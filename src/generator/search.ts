import MiniSearch from 'minisearch';
import { canonicalTerms } from '../content/taxonomy.ts';
import { compareLabels } from '../lib/compare.ts';
import {
  SEARCH_INDEX_VERSION,
  SEARCH_OPTIONS,
  type SearchDoc,
  type SearchFacets,
  type SearchSections,
} from '../shared/search-config.ts';
import type { Item, Term, TermLookup } from '../types.ts';

/** An item with its plain text, as extracted during rendering, and the terms of its section. */
export interface SearchEntry {
  readonly item: Item;
  readonly text: string;
  readonly terms: TermLookup;
}

/** Terms sorted by label, one per slug. */
function sortedTerms(terms: readonly Term[]): Term[] {
  return [...new Map(terms.map((t) => [t.slug, t])).values()].sort((a, b) =>
    compareLabels(a.label, b.label),
  );
}

/** Maps each term to the first spelling seen for its slug, so differing labels do not split a term. */
function firstSpelling(): (term: Term) => Term {
  const first = new Map<string, Term>();
  return (term) => {
    const known = first.get(term.slug);
    if (known) {
      return known;
    }
    first.set(term.slug, term);
    return term;
  };
}

/**
 * JSON of the published search file: the MiniSearch index over items and pages, the filter terms in
 * use and the section labels. Labels use each term's canonical spelling.
 *
 * @returns `{ version, index, facets, sections }`; `index` loads with `MiniSearch.loadJS(index, SEARCH_OPTIONS)`
 */
export function buildSearchIndex(
  entries: readonly SearchEntry[],
  sections: SearchSections,
): string {
  const spellCategory = firstSpelling();
  const spellTag = firstSpelling();
  const labelled = entries.map(({ item, text, terms }) => ({
    item,
    text,
    categories: canonicalTerms(item.meta.categories, terms.category).map(spellCategory),
    tags: canonicalTerms(item.meta.tags, terms.tag).map(spellTag),
  }));
  const index = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
  index.addAll(
    labelled.map(({ item, text, categories, tags }) => ({
      url: item.url,
      title: item.meta.title,
      summary: item.meta.summary,
      published: item.meta.published,
      section: item.kind === 'intro' ? item.slug : item.section,
      tags: tags.map((t) => t.label),
      categories: categories.map((t) => t.label),
      text,
    })),
  );
  const facets: SearchFacets = {
    categories: sortedTerms(labelled.flatMap((l) => l.categories)),
    tags: sortedTerms(labelled.flatMap((l) => l.tags)),
  };
  return JSON.stringify({ version: SEARCH_INDEX_VERSION, index, facets, sections });
}

/**
 * Site-relative file name of the search index. It is fixed, not content-hashed, so the pages that
 * link it keep their bytes when only the index changes; it is served `no-cache` and revalidated.
 */
export const SEARCH_INDEX_FILE = 'search-index.json';
