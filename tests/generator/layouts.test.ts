// @vitest-environment happy-dom
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SiteConfig } from '../../src/config/schema.ts';
import { build } from '../../src/generator/build.ts';
import { SEARCH_INDEX_FILE } from '../../src/generator/search.ts';
import { isRecord } from '../../src/shared/guards.ts';
import type { BuildResult } from '../../src/types.ts';
import {
  $,
  $$,
  attrs,
  CARDS,
  doc,
  LIST,
  parseHtml,
  STREAM,
  siteConfig,
  texts,
  trackedTrees,
} from '../helpers.ts';

const { tree, outFor } = trackedTrees();
const now = new Date('2027-06-01T00:00:00Z');

interface Built {
  readonly result: BuildResult;
  readonly read: (rel: string) => Promise<string>;
  readonly page: (url: string) => Promise<Document>;
  readonly exists: (rel: string) => Promise<boolean>;
}

async function buildSite(content: Record<string, string>, config: SiteConfig): Promise<Built> {
  const siteDir = await tree(content);
  const outDir = outFor(siteDir);
  const result = await build({ siteDir, dataDir: await tree(), outDir, config, now });
  const read = (rel: string) => fs.readFile(path.join(outDir, rel), 'utf8');
  return {
    result,
    read,
    page: async (url) => parseHtml(await read(`${url.slice(1)}index.html`)),
    exists: (rel) =>
      fs.access(path.join(outDir, rel)).then(
        () => true,
        () => false,
      ),
  };
}

const entry = (title: string, published: string, extra = '', body = 'Body.\n') =>
  doc(`title: ${title}\npublished: ${published}\nsummary: About ${title}\n${extra}`, body);

/** A site of one section per layout, with a menu entry of each kind. */
const threeLayouts = siteConfig({
  sections: {
    blog: { ...STREAM, stream: { initial: 1, batch: 5 } },
    projects: CARDS,
    notes: { ...LIST, taxonomies: ['tags', 'categories'], menu: 'taxonomy' },
  },
  menu: ['about', 'notes', 'blog', 'projects'],
  home: [
    { kind: 'featured', section: 'projects', count: 1 },
    { kind: 'latest', section: 'notes', count: 2 },
    { kind: 'latest', section: 'blog', count: 5 },
  ],
});

const content = {
  'index.md': entry('Welcome', '2026-01-01'),
  'about/index.md': entry('About', '2026-01-02'),
  'blog/a/index.md': entry('Alpha post', '2026-02-01', 'categories: [Linux]\ntags: [rt]'),
  'blog/b/index.md': entry('Beta post', '2026-03-01', 'categories: [linux]\ntags: [rt, io]'),
  'projects/p/index.md': entry('Proj', '2026-01-05', 'tags: [rt]\nfeatured: true'),
  'projects/q/index.md': entry('Quark', '2026-01-06', 'tags: [io]\nfeatured: true'),
  'notes/index.md': entry('Jottings', '2026-04-04', '', 'Intro of notes.\n'),
  'notes/n1/index.md': entry('First note', '2026-04-01', 'tags: [rt, Tip]\ncategories: [Misc]'),
  'notes/n2/index.md': entry('Second note', '2026-04-02', 'tags: [tip]'),
};

describe('three layouts side by side', () => {
  let site: Built;

  beforeAll(async () => {
    site = await buildSite(content, threeLayouts);
  });

  it('renders each section index in its own layout', async () => {
    expect($$(await site.page('/blog/'), 'section.stream article')).toHaveLength(1);
    expect(texts(await site.page('/projects/'), 'section.cards-page .card h2')).toEqual([
      'Quark',
      'Proj',
    ]);
    const notes = await site.page('/notes/');
    expect(texts(notes, 'main h1')).toEqual(['Jottings']);
    expect(texts(notes, 'section.list-page .md-content').map((t) => t?.trim())).toEqual([
      'Intro of notes.',
    ]);
    expect(texts(notes, '.post-list h2 a')).toEqual(['Second note', 'First note']);
    expect(attrs(notes, '.post-list h2 a', 'href')).toEqual(['/notes/n2/', '/notes/n1/']);
    expect($$(notes, 'article')).toEqual([]);
  });

  it('writes term pages under the section, in its layout, for the taxonomies it declares', async () => {
    const files = new Set(site.result.files);
    for (const url of [
      'blog/category/linux',
      'blog/tag/rt',
      'blog/tag/io',
      'projects/tag/rt',
      'projects/tag/io',
      'notes/tag/rt',
      'notes/tag/tip',
      'notes/category/misc',
    ]) {
      expect(files.has(`${url}/index.html`), url).toBe(true);
    }
    expect([...files].filter((f) => /^projects\/category\//.test(f))).toEqual([]);
    const tag = await site.page('/notes/tag/tip/');
    expect(texts(tag, 'main h1')).toEqual(['Tag: Tip']);
    expect(texts(tag, '.post-list h2 a')).toEqual(['Second note', 'First note']);
    expect(texts(await site.page('/projects/tag/io/'), '.card h2 a')).toEqual(['Quark']);
    expect(texts(await site.page('/blog/category/linux/'), 'main h1')).toEqual(['Category: Linux']);
  });

  it('scopes terms to their section: the same tag has one page and one spelling per section', async () => {
    expect(texts(await site.page('/blog/tag/rt/'), 'h2 a')).toEqual(['Beta post', 'Alpha post']);
    expect(texts(await site.page('/projects/tag/rt/'), '.card h2 a')).toEqual(['Proj']);
    expect(texts(await site.page('/notes/tag/rt/'), '.post-list h2 a')).toEqual(['First note']);
  });

  it('links the terms of an item to the term pages of its own section', async () => {
    expect(attrs(await site.page('/notes/n1/'), '.article-tags a', 'href')).toEqual([
      '/notes/tag/rt/',
      '/notes/tag/tip/',
    ]);
    expect(attrs(await site.page('/notes/n1/'), '.article-categories a', 'href')).toEqual([
      '/notes/category/misc/',
    ]);
    expect(attrs(await site.page('/projects/p/'), '.article-tags a', 'href')).toEqual([
      '/projects/tag/rt/',
    ]);
    expect(attrs(await site.page('/projects/'), '.card .article-tags a', 'href')).toEqual([
      '/projects/tag/io/',
      '/projects/tag/rt/',
    ]);
  });

  it('writes fragments for the items of stream sections only', async () => {
    expect(await site.exists('blog/a/fragment.html')).toBe(true);
    expect(await site.exists('blog/b/fragment.html')).toBe(true);
    expect(await site.exists('projects/p/fragment.html')).toBe(false);
    expect(await site.exists('notes/n1/fragment.html')).toBe(false);
  });

  it('lists the stream rest only where the layout is a stream', async () => {
    expect($$(await site.page('/blog/'), 'ol.stream-rest > li')).toHaveLength(1);
    expect($$(await site.page('/notes/'), 'ol.stream-rest')).toEqual([]);
  });

  it('puts the menu entries in the configured order, each as its section asks', async () => {
    const menu = await site.page('/');
    expect(
      $$(menu, '.site-menu > ul > li').map((li) => li.querySelector('a, summary')?.textContent),
    ).toEqual(['Home', 'About', 'Notes', 'Blog', 'Projects']);
    const [notes, blog, projects] = $$(menu, '.site-menu details');
    expect(texts(notes ?? menu, 'a')).toEqual(['All notes', 'rt (1)', 'Tip (2)']);
    expect(attrs(notes ?? menu, 'a', 'href')).toEqual([
      '/notes/',
      '/notes/tag/rt/',
      '/notes/tag/tip/',
    ]);
    expect(texts(blog ?? menu, 'a')).toEqual(['All posts', 'Linux (2)']);
    expect(texts(projects ?? menu, 'a')).toEqual(['All projects', 'Proj', 'Quark']);
  });

  it('composes the home page from its blocks, in order, each in its own form', async () => {
    const home = await site.page('/');
    expect($$(home, '.home-section').map((s) => s.className)).toEqual([
      'home-section home-featured',
      'home-section home-latest',
      'home-section home-latest',
    ]);
    expect(texts(home, '.home-section h2')).toEqual([
      'Featured projects',
      'Latest notes',
      'Latest posts',
    ]);
    expect(texts(home, '.home-featured .card h3 a')).toEqual(['Quark']);
    expect(texts(home, '.home-latest:nth-of-type(2) h3 a')).toEqual(['Second note', 'First note']);
    expect(attrs(home, '.home-more a', 'href')).toEqual(['/projects/', '/notes/', '/blog/']);
  });

  it('lists every generated page in the sitemap, and nothing the sections do not have', async () => {
    const xml = await site.read('sitemap.xml');
    const locs = [...xml.matchAll(/<loc>https:\/\/example\.com([^<]*)<\/loc>(<lastmod>([^<]*))?/g)];
    expect(locs.map((m) => m[1])).toEqual([
      '/',
      '/about/',
      '/blog/',
      '/blog/a/',
      '/blog/b/',
      '/notes/',
      '/notes/n1/',
      '/notes/n2/',
      '/projects/',
      '/projects/p/',
      '/projects/q/',
    ]);
    expect(locs.find((m) => m[1] === '/notes/')?.[3]).toBe('2026-04-04');
  });

  it('indexes every section and the pages that have Markdown, with their labels', async () => {
    const file: unknown = JSON.parse(await site.read(SEARCH_INDEX_FILE));
    expect(isRecord(file) && file.sections).toEqual({
      blog: 'Blog',
      projects: 'Projects',
      notes: 'Notes',
    });
    const index = isRecord(file) && isRecord(file.index) ? file.index : {};
    const stored = Object.values(Object(index.storedFields)).map((f) =>
      isRecord(f) ? [f.url, f.section] : [],
    );
    expect(stored.sort()).toEqual(
      [
        ['/about/', null],
        ['/blog/a/', 'blog'],
        ['/blog/b/', 'blog'],
        ['/notes/', 'notes'],
        ['/notes/n1/', 'notes'],
        ['/notes/n2/', 'notes'],
        ['/projects/p/', 'projects'],
        ['/projects/q/', 'projects'],
      ].sort(),
    );
  });
});

describe('sections that may be left out', () => {
  it('builds a site without sections', async () => {
    const config = siteConfig({ sections: {}, menu: ['about'], home: [] });
    const site = await buildSite(
      { 'index.md': entry('Home', '2026-01-01'), 'about/index.md': entry('About', '2026-01-02') },
      config,
    );
    expect(texts(await site.page('/'), '.site-menu a')).toEqual(['Home', 'About']);
    expect($$(await site.page('/'), '.home-section')).toEqual([]);
  });

  it('shows a home block only when its section has items to show', async () => {
    const config = siteConfig({
      sections: { notes: LIST, projects: CARDS },
      menu: [],
      home: [
        { kind: 'latest', section: 'notes', count: 0 },
        { kind: 'featured', section: 'projects', count: 3 },
        { kind: 'latest', section: 'projects', count: 3 },
      ],
    });
    const site = await buildSite(
      {
        'index.md': entry('Home', '2026-01-01'),
        'notes/n/index.md': entry('N', '2026-01-02'),
        'projects/p/index.md': entry('P', '2026-01-03'),
      },
      config,
    );
    expect($$(await site.page('/'), '.home-section').map((s) => s.className)).toEqual([
      'home-section home-latest',
    ]);
    expect(texts(await site.page('/'), '.home-latest h2')).toEqual(['Latest projects']);
  });

  it('limits featured items by count, newest first', async () => {
    const config = siteConfig({
      sections: { projects: CARDS },
      menu: [],
      home: [{ kind: 'featured', section: 'projects', count: 2 }],
    });
    const site = await buildSite(
      {
        'index.md': entry('Home', '2026-01-01'),
        'projects/a/index.md': entry('A', '2026-01-01', 'featured: true'),
        'projects/b/index.md': entry('B', '2026-03-01', 'featured: true'),
        'projects/c/index.md': entry('C', '2026-02-01', 'featured: true'),
        'projects/d/index.md': entry('D', '2026-04-01'),
      },
      config,
    );
    expect(texts(await site.page('/'), '.home-featured .card h3')).toEqual(['B', 'C']);
  });

  it('stops with the file and path when a menu entry names nothing', async () => {
    const config = siteConfig({ menu: ['blog', 'missing'] });
    await expect(buildSite({ 'index.md': entry('Home', '2026-01-01') }, config)).rejects.toThrow(
      'site.yaml: menu[1]: "missing" is neither a section nor a top-level page',
    );
  });

  it('accepts a menu entry that names a draft page, and leaves it out', async () => {
    const config = siteConfig({ menu: ['secret'] });
    const site = await buildSite(
      {
        'index.md': entry('Home', '2026-01-01'),
        'secret/index.md': doc('title: Secret\ndraft: true\npublished: 2026-01-01'),
      },
      config,
    );
    expect(texts(await site.page('/'), '.site-menu a')).toEqual(['Home']);
  });

  it('refuses content that no declared section accounts for', async () => {
    await expect(
      buildSite({ 'wiki/page/index.md': entry('W', '2026-01-01') }, siteConfig()),
    ).rejects.toThrow('wiki/page: wiki/ is not a declared section');
  });
});

describe('hand-written HTML pages', () => {
  const html = [
    '<h1>Hello <em>there</em></h1>',
    '<p><a href="team.png">team</a> <img src="team.png" alt=""></p>',
    '<p><a href="/abs/">abs</a> <a href="#local">local</a> <a href="https://example.org/">ext</a></p>',
    '<button onclick="x()">no</button><script>1</script>',
  ].join('\n');
  let site: Built;

  beforeAll(async () => {
    site = await buildSite(
      {
        'index.md': entry('Home', '2026-01-01'),
        'talks/index.html': html,
        'talks/team.png': 'PNG',
        'talks/_notes.txt': 'private',
      },
      siteConfig({ menu: ['talks'] }),
    );
  });

  it('is inserted as written, with relative URLs resolved against the page', async () => {
    const page = await site.page('/talks/');
    expect(attrs(page, 'main a', 'href')).toEqual([
      '/talks/team.png',
      '/abs/',
      '#local',
      'https://example.org/',
    ]);
    expect(attrs(page, 'main img', 'src')).toEqual(['/talks/team.png']);
    expect(texts(page, 'main h1')).toEqual(['Hello there']);
    expect(await site.read('talks/team.png')).toBe('PNG');
  });

  it('is titled by its <h1>, in the title, the menu and the manifest', async () => {
    const page = await site.page('/talks/');
    expect(page.title).toBe('Hello there · Site');
    expect(texts(page, '.site-menu a')).toEqual(['Home', 'Hello there']);
    expect(attrs(page, '.site-menu [aria-current]', 'href')).toEqual(['/talks/']);
    const manifest = JSON.parse(await site.read('manifest.json'));
    expect(manifest.pages).toContainEqual({
      url: '/talks/',
      title: 'Hello there',
      section: null,
      published: null,
      updated: null,
      draft: false,
    });
  });

  it('warns about what the Content-Security-Policy blocks', () => {
    expect(site.result.warnings.filter((w) => w.startsWith('talks/index.html'))).toEqual([
      'talks/index.html: event-handler attribute onclick is blocked by the Content-Security-Policy',
      'talks/index.html: inline <script> is blocked by the Content-Security-Policy',
    ]);
  });

  it('is in the sitemap without a date, but not in the search index', async () => {
    expect(await site.read('sitemap.xml')).toContain('<loc>https://example.com/talks/</loc></url>');
    expect(await site.read(SEARCH_INDEX_FILE)).not.toContain('talks');
  });

  it('has no article metadata for the top bar, as it is not a Markdown article', async () => {
    const page = await site.page('/talks/');
    expect($$(page, '.topbar-title')).toEqual([]);
    expect($(page, 'main article .md-content h1').textContent).toBe('Hello there');
  });
});

describe('resume pages', () => {
  const RESUME =
    'headline: Embedded engineer\nexperience:\n  - { role: Kernel hacker, org: Acme, start: 2020-01, end: present }\nskills:\n  - { group: Languages, items: [Zig] }\n';

  it('is found by its data file wherever it sits at the top level, and indexed with its data', async () => {
    const site = await buildSite(
      {
        'cv/index.md': entry('My CV', '2026-01-01', '', 'Intro of the cv.\n'),
        'cv/_resume.yaml': RESUME,
      },
      siteConfig({ menu: ['cv'] }),
    );
    const page = await site.page('/cv/');
    expect(texts(page, '.resume-headline')).toEqual(['Embedded engineer']);
    expect(texts(page, '.resume-entry h3')).toEqual(['Kernel hacker']);
    expect(attrs(page, '.site-menu a', 'href')).toEqual(['/', '/cv/']);
    const index = JSON.parse(await site.read(SEARCH_INDEX_FILE)).index;
    expect(Object.values(index.storedFields)).toMatchObject([{ url: '/cv/', section: null }]);
    const stored = await site.read(SEARCH_INDEX_FILE);
    expect(stored).toContain('zig');
    expect(stored).toContain('hacker');
    expect(stored).toContain('cv');
  });

  it('is an ordinary page without a data file, and is indexed by its text', async () => {
    const site = await buildSite(
      { 'cv/index.md': entry('My CV', '2026-01-01', '', 'Plain text.\n') },
      siteConfig({ menu: ['cv'] }),
    );
    expect($$(await site.page('/cv/'), '.resume')).toEqual([]);
    expect(await site.read(SEARCH_INDEX_FILE)).toContain('/cv/');
  });

  it('is ignored as data when it sits anywhere but a top-level page', async () => {
    const site = await buildSite(
      {
        'blog/p/index.md': entry('P', '2026-01-01'),
        'blog/p/_resume.yaml': RESUME,
      },
      siteConfig(),
    );
    expect($$(await site.page('/blog/p/'), '.resume')).toEqual([]);
    expect(site.result.files.some((f) => f.endsWith('_resume.yaml'))).toBe(false);
  });
});

describe('asset directories in the build', () => {
  let site: Built;

  beforeAll(async () => {
    site = await buildSite(
      {
        'index.md': entry('Home', '2026-01-01', '', '![h](img/home.png)\n'),
        'img/home.png': 'HOME',
        'about/index.md': entry('About', '2026-01-02', '', '![a](img/deep/er/a.png)\n'),
        'about/img/deep/er/a.png': 'ABOUT',
        'about/img/_draft/hidden.png': 'HIDDEN',
        'talks/index.html': '<h1>Talks</h1><img src="img/t.png">',
        'talks/img/t.png': 'TALKS',
        'blog/index.md': entry('Writing', '2026-01-03'),
        'blog/img/intro.png': 'INTRO',
        'blog/a/index.md': entry('A', '2026-01-04', '', '![x](shots/x.png)\n'),
        'blog/a/shots/x.png': 'ITEM',
      },
      siteConfig({ menu: [] }),
    );
  });

  it.each([
    ['/', 'img/home.png', 'HOME'],
    ['/about/', 'about/img/deep/er/a.png', 'ABOUT'],
    ['/talks/', 'talks/img/t.png', 'TALKS'],
    ['/blog/a/', 'blog/a/shots/x.png', 'ITEM'],
  ])(
    'copies what %s references, and the URL resolves to an emitted file',
    async (url, file, text) => {
      const src = attrs(await site.page(url), 'main img', 'src')[0];
      expect(src).toBe(`/${file}`);
      expect(await site.read(file)).toBe(text);
    },
  );

  it('copies the assets of a section introduction and leaves _-prefixed paths out', async () => {
    expect(await site.read('blog/img/intro.png')).toBe('INTRO');
    expect(site.result.files.filter((f) => f.includes('hidden'))).toEqual([]);
  });
});
