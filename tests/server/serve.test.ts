import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createReloadChannel, RELOAD_SCRIPT, reloadTag } from '../../src/server/reload.ts';
import {
  createHandler,
  negotiateEncoding,
  parseRange,
  resolveRequestPath,
} from '../../src/server/serve.ts';
import { trackedTrees } from '../helpers.ts';
import { expectSecure, type Listening, listening, request } from './http.ts';

const { tree } = trackedTrees();

const CSP = "default-src 'self'; script-src 'self' 'sha256-x='";
const BIG = 'abcdefghij'.repeat(300);
const page = (body: string) =>
  `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
const SECRET = 'TOP SECRET';
const SITE: Record<string, string> = {
  'index.html': page('home'),
  'blog/index.html': page('blog'),
  'blog/a/index.html': page('post a'),
  '404.html': page('NOT FOUND PAGE'),
  'assets/main-ABC12345.js': BIG,
  'assets/fonts/f.woff2': BIG,
  'assets/site-ABC12345.css': BIG,
  'search-index.json': JSON.stringify({ text: BIG }),
  'notes.txt': 'plain',
  'robots.txt': 'User-agent: *',
  'sitemap.xml': '<urlset/>',
  'icon.svg': '<svg/>',
  'pic.png': 'PNG',
  'pic.jpg': 'JPG',
  'pic.jpeg': 'JPG',
  'pic.gif': 'GIF',
  'pic.webp': 'WEBP',
  'pic.avif': 'AVIF',
  'favicon.ico': 'ICO',
  'doc.pdf': 'PDF',
  'app.js.map': '{}',
  'data.json': '{}',
  'file.weird': 'x',
  'UPPER.HTML': page('upper'),
  'café.html': page('cafe'),
  'a b.txt': 'spaced',
  'fragment-only.html': '<p>no head element</p>',
  '_headers.txt': 'secret rules',
  '_csp.txt': 'secret policy',
  'empty-dir/.keep': '',
  'media/v.mp4': 'x',
  'media/v.webm': 'x',
  'media/a.mp3': 'x',
  'media/a.ogg': 'x',
  'media/f.woff': 'x',
  'media/f.ttf': 'x',
  'media/m.wasm': 'x',
  'media/site.webmanifest': '{}',
  'media/m.mjs': 'x',
  'media/t.csv': 'a,b',
  '.generated': '',
  'bytes.bin': '0123456789',
};

let site = '';
let server: Listening;

beforeAll(async () => {
  // The site is a subdirectory of its tree, next to a file a traversal would reach.
  const outer = await tree({
    'secret.txt': SECRET,
    ...Object.fromEntries(Object.entries(SITE).map(([rel, text]) => [`site/${rel}`, text])),
  });
  site = path.join(outer, 'site');
  server = await listening(createHandler({ root: site, csp: () => CSP }));
});
afterAll(() => server.close());

const get = (rawPath: string, headers: Record<string, string> = {}) =>
  request(server.port, rawPath, { headers });

describe('routing', () => {
  it('serves index.html for the root and for directories with a trailing slash', async () => {
    for (const [url, body] of [
      ['/', 'home'],
      ['/blog/', 'blog'],
      ['/blog/a/', 'post a'],
    ] as const) {
      const reply = await get(url);
      expect(reply.status, url).toBe(200);
      expect(reply.text, url).toContain(`<body>${body}</body>`);
      expect(reply.headers['content-type'], url).toBe('text/html; charset=utf-8');
    }
  });

  it('serves files by exact path, decoding percent-encoding', async () => {
    expect((await get('/blog/index.html')).text).toContain('blog');
    expect((await get('/caf%C3%A9.html')).text).toContain('cafe');
    expect((await get('/a%20b.txt')).text).toBe('spaced');
    expect((await get('/notes%2Etxt')).text).toBe('plain');
  });

  it('redirects a directory without a trailing slash, keeping the query string', async () => {
    for (const [from, to] of [
      ['/blog', './blog/'],
      ['/blog/a?x=1&y=%20z', './a/?x=1&y=%20z'],
      ['/blog?', './blog/?'],
    ] as const) {
      const reply = await get(from);
      expect(reply.status, from).toBe(301);
      expect(reply.headers.location, from).toBe(to);
      expect(reply.headers['cache-control'], from).toBe('no-cache');
      expectSecure(reply, CSP);
    }
  });

  it('does not redirect to a protocol-relative URL', async () => {
    for (const url of ['//blog', '//evil.example', '///blog', '//', '/%2f%2fblog']) {
      const reply = await get(url);
      expect(reply.status, url).toBe(404);
      expect(reply.headers.location, url).toBeUndefined();
    }
  });

  it('serves the 404 page with status 404 for missing paths, directories without index and file/ paths', async () => {
    for (const url of [
      '/nope',
      '/nope/',
      '/empty-dir/',
      '/index.html/',
      '/blog/a/missing.html',
      '/assets/missing.js',
    ]) {
      const reply = await get(url);
      expect(reply.status, url).toBe(404);
      expect(reply.text, url).toContain('NOT FOUND PAGE');
      expect(reply.headers['content-type'], url).toBe('text/html; charset=utf-8');
      expect(reply.headers['cache-control'], url).toBe('no-cache');
      expect(reply.headers.etag, url).toBeUndefined();
      expectSecure(reply, CSP);
    }
  });

  it('redirects a directory that has no index.html; the target then 404s', async () => {
    const reply = await get('/empty-dir');
    expect(reply.status).toBe(301);
    expect(reply.headers.location).toBe('./empty-dir/');
  });

  it('does not serve the host configuration files', async () => {
    for (const url of ['/_headers.txt', '/_csp.txt', '/%5Fcsp.txt', '/.generated']) {
      const reply = await get(url);
      expect(reply.status, url).toBe(404);
      expect(reply.text, url).not.toContain('secret');
    }
  });

  it('answers HEAD like GET, without a body', async () => {
    for (const [url, status] of [
      ['/', 200],
      ['/nope', 404],
      ['/blog', 301],
    ] as const) {
      const head = await request(server.port, url, { method: 'HEAD' });
      const full = await get(url);
      expect(head.status, url).toBe(status);
      expect(head.body.length, url).toBe(0);
      expect(head.headers['content-type'], url).toBe(full.headers['content-type']);
      expect(head.headers['content-length'], url).toBe(full.headers['content-length']);
      expectSecure(head, CSP);
    }
  });
});

describe('request validation', () => {
  it.each(['/%', '/%zz', '/a%2', '/%E0%A4%A', '/%ff', '/ok/%c0%af'])(
    '400 for malformed encoding %s',
    async (url) => {
      const reply = await get(url);
      expect(reply.status).toBe(400);
      expectSecure(reply, CSP);
    },
  );

  it('400 for a request target that is not a path', async () => {
    expect((await get('http://example.com/index.html')).status).toBe(400);
    expect((await get('*')).status).toBe(400);
  });

  it.each([
    '/../secret.txt',
    '/blog/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/%2E%2E/%2E%2E/secret.txt',
    '/..%2fsecret.txt',
    '/blog%2f..%2f..%2fsecret.txt',
    '/blog%2fa%2findex.html',
    '/%2fetc%2fpasswd',
    '/..%5csecret.txt',
    '/blog%5ca',
    '/%5c',
    '/index.html%00.txt',
    '/%00',
  ])('404 for traversal or unaddressable path %s', async (url) => {
    const reply = await get(url);
    expect(reply.status).toBe(404);
    expect(reply.text).toContain('NOT FOUND PAGE');
    expect(reply.text).not.toContain(SECRET);
    expectSecure(reply, CSP);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])(
    '405 with Allow for %s',
    async (method) => {
      const reply = await request(server.port, '/', { method });
      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe('GET, HEAD');
      expectSecure(reply, CSP);
    },
  );

  it('checks the method before the path', async () => {
    expect((await request(server.port, '/%zz', { method: 'POST' })).status).toBe(405);
  });
});

describe('resolveRequestPath', () => {
  const root = path.join(path.sep, 'srv', 'site');
  it.each([
    ['/', root],
    ['/a/b.html', path.join(root, 'a', 'b.html')],
    ['/a//b', path.join(root, 'a', 'b')],
    ['/%41', path.join(root, 'A')],
    ['/a/./b', path.join(root, 'a', 'b')],
    ['/a/../b', path.join(root, 'b')],
  ])('%s -> %s', (raw, expected) => {
    expect(resolveRequestPath(root, raw)).toBe(expected);
  });

  it.each([
    '/..',
    '/../x',
    '/%2e%2e/x',
    '/a%2fb',
    '/a%5cb',
    '/a%00',
    '//x',
    '//',
    '///x',
    '/a/../../x',
  ])('%s -> null', (raw) => {
    expect(resolveRequestPath(root, raw)).toBeNull();
  });

  it('does not mistake a programming error for an unaddressable path', () => {
    expect(() => resolveRequestPath('relative/root', '/x')).toThrow(TypeError);
  });

  it.each(['/%', '/%e0%a4', 'relative', ''])('throws URIError for %s', (raw) => {
    expect(() => resolveRequestPath(root, raw)).toThrow(URIError);
  });
});

describe('content types', () => {
  it.each([
    ['/index.html', 'text/html; charset=utf-8'],
    ['/UPPER.HTML', 'text/html; charset=utf-8'],
    ['/assets/site-ABC12345.css', 'text/css; charset=utf-8'],
    ['/assets/main-ABC12345.js', 'text/javascript; charset=utf-8'],
    ['/data.json', 'application/json; charset=utf-8'],
    ['/app.js.map', 'application/json; charset=utf-8'],
    ['/sitemap.xml', 'application/xml; charset=utf-8'],
    ['/notes.txt', 'text/plain; charset=utf-8'],
    ['/icon.svg', 'image/svg+xml; charset=utf-8'],
    ['/pic.png', 'image/png'],
    ['/pic.jpg', 'image/jpeg'],
    ['/pic.jpeg', 'image/jpeg'],
    ['/pic.gif', 'image/gif'],
    ['/pic.webp', 'image/webp'],
    ['/pic.avif', 'image/avif'],
    ['/favicon.ico', 'image/x-icon'],
    ['/assets/fonts/f.woff2', 'font/woff2'],
    ['/doc.pdf', 'application/pdf'],
    ['/file.weird', 'application/octet-stream'],
    ['/media/v.mp4', 'video/mp4'],
    ['/media/v.webm', 'video/webm'],
    ['/media/a.mp3', 'audio/mpeg'],
    ['/media/a.ogg', 'audio/ogg'],
    ['/media/f.woff', 'font/woff'],
    ['/media/f.ttf', 'font/ttf'],
    ['/media/m.wasm', 'application/wasm'],
    ['/media/site.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/media/m.mjs', 'text/javascript; charset=utf-8'],
    ['/media/t.csv', 'text/csv; charset=utf-8'],
  ])('%s is %s', async (url, type) => {
    expect((await get(url)).headers['content-type']).toBe(type);
  });
});

describe('caching', () => {
  const immutable = 'public, max-age=31536000, immutable';

  it('marks hashed assets immutable, and everything else, the search index included, no-cache', async () => {
    for (const [url, expected] of [
      ['/assets/main-ABC12345.js', immutable],
      ['/assets/fonts/f.woff2', immutable],
      ['/search-index.json', 'no-cache'],
      ['/', 'no-cache'],
      ['/blog/', 'no-cache'],
      ['/robots.txt', 'no-cache'],
      ['/404.html', 'no-cache'],
    ] as const) {
      expect((await get(url)).headers['cache-control'], url).toBe(expected);
    }
  });

  it('sends a weak ETag from size and mtime that changes with the file', async () => {
    const first = (await get('/notes.txt')).headers.etag;
    expect(first).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect((await get('/notes.txt')).headers.etag).toBe(first);
    const file = path.join(site, 'etag.txt');
    await fs.writeFile(file, 'one');
    const before = (await get('/etag.txt')).headers.etag;
    await fs.writeFile(file, 'three');
    expect((await get('/etag.txt')).headers.etag).not.toBe(before);
    await fs.utimes(file, new Date(0), new Date(1_000_000));
    const sameSizeOldTime = (await get('/etag.txt')).headers.etag;
    await fs.utimes(file, new Date(0), new Date(2_000_000));
    expect((await get('/etag.txt')).headers.etag).not.toBe(sameSizeOldTime);
  });

  it('answers a matching If-None-Match with an empty 304 that keeps the headers', async () => {
    const first = await get('/assets/main-ABC12345.js');
    const etag = first.headers.etag ?? '';
    for (const header of [etag, etag.replace('W/', ''), `"other", ${etag}`, '*']) {
      const reply = await get('/assets/main-ABC12345.js', { 'If-None-Match': header });
      expect(reply.status, header).toBe(304);
      expect(reply.body.length).toBe(0);
      expect(reply.headers.etag).toBe(etag);
      expect(reply.headers['cache-control']).toBe(immutable);
      expect(reply.headers.vary).toBe('Accept-Encoding');
      expectSecure(reply, CSP);
    }
  });

  it('answers a different If-None-Match with the file, and a 304 for HEAD too', async () => {
    const etag = (await get('/notes.txt')).headers.etag ?? '';
    const stale = await get('/notes.txt', { 'If-None-Match': 'W/"0-0"' });
    expect(stale.status).toBe(200);
    expect(stale.text).toBe('plain');
    const head = await request(server.port, '/notes.txt', {
      method: 'HEAD',
      headers: { 'If-None-Match': etag },
    });
    expect(head.status).toBe(304);
  });

  it('never revalidates the 404 page into a 304', async () => {
    const reply = await get('/nope', { 'If-None-Match': '*' });
    expect(reply.status).toBe(404);
    expect(reply.text).toContain('NOT FOUND PAGE');
  });
});

describe('compression', () => {
  const plain = Buffer.from(BIG);

  it('prefers br, then gzip, and decodes to the original', async () => {
    const br = await get('/assets/main-ABC12345.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(zlib.brotliDecompressSync(br.body)).toEqual(plain);
    expect(br.body.length).toBeLessThan(plain.length);
    const gzip = await get('/assets/main-ABC12345.js', { 'Accept-Encoding': 'gzip' });
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gzip.body)).toEqual(plain);
  });

  it('sends identity with a Content-Length when nothing is accepted or the header is absent', async () => {
    for (const header of [undefined, 'identity', 'br;q=0, gzip;q=0', 'deflate', '']) {
      const reply = await get(
        '/assets/main-ABC12345.js',
        header === undefined ? {} : { 'Accept-Encoding': header },
      );
      expect(reply.headers['content-encoding'], `${header}`).toBeUndefined();
      expect(reply.headers['content-length'], `${header}`).toBe(String(plain.length));
      expect(reply.body, `${header}`).toEqual(plain);
    }
  });

  it('honours quality values', async () => {
    const encodingFor = async (header: string) =>
      (await get('/assets/main-ABC12345.js', { 'Accept-Encoding': header })).headers[
        'content-encoding'
      ];
    expect(await encodingFor('br;q=0, gzip')).toBe('gzip');
    expect(await encodingFor('gzip;q=0.8, br;q=0.5')).toBe('gzip');
    expect(await encodingFor('gzip;q=0.5, br;q=0.8')).toBe('br');
    expect(await encodingFor('*')).toBe('br');
    expect(await encodingFor('*;q=0, gzip')).toBe('gzip');
  });

  it('marks compressible types with Vary, compressed or not, and leaves binary types alone', async () => {
    expect((await get('/index.html')).headers.vary).toBe('Accept-Encoding');
    const font = await get('/assets/fonts/f.woff2', { 'Accept-Encoding': 'br, gzip' });
    expect(font.headers['content-encoding']).toBeUndefined();
    expect(font.headers.vary).toBeUndefined();
    expect(font.body).toEqual(plain);
    for (const url of ['/pic.png', '/doc.pdf', '/file.weird']) {
      expect(
        (await get(url, { 'Accept-Encoding': 'br' })).headers['content-encoding'],
        url,
      ).toBeUndefined();
    }
  });

  it('compresses the 404 page, and HEAD announces the encoding without a body', async () => {
    const reply = await get('/nope', { 'Accept-Encoding': 'gzip' });
    expect(reply.status).toBe(404);
    expect(zlib.gunzipSync(reply.body).toString()).toContain('NOT FOUND PAGE');
    const head = await request(server.port, '/', {
      method: 'HEAD',
      headers: { 'Accept-Encoding': 'br' },
    });
    expect(head.headers['content-encoding']).toBe('br');
    expect(head.headers['content-length']).toBeUndefined();
    expect(head.body.length).toBe(0);
  });

  describe('negotiateEncoding', () => {
    it.each([
      [undefined, null],
      ['', null],
      ['br', 'br'],
      ['BR', 'br'],
      ['gzip, br', 'br'],
      ['gzip;q=1.0, br;q=0.9', 'gzip'],
      ['br;q=0', null],
      ['br;q=0, gzip;q=0.1', 'gzip'],
      ['*;q=0.5', 'br'],
      ['br;q=0, *', 'gzip'],
      ['gzip;q=abc', null],
      ['gzip;q=1.5', null],
      ['gzip;q=-1', null],
      ['gzip; q=0.5', 'gzip'],
      [',,;q=1', null],
      ['gzip;q= 0.5', 'gzip'],
      ['gzip ; q = 0', null],
      ['br;Q=0.2, gzip;q=  0.7', 'gzip'],
    ])('%j -> %j', (header, expected) => {
      expect(negotiateEncoding(header)).toBe(expected);
    });
  });
});

describe('without a 404 page', () => {
  it('falls back to plain text', async () => {
    const root = await tree({ 'index.html': page('x') });
    const bare = await listening(createHandler({ root, csp: () => CSP }));
    try {
      const reply = await request(bare.port, '/missing');
      expect(reply.status).toBe(404);
      expect(reply.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(reply.text).toBe('Not found\n');
      expectSecure(reply, CSP);
      const head = await request(bare.port, '/missing', { method: 'HEAD' });
      expect(head.body.length).toBe(0);
      expect(head.headers['content-length']).toBe('10');
    } finally {
      await bare.close();
    }
  });

  it('reads the policy per request', async () => {
    const root = await tree({ 'index.html': page('x') });
    let policy = 'one';
    const dynamic = await listening(createHandler({ root, csp: () => policy }));
    try {
      expect((await request(dynamic.port, '/')).headers['content-security-policy']).toBe('one');
      policy = 'two';
      expect((await request(dynamic.port, '/')).headers['content-security-policy']).toBe('two');
    } finally {
      await dynamic.close();
    }
  });
});

describe('live reload', () => {
  let root = '';
  const channel = createReloadChannel();
  let live: Listening;

  beforeAll(async () => {
    root = await tree(SITE);
    live = await listening(createHandler({ root, csp: () => CSP, reload: channel }));
  });
  afterAll(async () => {
    channel.close();
    await live.close();
  });

  const getLive = (rawPath: string, headers: Record<string, string> = {}) =>
    request(live.port, rawPath, { headers });

  it('injects the script tag before </head> in HTML only, with a matching Content-Length', async () => {
    const plain = await get('/');
    const tag = reloadTag(channel.build);
    const reply = await getLive('/');
    expect(reply.text).toBe(plain.text.replace('</head>', `${tag}</head>`));
    expect(reply.headers['content-length']).toBe(String(Buffer.byteLength(reply.text)));
    expect(Number(reply.headers['content-length'])).toBe(
      Number(plain.headers['content-length']) + tag.length,
    );
    expect(reply.headers.etag).not.toBe(plain.headers.etag);
    expectSecure(reply, CSP);
    for (const url of [
      '/notes.txt',
      '/assets/main-ABC12345.js',
      '/search-index.json',
      '/icon.svg',
    ]) {
      expect((await getLive(url)).text, url).not.toContain('reload.js');
    }
  });

  it('injects into the 404 page and into uppercase tags, and leaves headless HTML alone', async () => {
    expect((await getLive('/nope')).text).toContain(reloadTag(channel.build));
    await fs.writeFile(path.join(root, 'upper.html'), '<HTML><HEAD></HEAD></HTML>');
    expect((await getLive('/upper.html')).text).toBe(
      `<HTML><HEAD>${reloadTag(channel.build)}</HEAD></HTML>`,
    );
    expect((await getLive('/fragment-only.html')).text).toBe('<p>no head element</p>');
  });

  it('sends the whole injected page for a Range request, not a 206', async () => {
    const plain = await get('/');
    const reply = await getLive('/', { Range: 'bytes=0-3' });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-range']).toBeUndefined();
    expect(reply.text).toBe(plain.text.replace('</head>', `${reloadTag(channel.build)}</head>`));
  });

  it('keeps the validators consistent: the 304 matches the injected ETag', async () => {
    const etag = (await getLive('/')).headers.etag ?? '';
    expect((await getLive('/', { 'If-None-Match': etag })).status).toBe(304);
  });

  it('injects into compressed responses and HEAD sends the injected length', async () => {
    const reply = await getLive('/', { 'Accept-Encoding': 'br' });
    expect(zlib.brotliDecompressSync(reply.body).toString()).toContain(reloadTag(channel.build));
    const head = await request(live.port, '/', { method: 'HEAD' });
    expect(head.headers['content-length']).toBe(String((await getLive('/')).body.length));
  });

  it('serves the reload script itself, which the CSP allows (same origin)', async () => {
    const reply = await getLive('/__preview/reload.js');
    expect(reply.status).toBe(200);
    expect(reply.text).toBe(RELOAD_SCRIPT);
    expect(reply.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(reply.headers['cache-control']).toBe('no-cache');
    expectSecure(reply, CSP);
  });

  it('serves the script for any build query', async () => {
    expect((await getLive('/__preview/reload.js?build=5')).text).toBe(RELOAD_SCRIPT);
  });

  it('stamps pages with the current build, so a stale cached copy never validates', async () => {
    const before = await getLive('/');
    expect(before.text).toContain(`reload.js?build=${channel.build}`);
    channel.notify();
    const after = await getLive('/');
    expect(after.text).toContain(`reload.js?build=${channel.build}`);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect((await getLive('/', { 'If-None-Match': before.headers.etag ?? '' })).status).toBe(200);
  });

  it('streams the build to connected pages and ends the stream on close', async () => {
    const announced = channel.build;
    let notified = false;
    const received = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: live.port, path: '/__reload' }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['content-security-policy']).toBe(CSP);
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
          if (text.includes(`data: ${channel.build}\n\n`) && channel.build > announced) {
            req.destroy();
            resolve(text);
          } else if (text.includes('retry:') && !notified) {
            notified = true;
            channel.notify();
          }
        });
      });
      req.on('error', reject);
    });
    expect(received).toContain('retry: 1000');
    expect(received).toContain(`event: build\ndata: ${announced}\n\n`);
    expect(received).toContain(`event: build\ndata: ${announced + 1}\n\n`);
  });

  it('is absent when reload is disabled', async () => {
    expect((await get('/__preview/reload.js')).status).toBe(404);
    expect((await get('/__reload')).status).toBe(404);
    expect((await get('/')).text).not.toContain('reload.js');
  });

  it('does not open an event stream for HEAD', async () => {
    const head = await request(live.port, '/__reload', { method: 'HEAD' });
    expect(head.status).toBe(404);
  });
});

describe('failures', () => {
  it('answers 500 with the security headers when a handler step throws before sending', async () => {
    const root = await tree({ 'index.html': page('x') });
    const reload = {
      connect() {
        throw new Error('boom');
      },
      build: 0,
      notify() {},
      close() {},
    };
    const broken = await listening(createHandler({ root, csp: () => CSP, reload }));
    try {
      const reply = await request(broken.port, '/__reload');
      expect(reply.status).toBe(500);
      expect(reply.text).toBe('Internal server error\n');
      expect(reply.text).not.toContain('boom');
      expectSecure(reply, CSP);
    } finally {
      await broken.close();
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'drops the connection when a file cannot be read after the response started',
    async () => {
      const root = await tree({ 'locked.txt': BIG });
      await fs.chmod(path.join(root, 'locked.txt'), 0o000);
      const locked = await listening(createHandler({ root, csp: () => CSP }));
      try {
        await expect(request(locked.port, '/locked.txt')).rejects.toThrow(/socket hang up/);
      } finally {
        await locked.close();
      }
    },
  );
});

describe('ranges', () => {
  const range = (value: string, extra: Record<string, string> = {}) =>
    get('/bytes.bin', { Range: value, ...extra });

  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=-100', '0123456789', 'bytes 0-9/10'],
    ['bytes=0-0', '0', 'bytes 0-0/10'],
    ['bytes=5-100', '56789', 'bytes 5-9/10'],
    ['bytes=9-9', '9', 'bytes 9-9/10'],
  ])('%s -> 206 %s', async (header, body, contentRange) => {
    const reply = await range(header);
    expect(reply.status).toBe(206);
    expect(reply.text).toBe(body);
    expect(reply.headers['content-range']).toBe(contentRange);
    expect(reply.headers['content-length']).toBe(String(body.length));
    expect(reply.headers['accept-ranges']).toBe('bytes');
    expect(reply.headers.etag).toBeDefined();
    expectSecure(reply, CSP);
  });

  it.each(['bytes=10-', 'bytes=10-12', 'bytes=99-', 'bytes=-0'])(
    '%s -> 416 with the size',
    async (header) => {
      const reply = await range(header);
      expect(reply.status).toBe(416);
      expect(reply.headers['content-range']).toBe('bytes */10');
      expectSecure(reply, CSP);
    },
  );

  it('answers 416 for any range of an empty file', async () => {
    await fs.writeFile(path.join(site, 'empty.bin'), '');
    for (const header of ['bytes=0-', 'bytes=-1', 'bytes=0-0']) {
      expect((await get('/empty.bin', { Range: header })).status, header).toBe(416);
    }
  });

  it.each(['bytes=5-2', 'bytes=', 'bytes=-', 'bytes=a-b', 'items=0-1', 'bytes=0-1,3-4', '0-1', ''])(
    'ignores the malformed or multiple range %j and sends the whole file',
    async (header) => {
      const reply = await range(header);
      expect(reply.status).toBe(200);
      expect(reply.text).toBe('0123456789');
      expect(reply.headers['content-range']).toBeUndefined();
    },
  );

  it('advertises ranges on identity responses only', async () => {
    expect((await get('/bytes.bin')).headers['accept-ranges']).toBe('bytes');
    expect((await get('/assets/main-ABC12345.js')).headers['accept-ranges']).toBe('bytes');
    expect(
      (await get('/assets/main-ABC12345.js', { 'Accept-Encoding': 'br' })).headers['accept-ranges'],
    ).toBeUndefined();
    expect((await get('/nope')).headers['accept-ranges']).toBeUndefined();
  });

  it('does not range a compressed response: the whole body is sent', async () => {
    const reply = await get('/assets/main-ABC12345.js', {
      'Accept-Encoding': 'gzip',
      Range: 'bytes=0-9',
    });
    expect(reply.status).toBe(200);
    expect(zlib.gunzipSync(reply.body).toString()).toBe(BIG);
  });

  it('does not range the 404 page or HEAD requests', async () => {
    expect((await get('/nope', { Range: 'bytes=0-3' })).status).toBe(404);
    const head = await request(server.port, '/bytes.bin', {
      method: 'HEAD',
      headers: { Range: 'bytes=0-3' },
    });
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe('10');
  });

  it('validates before ranging: a matching If-None-Match gives 304', async () => {
    const etag = (await get('/bytes.bin')).headers.etag ?? '';
    expect((await range('bytes=0-1', { 'If-None-Match': etag })).status).toBe(304);
  });

  describe('parseRange', () => {
    it.each([
      [undefined, 10, undefined],
      ['bytes=0-4', 10, { start: 0, end: 4 }],
      [' bytes=0-4 ', 10, { start: 0, end: 4 }],
      ['bytes=4-', 10, { start: 4, end: 9 }],
      ['bytes=-4', 10, { start: 6, end: 9 }],
      ['bytes=-4', 3, { start: 0, end: 2 }],
      ['bytes=2-2', 10, { start: 2, end: 2 }],
      ['bytes=3-1', 10, undefined],
      ['bytes=10-', 10, 'unsatisfiable'],
      ['bytes=0-', 0, 'unsatisfiable'],
      ['bytes=-1', 0, 'unsatisfiable'],
      ['bytes=-0', 10, 'unsatisfiable'],
      ['bytes=1-2,4-5', 10, undefined],
    ])('%j of %i bytes -> %j', (header, size, expected) => {
      expect(parseRange(header, size)).toEqual(expected);
    });
  });
});

describe('symlinks', () => {
  it('serves links that stay inside the site and refuses those that leave it', async () => {
    const outside = await tree({ 'secret.txt': 'SECRET', 'dir/index.html': page('SECRET DIR') });
    const root = await tree({
      'index.html': page('home'),
      '404.html': page('NOT FOUND PAGE'),
      'real.txt': 'real',
      '_csp.txt': 'policy',
    });
    await fs.symlink('real.txt', path.join(root, 'inside.txt'));
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
    await fs.symlink(path.join(outside, 'dir'), path.join(root, 'leakdir'));
    await fs.symlink('_csp.txt', path.join(root, 'csp-link.txt'));
    const linked = await listening(createHandler({ root, csp: () => CSP }));
    try {
      expect((await request(linked.port, '/inside.txt')).text).toBe('real');
      for (const url of ['/leak.txt', '/leakdir/', '/csp-link.txt']) {
        const reply = await request(linked.port, url);
        expect(reply.status, url).toBe(404);
        expect(reply.text, url).not.toContain('SECRET');
        expect(reply.text, url).not.toContain('policy');
      }
    } finally {
      await linked.close();
    }
  });

  it('does not serve a 404 page that is a link out of the site', async () => {
    const outside = await tree({ 'page.html': page('SECRET 404') });
    const root = await tree({ 'index.html': page('home') });
    await fs.symlink(path.join(outside, 'page.html'), path.join(root, '404.html'));
    const linked = await listening(createHandler({ root, csp: () => CSP }));
    try {
      const reply = await request(linked.port, '/missing');
      expect(reply.status).toBe(404);
      expect(reply.text).toBe('Not found\n');
    } finally {
      await linked.close();
    }
  });

  it('serves a site whose root directory is itself a link', async () => {
    const real = await tree({ 'index.html': page('via link') });
    const link = path.join(path.dirname(real), `link-${path.basename(real)}`);
    await fs.symlink(real, link);
    const linked = await listening(createHandler({ root: link, csp: () => CSP }));
    try {
      expect((await request(linked.port, '/')).text).toContain('via link');
    } finally {
      await linked.close();
      await fs.rm(link);
    }
  });
});

describe('unresolvable root', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves nothing, answering 404, when the root cannot be resolved, and resolves it again later', async () => {
    const root = await tree({ 'index.html': page('home') });
    const realpath = fs.realpath.bind(fs);
    const failing = vi
      .spyOn(fs, 'realpath')
      .mockImplementation(async (file, options) =>
        file === root ? Promise.reject(new Error('ENOENT')) : realpath(file, options),
      );
    const live = await listening(createHandler({ root, csp: () => CSP }));
    try {
      const refused = await request(live.port, '/');
      expect(refused.status).toBe(404);
      expect(refused.text).not.toContain('home');
      failing.mockRestore();
      const served = await request(live.port, '/');
      expect(served.status).toBe(200);
      expect(served.text).toContain('home');
    } finally {
      await live.close();
    }
  });
});

describe('validation before reading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a matching If-None-Match for HTML without reading the file, and reads on a miss', async () => {
    const root = await tree({ 'index.html': page('x') });
    const channel = createReloadChannel();
    const live = await listening(createHandler({ root, csp: () => CSP, reload: channel }));
    try {
      const etag = (await request(live.port, '/')).headers.etag ?? '';
      const read = vi.spyOn(fs, 'readFile');
      expect((await request(live.port, '/', { headers: { 'If-None-Match': etag } })).status).toBe(
        304,
      );
      expect(read).not.toHaveBeenCalled();
      expect(
        (await request(live.port, '/', { headers: { 'If-None-Match': 'W/"0-0"' } })).status,
      ).toBe(200);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      channel.close();
      await live.close();
    }
  });
});

describe('error responses', () => {
  it('carry the policy headers: a failure while computing them is retried for the 500', async () => {
    const root = await tree({ 'index.html': page('x') });
    let calls = 0;
    const flaky = await listening(
      createHandler({
        root,
        csp: () => {
          calls++;
          if (calls === 1) {
            throw new Error('policy unavailable');
          }
          return CSP;
        },
      }),
    );
    try {
      const reply = await request(flaky.port, '/');
      expect(reply.status).toBe(500);
      expectSecure(reply, CSP);
    } finally {
      await flaky.close();
    }
  });

  it('drops the connection when even the 500 cannot be produced', async () => {
    const root = await tree({ 'index.html': page('x') });
    const broken = await listening(
      createHandler({
        root,
        csp: () => {
          throw new Error('always');
        },
      }),
    );
    try {
      await expect(request(broken.port, '/')).rejects.toThrow(/socket hang up/);
    } finally {
      await broken.close();
    }
  });
});
