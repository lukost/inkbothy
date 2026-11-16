import type { SearchResult } from 'minisearch';
import { compareStrings } from '../../lib/compare.ts';
import { isStringArray } from '../../shared/guards.ts';
import type { LoadedIndex } from './loader.ts';

/** Most results shown. */
export const MAX_RESULTS = 20;

/** Selected labels; a hit must match one label in each non-empty group. */
export interface Filters {
  readonly categories: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

export interface Hit {
  readonly url: string;
  readonly title: string;
  readonly summary: string;
  /** `YYYY-MM-DD`, or null. */
  readonly published: string | null;
  /** Key of the section the document belongs to; null for a page. */
  readonly section: string | null;
  readonly tags: readonly string[];
  readonly categories: readonly string[];
  /** Index terms that matched, for highlighting. */
  readonly terms: readonly string[];
}

/** True when `group` is empty or shares a label with `labels`. */
function allows(group: ReadonlySet<string>, labels: readonly string[]): boolean {
  return group.size === 0 || labels.some((l) => group.has(l));
}

/** The hit for a stored document, or null if its stored fields are malformed. Malformed label lists count as empty. */
function toHit(result: SearchResult): Hit | null {
  const { url, title, summary, published, section, tags, categories } = result;
  if (
    typeof url !== 'string' ||
    typeof title !== 'string' ||
    typeof summary !== 'string' ||
    !(typeof published === 'string' || published === null) ||
    !(typeof section === 'string' || section === null)
  ) {
    return null;
  }
  return {
    url,
    title,
    summary,
    published,
    section,
    tags: isStringArray(tags) ? tags : [],
    categories: isStringArray(categories) ? categories : [],
    terms: result.terms,
  };
}

/** Newest first; undated last; equal dates by URL. */
function byNewest(a: Hit, b: Hit): number {
  return compareStrings(b.published ?? '', a.published ?? '') || compareStrings(a.url, b.url);
}

/** Documents matching `text`, ranked by relevance, that pass `filters`. Blank text lists all of them, newest first; blank text with no filters matches nothing. */
export function search(loaded: LoadedIndex, text: string, filters: Filters): Hit[] {
  const blank = text.trim() === '';
  if (blank && filters.categories.size === 0 && filters.tags.size === 0) {
    return [];
  }
  const results = blank ? loaded.index.search(loaded.wildcard) : loaded.index.search(text);
  const hits = results
    .flatMap((r) => toHit(r) ?? [])
    .filter((h) => allows(filters.categories, h.categories) && allows(filters.tags, h.tags));
  return (blank ? hits.sort(byNewest) : hits).slice(0, MAX_RESULTS);
}
