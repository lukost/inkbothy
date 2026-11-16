import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SiteConfig } from '../config/schema.ts';
import { splitFrontMatter } from '../content/frontmatter.ts';
import { isIgnored, normalize, placeBundle } from '../content/model.ts';
import { compareStrings } from '../lib/compare.ts';
import { SITE_CONFIG_FILE } from '../lib/paths.ts';
import { ownValue } from '../shared/guards.ts';
import type { Item, Meta } from '../types.ts';
import { firstHeadingText } from './html-title.ts';
import { RESUME_FILE } from './resume.ts';

const MARKDOWN_INDEX = 'index.md';
const HTML_INDEX = 'index.html';

/** Files at the top of the site directory that belong to the site rather than to its content. */
const SITE_FILES: ReadonlySet<string> = new Set([
  SITE_CONFIG_FILE,
  'site.schema.json',
  'CLAUDE.md',
  'README.md',
]);

/** An entry at the top of the site directory that is not content: site files and dot-entries such as `.git`. */
const isSiteEntry = (name: string): boolean => SITE_FILES.has(name) || name.startsWith('.');

export interface ScanOptions {
  readonly sections: SiteConfig['sections'];
  readonly drafts?: boolean;
}

export interface Scanned {
  readonly items: Item[];
  readonly warnings: string[];
  /** Directory names of the top-level pages, drafts included. */
  readonly pages: ReadonlySet<string>;
}

/** Meta of an HTML page: it has no front matter. */
const htmlMeta = (title: string): Meta => ({
  title,
  summary: '',
  published: null,
  updates: [],
  updated: null,
  categories: [],
  tags: [],
  draft: false,
  extra: {},
});

/**
 * The file that makes the directory a bundle: index.md, or index.html as the sole index of a
 * top-level page. index.html at the site root, in a section's directory or in a section's item
 * is an error.
 * @throws Error for index.html at those levels, or beside index.md in a page
 */
function indexOf(
  rel: string,
  names: ReadonlySet<string>,
  { isPage, atBundleLevel }: { isPage: boolean; atBundleLevel: boolean },
): string | undefined {
  const hasHtml = names.has(HTML_INDEX);
  if (hasHtml && !isPage && atBundleLevel) {
    throw new Error(
      `${rel ? `${rel}/` : ''}${HTML_INDEX}: only allowed as the sole index of a top-level page`,
    );
  }
  if (hasHtml && isPage && names.has(MARKDOWN_INDEX)) {
    throw new Error(`${rel}: has both ${MARKDOWN_INDEX} and ${HTML_INDEX}; keep one`);
  }
  if (names.has(MARKDOWN_INDEX)) {
    return MARKDOWN_INDEX;
  }
  return hasHtml && isPage ? HTML_INDEX : undefined;
}

/** The kind of the bundle at a depth below the content root (checked by `checkNesting`). */
function kindOf(depth: number, declared: boolean, names: ReadonlySet<string>): Item['kind'] {
  if (depth === 0) {
    return 'home';
  }
  if (depth === 2) {
    return 'member';
  }
  if (declared) {
    return 'intro';
  }
  return names.has(RESUME_FILE) ? 'resume' : 'page';
}

/** @throws Error for a bundle below the top level that is not an item of a declared section, or nested below an item */
function checkNesting(rel: string, segments: readonly string[], declared: boolean): void {
  if (segments.length > 1 && !declared) {
    throw new Error(
      `${rel}: ${segments[0]}/ is not a declared section; declare it in ${SITE_CONFIG_FILE} or remove the nested bundle`,
    );
  }
  if (segments.length > 2) {
    throw new Error(`${rel}: sections have one level; items sit directly under ${segments[0]}/`);
  }
}

/**
 * Walk the site directory and load every bundle: a directory with index.md, or a top-level page
 * with index.html. Paths with a `_`-prefixed segment, `site.yaml`, `site.schema.json`, `CLAUDE.md`,
 * `README.md` and dot-entries at the top are skipped. Bundles below the top level must be items of
 * a declared section. Draft bundles are skipped unless `drafts` is set.
 * @throws Error for a broken file or a bundle that does not fit the sections
 *
 * @param siteDir absolute site directory
 */
export async function scanContent(
  siteDir: string,
  { sections, drafts = false }: ScanOptions,
): Promise<Scanned> {
  const items: Item[] = [];
  const warnings: string[] = [];
  const pages = new Set<string>();

  /** The item of the bundle at `rel` whose source is `index`, with its warnings. */
  async function load(rel: string, index: string, assets: string[], kind: Item['kind']) {
    const source = rel ? `${rel}/${index}` : index;
    const text = await fs.readFile(path.join(siteDir, source), 'utf8');
    const found: string[] = [];
    const bundle = { rel, source, assets, kind };
    let item: Item;
    if (index === HTML_INDEX) {
      const title = firstHeadingText(text);
      if (title === undefined) {
        throw new Error(`${source}: needs an <h1>, which is the page title`);
      }
      if (title === '') {
        throw new Error(`${source}: the first <h1> has no text`);
      }
      const where = placeBundle(rel, sections, (msg) => found.push(msg));
      item = { ...bundle, ...where, format: 'html', meta: htmlMeta(title), body: text };
    } else {
      const { data, body } = splitFrontMatter(text, source);
      const { meta, warnings: problems, ...where } = normalize(data, rel, sections);
      found.push(...problems);
      item = { ...bundle, ...where, format: 'markdown', meta, body };
    }
    return { item, warnings: found.map((msg) => `${source}: ${msg}`) };
  }

  /** A file of a directory: an asset of the bundle, or a problem. */
  function classifyFile(entry: Dirent, rel: string, inBundle: boolean, assets: string[]): void {
    if (!entry.isFile()) {
      warnings.push(`${rel}: not a regular file or directory; ignored`);
    } else if (!inBundle) {
      warnings.push(`${rel}: not inside a bundle (no ${MARKDOWN_INDEX}); ignored`);
    } else if (entry.name.endsWith('.md')) {
      warnings.push(`${rel}: extra Markdown file in bundle; ignored`);
    } else {
      assets.push(rel);
    }
  }

  /** True if no index.md or index.html lies at or below `rel`. */
  async function lacksIndex(rel: string): Promise<boolean> {
    for (const entry of await fs.readdir(path.join(siteDir, rel), { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`;
      if (isIgnored(childRel)) {
        continue;
      }
      const isIndex =
        entry.isFile() && (entry.name === MARKDOWN_INDEX || entry.name === HTML_INDEX);
      if (isIndex || (entry.isDirectory() && !(await lacksIndex(childRel)))) {
        return false;
      }
    }
    return true;
  }

  /** A directory of a bundle that holds no bundle: its files belong to the bundle. A section's own directory never is one. */
  async function isAssetDir(rel: string, topLevel: boolean): Promise<boolean> {
    return !(topLevel && ownValue(sections, rel) !== undefined) && (await lacksIndex(rel));
  }

  /** Adds every file below `rel`, at any depth, to the assets of the bundle. */
  async function collectAssets(rel: string, assets: string[]): Promise<void> {
    const entries = await fs.readdir(path.join(siteDir, rel), { withFileTypes: true });
    entries.sort((a, b) => compareStrings(a.name, b.name));
    for (const entry of entries) {
      const childRel = `${rel}/${entry.name}`;
      if (isIgnored(childRel)) {
        continue;
      }
      if (entry.isDirectory()) {
        await collectAssets(childRel, assets);
      } else {
        classifyFile(entry, childRel, true, assets);
      }
    }
  }

  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(siteDir, rel), { withFileTypes: true });
    entries.sort((a, b) => compareStrings(a.name, b.name));
    const segments = rel ? rel.split('/') : [];
    const declared = ownValue(sections, segments[0] ?? '') !== undefined;
    const isPage = segments.length === 1 && !declared;
    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    const index = indexOf(rel, names, {
      isPage,
      atBundleLevel: segments.length < 2 || (segments.length === 2 && declared),
    });
    const assets: string[] = [];

    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (
        isIgnored(childRel) ||
        (rel === '' && isSiteEntry(entry.name)) ||
        (entry.name === index && entry.isFile())
      ) {
        continue;
      }
      if (!entry.isDirectory()) {
        classifyFile(entry, childRel, index !== undefined, assets);
      } else if (index !== undefined && (await isAssetDir(childRel, segments.length === 0))) {
        await collectAssets(childRel, assets);
      } else {
        await walk(childRel);
      }
    }

    if (index !== undefined) {
      checkNesting(rel, segments, declared);
      if (isPage) {
        pages.add(rel);
      }
      if (isPage && index === HTML_INDEX && names.has(RESUME_FILE)) {
        throw new Error(
          `${rel}/${RESUME_FILE}: a resume needs ${MARKDOWN_INDEX}, not ${HTML_INDEX}`,
        );
      }
      const loaded = await load(rel, index, assets, kindOf(segments.length, declared, names));
      if (drafts || !loaded.item.meta.draft) {
        warnings.push(...loaded.warnings);
        items.push(loaded.item);
      }
    }
  }

  await walk('');
  return { items, warnings, pages };
}
