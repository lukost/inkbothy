import type MiniSearch from 'minisearch';
import type { AsPlainObject, Wildcard } from 'minisearch';
import { isRecord } from '../../shared/guards.ts';
import {
  SEARCH_INDEX_VERSION,
  SEARCH_OPTIONS,
  type SearchDoc,
  type SearchFacets,
  type SearchSections,
} from '../../shared/search-config.ts';

/** A loaded search index with what the dialog needs from the MiniSearch module. */
export interface LoadedIndex {
  readonly index: MiniSearch<SearchDoc>;
  readonly wildcard: Wildcard;
  readonly facets: SearchFacets;
  readonly sections: SearchSections;
}

interface IndexFile {
  readonly index: AsPlainObject;
  readonly facets: SearchFacets;
  readonly sections: SearchSections;
}

function isTermList(value: unknown): value is SearchFacets['tags'] {
  return (
    Array.isArray(value) &&
    value.every((t) => isRecord(t) && typeof t.slug === 'string' && typeof t.label === 'string')
  );
}

function isSections(value: unknown): value is SearchSections {
  return isRecord(value) && Object.values(value).every((label) => typeof label === 'string');
}

function isPlainIndex(value: unknown): value is AsPlainObject {
  return (
    isRecord(value) &&
    typeof value.documentCount === 'number' &&
    typeof value.nextId === 'number' &&
    isRecord(value.documentIds) &&
    isRecord(value.fieldIds) &&
    isRecord(value.fieldLength) &&
    Array.isArray(value.averageFieldLength) &&
    isRecord(value.storedFields) &&
    Array.isArray(value.index) &&
    typeof value.serializationVersion === 'number'
  );
}

function isIndexFile(value: unknown): value is IndexFile {
  return (
    isRecord(value) &&
    value.version === SEARCH_INDEX_VERSION &&
    isPlainIndex(value.index) &&
    isRecord(value.facets) &&
    isTermList(value.facets.categories) &&
    isTermList(value.facets.tags) &&
    isSections(value.sections)
  );
}

async function fetchIndexFile(url: string): Promise<IndexFile> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const file: unknown = await response.json();
  if (!isIndexFile(file)) {
    throw new Error(`${url}: not a version ${SEARCH_INDEX_VERSION} search index`);
  }
  return file;
}

async function load(url: string): Promise<LoadedIndex> {
  const [file, { default: Search }] = await Promise.all([
    fetchIndexFile(url),
    import('minisearch'),
  ]);
  return {
    index: Search.loadJS(file.index, SEARCH_OPTIONS),
    wildcard: Search.wildcard,
    facets: file.facets,
    sections: file.sections,
  };
}

const loads = new Map<string, Promise<LoadedIndex>>();

/** The index at `url`, fetched and parsed on first use. Calls share one load; a failed load is forgotten so a retry fetches again. */
export function loadIndex(url: string): Promise<LoadedIndex> {
  let pending = loads.get(url);
  if (!pending) {
    pending = load(url);
    loads.set(url, pending);
    pending.catch(() => loads.delete(url));
  }
  return pending;
}
