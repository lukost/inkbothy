import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadIndex } from '../../../src/client/search/loader.ts';
import { search } from '../../../src/client/search/query.ts';
import { isRecord } from '../../../src/shared/guards.ts';
import { SEARCH_INDEX_VERSION } from '../../../src/shared/search-config.ts';
import { indexFile, indexJson, SECTION_LABELS } from './fixture.ts';

const fetchMock = vi.fn<typeof fetch>();
let counter = 0;
/** A URL no other test has loaded, so the module's cache never leaks between tests. */
const freshUrl = () => `/search-index-test-${counter++}.json`;
const ok = (body: string) => Promise.resolve(new Response(body));

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function withFetch(): typeof fetchMock {
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('loadIndex', () => {
  it('fetches the file once and loads a searchable index with its facets', async () => {
    const f = withFetch().mockImplementation(() => ok(indexJson()));
    const url = freshUrl();
    const loaded = await loadIndex(url);
    expect(f).toHaveBeenCalledExactlyOnceWith(url);
    expect(loaded.facets.categories.map((t) => t.label)).toEqual([
      'Embedded',
      'Linux',
      'Zwierzęta',
    ]);
    expect(loaded.sections).toEqual(SECTION_LABELS);
    expect(
      search(loaded, 'zolw', { categories: new Set(), tags: new Set() }).map((h) => h.url),
    ).toEqual(['/blog/zolw/']);
  });

  it.each([
    ['no sections', {}],
    ['one section', { only: 'Only' }],
    ['many sections', { a: 'A', b: 'B', c: 'C', d: 'D' }],
  ])('takes the sections from the file: %s', async (_, sections) => {
    withFetch().mockImplementation(() => ok(JSON.stringify({ ...file(), sections })));
    expect((await loadIndex(freshUrl())).sections).toEqual(sections);
  });

  it('rejects an index file of the previous layout, whose sections were fixed', async () => {
    withFetch().mockImplementation(() => ok(JSON.stringify({ ...file(), version: 2 })));
    await expect(loadIndex(freshUrl())).rejects.toThrow('not a version 3 search index');
  });

  it('caches across calls, concurrent or later, as one promise', async () => {
    const f = withFetch().mockImplementation(() => ok(indexJson()));
    const url = freshUrl();
    const first = loadIndex(url);
    expect(loadIndex(url)).toBe(first);
    const [a, b] = await Promise.all([first, loadIndex(url)]);
    expect(a).toBe(b);
    expect(await loadIndex(url)).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('keeps indexes of different URLs apart', async () => {
    const f = withFetch().mockImplementation(() => ok(indexJson()));
    const [a, b] = await Promise.all([loadIndex(freshUrl()), loadIndex(freshUrl())]);
    expect(a).not.toBe(b);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('rejects on an HTTP error, naming the status', async () => {
    withFetch().mockImplementation(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(loadIndex(freshUrl())).rejects.toThrow('HTTP 404');
  });

  it('rejects when the request fails', async () => {
    withFetch().mockRejectedValue(new TypeError('offline'));
    await expect(loadIndex(freshUrl())).rejects.toThrow('offline');
  });

  it('rejects on invalid JSON', async () => {
    withFetch().mockImplementation(() => ok('{not json'));
    await expect(loadIndex(freshUrl())).rejects.toThrow();
  });

  const file = () => indexFile();
  /** The file with `patch` merged into its object-valued `field`. */
  const patched = (field: 'index' | 'facets', patch: Record<string, unknown>) => {
    const original = file()[field];
    if (!isRecord(original)) {
      throw new Error(`${field} is not an object`);
    }
    return { ...file(), [field]: { ...original, ...patch } };
  };
  const withIndex = (patch: Record<string, unknown>) => patched('index', patch);
  const withFacets = (patch: Record<string, unknown>) => patched('facets', patch);

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'index'],
    ['an older version', { ...file(), version: SEARCH_INDEX_VERSION - 1 }],
    ['no version', { index: file().index, facets: file().facets, sections: SECTION_LABELS }],
    [
      'no index',
      { version: SEARCH_INDEX_VERSION, facets: file().facets, sections: SECTION_LABELS },
    ],
    ['an index that is not an object', { ...file(), index: [] }],
    ['an index without documents', withIndex({ documentIds: undefined })],
    ['an index without a count', withIndex({ documentCount: '4' })],
    ['an index without terms', withIndex({ index: {} })],
    ['an index without a serialization version', withIndex({ serializationVersion: undefined })],
    ['no facets', { version: SEARCH_INDEX_VERSION, index: file().index, sections: SECTION_LABELS }],
    ['no section labels', { ...file(), sections: undefined }],
    ['section labels that are not an object', { ...file(), sections: 'Scribings' }],
    [
      'a section label that is not a string',
      { ...file(), sections: { blog: 'Scribings', projects: 3 } },
    ],
    ['facets without categories', withFacets({ categories: undefined })],
    ['facets without tags', withFacets({ tags: 'kernel' })],
    ['a facet term without a label', withFacets({ tags: [{ slug: 'x' }] })],
    ['a facet term that is not an object', withFacets({ categories: ['Linux'] })],
  ])('rejects %s as the wrong shape', async (_name, body) => {
    withFetch().mockImplementation(() => ok(JSON.stringify(body)));
    await expect(loadIndex(freshUrl())).rejects.toThrow(
      `not a version ${SEARCH_INDEX_VERSION} search index`,
    );
  });

  it('rejects an index MiniSearch cannot read', async () => {
    withFetch().mockImplementation(() =>
      ok(JSON.stringify(withIndex({ serializationVersion: 99 }))),
    );
    await expect(loadIndex(freshUrl())).rejects.toThrow(/incompatible/);
  });

  it('shares one failed fetch between concurrent calls, then fetches afresh', async () => {
    const f = withFetch();
    f.mockRejectedValueOnce(new TypeError('offline')).mockImplementation(() => ok(indexJson()));
    const url = freshUrl();
    const results = await Promise.allSettled([loadIndex(url), loadIndex(url)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(f).toHaveBeenCalledTimes(1);
    await expect(loadIndex(url)).resolves.toBeDefined();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('forgets a failure, so a retry fetches again and can succeed', async () => {
    const f = withFetch();
    f.mockRejectedValueOnce(new TypeError('offline')).mockImplementation(() => ok(indexJson()));
    const url = freshUrl();
    await expect(loadIndex(url)).rejects.toThrow('offline');
    const loaded = await loadIndex(url);
    expect(loaded.index.documentCount).toBe(8);
    expect(f).toHaveBeenCalledTimes(2);
    expect(await loadIndex(url)).toBe(loaded);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
