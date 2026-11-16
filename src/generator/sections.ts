import type { SectionConfig, SiteConfig } from '../config/schema.ts';
import {
  type SectionTaxonomies,
  sectionTaxonomies,
  TAXONOMIES,
  termUrl,
} from '../content/taxonomy.ts';
import { compareStrings } from '../lib/compare.ts';
import { renderCards } from '../templates/cards.ts';
import type { HomeBlock } from '../templates/home.ts';
import type { Markup } from '../templates/html.ts';
import { renderList } from '../templates/list.ts';
import { renderStream } from '../templates/stream.ts';
import type { Item } from '../types.ts';
import { sortFeaturedFirst, sortNewest } from './order.ts';

/** A section's index page: `/<key>/`, with the section root's own bundle as optional introduction. */
export interface SectionPage extends SectionTaxonomies {
  readonly key: string;
  readonly config: SectionConfig;
  readonly url: string;
  readonly intro: Item | undefined;
  /** The section's items in display order. */
  readonly members: readonly Item[];
}

/** A page listing some of a section's items: its index or the page of one term. */
export interface MemberList {
  readonly heading: string;
  readonly intro?: Item | undefined;
  readonly members: readonly Item[];
}

/** A generated page of one term of a taxonomy. */
export interface TermPage {
  readonly url: string;
  readonly heading: string;
  readonly members: readonly Item[];
}

const orderOf = ({ layout }: SectionConfig): ((items: readonly Item[]) => Item[]) =>
  layout === 'cards' ? sortFeaturedFirst : sortNewest;

/** The introduction's title, else the section's label. */
export function headingOf({ intro, config }: Pick<SectionPage, 'intro' | 'config'>): string {
  return intro?.meta.title ?? config.label;
}

/**
 * The index pages to generate: declared sections with items or an introduction.
 * @returns the pages, and the warnings about their taxonomies
 */
export function sectionPages(
  items: readonly Item[],
  { sections }: Pick<SiteConfig, 'sections'>,
): { pages: SectionPage[]; warnings: string[] } {
  const pages: SectionPage[] = [];
  const warnings: string[] = [];
  for (const [key, config] of Object.entries(sections)) {
    const url = `/${key}/`;
    const intro = items.find((i) => i.kind === 'intro' && i.url === url);
    const own = items.filter((i) => i.section === key);
    if (own.length > 0 || intro) {
      const taxonomies = sectionTaxonomies(own, config);
      warnings.push(...taxonomies.warnings.map((msg) => `${key}: ${msg}`));
      pages.push({ ...taxonomies, key, config, url, intro, members: orderOf(config)(own) });
    }
  }
  return { pages, warnings };
}

/** Pages of every term of the section's taxonomies. */
export function termPages({ key, config, lists }: SectionPage): TermPage[] {
  const order = orderOf(config);
  return lists.flatMap(({ field, terms }) =>
    terms.map((term) => ({
      url: termUrl(key, field, term.slug),
      heading: `${TAXONOMIES[field].title}: ${term.label}`,
      members: order(term.items),
    })),
  );
}

/** `<main>` content of a page listing some of the section's items, in the section's layout. */
export function renderMembers(
  { config, lookup: terms }: SectionPage,
  { heading, intro, members }: MemberList,
  content: (item: Item) => string,
): Markup {
  const introduction = intro && content(intro);
  switch (config.layout) {
    case 'stream':
      return renderStream({
        heading,
        intro: introduction,
        items: members,
        terms,
        noun: config.noun,
        content,
        ...config.stream,
      });
    case 'cards':
      return renderCards({
        heading,
        intro: introduction,
        items: members,
        terms,
        noun: config.noun,
      });
    case 'list':
      return renderList({ heading, intro: introduction, items: members, noun: config.noun });
  }
}

/** The configured home blocks that have something to show. */
export function homeBlocks(blocks: SiteConfig['home'], pages: readonly SectionPage[]): HomeBlock[] {
  return blocks.flatMap(({ kind, section, count }) => {
    const page = pages.find((p) => p.key === section);
    if (!page) {
      return [];
    }
    const chosen = kind === 'latest' ? page.members : page.members.filter((i) => i.meta.featured);
    const items = sortNewest(chosen).slice(0, count);
    return items.length > 0
      ? [{ kind, url: page.url, noun: page.config.noun, items, terms: page.lookup }]
      : [];
  });
}

/** Newest `updated` or `published` date among the section's published items and its introduction. */
export function sectionLastmod(page: SectionPage, published: readonly Item[]): string | null {
  return (
    published
      .filter((i) => i === page.intro || i.section === page.key)
      .map((i) => i.meta.updated ?? i.meta.published)
      .filter((d): d is string => d !== null)
      .sort(compareStrings)
      .at(-1) ?? null
  );
}
