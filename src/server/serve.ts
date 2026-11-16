import type { Stats } from 'node:fs';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import {
  cacheControl,
  NO_CACHE,
  NOT_FOUND_FILE,
  SECURITY_HEADERS,
  UNSERVED_FILES,
} from '../lib/http-policy.ts';
import { assertInside, toPosix } from '../lib/paths.ts';
import {
  RELOAD_EVENTS_PATH,
  RELOAD_SCRIPT,
  RELOAD_SCRIPT_PATH,
  type ReloadChannel,
  reloadTag,
} from './reload.ts';

export interface HandlerOptions {
  readonly root: string;
  /** Content-Security-Policy to send; read per request. */
  readonly csp: () => string;
  /** Enables live reload: the event stream, its script, and the script tag in HTML. */
  readonly reload?: ReloadChannel;
}

interface MediaType {
  readonly type: string;
  /** Text is sent as UTF-8 and compressed. */
  readonly text: boolean;
}

const TEXT = (type: string): MediaType => ({ type, text: true });
const BINARY = (type: string): MediaType => ({ type, text: false });
const MEDIA_TYPES: ReadonlyMap<string, MediaType> = new Map([
  ['.html', TEXT('text/html')],
  ['.css', TEXT('text/css')],
  ['.js', TEXT('text/javascript')],
  ['.json', TEXT('application/json')],
  ['.map', TEXT('application/json')],
  ['.xml', TEXT('application/xml')],
  ['.txt', TEXT('text/plain')],
  ['.svg', TEXT('image/svg+xml')],
  ['.png', BINARY('image/png')],
  ['.jpg', BINARY('image/jpeg')],
  ['.jpeg', BINARY('image/jpeg')],
  ['.gif', BINARY('image/gif')],
  ['.webp', BINARY('image/webp')],
  ['.avif', BINARY('image/avif')],
  ['.ico', BINARY('image/x-icon')],
  ['.woff2', BINARY('font/woff2')],
  ['.pdf', BINARY('application/pdf')],
  ['.mp4', BINARY('video/mp4')],
  ['.webm', BINARY('video/webm')],
  ['.mp3', BINARY('audio/mpeg')],
  ['.ogg', BINARY('audio/ogg')],
  ['.woff', BINARY('font/woff')],
  ['.ttf', BINARY('font/ttf')],
  ['.wasm', BINARY('application/wasm')],
  ['.webmanifest', TEXT('application/manifest+json')],
  ['.mjs', TEXT('text/javascript')],
  ['.csv', TEXT('text/csv')],
]);
const UNKNOWN_TYPE = BINARY('application/octet-stream');
const HTML = 'text/html';

const mediaType = (file: string): MediaType =>
  MEDIA_TYPES.get(path.extname(file).toLowerCase()) ?? UNKNOWN_TYPE;
const contentType = ({ type, text }: MediaType): string => (text ? `${type}; charset=utf-8` : type);

type Encoding = 'br' | 'gzip';
const ENCODINGS: readonly Encoding[] = ['br', 'gzip'];

/** A qvalue (`0`..`1`, up to three decimals), NaN if malformed. */
const parseQuality = (text: string): number => (/^\d(\.\d{0,3})?$/.test(text) ? Number(text) : NaN);

/** Quality values of an `Accept-Encoding` header by coding; malformed entries are ignored. */
function acceptedEncodings(header: string): Map<string, number> {
  const accepted = new Map<string, number>();
  for (const entry of header.split(',')) {
    const [coding = '', ...params] = entry.split(';').map((s) => s.trim());
    const qParam = params.map((p) => /^q\s*=\s*(.*)$/i.exec(p)?.[1]).find((q) => q !== undefined);
    const quality = qParam === undefined ? 1 : parseQuality(qParam);
    if (coding !== '' && quality >= 0 && quality <= 1) {
      accepted.set(coding.toLowerCase(), quality);
    }
  }
  return accepted;
}

/** Best encoding the client accepts (br before gzip on equal quality), or null for identity. */
export function negotiateEncoding(header: string | undefined): Encoding | null {
  const accepted = acceptedEncodings(header ?? '');
  const wildcard = accepted.get('*') ?? 0;
  let best: Encoding | null = null;
  let bestQuality = 0;
  for (const encoding of ENCODINGS) {
    const quality = accepted.get(encoding) ?? wildcard;
    if (quality > bestQuality) {
      best = encoding;
      bestQuality = quality;
    }
  }
  return best;
}

function encoder(encoding: Encoding): zlib.BrotliCompress | zlib.Gzip {
  return encoding === 'br'
    ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    : zlib.createGzip();
}

/**
 * Absolute path below `root` for the raw (still percent-encoded) path of a request.
 * The containment check is lexical; symlinks are checked against the real root when serving.
 *
 * @returns null if the path cannot name a file: NUL, backslash, an encoded separator, an empty
 *          first segment (`//x`) or a traversal out of `root`
 * @throws URIError on malformed percent-encoding, or a path that does not start with `/`
 */
export function resolveRequestPath(root: string, rawPath: string): string | null {
  if (!rawPath.startsWith('/')) {
    throw new URIError(`not an absolute path: ${rawPath}`);
  }
  const segments = rawPath.split('/').slice(1).map(decodeURIComponent);
  // `//x` would read as a protocol-relative URL in any redirect built from the path.
  const emptyFirst = segments.length > 1 && segments[0] === '';
  if (emptyFirst || segments.some((s) => /[/\\\0]/.test(s))) {
    return null;
  }
  try {
    return assertInside(root, segments.join('/'));
  } catch (err) {
    if (err instanceof RangeError) {
      return null;
    }
    throw err;
  }
}

/** Weak validator from size and modification time, and the reload build a page was injected with. */
const etagOf = (size: number, mtimeMs: number, build?: number): string =>
  `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}${build === undefined ? '' : `-b${build}`}"`;

/** Whether an `If-None-Match` header matches `etag` (weak comparison). */
function matchesEtag(header: string | undefined, etag: string): boolean {
  const weak = (tag: string) => tag.trim().replace(/^W\//, '');
  return (header?.split(',') ?? []).some((tag) => tag.trim() === '*' || weak(tag) === weak(etag));
}

const injectReload = (page: Buffer, tag: string): Buffer =>
  Buffer.from(page.toString('utf8').replace(/<\/head>/i, (end) => `${tag}${end}`));

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The single byte range of a `Range` header for a body of `size` bytes.
 * @returns undefined if the header is absent, malformed or asks for several ranges (the whole
 *          body is sent then), 'unsatisfiable' if it lies outside the body
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  const [first = '', last = ''] = match?.slice(1) ?? [];
  if (!match || (first === '' && last === '')) {
    return undefined;
  }
  if (first === '') {
    const suffix = Number(last);
    return suffix === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (last !== '' && Number(last) < start) {
    return undefined;
  }
  return start >= size ? 'unsatisfiable' : { start, end };
}

/** Stats of a regular file, or undefined if `file` is missing or not one. */
async function statFile(file: string): Promise<Stats | undefined> {
  const stats = await fs.stat(file).catch(() => undefined);
  return stats?.isFile() ? stats : undefined;
}

interface Found {
  readonly file: string;
  readonly stats: Stats;
}

type Route =
  | { readonly kind: 'bad-request' }
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'reload-events'; readonly channel: ReloadChannel }
  | { readonly kind: 'reload-script' }
  | { readonly kind: 'file'; readonly found: Found }
  | { readonly kind: 'missing' };

const MISSING = { kind: 'missing' } as const;

function sendText(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  text: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': NO_CACHE,
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : text);
}

/** Request handler serving the files below `options.root` as a static host does. */
export function createHandler(options: HandlerOptions): RequestListener {
  const { root, csp, reload } = options;
  const notFoundPage = path.join(root, NOT_FOUND_FILE);
  let realRoot: string | undefined;

  function applyPolicyHeaders(res: ServerResponse): void {
    res.setHeader('Content-Security-Policy', csp());
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
  }

  /** The file if it is regular, lies inside the real root once symlinks are resolved, and is served. */
  async function servable(file: string): Promise<Found | undefined> {
    const stats = await statFile(file);
    const real = await fs.realpath(file).catch(() => undefined);
    realRoot ??= await fs.realpath(root).catch(() => undefined);
    if (!stats || real === undefined || realRoot === undefined) {
      return undefined;
    }
    try {
      assertInside(realRoot, real);
    } catch {
      return undefined;
    }
    return UNSERVED_FILES.has(toPosix(path.relative(realRoot, real))) ? undefined : { file, stats };
  }

  async function route(
    rawPath: string,
    search: string,
    method: string | undefined,
  ): Promise<Route> {
    let target: string | null;
    try {
      target = resolveRequestPath(root, rawPath);
    } catch {
      return { kind: 'bad-request' };
    }
    if (reload && method === 'GET' && rawPath === RELOAD_EVENTS_PATH) {
      return { kind: 'reload-events', channel: reload };
    }
    if (reload && rawPath === RELOAD_SCRIPT_PATH) {
      return { kind: 'reload-script' };
    }
    if (target === null) {
      return MISSING;
    }
    const stats = await fs.stat(target).catch(() => undefined);
    const trailingSlash = rawPath.endsWith('/');
    if (stats?.isDirectory()) {
      if (!trailingSlash) {
        // Relative to the request URL, so it cannot name another host.
        const last = rawPath.slice(rawPath.lastIndexOf('/') + 1);
        return { kind: 'redirect', location: `./${last}/${search}` };
      }
      return found(path.join(target, 'index.html'));
    }
    // A file is not addressable below a trailing slash.
    return trailingSlash ? MISSING : found(target);
  }

  async function found(file: string): Promise<Route> {
    const hit = await servable(file);
    return hit ? { kind: 'file', found: hit } : MISSING;
  }

  async function sendFile(
    req: IncomingMessage,
    res: ServerResponse,
    { file, stats }: Found,
    status: 200 | 404,
  ): Promise<void> {
    const media = mediaType(file);
    const build = reload !== undefined && media.type === HTML ? reload.build : undefined;
    const tag = build === undefined ? undefined : reloadTag(build);
    const etag =
      status === 200 ? etagOf(stats.size + (tag?.length ?? 0), stats.mtimeMs, build) : undefined;
    const caching = {
      'Cache-Control': status === 200 ? cacheControl(toPosix(path.relative(root, file))) : NO_CACHE,
      ...(media.text ? { Vary: 'Accept-Encoding' } : {}),
      ...(etag ? { ETag: etag } : {}),
    };
    if (etag && matchesEtag(req.headers['if-none-match'], etag)) {
      res.writeHead(304, caching);
      res.end();
      return;
    }
    const page = tag === undefined ? undefined : injectReload(await fs.readFile(file), tag);
    const size = page?.length ?? stats.size;
    const encoding = media.text ? negotiateEncoding(req.headers['accept-encoding']) : null;
    const ranged = status === 200 && !encoding && !page;
    const range = ranged && req.method === 'GET' ? parseRange(req.headers.range, size) : undefined;
    if (range === 'unsatisfiable') {
      sendText(req, res, 416, 'Range not satisfiable\n', { 'Content-Range': `bytes */${size}` });
      return;
    }
    const length = range ? range.end - range.start + 1 : size;
    res.writeHead(range ? 206 : status, {
      'Content-Type': contentType(media),
      ...caching,
      ...(ranged ? { 'Accept-Ranges': 'bytes' } : {}),
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
      ...(encoding ? { 'Content-Encoding': encoding } : { 'Content-Length': String(length) }),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const source = page ? Readable.from([page]) : createReadStream(file, range);
    await pipeline(encoding ? [source, encoder(encoding), res] : [source, res]);
  }

  async function sendNotFound(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const page = await servable(notFoundPage);
    if (page) {
      await sendFile(req, res, page, 404);
    } else {
      sendText(req, res, 404, 'Not found\n');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyPolicyHeaders(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(req, res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
      return;
    }
    const url = req.url ?? '/';
    const queryAt = url.indexOf('?');
    const rawPath = queryAt === -1 ? url : url.slice(0, queryAt);
    const dest = await route(rawPath, queryAt === -1 ? '' : url.slice(queryAt), req.method);
    switch (dest.kind) {
      case 'bad-request':
        sendText(req, res, 400, 'Bad request\n');
        break;
      case 'redirect':
        sendText(req, res, 301, '', { Location: dest.location });
        break;
      case 'reload-events':
        dest.channel.connect(res);
        break;
      case 'reload-script':
        sendText(req, res, 200, RELOAD_SCRIPT, {
          'Content-Type': 'text/javascript; charset=utf-8',
        });
        break;
      case 'file':
        await sendFile(req, res, dest.found, 200);
        break;
      case 'missing':
        await sendNotFound(req, res);
        break;
    }
  }

  function fail(req: IncomingMessage, res: ServerResponse): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    applyPolicyHeaders(res);
    sendText(req, res, 500, 'Internal server error\n');
  }

  return (req, res) => {
    handle(req, res)
      .catch(() => fail(req, res))
      .catch(() => res.destroy());
  };
}
