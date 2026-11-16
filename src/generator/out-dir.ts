import fs from 'node:fs/promises';
import path from 'node:path';
import { MARKER_FILE } from '../lib/http-policy.ts';
import { isErrnoException } from '../lib/node-guards.ts';
import { assertInside, DATA, DOCS, isSameOrInside, ROOT, SITE_SAMPLE, SRC } from '../lib/paths.ts';

/** Written into every generated directory; only a directory holding it (or empty) is wiped. */
export const GENERATED_MARKER = MARKER_FILE;

const PROTECTED = [
  SRC,
  DATA,
  DOCS,
  SITE_SAMPLE,
  path.join(ROOT, 'tests'),
  path.join(ROOT, 'node_modules'),
  path.join(ROOT, '.git'),
];

/**
 * Refuse to use anything but a dedicated directory strictly inside the project.
 * `siteDir` (the site: content and configuration) and `dataDir` (the data directory) are protected
 * like the project's own sources. `also` lists further directories `outDir` may neither contain nor
 * lie within.
 */
export function checkOutDir(
  outDir: string,
  siteDir: string,
  dataDir = DATA,
  also: readonly string[] = [],
): string {
  const out = path.resolve(outDir);
  assertInside(ROOT, out);
  const protectedDirs = [...PROTECTED, siteDir, dataDir, ...also].map((p) => path.resolve(p));
  if (out === ROOT || protectedDirs.some((p) => isSameOrInside(out, p) || isSameOrInside(p, out))) {
    throw new RangeError(`refusing to use ${out} as output directory`);
  }
  return out;
}

/** @throws RangeError unless `dir` is absent, empty or marked as generated */
export async function assertReplaceable(dir: string): Promise<void> {
  const entries = await fs.readdir(dir).catch((err: unknown): string[] => {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  });
  if (entries.length > 0 && !entries.includes(GENERATED_MARKER)) {
    throw new RangeError(
      `refusing to replace ${dir}: it is not empty and has no ${GENERATED_MARKER} marker from a previous build`,
    );
  }
}

/** Empty `dir` (see `assertReplaceable`), create it and mark it as generated. */
export async function resetOutDir(dir: string): Promise<void> {
  await assertReplaceable(dir);
  await fs.rm(dir, { recursive: true, force: true });
  await markGenerated(dir);
}

/** Create `dir` if needed and write the marker. */
export async function markGenerated(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, GENERATED_MARKER), '');
}
