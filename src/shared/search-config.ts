import type { Options } from 'minisearch';
import type { Meta, Term } from '../types.ts';
import { foldLetters } from './fold.ts';

/** A document as indexed by MiniSearch. */
export interface SearchDoc
  extends Pick<Meta, 'title' | 'summary' | 'published' | 'tags' | 'categories'> {
  readonly url: string;
  /** Key of the section the document belongs to; null for a page. */
  readonly section: string | null;
  /** Plain text of the body (no code blocks). */
  readonly text: string;
}

/** Filter terms offered by the search dialog: those carried by at least one indexed document. */
export interface SearchFacets {
  readonly categories: readonly Term[];
  readonly tags: readonly Term[];
}

/** Display name of each section by key, as the menu shows it. */
export type SearchSections = Readonly<Record<string, string>>;

/** Badge of a result that belongs to no section. */
export const PAGE_BADGE = 'Page';

/** Layout version of the published index file. */
export const SEARCH_INDEX_VERSION = 3;

/** The form in which terms are indexed and searched; see `foldLetters`. */
export const foldTerm = foldLetters;

/** Words of this length or more tolerate a typo. */
const FUZZY_MIN_LENGTH = 5;

/** MiniSearch options; the index must be built and loaded with identical options. */
export const SEARCH_OPTIONS = {
  idField: 'url',
  fields: ['title', 'summary', 'tags', 'categories', 'text'],
  storeFields: ['url', 'title', 'summary', 'published', 'section', 'tags', 'categories'],
  stringifyField: (value: unknown) =>
    Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '',
  processTerm: foldTerm,
  searchOptions: {
    boost: { title: 3, tags: 2, categories: 2, summary: 1.5 },
    combineWith: 'AND',
    prefix: true,
    fuzzy: (term: string) => (term.length >= FUZZY_MIN_LENGTH ? 0.2 : false),
  },
} as const satisfies Options<SearchDoc>;
