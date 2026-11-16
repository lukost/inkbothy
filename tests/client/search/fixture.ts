import MiniSearch from 'minisearch';
import type { LoadedIndex } from '../../../src/client/search/loader.ts';
import type { SiteConfig } from '../../../src/config/schema.ts';
import { NO_TERMS, sectionTaxonomies } from '../../../src/content/taxonomy.ts';
import { buildSearchIndex, type SearchEntry } from '../../../src/generator/search.ts';
import { isRecord } from '../../../src/shared/guards.ts';
import {
  SEARCH_OPTIONS,
  type SearchDoc,
  type SearchSections,
} from '../../../src/shared/search-config.ts';
import { CARDS, type ItemSpec, item, LIST, STREAM } from '../../helpers.ts';

/** `[spec, body text]` pairs: the content behind the fixture index. */
export type Fixture = readonly (readonly [ItemSpec, string])[];

export const FIXTURE: Fixture = [
  [
    {
      url: '/blog/dma/',
      title: 'DMA on i.MX8',
      summary: 'Scatter-gather transfers',
      published: '2026-03-01',
      categories: ['Linux'],
      tags: ['kernel', 'dma'],
    },
    'Descriptors and bounce buffers.',
  ],
  [
    {
      url: '/blog/rt/',
      title: 'Realtime scheduling',
      summary: 'PREEMPT_RT latency',
      published: '2026-02-01',
      categories: ['Linux', 'Embedded'],
      tags: ['rt'],
    },
    'Cyclictest results.',
  ],
  [
    {
      url: '/blog/zolw/',
      title: 'Żółw na zimę',
      summary: 'A tortoise',
      published: '2026-01-01',
      categories: ['Zwierzęta'],
      tags: ['kernel'],
    },
    'Zażółć gęślą jaźń.',
  ],
  [
    {
      url: '/projects/tracer/',
      section: 'projects',
      title: 'Tracer',
      summary: 'ftrace helper',
      published: '2025-12-01',
      tags: ['kernel', 'tooling'],
    },
    'Collects events.',
  ],
  [
    {
      url: '/projects/undated/',
      section: 'projects',
      title: 'Undated',
      summary: '',
      published: null,
      tags: ['kernel'],
    },
    'Nothing.',
  ],
  [
    {
      url: '/blog/mention/',
      title: 'Notes',
      summary: 'Misc',
      published: '2025-11-01',
      categories: ['Embedded'],
    },
    'We used a tracer here.',
  ],
  [
    {
      url: '/snippets/bitmask/',
      section: 'snippets',
      title: 'Bitmask trick',
      summary: 'Isolate the lowest set bit',
      published: '2025-10-01',
      tags: ['bits'],
    },
    'Two complement arithmetic.',
  ],
  [
    {
      url: '/about/',
      section: null,
      title: 'About the author',
      summary: 'Who writes here',
      published: null,
    },
    'Embedded systems since the nineties.',
  ],
];

/** `count` posts tagged `bulk`, one per day, newest last in the list. */
export function bulk(count: number): Fixture {
  return Array.from({ length: count }, (_, n): Fixture[number] => [
    {
      url: `/blog/bulk-${n}/`,
      title: `Bulk ${n}`,
      published: `2026-04-${String(n + 1).padStart(2, '0')}`,
      tags: ['bulk'],
    },
    'bulky',
  ]);
}

/** The sections of the fixture site. */
const FIXTURE_SECTIONS: SiteConfig['sections'] = {
  blog: STREAM,
  projects: CARDS,
  snippets: { ...LIST, label: 'Snippets' },
};

/** Section labels as the fixture site configures them. */
export const SECTION_LABELS: SearchSections = {
  blog: 'Scribings',
  projects: 'Projects',
  snippets: 'Snippets',
};

/** The file the generator publishes for `fixture`, as JSON text. */
export function indexJson(fixture: Fixture = FIXTURE): string {
  const items = fixture.map(([spec]) => item(spec));
  const lookups = new Map(
    Object.entries(FIXTURE_SECTIONS).map(([key, config]) => [
      key,
      sectionTaxonomies(
        items.filter((i) => i.section === key),
        config,
      ).lookup,
    ]),
  );
  const entries: SearchEntry[] = items.map((i, n) => ({
    item: i,
    text: fixture[n]?.[1] ?? '',
    terms: (i.section === null ? undefined : lookups.get(i.section)) ?? NO_TERMS,
  }));
  return buildSearchIndex(entries, SECTION_LABELS);
}

/** The parsed index file. */
export function indexFile(fixture: Fixture = FIXTURE): Record<string, unknown> {
  const file: unknown = JSON.parse(indexJson(fixture));
  if (!isRecord(file)) {
    throw new Error('index file is not an object');
  }
  return file;
}

/** What the loader yields for `fixture`, without fetching anything. */
export function loadedIndex(fixture: Fixture = FIXTURE): LoadedIndex {
  const file = indexFile(fixture);
  const facets = file.facets;
  if (!isRecord(facets)) {
    throw new Error('missing facets');
  }
  return {
    index: MiniSearch.loadJSON<SearchDoc>(JSON.stringify(file.index), SEARCH_OPTIONS),
    wildcard: MiniSearch.wildcard,
    facets: { categories: asTerms(facets.categories), tags: asTerms(facets.tags) },
    sections: SECTION_LABELS,
  };
}

function asTerms(value: unknown): { slug: string; label: string }[] {
  if (!Array.isArray(value)) {
    throw new Error('facet is not a list');
  }
  return value.flatMap((t) =>
    isRecord(t) && typeof t.slug === 'string' && typeof t.label === 'string'
      ? [{ slug: t.slug, label: t.label }]
      : [],
  );
}
