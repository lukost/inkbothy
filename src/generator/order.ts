import { compareLabels, compareStrings } from '../lib/compare.ts';
import type { Item } from '../types.ts';

const byNewest = (a: Item, b: Item): number =>
  compareStrings(b.meta.published ?? '', a.meta.published ?? '') || compareStrings(a.url, b.url);

/** Newest first by `published`; undated last; ties by URL. Returns a new array. */
export function sortNewest(items: readonly Item[]): Item[] {
  return [...items].sort(byNewest);
}

/** Featured items first, each group newest first. Returns a new array. */
export function sortFeaturedFirst(items: readonly Item[]): Item[] {
  const rank = (i: Item): number => (i.meta.featured ? 0 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b) || byNewest(a, b));
}

/** By title (case-insensitive), ties by URL. Returns a new array. */
export function sortByTitle(items: readonly Item[]): Item[] {
  return [...items].sort(
    (a, b) => compareLabels(a.meta.title, b.meta.title) || compareStrings(a.url, b.url),
  );
}
