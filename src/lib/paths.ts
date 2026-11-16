import path from 'node:path';

/** Project root: two levels above src/lib/. */
export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export const SRC = path.join(ROOT, 'src');
export const SITE_CONFIG_FILE = 'site.yaml';
/** Where the site (content and `site.yaml`) is looked for unless told otherwise. */
export const SITE_DEFAULT = path.join(ROOT, 'site');
/** Starter site that `make init-site` copies; part of this repository. */
export const SITE_SAMPLE = path.join(ROOT, 'site.sample');
/** Documentation of this repository. */
export const DOCS = path.join(ROOT, 'docs');
/** Hand-kept site data: attribution extras, licence overrides and licence texts. */
export const DATA = path.join(ROOT, 'data');
/** Intermediate build artifacts. */
export const BUILD = path.join(ROOT, 'build');
/** Clean, deployable copy of the site. */
export const PUBLISH = path.join(ROOT, 'publish');

/** The configuration file of the site directory `siteDir`. */
export const siteConfigFile = (siteDir: string): string => path.join(siteDir, SITE_CONFIG_FILE);

/**
 * Resolve `p` against `base` and guarantee the result stays within `base`.
 * Purely lexical: symlinks are not followed.
 *
 * @param base absolute directory acting as the jail
 * @param p    path relative to `base`, or absolute
 * @returns normalised absolute path inside `base` (may equal `base`)
 * @throws TypeError if `base` is relative
 * @throws RangeError if `p` contains a NUL byte or escapes `base`
 */
export function assertInside(base: string, p: string): string {
  if (!path.isAbsolute(base)) {
    throw new TypeError(`assertInside: base must be absolute: ${base}`);
  }
  if (p.includes('\0')) {
    throw new RangeError('assertInside: path contains NUL byte');
  }
  const root = path.resolve(base);
  const target = path.resolve(root, p);
  const rel = path.relative(root, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new RangeError(`assertInside: path escapes ${root}: ${p}`);
  }
  return target;
}

/** Whether `p` is `base` or lies below it; purely lexical, both absolute. */
export function isSameOrInside(p: string, base: string): boolean {
  return p === base || p.startsWith(`${base}${path.sep}`);
}

/** `p` with `/` separators. */
export const toPosix = (p: string): string => p.split(path.sep).join('/');
