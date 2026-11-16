import type { SectionConfig, TaxonomyField } from '../config/schema.ts';
import { compareLabels } from '../lib/compare.ts';
import type { Item, Lookup, TaxonomyTerm, Term, TermLookup } from '../types.ts';
import { slugify } from './slug.ts';

/** URL segment and page-title prefix of each taxonomy: `/<section>/<segment>/<slug>/`. */
export const TAXONOMIES: Readonly<Record<TaxonomyField, { segment: string; title: string }>> = {
  categories: { segment: 'category', title: 'Category' },
  tags: { segment: 'tag', title: 'Tag' },
};

/** URL of a term's page. */
export const termUrl = (section: string, field: TaxonomyField, slug: string): string =>
  `/${section}/${TAXONOMIES[field].segment}/${slug}/`;

/** Lookup that knows no terms: every label keeps its own spelling. */
export const NO_TERMS: TermLookup = { category: () => undefined, tag: () => undefined };

/** Member slugs taken by the section's generated term pages. */
export function reservedSlugs({ taxonomies }: Pick<SectionConfig, 'taxonomies'>): Set<string> {
  return new Set(taxonomies.map((field) => TAXONOMIES[field].segment));
}

/**
 * Group items by the slug of each label in `item.meta[field]`, merging
 * spelling variants ("Linux", "linux", "LINUX"). The display label is the most
 * frequent spelling; ties go to the first seen (input order).
 *
 * @returns terms sorted by label, plus warnings about spelling variants
 */
export function buildTaxonomy(
  items: readonly Item[],
  field: TaxonomyField,
): { terms: TaxonomyTerm[]; warnings: string[] } {
  const groups = new Map<string, { variants: Map<string, number>; items: Item[] }>();
  for (const item of items) {
    for (const label of item.meta[field]) {
      const slug = slugify(label);
      let group = groups.get(slug);
      if (!group) {
        group = { variants: new Map(), items: [] };
        groups.set(slug, group);
      }
      group.variants.set(label, (group.variants.get(label) ?? 0) + 1);
      if (group.items.at(-1) !== item) {
        group.items.push(item);
      }
    }
  }

  const warnings: string[] = [];
  const terms = [...groups].map(([slug, { variants, items: members }]): TaxonomyTerm => {
    let label = '';
    let best = 0;
    for (const [variant, count] of variants) {
      if (count > best) {
        [label, best] = [variant, count];
      }
    }
    if (variants.size > 1) {
      const others = [...variants.keys()].filter((v) => v !== label);
      warnings.push(
        `${field}: "${label}" is also spelled ${others.map((v) => `"${v}"`).join(', ')}`,
      );
    }
    return { slug, label, items: members };
  });
  terms.sort((a, b) => compareLabels(a.label, b.label));
  return { terms, warnings };
}

/** Lookup from any spelling of a label to its canonical term. */
export function termIndex(terms: readonly TaxonomyTerm[]): Lookup {
  const bySlug = new Map(terms.map((t) => [t.slug, t]));
  return (label) => bySlug.get(slugify(label));
}

/**
 * Canonical, de-duplicated terms for an item's labels. Labels unknown to
 * `lookup` keep their own spelling.
 */
export function canonicalTerms(labels: readonly string[], lookup: Lookup): Term[] {
  const seen = new Map<string, Term>();
  for (const raw of labels) {
    const term = lookup(raw) ?? { slug: slugify(raw), label: raw };
    if (!seen.has(term.slug)) {
      seen.set(term.slug, { slug: term.slug, label: term.label });
    }
  }
  return [...seen.values()];
}

/** A section's terms for each taxonomy it declares, with the lookup that spells them canonically. */
export interface SectionTaxonomies {
  readonly lists: readonly {
    readonly field: TaxonomyField;
    readonly terms: readonly TaxonomyTerm[];
  }[];
  readonly lookup: TermLookup;
  readonly warnings: readonly string[];
}

/** Terms of the section's items for each declared taxonomy. Taxonomies are scoped to their section. */
export function sectionTaxonomies(
  items: readonly Item[],
  { taxonomies }: Pick<SectionConfig, 'taxonomies'>,
): SectionTaxonomies {
  const built = taxonomies.map((field) => ({ field, ...buildTaxonomy(items, field) }));
  const lookupOf = (field: TaxonomyField): Lookup =>
    termIndex(built.find((b) => b.field === field)?.terms ?? []);
  return {
    lists: built,
    lookup: { category: lookupOf('categories'), tag: lookupOf('tags') },
    warnings: built.flatMap((b) => b.warnings),
  };
}
