import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dirFlag, type Env, type Output, parseOrUsage, resolveSettings } from '../lib/cli.ts';
import { compareStrings } from '../lib/compare.ts';
import {
  CSP_FILE,
  contentSecurityPolicy,
  HEADERS_FILE,
  MARKER_FILE,
  renderHeaders,
  UNSERVED_FILES,
} from '../lib/http-policy.ts';
import { isErrnoException } from '../lib/node-guards.ts';
import { assertInside, BUILD, PUBLISH, ROOT, SITE_DEFAULT, toPosix } from '../lib/paths.ts';
import { errorMessage } from '../shared/guards.ts';
import { MANIFEST_FILE, parsePublishManifest } from './manifest.ts';
import { assertReplaceable, checkOutDir, markGenerated } from './out-dir.ts';

const USAGE = 'usage: publish [--site <dir>] [--build <dir>] [--publish <dir>]';

export interface PublishOptions {
  /** Site directory; the publish directory must not overlap it. */
  readonly siteDir?: string;
  readonly buildDir?: string;
  readonly publishDir?: string;
}

export interface PublishResult {
  /** Files copied, site-relative. */
  readonly files: readonly string[];
  /** Of `files`, those new or different from the previous publish. */
  readonly changed: number;
  /** Of `files`, those identical to the previous publish; they keep its modification time. */
  readonly unchanged: number;
  /** Policy the host should send, as written to `_csp.txt`. */
  readonly csp: string;
  readonly warnings: readonly string[];
}

/** Files of `dir`, relative and `/`-separated. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => toPosix(path.relative(dir, path.join(e.parentPath, e.name))));
}

/** Stat of `file`, or undefined if it does not exist. */
const statIfExists = (file: string) =>
  fs.stat(file).catch((err: unknown) => {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return undefined;
    }
    throw err;
  });

/**
 * Give `staged` the modification time of `previous` if both hold the same bytes, so a sync that
 * compares times and sizes skips it.
 * @returns whether `previous` was a file with identical contents
 */
async function keepTimestamp(previous: string, staged: string): Promise<boolean> {
  const before = await statIfExists(previous);
  if (!before?.isFile()) {
    return false;
  }
  const [a, b] = await Promise.all([fs.readFile(previous), fs.readFile(staged)]);
  if (!a.equals(b)) {
    return false;
  }
  await fs.utimes(staged, before.atime, before.mtime);
  return true;
}

/** Put `staged` in place of `to`; the previous `to` is restored if that fails. */
async function swap(staged: string, to: string): Promise<void> {
  const old = `${to}.old-${process.pid}`;
  await fs.rm(old, { recursive: true, force: true });
  const hadPrevious = await fs.rename(to, old).then(
    () => true,
    (err: unknown) => {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return false;
      }
      throw err;
    },
  );
  try {
    await fs.rename(staged, to);
  } catch (err) {
    if (hadPrevious) {
      await fs.rename(old, to);
    }
    throw err;
  }
  await fs.rm(old, { recursive: true, force: true });
}

/**
 * Copy the files listed in the build manifest into a sibling staging directory, write the host
 * configuration (`_headers.txt`, `_csp.txt`) there and swap it in for the publish directory.
 * A file identical to its counterpart in the previous publish keeps that file's modification time.
 * Any failure before the swap removes the staging directory and leaves the existing publish directory in place.
 *
 * @throws Error on an unreadable or malformed manifest, a listed file missing from the build, or a
 *         path outside either directory
 * @throws RangeError if the publish directory is protected, overlaps the build directory or holds
 *         something other than a previous publish
 */
export async function publish({
  siteDir = SITE_DEFAULT,
  buildDir = BUILD,
  publishDir = PUBLISH,
}: PublishOptions = {}): Promise<PublishResult> {
  const from = path.resolve(buildDir);
  const to = checkOutDir(publishDir, siteDir, undefined, [from]);
  const staged = checkOutDir(`${to}.tmp-${process.pid}`, siteDir, undefined, [from]);
  await assertReplaceable(to);
  const manifestPath = path.join(from, MANIFEST_FILE);
  let manifest: ReturnType<typeof parsePublishManifest>;
  try {
    manifest = parsePublishManifest(await fs.readFile(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`cannot use ${path.relative(ROOT, manifestPath)}: ${errorMessage(err)}`);
  }
  const files = [...new Set(manifest.files)].sort(compareStrings);
  const reserved = files.filter((f) => f === MANIFEST_FILE || UNSERVED_FILES.has(f));
  if (reserved.length > 0) {
    throw new Error(`manifest lists reserved files: ${reserved.join(', ')}`);
  }
  for (const f of files) {
    assertInside(from, f);
    assertInside(to, f);
  }
  const present = await Promise.all(
    files.map((f) =>
      fs.stat(path.join(from, f)).then(
        (s) => s.isFile(),
        () => false,
      ),
    ),
  );
  const missing = files.filter((_f, i) => !present[i]);
  if (missing.length > 0) {
    throw new Error(`manifest lists files missing or not regular files: ${missing.join(', ')}`);
  }
  const listed = new Set([...files, MANIFEST_FILE, MARKER_FILE]);
  const warnings = (await listFiles(from))
    .filter((f) => !listed.has(f))
    .sort(compareStrings)
    .map((f) => `${f} is in the build but not in the manifest; not published`);

  const csp = contentSecurityPolicy(manifest.csp);
  const staging = [...files, HEADERS_FILE, CSP_FILE, MARKER_FILE];
  const kept = new Set<string>();
  try {
    await fs.rm(staged, { recursive: true, force: true });
    await markGenerated(staged);
    for (const f of files) {
      const target = path.join(staged, f);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(from, f), target);
    }
    await fs.writeFile(path.join(staged, HEADERS_FILE), renderHeaders(csp, true));
    await fs.writeFile(path.join(staged, CSP_FILE), `${csp}\n`);
    for (const f of staging) {
      if (await keepTimestamp(path.join(to, f), path.join(staged, f))) {
        kept.add(f);
      }
    }
    await swap(staged, to);
  } catch (err) {
    await fs.rm(staged, { recursive: true, force: true });
    throw err;
  }
  const unchanged = files.filter((f) => kept.has(f)).length;
  return { files, changed: files.length - unchanged, unchanged, csp, warnings };
}

interface Io {
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly env?: Env;
  readonly run?: (options: PublishOptions) => Promise<PublishResult>;
}

/** Publish options from CLI arguments and environment. @throws on unknown or malformed flags or variables */
export function parseCli(
  argv: readonly string[],
  env: Env = process.env,
): Required<PublishOptions> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      site: { type: 'string' },
      build: { type: 'string' },
      publish: { type: 'string' },
    },
  });
  const { site, out, publish } = resolveSettings(
    {
      site: dirFlag('--site', values.site),
      out: dirFlag('--build', values.build),
      publish: dirFlag('--publish', values.publish),
    },
    env,
  );
  return { siteDir: site, buildDir: out, publishDir: publish };
}

/**
 * `node src/generator/publish.ts [--site <dir>] [--build <dir>] [--publish <dir>]`
 * @returns exit code: 0 ok, 1 publish failed, 2 usage error
 */
export async function main(
  argv: readonly string[],
  { stdout = process.stdout, stderr = process.stderr, env = process.env, run = publish }: Io = {},
): Promise<number> {
  const options = parseOrUsage(() => parseCli(argv, env), USAGE, stderr);
  if (options === undefined) {
    return 2;
  }
  try {
    const { files, changed, unchanged, warnings } = await run(options);
    for (const w of warnings) {
      stderr.write(`warning: ${w}\n`);
    }
    stdout.write(
      `published ${files.length} files into ${path.relative(ROOT, options.publishDir)}/ (${changed} changed, ${unchanged} unchanged)\n`,
    );
    return 0;
  } catch (err) {
    stderr.write(`error: ${errorMessage(err)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
