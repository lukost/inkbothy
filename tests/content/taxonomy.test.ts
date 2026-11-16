import { describe, expect, it } from 'vitest';
import {
  buildTaxonomy,
  canonicalTerms,
  NO_TERMS,
  reservedSlugs,
  sectionTaxonomies,
  TAXONOMIES,
  termIndex,
  termUrl,
} from '../../src/content/taxonomy.ts';
import { sortByTitle, sortFeaturedFirst, sortNewest } from '../../src/generator/order.ts';
import { CARDS, type ItemSpec, item, LIST, STREAM } from '../helpers.ts';

const post = (url: string, categories: string[], extra: ItemSpec = {}) =>
  item({ url, categories, ...extra });

describe('buildTaxonomy', () => {
  it('groups by slug and sorts terms by label, case-insensitively', () => {
    const a = post('/blog/a/', ['linux', 'Embedded']);
    const b = post('/blog/b/', ['Linux', 'zephyr']);
    const c = post('/blog/c/', ['LINUX', 'Linux']);
    const { terms } = buildTaxonomy([a, b, c], 'categories');
    expect(terms.map((t) => [t.slug, t.label, t.items.map((i) => i.url)])).toEqual([
      ['embedded', 'Embedded', ['/blog/a/']],
      ['linux', 'Linux', ['/blog/a/', '/blog/b/', '/blog/c/']],
      ['zephyr', 'zephyr', ['/blog/b/']],
    ]);
  });

  it('picks the most frequent spelling and warns about the others', () => {
    const items = [
      post('/blog/a/', ['linux']),
      post('/blog/b/', ['Linux']),
      post('/blog/c/', ['Linux']),
    ];
    const { terms, warnings } = buildTaxonomy(items, 'categories');
    expect(terms[0]?.label).toBe('Linux');
    expect(warnings).toEqual(['categories: "Linux" is also spelled "linux"']);
  });

  it('breaks frequency ties by first-seen spelling', () => {
    const items = [post('/blog/a/', ['kernel']), post('/blog/b/', ['Kernel'])];
    expect(buildTaxonomy(items, 'categories').terms[0]?.label).toBe('kernel');
  });

  it('merges diacritic variants', () => {
    const items = [post('/blog/a/', ['Łódź']), post('/blog/b/', ['Lodz'])];
    const { terms, warnings } = buildTaxonomy(items, 'categories');
    expect(terms).toHaveLength(1);
    expect(terms[0]?.slug).toBe('lodz');
    expect(warnings).toHaveLength(1);
  });

  it('counts an item once even if it lists two spellings', () => {
    const { terms } = buildTaxonomy([post('/blog/a/', ['Linux', 'linux'])], 'categories');
    expect(terms[0]?.items).toHaveLength(1);
  });

  it('works on tags', () => {
    const i = item({ tags: ['C++', 'C'] });
    expect(buildTaxonomy([i], 'tags').terms.map((t) => t.slug)).toEqual(['c', 'cpp']);
  });

  it('returns empty results for no items or no labels', () => {
    expect(buildTaxonomy([], 'tags')).toEqual({ terms: [], warnings: [] });
    expect(buildTaxonomy([item()], 'tags')).toEqual({ terms: [], warnings: [] });
  });
});

describe('termIndex / canonicalTerms', () => {
  const { terms } = buildTaxonomy(
    [post('/blog/a/', ['Linux']), post('/blog/b/', ['Linux', 'Embedded'])],
    'categories',
  );
  const lookup = termIndex(terms);

  it('finds a term by any spelling', () => {
    expect(lookup('LINUX')?.label).toBe('Linux');
    expect(lookup('unknown')).toBeUndefined();
  });

  it('canonicalises and de-duplicates, keeping order', () => {
    expect(canonicalTerms(['linux', 'Embedded', 'Linux'], lookup)).toEqual([
      { slug: 'linux', label: 'Linux' },
      { slug: 'embedded', label: 'Embedded' },
    ]);
  });

  it('keeps unknown labels with their own spelling', () => {
    expect(canonicalTerms(['New Thing', 'new thing'], lookup)).toEqual([
      { slug: 'new-thing', label: 'New Thing' },
    ]);
  });
});

describe('ordering', () => {
  it('sortNewest: newest first, undated last, ties by url, input untouched', () => {
    const input = [
      item({ url: '/blog/old/', published: '2025-01-01' }),
      item({ url: '/blog/none/', published: null }),
      item({ url: '/blog/b/', published: '2026-05-05' }),
      item({ url: '/blog/a/', published: '2026-05-05' }),
    ];
    const snapshot = input.map((i) => i.url);
    expect(sortNewest(input).map((i) => i.url)).toEqual([
      '/blog/a/',
      '/blog/b/',
      '/blog/old/',
      '/blog/none/',
    ]);
    expect(input.map((i) => i.url)).toEqual(snapshot);
  });

  it('sortFeaturedFirst: featured before the rest, each newest first, input untouched', () => {
    const input = [
      item({ url: '/projects/new/', published: '2026-05-05' }),
      item({ url: '/projects/old-star/', published: '2024-01-01', featured: true }),
      item({ url: '/projects/off/', published: '2027-01-01', featured: false }),
      item({ url: '/projects/star/', published: '2025-01-01', featured: true }),
      item({ url: '/projects/none/', published: null }),
    ];
    const snapshot = input.map((i) => i.url);
    expect(sortFeaturedFirst(input).map((i) => i.url)).toEqual([
      '/projects/star/',
      '/projects/old-star/',
      '/projects/off/',
      '/projects/new/',
      '/projects/none/',
    ]);
    expect(input.map((i) => i.url)).toEqual(snapshot);
  });

  it('sortByTitle: case-insensitive, ties by url', () => {
    const input = [
      item({ url: '/projects/2/', title: 'beta' }),
      item({ url: '/projects/1/', title: 'Alpha' }),
      item({ url: '/projects/0/', title: 'Beta' }),
    ];
    expect(sortByTitle(input).map((i) => i.url)).toEqual([
      '/projects/1/',
      '/projects/0/',
      '/projects/2/',
    ]);
  });
});

describe('term URLs and names', () => {
  it('builds the page URL of a term below its section', () => {
    expect(termUrl('blog', 'categories', 'linux')).toBe('/blog/category/linux/');
    expect(termUrl('notes', 'tags', 'c-1')).toBe('/notes/tag/c-1/');
    expect(TAXONOMIES.categories.title).toBe('Category');
    expect(TAXONOMIES.tags.title).toBe('Tag');
  });

  it('reserves the URL segments of the declared taxonomies as item slugs', () => {
    expect(reservedSlugs(STREAM)).toEqual(new Set(['category', 'tag']));
    expect(reservedSlugs(CARDS)).toEqual(new Set(['tag']));
    expect(reservedSlugs({ taxonomies: [] })).toEqual(new Set());
  });

  it('knows no terms', () => {
    expect(NO_TERMS.category('Linux')).toBeUndefined();
    expect(NO_TERMS.tag('kernel')).toBeUndefined();
  });
});

describe('sectionTaxonomies', () => {
  const posts = [
    item({ url: '/blog/a/', categories: ['linux'], tags: ['Kernel'] }),
    item({ url: '/blog/b/', categories: ['Linux', 'Linux'], tags: ['kernel', 'rt'] }),
    item({ url: '/blog/c/', categories: ['Linux'], tags: ['kernel'] }),
  ];

  it('lists the terms of each declared taxonomy, in declaration order', () => {
    const { lists } = sectionTaxonomies(posts, { taxonomies: ['tags', 'categories'] });
    expect(lists.map((l) => [l.field, l.terms.map((t) => `${t.label}:${t.items.length}`)])).toEqual(
      [
        ['tags', ['kernel:3', 'rt:1']],
        ['categories', ['Linux:3']],
      ],
    );
  });

  it('spells terms by the most frequent variant, warning about the others', () => {
    const { lookup, warnings } = sectionTaxonomies(posts, STREAM);
    expect(lookup.tag('KERNEL')).toMatchObject({ slug: 'kernel', label: 'kernel' });
    expect(lookup.category('linux')).toMatchObject({ slug: 'linux', label: 'Linux' });
    expect(warnings).toEqual([
      'categories: "Linux" is also spelled "linux"',
      'tags: "kernel" is also spelled "Kernel"',
    ]);
  });

  it('knows nothing of a taxonomy the section does not declare', () => {
    const { lookup, lists } = sectionTaxonomies(posts, { taxonomies: ['tags'] });
    expect(lists.map((l) => l.field)).toEqual(['tags']);
    expect(lookup.category('Linux')).toBeUndefined();
    expect(lookup.tag('rt')).toMatchObject({ slug: 'rt', label: 'rt' });
  });

  it('has nothing for a section without taxonomies or items', () => {
    const none = sectionTaxonomies(posts, { ...LIST, taxonomies: [] });
    expect(none.lists).toEqual([]);
    expect(none.warnings).toEqual([]);
    expect(none.lookup.tag('kernel')).toBeUndefined();
    expect(sectionTaxonomies([], STREAM).lists.map((l) => l.terms)).toEqual([[], []]);
  });
});
