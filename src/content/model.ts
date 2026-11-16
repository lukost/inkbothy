import path from 'node:path';
import type { SectionConfig, SiteConfig, TaxonomyField } from '../config/schema.ts';
import { compareStrings } from '../lib/compare.ts';
import { safeHttpUrl } from '../lib/url.ts';
import { isRecord, ownValue } from '../shared/guards.ts';
import type { Link, Meta, Update } from '../types.ts';
import { RESERVED_ROOT_SLUGS, slugify } from './slug.ts';
import { reservedSlugs } from './taxonomy.ts';

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'title',
  'summary',
  'published',
  'updates',
  'categories',
  'tags',
  'draft',
  'toc',
  'featured',
  'copyright',
  'status',
  'repo',
  'links',
]);
const DATE_RE = /^(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})$/;
const TRUE_WORDS: ReadonlySet<string> = new Set(['true', 'yes']);
const FALSE_WORDS: ReadonlySet<string> = new Set(['false', 'no']);

export type Warn = (msg: string) => void;

export interface Normalized {
  readonly meta: Meta;
  readonly url: string;
  readonly section: string | null;
  readonly slug: string;
  readonly warnings: readonly string[];
}

/** Where a bundle lives: its URL, slug and the declared section it is an item of (null for pages). */
export interface Placement {
  readonly url: string;
  readonly slug: string;
  readonly section: string | null;
}

/** True for a `YYYY-MM-DD` string naming a real calendar day. */
export function isValidDate(value: unknown): value is string {
  const groups = typeof value === 'string' ? DATE_RE.exec(value)?.groups : undefined;
  if (!groups) {
    return false;
  }
  const [y, m, d] = [Number(groups.y), Number(groups.m), Number(groups.d)];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True if any segment of a content-relative POSIX path starts with `_`. */
export function isIgnored(relPath: string): boolean {
  return relPath.split('/').some((seg) => seg.startsWith('_'));
}

/**
 * URL and path segments of a bundle directory (POSIX, relative to the content root).
 * @throws RangeError if the path is absolute, contains NUL, or escapes the root
 */
export function locate(relDir: string): { url: string; segments: string[] } {
  if (relDir.includes('\0') || path.posix.isAbsolute(relDir)) {
    throw new RangeError(`invalid bundle path: ${JSON.stringify(relDir)}`);
  }
  const norm = path.posix.normalize(relDir || '.');
  if (norm === '..' || norm.startsWith('../')) {
    throw new RangeError(`bundle path escapes the content root: ${relDir}`);
  }
  const segments = norm.split('/').filter((s) => s !== '' && s !== '.');
  return { url: segments.length ? `/${segments.join('/')}/` : '/', segments };
}

/** Scalar → trimmed string; anything else → undefined. */
export function scalarText(v: unknown): string | undefined {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : undefined;
}

function labelList(value: unknown, field: string, warn: Warn): string[] {
  if (value == null) {
    return [];
  }
  if (isRecord(value)) {
    warn(`${field}: expected a list or a string; ignored`);
    return [];
  }
  const out: string[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    const label = scalarText(item);
    if (label === undefined) {
      warn(`${field}: ignoring non-text entry ${JSON.stringify(item)}`);
    } else if (label && !slugify(label)) {
      warn(`${field}: "${label}" has no URL-safe characters; ignored`);
    } else if (label && !out.includes(label)) {
      out.push(label);
    }
  }
  return out;
}

function dateField(value: unknown, field: string, warn: Warn): string | null {
  if (isValidDate(value)) {
    return value;
  }
  warn(
    value == null
      ? `missing ${field} date`
      : `${field}: invalid date ${JSON.stringify(value)} (expected YYYY-MM-DD)`,
  );
  return null;
}

/**
 * The entries of the list in `where`, each read by `each` (undefined drops it).
 * Absent is empty; anything but a list warns, naming `shape`, and is ignored.
 */
export function listOf<T>(
  value: unknown,
  where: string,
  warn: Warn,
  shape: string,
  each: (entry: unknown, at: string) => T | undefined,
): T[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    warn(`${where}: expected a list${shape && ` of ${shape}`}; ignored`);
    return [];
  }
  return value.flatMap((entry, i) => each(entry, `${where}[${i}]`) ?? []);
}

function updateList(value: unknown, warn: Warn): Update[] {
  const out = listOf(value, 'updates', warn, '{ date, note }', (entry, at): Update | undefined => {
    const e = isRecord(entry) ? entry : {};
    const note = scalarText(e.note);
    if (!isValidDate(e.date)) {
      warn(`${at}: invalid or missing date; entry ignored`);
    } else if (!note) {
      warn(`${at}: missing note; entry ignored`);
    } else {
      return { date: e.date, note };
    }
    return undefined;
  });
  // Stable sort: equal dates keep author order.
  return out.sort((a, b) => compareStrings(b.date, a.date));
}

/** Links from a `{ label, url }` list in `field`. Entries without a label or an http(s) url warn and are dropped. */
export function linkList(value: unknown, warn: Warn, field = 'links'): Link[] {
  return listOf(value, field, warn, '{ label, url }', (entry, at): Link | undefined => {
    const e = isRecord(entry) ? entry : {};
    const label = scalarText(e.label);
    const url = safeHttpUrl(e.url);
    if (label && url) {
      return { label, url };
    }
    warn(`${at}: needs a label and an http(s) url; entry ignored`);
    return undefined;
  });
}

/** `'invalid'` for text that is neither a boolean nor a yes/no word. */
export function parseFlag(value: unknown): boolean | undefined | 'invalid' {
  if (value == null || typeof value === 'boolean') {
    return value ?? undefined;
  }
  const word = String(value).trim().toLowerCase();
  if (TRUE_WORDS.has(word)) {
    return true;
  }
  return FALSE_WORDS.has(word) ? false : 'invalid';
}

function draftFlag(value: unknown, warn: Warn): boolean {
  const flag = parseFlag(value);
  if (flag === 'invalid') {
    warn(`draft: unrecognised value ${JSON.stringify(value)}; treating as draft`);
    return true;
  }
  return flag === true;
}

/** An optional yes/no field: absent or unrecognised (with a warning) is undefined. */
function optionalFlag(value: unknown, field: string, warn: Warn): boolean | undefined {
  const flag = parseFlag(value);
  if (flag === 'invalid') {
    warn(`${field}: unrecognised value ${JSON.stringify(value)}; ignored`);
    return undefined;
  }
  return flag;
}

/**
 * Where the bundle at `relDir` ('' = home) lives. Directory names that are not clean slugs and
 * reserved slugs become warnings.
 * @throws RangeError for an invalid bundle path (see `locate`)
 */
export function placeBundle(
  relDir: string,
  sections: SiteConfig['sections'],
  warn: Warn,
): Placement {
  const { url, segments } = locate(relDir);
  const slug = segments.at(-1) ?? '';
  const [first = ''] = segments;
  const config = segments.length === 2 ? ownValue(sections, first) : undefined;
  const section = config ? first : null;

  for (const seg of segments) {
    if (slugify(seg) !== seg) {
      warn(`directory "${seg}" is not a clean slug (suggest "${slugify(seg)}")`);
    }
  }
  if (segments.length === 1 && RESERVED_ROOT_SLUGS.has(slug)) {
    warn(`slug "${slug}" is reserved`);
  }
  if (config && reservedSlugs(config).has(slug)) {
    warn(`slug "${slug}" is reserved under ${section}/`);
  }
  return { url, slug, section };
}

/** The labels of `field` that the item's section uses; others warn and are dropped. */
function taxonomyLabels(
  value: unknown,
  field: TaxonomyField,
  config: SectionConfig | undefined,
  where: string,
  warn: Warn,
): string[] {
  const labels = labelList(value, field, warn);
  if (labels.length > 0 && !config?.taxonomies.includes(field)) {
    warn(`${field} are not enabled for ${where}; ignored`);
    return [];
  }
  return labels;
}

/**
 * Leniently normalise the front-matter of the bundle at `relDir` ('' = home).
 * Content problems become warnings; unknown keys go to `meta.extra`.
 * @throws RangeError for an invalid bundle path (see `locate`)
 */
export function normalize(
  data: Readonly<Record<string, unknown>>,
  relDir: string,
  sections: SiteConfig['sections'],
): Normalized {
  const warnings: string[] = [];
  const warn: Warn = (msg) => warnings.push(msg);
  const { url, slug, section } = placeBundle(relDir, sections, warn);
  const config = section === null ? undefined : ownValue(sections, section);
  const where = section === null ? 'pages' : `${section}/`;

  let title = scalarText(data.title);
  if (!title) {
    title = slug || 'home';
    warn(`missing title; using "${title}"`);
  }

  let repo: string | null = null;
  if (data.repo != null) {
    repo = safeHttpUrl(data.repo);
    if (!repo) {
      warn(`repo: not an http(s) URL ${JSON.stringify(data.repo)}; ignored`);
    }
  }

  const copyright = scalarText(data.copyright);
  const status = scalarText(data.status);
  const toc = optionalFlag(data.toc, 'toc', warn);
  const featured = optionalFlag(data.featured, 'featured', warn);
  const links = linkList(data.links, warn);
  const updates = updateList(data.updates, warn);
  const extra = Object.fromEntries(Object.entries(data).filter(([key]) => !KNOWN_KEYS.has(key)));

  const meta: Meta = {
    title,
    summary: scalarText(data.summary) ?? '',
    published: dateField(data.published, 'published', warn),
    updates,
    updated: updates[0]?.date ?? null,
    categories: taxonomyLabels(data.categories, 'categories', config, where, warn),
    tags: taxonomyLabels(data.tags, 'tags', config, where, warn),
    draft: draftFlag(data.draft, warn),
    ...(toc === undefined ? {} : { toc }),
    ...(featured === undefined ? {} : { featured }),
    ...(copyright ? { copyright } : {}),
    ...(status ? { status } : {}),
    ...(repo ? { repo } : {}),
    ...(links.length ? { links } : {}),
    extra,
  };
  return { meta, url, section, slug, warnings };
}
