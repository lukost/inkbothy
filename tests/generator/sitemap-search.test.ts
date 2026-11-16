// @vitest-environment happy-dom
import MiniSearch from 'minisearch';
import { beforeAll, describe, expect, it } from 'vitest';
import { sectionTaxonomies } from '../../src/content/taxonomy.ts';
import { getRenderer } from '../../src/generator/render.ts';
import { buildSearchIndex, type SearchEntry } from '../../src/generator/search.ts';
import { renderSitemap } from '../../src/generator/sitemap.ts';
import { isRecord } from '../../src/shared/guards.ts';
import {
  foldTerm,
  SEARCH_INDEX_VERSION,
  SEARCH_OPTIONS,
  type SearchDoc,
  type SearchSections,
} from '../../src/shared/search-config.ts';
import type { Item } from '../../src/types.ts';
import { CARDS, item, noTerms, STREAM } from '../helpers.ts';

describe('renderSitemap', () => {
  const xml = renderSitemap('https://example.com', [
    { url: '/', lastmod: '2026-01-01' },
    { url: '/blog/a&b/', lastmod: null },
    { url: '/blog/x/', lastmod: '' },
  ]);

  it('produces well-formed sitemaps.org XML', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('xmlns')).toBe(
      'http://www.sitemaps.org/schemas/sitemap/0.9',
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('writes absolute, escaped locs and lastmod only when known', () => {
    expect(xml).toContain(
      '<url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>',
    );
    expect(xml).toContain('<url><loc>https://example.com/blog/a&amp;b/</loc></url>');
    expect(xml).toContain('<url><loc>https://example.com/blog/x/</loc></url>');
  });

  it('renders an empty urlset', () => {
    expect(renderSitemap('https://e.com', [])).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n</urlset>',
    );
  });
});

const SECTIONS_LABELS: SearchSections = { blog: 'Scribings', projects: 'Projects', notes: 'Notes' };

describe('buildSearchIndex', () => {
  const posts = [
    item({
      url: '/blog/dma/',
      title: 'DMA on i.MX8',
      summary: 'Scatter-gather',
      categories: ['Linux'],
      tags: ['kernel', 'Kernel'],
      body: 'Talks about `ioctl` usage.\n\n```c\nint fencedsecret;\n```\n\n```mermaid\ngraph TD; mermaidsecret-->B\n```\n',
    }),
    item({ url: '/blog/rt/', title: 'Realtime', categories: ['linux'], tags: ['rt'] }),
  ];
  const project = item({
    url: '/projects/tool/',
    section: 'projects',
    title: 'Tracer',
    tags: ['kernel'],
  });
  const blogTerms = sectionTaxonomies(posts, STREAM).lookup;
  const projectTerms = sectionTaxonomies([project], CARDS).lookup;
  const termsOf = (i: Item) => (i === project ? projectTerms : blogTerms);
  let index = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
  let json = '';

  beforeAll(async () => {
    const markdown = getRenderer('markdown');
    const entries = await Promise.all(
      [...posts, project].map(
        async (i): Promise<SearchEntry> => ({
          item: i,
          terms: termsOf(i),
          text: (
            await markdown.render(i.body, { baseUrl: i.url, docId: i.slug, title: i.meta.title })
          ).text,
        }),
      ),
    );
    json = buildSearchIndex(entries, SECTIONS_LABELS);
    const file: unknown = JSON.parse(json);
    index = MiniSearch.loadJSON(JSON.stringify(isRecord(file) ? file.index : null), SEARCH_OPTIONS);
  });

  it('wraps the index in a versioned file that loads with the shared options', () => {
    const file: unknown = JSON.parse(json);
    expect(isRecord(file) && Object.keys(file)).toEqual(['version', 'index', 'facets', 'sections']);
    expect(isRecord(file) && file.version).toBe(SEARCH_INDEX_VERSION);
    expect(isRecord(file) && file.sections).toEqual(SECTIONS_LABELS);
    expect(index.documentCount).toBe(3);
  });

  it('lists the filter terms of the indexed items, canonical, sorted and without duplicates', () => {
    const file: unknown = JSON.parse(json);
    expect(isRecord(file) && file.facets).toEqual({
      categories: [{ slug: 'linux', label: 'Linux' }],
      tags: [
        { slug: 'kernel', label: 'kernel' },
        { slug: 'rt', label: 'rt' },
      ],
    });
  });

  it('leaves out terms that no indexed item carries', () => {
    const lone = item({ url: '/blog/lone/', tags: ['solo'], categories: ['Alone'] });
    const draft = item({ url: '/blog/other/', tags: ['unused'], categories: ['Unused'] });
    const { lookup } = sectionTaxonomies([lone, draft], STREAM);
    const file: unknown = JSON.parse(
      buildSearchIndex([{ item: lone, terms: lookup, text: '' }], SECTIONS_LABELS),
    );
    expect(isRecord(file) && file.facets).toEqual({
      categories: [{ slug: 'alone', label: 'Alone' }],
      tags: [{ slug: 'solo', label: 'solo' }],
    });
  });

  it('has empty facets for no entries', () => {
    const file: unknown = JSON.parse(buildSearchIndex([], SECTIONS_LABELS));
    expect(isRecord(file) && file.facets).toEqual({ categories: [], tags: [] });
  });

  it('keeps a label that no taxonomy knows, as written', () => {
    const file: unknown = JSON.parse(
      buildSearchIndex(
        [{ item: item({ tags: ['Odd Tag'] }), terms: noTerms, text: '' }],
        SECTIONS_LABELS,
      ),
    );
    expect(isRecord(file) && file.facets).toMatchObject({
      tags: [{ slug: 'odd-tag', label: 'Odd Tag' }],
    });
  });

  it('is version 3, and keeps the labels of sections without items', () => {
    const file: unknown = JSON.parse(json);
    expect(isRecord(file) && file.version).toBe(3);
    expect(isRecord(file) && Object.keys(Object(file.sections))).toEqual([
      'blog',
      'projects',
      'notes',
    ]);
  });

  it('indexes the items of every section and pages, each stored with its section or none', () => {
    const page = item({ url: '/about/', section: null, title: 'About', published: null });
    const note = item({ url: '/notes/n/', section: 'notes', title: 'Note' });
    const file: unknown = JSON.parse(
      buildSearchIndex(
        [
          { item: page, terms: noTerms, text: 'cv' },
          { item: note, terms: noTerms, text: '' },
        ],
        SECTIONS_LABELS,
      ),
    );
    const loaded = MiniSearch.loadJSON<SearchDoc>(
      JSON.stringify(isRecord(file) ? file.index : null),
      SEARCH_OPTIONS,
    );
    expect(loaded.search('About')[0]).toMatchObject({ url: '/about/', section: null });
    expect(loaded.search('Note')[0]).toMatchObject({ url: '/notes/n/', section: 'notes' });
  });

  it('joins the terms of different sections into one facet list', () => {
    const blog = item({ url: '/blog/a/', tags: ['Kernel'] });
    const tool = item({ url: '/projects/b/', section: 'projects', tags: ['kernel', 'c'] });
    const file: unknown = JSON.parse(
      buildSearchIndex(
        [
          { item: blog, terms: sectionTaxonomies([blog], STREAM).lookup, text: '' },
          { item: tool, terms: sectionTaxonomies([tool], CARDS).lookup, text: '' },
        ],
        SECTIONS_LABELS,
      ),
    );
    expect(isRecord(file) && file.facets).toMatchObject({
      tags: [
        { slug: 'c', label: 'c' },
        { slug: 'kernel', label: 'Kernel' },
      ],
    });
  });

  it('spells a term the same in every item, so one filter matches them all', () => {
    const blog = item({ url: '/blog/a/', tags: ['Kernel'], categories: ['Linux'] });
    const tool = item({ url: '/projects/b/', section: 'projects', tags: ['kernel'] });
    const other = item({ url: '/blog/c/', tags: ['KERNEL'], categories: ['linux'] });
    const file: unknown = JSON.parse(
      buildSearchIndex(
        [
          { item: blog, terms: sectionTaxonomies([blog, other], STREAM).lookup, text: '' },
          { item: tool, terms: sectionTaxonomies([tool], CARDS).lookup, text: '' },
          { item: other, terms: noTerms, text: '' },
        ],
        SECTIONS_LABELS,
      ),
    );
    const loaded = MiniSearch.loadJSON<SearchDoc>(
      JSON.stringify(isRecord(file) ? file.index : null),
      SEARCH_OPTIONS,
    );
    const labels = loaded.search(MiniSearch.wildcard).map((r) => [r.id, r.tags, r.categories]);
    expect(labels.sort()).toEqual([
      ['/blog/a/', ['Kernel'], ['Linux']],
      ['/blog/c/', ['Kernel'], ['Linux']],
      ['/projects/b/', ['Kernel'], []],
    ]);
  });

  it('finds Polish words without diacritics', () => {
    expect(foldTerm('Żółć GĘŚLĄ jaźń')).toBe('zolc gesla jazn');
    const polish = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
    polish.add({
      url: '/blog/p/',
      title: 'Zażółć gęślą jaźń',
      summary: '',
      published: null,
      section: 'blog',
      tags: [],
      categories: [],
      text: '',
    });
    expect(polish.search('zazolc').map((r) => r.id)).toEqual(['/blog/p/']);
    expect(polish.search('JAŹŃ').map((r) => r.id)).toEqual(['/blog/p/']);
  });

  it('finds body text and inline code', () => {
    expect(index.search('ioctl').map((r) => r.id)).toEqual(['/blog/dma/']);
  });

  it('does not index fenced code or Mermaid', () => {
    expect(index.search('fencedsecret', { fuzzy: false, prefix: false })).toEqual([]);
    expect(index.search('mermaidsecret', { fuzzy: false, prefix: false })).toEqual([]);
  });

  it('stores canonical, de-duplicated labels for filtering', () => {
    const hit = index.search('DMA')[0];
    expect(hit).toMatchObject({
      url: '/blog/dma/',
      title: 'DMA on i.MX8',
      section: 'blog',
      published: '2026-01-01',
      tags: ['kernel'],
      categories: ['Linux'],
    });
  });

  it('supports tag/category filters on stored fields', () => {
    const ids = index
      .search('kernel', { filter: (r) => r.section === 'projects' })
      .map((r) => r.id);
    expect(ids).toEqual(['/projects/tool/']);
    const linux = index.search('realtime', { filter: (r) => r.categories.includes('Linux') });
    expect(linux.map((r) => r.id)).toEqual(['/blog/rt/']);
  });

  it('matches by tag text and by prefix', () => {
    expect(
      index
        .search('kern')
        .map((r) => r.id)
        .sort(),
    ).toEqual(['/blog/dma/', '/projects/tool/']);
  });
});
