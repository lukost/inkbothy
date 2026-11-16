import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';
import type { LoadedIndex } from '../../../src/client/search/loader.ts';
import { type Filters, MAX_RESULTS, search } from '../../../src/client/search/query.ts';
import { SEARCH_OPTIONS, type SearchDoc } from '../../../src/shared/search-config.ts';
import { bulk, type FIXTURE, loadedIndex } from './fixture.ts';

const loaded = loadedIndex();
const filters = (categories: string[] = [], tags: string[] = []): Filters => ({
  categories: new Set(categories),
  tags: new Set(tags),
});
const urls = (found: { url: string }[]) => found.map((h) => h.url);
const NONE = filters();

describe('search without text', () => {
  it.each(['', '   ', '\t\n'])('finds nothing for %j without filters', (text) => {
    expect(search(loaded, text, NONE)).toEqual([]);
  });

  it('lists what the filters allow, newest first, undated last', () => {
    expect(urls(search(loaded, '', filters([], ['kernel'])))).toEqual([
      '/blog/dma/',
      '/blog/zolw/',
      '/projects/tracer/',
      '/projects/undated/',
    ]);
  });

  it('breaks date ties by URL', () => {
    const same = loadedIndex(
      ['/blog/b/', '/blog/a/', '/blog/c/'].map((url): (typeof FIXTURE)[number] => [
        { url, published: '2026-01-01', tags: ['t'] },
        '',
      ]),
    );
    expect(urls(search(same, ' ', filters([], ['t'])))).toEqual([
      '/blog/a/',
      '/blog/b/',
      '/blog/c/',
    ]);
  });
});

describe('filter semantics: categories OR, tags OR, the two groups AND', () => {
  it.each([
    ['one category', ['Linux'], [], ['/blog/dma/', '/blog/rt/']],
    ['categories are ORed', ['Linux', 'Zwierzęta'], [], ['/blog/dma/', '/blog/rt/', '/blog/zolw/']],
    ['one tag', [], ['rt'], ['/blog/rt/']],
    ['tags are ORed', [], ['rt', 'dma'], ['/blog/dma/', '/blog/rt/']],
    ['tags reach projects', [], ['tooling'], ['/projects/tracer/']],
    ['groups are ANDed', ['Linux'], ['kernel'], ['/blog/dma/']],
    ['ANDed groups may be empty', ['Embedded'], ['kernel'], []],
    [
      'ORed within, ANDed across',
      ['Linux', 'Embedded'],
      ['rt', 'dma'],
      ['/blog/dma/', '/blog/rt/'],
    ],
    ['an unknown label matches nothing', ['Nope'], [], []],
    ['labels are canonical, so case counts', ['linux'], [], []],
    [
      'a category matches only documents that have it',
      ['Embedded'],
      [],
      ['/blog/rt/', '/blog/mention/'],
    ],
  ])('%s', (_name, categories, tags, expected) => {
    expect(urls(search(loaded, '', filters(categories, tags)))).toEqual(expected);
  });

  it('applies the filters to a text query too', () => {
    expect(urls(search(loaded, 'kernel', NONE)).sort()).toEqual([
      '/blog/dma/',
      '/blog/zolw/',
      '/projects/tracer/',
      '/projects/undated/',
    ]);
    expect(urls(search(loaded, 'kernel', filters(['Linux'])))).toEqual(['/blog/dma/']);
    expect(urls(search(loaded, 'kernel', filters([], ['tooling'])))).toEqual(['/projects/tracer/']);
  });
});

describe('search with text', () => {
  it('matches by prefix', () => {
    expect(urls(search(loaded, 'sched', NONE))).toEqual(['/blog/rt/']);
  });

  it('tolerates a typo', () => {
    expect(urls(search(loaded, 'realtme', NONE))).toEqual(['/blog/rt/']);
  });

  it('matches body text, summaries and tags', () => {
    expect(urls(search(loaded, 'cyclictest', NONE))).toEqual(['/blog/rt/']);
    expect(urls(search(loaded, 'ftrace', NONE))).toEqual(['/projects/tracer/']);
    expect(urls(search(loaded, 'dma', NONE))).toEqual(['/blog/dma/']);
  });

  it('ranks a title match above a body mention', () => {
    expect(urls(search(loaded, 'tracer', NONE))).toEqual(['/projects/tracer/', '/blog/mention/']);
  });

  it('finds Polish words without their diacritics, in any case', () => {
    for (const text of ['zolw', 'ŻÓŁW', 'żółw', 'ZOLW']) {
      expect(urls(search(loaded, text, NONE)), text).toEqual(['/blog/zolw/']);
    }
    expect(urls(search(loaded, 'gesla', NONE))).toEqual(['/blog/zolw/']);
    expect(urls(search(loaded, 'zazolc jazn', NONE))).toEqual(['/blog/zolw/']);
    expect(urls(search(loaded, 'zwierzeta', NONE))).toEqual(['/blog/zolw/']);
  });

  it('finds nothing for unknown text', () => {
    expect(search(loaded, 'xyzzyplugh', NONE)).toEqual([]);
  });

  it('returns the stored fields and the matched index terms', () => {
    expect(search(loaded, 'sched', NONE)).toEqual([
      {
        url: '/blog/rt/',
        title: 'Realtime scheduling',
        summary: 'PREEMPT_RT latency',
        published: '2026-02-01',
        section: 'blog',
        tags: ['rt'],
        categories: ['Linux', 'Embedded'],
        terms: ['scheduling'],
      },
    ]);
    expect(search(loaded, 'undated', NONE)[0]).toMatchObject({
      section: 'projects',
      published: null,
    });
  });
});

describe('matching rules', () => {
  it('requires every word of the query', () => {
    expect(urls(search(loaded, 'dma kernel', NONE))).toEqual(['/blog/dma/']);
    expect(urls(search(loaded, 'kernel tooling', NONE))).toEqual(['/projects/tracer/']);
    expect(search(loaded, 'dma tooling', NONE)).toEqual([]);
    expect(search(loaded, 'dma xyzzyplugh', NONE)).toEqual([]);
  });

  it('finds words of the same document in different fields', () => {
    expect(urls(search(loaded, 'realtime cyclictest', NONE))).toEqual(['/blog/rt/']);
  });

  it('tolerates a typo in a word of five or more letters', () => {
    expect(urls(search(loaded, 'tracr', NONE))).toEqual(['/projects/tracer/', '/blog/mention/']);
    expect(urls(search(loaded, 'kernal', NONE))).toContain('/blog/dma/');
    expect(urls(search(loaded, 'realtme', NONE))).toEqual(['/blog/rt/']);
  });

  it('matches shorter words exactly or by prefix only', () => {
    expect(search(loaded, 'dmb', NONE)).toEqual([]);
    expect(search(loaded, 'zalw', NONE)).toEqual([]);
    expect(urls(search(loaded, 'dm', NONE))).toEqual(['/blog/dma/']);
    expect(urls(search(loaded, 'zolw', NONE))).toEqual(['/blog/zolw/']);
  });

  it('leaves the listing of a filter alone', () => {
    expect(urls(search(loaded, '', filters([], ['rt', 'dma'])))).toEqual([
      '/blog/dma/',
      '/blog/rt/',
    ]);
  });

  it('finds ß, ø and æ by their ASCII spelling', () => {
    const letters = loadedIndex([
      [{ url: '/blog/a/', title: 'Straße', tags: ['t'] }, ''],
      [{ url: '/blog/b/', title: 'Ørsted', tags: ['t'] }, ''],
      [{ url: '/blog/c/', title: 'Ætherial', tags: ['t'] }, ''],
    ]);
    expect(urls(search(letters, 'strasse', NONE))).toEqual(['/blog/a/']);
    expect(urls(search(letters, 'STRAßE', NONE))).toEqual(['/blog/a/']);
    expect(urls(search(letters, 'orsted', NONE))).toEqual(['/blog/b/']);
    expect(urls(search(letters, 'aetherial', NONE))).toEqual(['/blog/c/']);
  });
});

describe('result cap', () => {
  const many = loadedIndex(bulk(MAX_RESULTS + 5));

  it('keeps 20 hits of a text search', () => {
    expect(search(many, 'bulk', NONE)).toHaveLength(MAX_RESULTS);
  });

  it('keeps the 20 newest hits of a filtered listing', () => {
    const found = search(many, '', filters([], ['bulk']));
    expect(found).toHaveLength(MAX_RESULTS);
    expect(found[0]?.url).toBe('/blog/bulk-24/');
    expect(found.at(-1)?.url).toBe('/blog/bulk-5/');
  });

  it('keeps all hits below the cap', () => {
    expect(search(loadedIndex(bulk(MAX_RESULTS)), '', filters([], ['bulk']))).toHaveLength(
      MAX_RESULTS,
    );
  });
});

describe('malformed stored documents', () => {
  /** An index of `count` valid documents titled "word", whose stored fields are overwritten by `patches`. */
  function corrupted(patches: readonly Record<string, unknown>[]): LoadedIndex {
    const index = new MiniSearch<SearchDoc>(SEARCH_OPTIONS);
    index.addAll(
      patches.map((_, n) => ({
        url: `/doc-${n}/`,
        title: 'word',
        summary: '',
        published: null,
        section: 'blog',
        tags: [],
        categories: [],
        text: 'word',
      })),
    );
    const plain = index.toJSON();
    const storedFields = Object.fromEntries(
      Object.entries(plain.storedFields).map(([id, fields], n) => [
        id,
        { ...fields, ...patches[n] },
      ]),
    );
    return {
      index: MiniSearch.loadJS({ ...plain, storedFields }, SEARCH_OPTIONS),
      wildcard: MiniSearch.wildcard,
      facets: loaded.facets,
      sections: loaded.sections,
    };
  }

  it('skips documents without a valid section or valid fields', () => {
    const broken = corrupted([
      {},
      { section: 7 },
      { section: undefined },
      { published: 20260101 },
      { title: 7 },
      { summary: 7 },
      { url: 7 },
    ]);
    expect(urls(search(broken, 'word', NONE))).toEqual(['/doc-0/']);
  });

  it('keeps pages, which have no section, and sections the index names however it likes', () => {
    const odd = corrupted([{ section: null }, { section: 'wiki' }, { section: '' }]);
    expect(search(odd, 'word', NONE).map((h) => h.section)).toEqual([null, 'wiki', '']);
  });

  it('treats malformed label lists as carrying no label', () => {
    const odd = corrupted([
      { tags: 'rt' },
      { tags: ['rt', 7] },
      { tags: ['rt'] },
      { tags: ['rt'], categories: 7 },
    ]);
    expect(urls(search(odd, '', filters([], ['rt']))).sort()).toEqual(['/doc-2/', '/doc-3/']);
    expect(urls(search(odd, '', filters(['x'], ['rt'])))).toEqual([]);
    expect(search(odd, 'word', NONE)).toHaveLength(4);
  });
});
