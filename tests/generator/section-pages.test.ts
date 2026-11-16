// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  headingOf,
  homeBlocks,
  renderMembers,
  sectionLastmod,
  sectionPages,
  termPages,
} from '../../src/generator/sections.ts';
import { required } from '../../src/shared/guards.ts';
import { $, $$, CARDS, dom, item, LIST, STREAM, siteConfig, texts } from '../helpers.ts';

const config = siteConfig({
  sections: { projects: CARDS, notes: LIST, blog: STREAM },
});

const post = (slug: string, published: string | null, extra: Parameters<typeof item>[0] = {}) =>
  item({ url: `/blog/${slug}/`, title: slug, published, ...extra });
const project = (slug: string, published: string | null, extra: Parameters<typeof item>[0] = {}) =>
  item({ url: `/projects/${slug}/`, section: 'projects', title: slug, published, ...extra });
const note = (slug: string, published: string | null, extra: Parameters<typeof item>[0] = {}) =>
  item({ url: `/notes/${slug}/`, section: 'notes', title: slug, published, ...extra });

describe('sectionPages', () => {
  it('makes a page per declared section that has items or an introduction, in declaration order', () => {
    const items = [post('a', '2026-01-01'), note('n', '2026-01-02')];
    const { pages } = sectionPages(items, config);
    expect(pages.map((p) => [p.key, p.url, p.members.map((m) => m.slug)])).toEqual([
      ['notes', '/notes/', ['n']],
      ['blog', '/blog/', ['a']],
    ]);
  });

  it('takes the section root bundle as the introduction, and counts it as content', () => {
    const intro = item({ url: '/projects/', section: null, kind: 'intro', title: 'Work' });
    const { pages } = sectionPages([intro], config);
    expect(pages.map((p) => [p.key, p.intro, p.members])).toEqual([['projects', intro, []]]);
    expect(headingOf(pages[0] ?? { intro, config: CARDS })).toBe('Work');
  });

  it('orders each section by its layout: newest first, cards featured first', () => {
    const items = [
      project('old', '2026-01-01', { featured: true }),
      project('new', '2026-03-01'),
      project('mid', '2026-02-01', { featured: true }),
      note('n1', '2026-01-01'),
      note('n2', null),
      note('n3', '2026-05-01'),
      post('b1', '2026-01-01'),
      post('b2', '2026-02-01'),
    ];
    const order = (key: string) =>
      sectionPages(items, config)
        .pages.find((p) => p.key === key)
        ?.members.map((m) => m.slug);
    expect(order('projects')).toEqual(['mid', 'old', 'new']);
    expect(order('notes')).toEqual(['n3', 'n1', 'n2']);
    expect(order('blog')).toEqual(['b2', 'b1']);
  });

  it('keeps the terms of different sections apart', () => {
    const items = [post('a', null, { tags: ['rt'] }), project('p', null, { tags: ['rt', 'io'] })];
    const { pages } = sectionPages(items, config);
    const tagsOf = (key: string) =>
      pages.find((p) => p.key === key)?.lists.map((l) => l.terms.map((t) => t.slug));
    expect(tagsOf('blog')).toEqual([[], ['rt']]);
    expect(tagsOf('projects')).toEqual([['io', 'rt']]);
  });

  it('names the section in the warnings about its terms', () => {
    const items = [post('a', null, { tags: ['Rt'] }), post('b', null, { tags: ['rt'] })];
    expect(sectionPages(items, config).warnings).toEqual(['blog: tags: "Rt" is also spelled "rt"']);
  });

  it('has no pages for items outside the declared sections', () => {
    const stray = item({ url: '/wiki/x/', section: 'wiki' });
    expect(sectionPages([stray], config).pages).toEqual([]);
  });
});

describe('termPages', () => {
  const items = [
    post('a', '2026-01-01', { categories: ['Linux'], tags: ['rt'] }),
    post('b', '2026-02-01', { categories: ['Linux'], tags: ['rt', 'io'] }),
    project('p', '2026-01-01', { tags: ['rt'] }),
    project('q', '2026-02-01', { tags: ['rt'], featured: true }),
  ];
  const { pages } = sectionPages(items, config);
  const of = (key: string) =>
    termPages(
      required(
        pages.find((p) => p.key === key),
        key,
      ),
    );

  it('has a page per term of each declared taxonomy, headed by its title and label', () => {
    expect(of('blog').map((t) => [t.url, t.heading, t.members.map((m) => m.slug)])).toEqual([
      ['/blog/category/linux/', 'Category: Linux', ['b', 'a']],
      ['/blog/tag/io/', 'Tag: io', ['b']],
      ['/blog/tag/rt/', 'Tag: rt', ['b', 'a']],
    ]);
  });

  it('orders the members of a term page by the layout of the section', () => {
    expect(of('projects').map((t) => [t.url, t.members.map((m) => m.slug)])).toEqual([
      ['/projects/tag/rt/', ['q', 'p']],
    ]);
  });

  it('is empty for a section without terms', () => {
    const only = sectionPages([note('n', '2026-01-01')], config).pages;
    expect(only.flatMap(termPages)).toEqual([]);
  });
});

describe('homeBlocks', () => {
  const items = [
    post('a', '2026-01-01'),
    post('b', '2026-03-01'),
    post('c', '2026-02-01'),
    project('p', '2026-01-01', { featured: true }),
    project('q', '2026-02-01', { featured: true }),
    project('r', '2026-03-01'),
  ];
  const { pages } = sectionPages(items, config);

  it('takes the newest items for latest and the featured ones, newest first, for featured', () => {
    const blocks = homeBlocks(
      [
        { kind: 'latest', section: 'blog', count: 2 },
        { kind: 'featured', section: 'projects', count: 5 },
        { kind: 'latest', section: 'projects', count: 1 },
      ],
      pages,
    );
    expect(blocks.map((b) => [b.kind, b.url, b.noun.plural, b.items.map((i) => i.slug)])).toEqual([
      ['latest', '/blog/', 'posts', ['b', 'c']],
      ['featured', '/projects/', 'projects', ['q', 'p']],
      ['latest', '/projects/', 'projects', ['r']],
    ]);
  });

  it('hands each block the terms of its own section', () => {
    const [block] = homeBlocks([{ kind: 'latest', section: 'blog', count: 1 }], pages);
    expect(block?.terms).toBe(pages.find((p) => p.key === 'blog')?.lookup);
  });

  it.each([
    ['a count of zero', { kind: 'latest', section: 'blog', count: 0 }],
    ['a section without a page', { kind: 'latest', section: 'notes', count: 3 }],
    ['an unknown section', { kind: 'latest', section: 'nowhere', count: 3 }],
    ['featured without featured items', { kind: 'featured', section: 'blog', count: 3 }],
  ] as const)('omits a block with %s', (_, block) => {
    expect(homeBlocks([block], pages)).toEqual([]);
  });

  it('is empty without blocks', () => {
    expect(homeBlocks([], pages)).toEqual([]);
  });
});

describe('sectionLastmod', () => {
  const intro = item({
    url: '/blog/',
    section: null,
    kind: 'intro',
    published: '2026-09-09',
    updated: '2026-10-10',
  });
  const items = [post('a', '2026-01-01'), post('b', '2026-02-01', { updated: '2026-06-06' })];

  it('is the newest of updated or published over the items and the introduction', () => {
    const [page] = sectionPages([intro, ...items], config).pages;
    expect(page && sectionLastmod(page, [intro, ...items])).toBe('2026-10-10');
    const [bare] = sectionPages(items, config).pages;
    expect(bare && sectionLastmod(bare, items)).toBe('2026-06-06');
  });

  it('ignores what is not published, and other sections', () => {
    const other = note('n', '2030-01-01');
    const [page] = sectionPages([...items, other], config).pages.filter((p) => p.key === 'blog');
    expect(page && sectionLastmod(page, items)).toBe('2026-06-06');
  });

  it('is null when nothing carries a date', () => {
    const undated = [post('u', null)];
    const [page] = sectionPages(undated, config).pages;
    expect(page && sectionLastmod(page, undated)).toBeNull();
  });
});

describe('renderMembers', () => {
  const items = [
    post('a', '2026-01-01', { title: 'Alpha' }),
    post('b', '2026-02-01', { title: 'Beta' }),
    project('p', '2026-01-01', { title: 'Proj' }),
    note('n', '2026-01-01', { title: 'Note' }),
  ];
  const { pages } = sectionPages(items, config);
  const page = (key: string) => {
    const found = pages.find((p) => p.key === key);
    if (!found) {
      throw new Error(`no page ${key}`);
    }
    return found;
  };
  const content = (i: { url: string }) => `<p>text of ${i.url}</p>`;

  it('renders a stream with the batch settings of the section', () => {
    const el = dom(
      renderMembers(page('blog'), { heading: 'H', members: page('blog').members }, content),
    );
    expect(texts(el, 'h1')).toEqual(['H']);
    expect($$(el, 'article')).toHaveLength(2);
    const small = {
      ...page('blog'),
      config: { ...STREAM, stream: { initial: 1, batch: 7 } },
    };
    const rest = $(
      dom(renderMembers(small, { heading: 'H', members: small.members }, content)),
      'ol',
    );
    expect(rest.dataset.batch).toBe('7');
    expect(rest.dataset.noun).toBe('post');
  });

  it('renders cards and a list, with the introduction rendered first', () => {
    const intro = item({ url: '/projects/', section: null, kind: 'intro', title: 'Work' });
    const cards = dom(
      renderMembers(
        page('projects'),
        { heading: 'Work', intro, members: page('projects').members },
        content,
      ),
    );
    expect(texts(cards, 'section.cards-page > .md-content')).toEqual(['text of /projects/']);
    expect(texts(cards, '.card h2')).toEqual(['Proj']);
    const list = dom(
      renderMembers(page('notes'), { heading: 'Notes', members: page('notes').members }, content),
    );
    expect(texts(list, 'section.list-page .post-list h2')).toEqual(['Note']);
  });

  it('renders a term page like an index without introduction, from the members given', () => {
    const [first] = page('blog').members;
    const el = dom(
      renderMembers(page('blog'), { heading: 'Tag: x', members: first ? [first] : [] }, content),
    );
    expect(texts(el, 'h1')).toEqual(['Tag: x']);
    expect($$(el, 'article')).toHaveLength(1);
  });
});
