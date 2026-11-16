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
  parseHtml,
  STREAM,
  siteConfig,
  texts,
  trackedTrees,
} from '../helpers.ts';

const config = siteConfig({
  home: [
    { kind: 'latest', section: 'blog', count: 3 },
    { kind: 'featured', section: 'projects', count: 3 },
  ],
});
const withResume = { ...config, menu: ['resume', ...config.menu] };
const now = new Date('2027-06-01T00:00:00Z');
const { tree, outFor } = trackedTrees();

interface Built {
  readonly out: string;
  readonly result: BuildResult;
  readonly page: (url: string) => Promise<Document>;
  readonly sitemap: () => Promise<string[]>;
  readonly manifest: () => Promise<{ pages: { url: string }[]; files: string[] }>;
  readonly read: (rel: string) => Promise<string>;
}

interface Options {
  readonly config?: SiteConfig;
  readonly drafts?: boolean;
}

async function buildTree(
  content: Record<string, string>,
  { config: used = config, drafts = false }: Options = {},
): Promise<Built> {
  const siteDir = await tree(content);
  const dataDir = await tree({});
  const out = outFor(siteDir);
  const result = await build({ siteDir, dataDir, outDir: out, config: used, now, drafts });
  const read = (rel: string) => fs.readFile(path.join(out, rel), 'utf8');
  return {
    out,
    result,
    page: async (url) => parseHtml(await read(`${url.slice(1)}index.html`)),
    sitemap: async () =>
      [...(await read('sitemap.xml')).matchAll(/<loc>https:\/\/example\.com([^<]*)<\/loc>/g)].map(
        (m) => m[1] ?? '',
      ),
    manifest: async () => JSON.parse(await read('manifest.json')),
    read,
  };
}

/** Trimmed text of each match. */
const lines = (root: ParentNode, selector: string) => texts(root, selector).map((t) => t?.trim());

const post = (title: string, published: string, extra = '') =>
  doc(
    `title: ${title}\npublished: ${published}\ncategories: [Linux]\n${extra}`,
    `Body of ${title}.\n`,
  );
const project = (title: string, published: string, extra = '') =>
  doc(`title: ${title}\npublished: ${published}\nsummary: About ${title}\n${extra}`);

const RESUME_YAML = `
headline: Engineer
contact:
  location: Berlin
  email: me@example.com
  links:
    - { label: Code, url: "https://example.com/me" }
    - { label: Bad, url: "javascript:alert(1)" }
experience:
  - role: Lead
    org: Acme
    start: 2020-03
    end: present
    highlights:
      - "Cut **latency** by \`40%\` with [a tool](https://example.com/t)"
      - "# Not a heading"
  - role: Backwards
    org: Acme
    start: 2022-05
    end: 2021-01
  - role: Bad month
    org: Acme
    start: 2022-13
    end: present
education:
  - { degree: MSc, institution: Uni, start: 2010-10, end: 2015-06 }
skills: not a list
salary: secret
`;

describe('sections (fixture site)', () => {
  let site: Built;
  const blog = Object.fromEntries(
    [1, 2, 3, 4, 5].map((n) => [`blog/p${n}/index.md`, post(`Post ${n}`, `2026-0${n}-01`)]),
  );

  beforeAll(async () => {
    site = await buildTree(
      {
        'index.md': doc('title: Welcome\npublished: 2026-01-01', 'About me.\n'),
        'resume/index.md': doc('title: Resume\npublished: 2026-01-01', 'Intro of the resume.\n'),
        'resume/_resume.yaml': RESUME_YAML,
        'projects/index.md': doc(
          'title: My work\npublished: 2026-09-09\nsummary: Intro summary',
          'Things I built.\n',
        ),
        ...blog,
        'blog/p6/index.md': post('Draft post', '2026-06-01', 'draft: true'),
        'projects/alpha/index.md': project(
          'Alpha',
          '2026-01-01',
          'status: active\nrepo: https://example.com/a\ntags: [c]',
        ),
        'projects/beta/index.md': project(
          'Beta',
          '2026-03-01',
          'featured: true\nstatus: maintained',
        ),
        'projects/gamma/index.md': project('Gamma', '2026-02-01', 'featured: yes'),
        'projects/delta/index.md': project('Delta', '2026-05-01', 'featured: no'),
      },
      { config: withResume },
    );
  });

  describe('home', () => {
    it('lists the newest posts up to the configured count, newest first, without drafts', async () => {
      const home = await site.page('/');
      expect(texts(home, '.home-latest h3 a')).toEqual(['Post 5', 'Post 4', 'Post 3']);
      expect(attrs(home, '.home-latest h3 a', 'href')).toEqual([
        '/blog/p5/',
        '/blog/p4/',
        '/blog/p3/',
      ]);
      expect(texts(home, '.home-latest .home-more a')).toEqual(['All posts →']);
    });

    it('shows its own text before the sections', async () => {
      const home = await site.page('/');
      expect(texts(home, 'main .article h1')).toEqual(['Welcome']);
      expect(lines(home, 'main .article .md-content')).toEqual(['About me.']);
    });

    it('features only the projects marked featured, newest first', async () => {
      const home = await site.page('/');
      expect(texts(home, '.home-featured .card h3')).toEqual(['Beta', 'Gamma']);
      expect(attrs(home, '.home-featured .home-more a', 'href')).toEqual(['/projects/']);
    });
  });

  describe('projects', () => {
    it('shows a card per project, featured first, then newest', async () => {
      const page = await site.page('/projects/');
      expect(texts(page, '.cards h2 a')).toEqual(['Beta', 'Gamma', 'Delta', 'Alpha']);
      const alpha = $$(page, '.card')[3];
      expect(texts(alpha ?? page, '.badge')).toEqual(['active']);
      expect(texts(alpha ?? page, '.card-summary')).toEqual(['About Alpha']);
      expect(texts(alpha ?? page, '.article-tags li')).toEqual(['c']);
      expect(attrs(alpha ?? page, '.card-repo a', 'href')).toEqual(['https://example.com/a']);
    });

    it('uses content/projects/index.md as the introduction and title', async () => {
      const page = await site.page('/projects/');
      expect(texts(page, 'main h1')).toEqual(['My work']);
      expect(lines(page, 'main .md-content')).toEqual(['Things I built.']);
      expect(page.title).toBe('My work · Site');
      expect(attrs(page, 'meta[name="description"]', 'content')).toEqual(['Intro summary']);
    });

    it('publishes the page once, and lists it among the pages', async () => {
      const { files, pages } = await site.manifest();
      expect(files.filter((f) => f === 'projects/index.html')).toHaveLength(1);
      expect(pages.map((p) => p.url)).toContain('/projects/');
    });

    it('has "All projects" first in the menu on every page', async () => {
      for (const url of ['/', '/projects/', '/projects/beta/', '/blog/']) {
        const page = await site.page(url);
        const links = $$($$(page, '.site-menu details')[1] ?? page, 'a');
        expect(links[0]?.textContent, url).toBe('All projects');
        expect(links[0]?.getAttribute('href'), url).toBe('/projects/');
        expect(links.map((l) => l.textContent).slice(1), url).toEqual([
          'Alpha',
          'Beta',
          'Delta',
          'Gamma',
        ]);
      }
      const own = await site.page('/projects/');
      expect(texts(own, '.site-menu [aria-current="page"]')).toEqual(['All projects']);
    });

    it('is in the sitemap once, dated by the newest project or introduction', async () => {
      const locs = await site.sitemap();
      expect(locs.filter((l) => l === '/projects/')).toHaveLength(1);
      const xml = await fs.readFile(path.join(site.out, 'sitemap.xml'), 'utf8');
      expect(xml).toContain(
        '<loc>https://example.com/projects/</loc><lastmod>2026-09-09</lastmod>',
      );
      expect(xml).toContain('<loc>https://example.com/blog/</loc><lastmod>2026-05-01</lastmod>');
    });
  });

  describe('blog stream', () => {
    it('renders the first posts in full and lists the rest for the client to load', async () => {
      const page = await site.page('/blog/');
      expect(texts(page, '.stream > article h2')).toEqual(['Post 5', 'Post 4']);
      const list = $(page, 'ol.stream-rest');
      expect(list.getAttribute('data-batch')).toBe('2');
      expect(attrs(list, ':scope > li', 'data-fragment')).toEqual([
        '/blog/p3/fragment.html',
        '/blog/p2/fragment.html',
        '/blog/p1/fragment.html',
      ]);
      const { files } = await site.manifest();
      for (const n of [1, 2, 3]) {
        expect(files).toContain(`blog/p${n}/fragment.html`);
      }
    });

    it('streams category pages the same way', async () => {
      const page = await site.page('/blog/category/linux/');
      expect($$(page, '.stream > article')).toHaveLength(2);
      expect($$(page, 'ol.stream-rest > li')).toHaveLength(3);
    });
  });

  describe('resume', () => {
    it('renders the header, the contact list, the page text and the sections', async () => {
      const page = await site.page('/resume/');
      expect(texts(page, 'main h1')).toEqual(['Resume']);
      expect(texts(page, '.resume-headline')).toEqual(['Engineer']);
      expect(texts(page, '.resume-contact li')).toEqual(['Berlin', 'me@example.com', 'Code']);
      expect(attrs(page, '.resume-contact a', 'href')).toEqual([
        'mailto:me@example.com',
        'https://example.com/me',
      ]);
      expect(lines(page, '.resume .md-content')).toEqual(['Intro of the resume.']);
      expect(texts(page, '.resume-section h2')).toEqual(['Experience', 'Education']);
      expect(texts(page, 'main .resume-entry h3')).toEqual(['Lead', 'MSc']);
      expect(texts(page, '.resume-period')).toEqual(['Mar 2020 – Present', 'Oct 2010 – Jun 2015']);
    });

    it('renders highlights as inline Markdown, with no block elements', async () => {
      const page = await site.page('/resume/');
      const [first, second] = $$(page, '.resume-entry li');
      expect(first?.innerHTML).toBe(
        'Cut <strong>latency</strong> by <code>40%</code> with <a href="https://example.com/t">a tool</a>',
      );
      expect(second?.innerHTML).toBe('# Not a heading');
      expect($$(page, '.resume-entry li :is(h1, h2, h3, p, ul, ol, pre)')).toEqual([]);
    });

    it('drops the unsafe link and reports each bad entry as a warning', async () => {
      const page = await site.page('/resume/');
      expect(texts(page, '.resume-contact a')).not.toContain('Bad');
      expect(String(page.documentElement.outerHTML)).not.toContain('javascript:');
      const resume = site.result.warnings.filter((w) => w.startsWith('resume:'));
      expect(resume).toEqual([
        'resume: unknown key "salary"; ignored',
        'resume: contact.links[1]: needs a label and an http(s) url; entry ignored',
        'resume: experience[1]: end 2021-01 is before start 2022-05; entry ignored',
        'resume: experience[2]: start must be a month, YYYY-MM; entry ignored',
        'resume: skills: expected a list; ignored',
      ]);
    });

    it('does not publish the data file', async () => {
      const { files } = await site.manifest();
      expect(files.filter((f) => f.startsWith('resume/'))).toEqual(['resume/index.html']);
      await expect(fs.access(path.join(site.out, 'resume/_resume.yaml'))).rejects.toThrow();
    });

    it('is in the menu and the sitemap', async () => {
      const home = await site.page('/');
      expect(attrs(home, '.site-menu > ul > li > a', 'href')).toContain('/resume/');
      expect(await site.sitemap()).toContain('/resume/');
    });
  });
});

describe('sections without content', () => {
  it('omits the home sections, the section pages and their menu groups when there are none', async () => {
    const site = await buildTree({ 'index.md': doc('title: Welcome\npublished: 2026-01-01') });
    const home = await site.page('/');
    expect($$(home, '.home-section')).toEqual([]);
    expect(texts(home, '.site-menu summary')).toEqual([]);
    const { files } = await site.manifest();
    expect(files).not.toContain('projects/index.html');
    expect(await site.sitemap()).not.toContain('/projects/');
    expect(site.result.warnings.filter((w) => w.startsWith('resume'))).toEqual([]);
  });

  it('shows no featured section when no project is featured, and no posts section without posts', async () => {
    const site = await buildTree({
      'index.md': doc('title: Welcome\npublished: 2026-01-01'),
      'projects/a/index.md': project('A', '2026-01-01'),
    });
    const home = await site.page('/');
    expect($$(home, '.home-section')).toEqual([]);
    expect(texts(await site.page('/projects/'), '.cards h2')).toEqual(['A']);
  });

  it('builds a projects page from the introduction alone, with a menu group of its own link', async () => {
    const site = await buildTree({
      'projects/index.md': doc('title: Projects\npublished: 2026-04-04', 'Coming soon.\n'),
    });
    const page = await site.page('/projects/');
    expect(lines(page, 'main .md-content')).toEqual(['Coming soon.']);
    expect(texts(page, '.empty')).toEqual(['No projects yet.']);
    expect(texts(page, '.site-menu summary')).toEqual(['Projects']);
    expect(texts(page, '.site-menu details a')).toEqual(['All projects']);
    expect(await site.sitemap()).toEqual(['/projects/']);
  });

  it('titles the projects page itself when there is no introduction', async () => {
    const site = await buildTree({ 'projects/a/index.md': project('A', '2026-01-01') });
    const page = await site.page('/projects/');
    expect(texts(page, 'main h1')).toEqual(['Projects']);
    expect($$(page, 'main .md-content')).toEqual([]);
    expect(page.title).toBe('Projects · Site');
  });

  it('leaves the projects page undated in the sitemap when nothing carries a date', async () => {
    const site = await buildTree({
      'projects/a/index.md': doc('title: A', 'x\n'),
    });
    const xml = await fs.readFile(path.join(site.out, 'sitemap.xml'), 'utf8');
    expect(xml).toContain('<loc>https://example.com/projects/</loc></url>');
  });
});

describe('resume problems', () => {
  const page = { 'resume/index.md': doc('title: Resume\npublished: 2026-01-01', 'Only text.\n') };

  it('renders the page as an ordinary article when there is no data file', async () => {
    const site = await buildTree(page);
    const resume = await site.page('/resume/');
    expect(texts(resume, 'main article h1')).toEqual(['Resume']);
    expect($$(resume, '.resume')).toEqual([]);
    expect(site.result.warnings.filter((w) => w.startsWith('resume'))).toEqual([]);
  });

  it('warns about unparsable data and falls back to the article', async () => {
    const site = await buildTree({ ...page, 'resume/_resume.yaml': 'a: [unclosed' });
    expect($$(await site.page('/resume/'), '.resume')).toEqual([]);
    const warnings = site.result.warnings.filter((w) => w.startsWith('resume:'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('_resume.yaml');
    expect(warnings[0]).toMatch(/; ignored$/);
  });

  it('prefixes every resume warning once, whatever its origin', async () => {
    const broken = await buildTree({ ...page, 'resume/_resume.yaml': 'a: [unclosed' });
    const mapping = await buildTree({ ...page, 'resume/_resume.yaml': 'skills: x\nsalary: 1\n' });
    const list = await buildTree({ ...page, 'resume/_resume.yaml': '- a\n' });
    const warnings = [broken, mapping, list].flatMap((b) =>
      b.result.warnings.filter((w) => /resume/.test(w) && !w.startsWith('attributions')),
    );
    expect(warnings).toHaveLength(4);
    for (const w of warnings) {
      expect(w).toMatch(/^resume: (?!resume)/);
    }
    expect(broken.result.warnings.find((w) => w.includes('_resume.yaml'))).toMatch(
      /^resume: .*_resume\.yaml: .*; ignored$/,
    );
  });

  it('warns about a position that starts after the build date, and still shows it', async () => {
    const future = await buildTree({
      ...page,
      'resume/_resume.yaml':
        'experience:\n  - { role: Next, org: Acme, start: 2027-07, end: present }\n  - { role: Now, org: Acme, start: 2027-06, end: present }\n',
    });
    expect(future.result.warnings.filter((w) => w.startsWith('resume:'))).toEqual([
      'resume: experience[0]: start 2027-07 is in the future',
    ]);
    expect(texts(await future.page('/resume/'), '.resume-entry h3')).toEqual(['Next', 'Now']);
  });

  it('shows raw HTML of a highlight as text', async () => {
    const built = await buildTree({
      ...page,
      'resume/_resume.yaml':
        'experience:\n  - role: R\n    org: O\n    start: 2020-01\n    end: present\n    highlights: ["<b>x</b> <img src=y onerror=z>"]\n',
    });
    const entry = $(await built.page('/resume/'), '.resume-entry li');
    expect(entry.innerHTML).toBe('&lt;b&gt;x&lt;/b&gt; &lt;img src=y onerror=z&gt;');
  });

  it('warns about data that is not a mapping and falls back to the article', async () => {
    const site = await buildTree({ ...page, 'resume/_resume.yaml': '- just\n- a list\n' });
    expect($$(await site.page('/resume/'), '.resume')).toEqual([]);
    expect(site.result.warnings).toContain('resume: expected a mapping at the top level; ignored');
  });

  it('ignores data when there is no resume page, and builds an empty-data resume page', async () => {
    const orphan = await buildTree({
      'index.md': doc('title: Welcome\npublished: 2026-01-01'),
      'resume/_resume.yaml': 'salary: 1\n',
    });
    expect(orphan.result.warnings.filter((w) => w.startsWith('resume'))).toEqual([]);
    expect((await orphan.manifest()).files.filter((f) => f.startsWith('resume'))).toEqual([]);
    const empty = await buildTree({ ...page, 'resume/_resume.yaml': '{}\n' });
    const resume = await empty.page('/resume/');
    expect(texts(resume, '.resume h1')).toEqual(['Resume']);
    expect($$(resume, '.resume-section')).toEqual([]);
  });
});

describe('section index pages', () => {
  const intro = (title: string, published: string, body: string, extra = '') =>
    doc(`title: ${title}\npublished: ${published}\nsummary: About ${title}\n${extra}`, `${body}\n`);
  const both = {
    'blog/index.md': intro('Writing', '2026-12-24', 'Blog intro text.\n\n![shot](hero.png)'),
    'blog/hero.png': 'BLOGPNG',
    'blog/one/index.md': post('One', '2026-01-01'),
    'blog/two/index.md': post('Two', '2026-02-01'),
    'blog/three/index.md': post('Three', '2026-03-01'),
    'projects/index.md': intro(
      'My work',
      '2026-11-11',
      'Projects intro text.\n\n![shot](shot.png)',
    ),
    'projects/shot.png': 'PROJPNG',
    'projects/a/index.md': project('A', '2026-04-04'),
  };
  let site: Built;

  beforeAll(async () => {
    site = await buildTree(both);
  });

  it.each([
    ['/blog/', 'Writing', 'Blog intro text.'],
    ['/projects/', 'My work', 'Projects intro text.'],
  ])(
    'uses %s root bundle as the introduction: title, body and summary',
    async (url, title, text) => {
      const page = await site.page(url);
      expect(texts(page, 'main h1')).toEqual([title]);
      expect(lines(page, 'main > .column > section > .md-content > p:first-child')).toEqual([text]);
      expect(page.title).toBe(`${title} · Site`);
      expect(attrs(page, 'meta[name="description"]', 'content')).toEqual([`About ${title}`]);
    },
  );

  it('keeps the stream below the blog introduction and the cards below the project one', async () => {
    const blog = await site.page('/blog/');
    expect(Array.from($(blog, 'section.stream').children, (c) => c.tagName)).toEqual([
      'H1',
      'DIV',
      'ARTICLE',
      'ARTICLE',
      'OL',
    ]);
    expect(texts(blog, '.stream > article h2')).toEqual(['Three', 'Two']);
    const projects = await site.page('/projects/');
    expect(Array.from($(projects, 'section.cards-page').children, (c) => c.className)).toEqual([
      'page-title',
      'md-content',
      'cards',
    ]);
  });

  it('copies the images next to each introduction, and publishes each page once', async () => {
    expect(await site.read('blog/hero.png')).toBe('BLOGPNG');
    expect(await site.read('projects/shot.png')).toBe('PROJPNG');
    const { files, pages } = await site.manifest();
    for (const url of ['blog', 'projects']) {
      expect(files.filter((f) => f === `${url}/index.html`)).toHaveLength(1);
      expect(pages.map((p) => p.url)).toContain(`/${url}/`);
    }
    expect(attrs(await site.page('/blog/'), 'main .md-content img', 'src')).toEqual([
      '/blog/hero.png',
    ]);
    expect(attrs(await site.page('/projects/'), 'main .md-content img', 'src')).toEqual([
      '/projects/shot.png',
    ]);
  });

  it('puts each section index in the sitemap once, dated by its newest item or introduction', async () => {
    const locs = await site.sitemap();
    expect(locs.filter((l) => l === '/blog/' || l === '/projects/')).toEqual([
      '/blog/',
      '/projects/',
    ]);
    const xml = await site.read('sitemap.xml');
    expect(xml).toContain('<loc>https://example.com/blog/</loc><lastmod>2026-12-24</lastmod>');
    expect(xml).toContain('<loc>https://example.com/projects/</loc><lastmod>2026-11-11</lastmod>');
  });

  it('indexes the introductions under their section, at the section index URL', async () => {
    const { files } = await site.manifest();
    expect(files).toContain(SEARCH_INDEX_FILE);
    const file = JSON.parse(await site.read(SEARCH_INDEX_FILE));
    const stored = Object.values<Record<string, unknown>>(file.index.storedFields);
    const of = (url: string) => stored.find((f) => f.url === url);
    expect(of('/blog/')).toMatchObject({ section: 'blog', title: 'Writing' });
    expect(of('/projects/')).toMatchObject({ section: 'projects', title: 'My work' });
    expect(file.sections).toMatchObject({ blog: 'Blog', projects: 'Projects' });
    expect(JSON.stringify(file.index)).toContain('intro');
  });

  it('adds nothing for a section without an introduction', async () => {
    const built = await buildTree({ 'blog/one/index.md': post('One', '2026-01-01') });
    const { files } = await built.manifest();
    expect(files).toContain(SEARCH_INDEX_FILE);
    const file = JSON.parse(await built.read(SEARCH_INDEX_FILE));
    expect(
      Object.values<Record<string, unknown>>(file.index.storedFields).map((f) => f.url),
    ).toEqual(['/blog/one/']);
  });

  it('shows the default heading and no introduction when there is none', async () => {
    const bare = await buildTree({
      'blog/one/index.md': post('One', '2026-01-01'),
      'projects/a/index.md': project('A', '2026-04-04'),
    });
    for (const [url, heading] of [
      ['/blog/', 'Blog'],
      ['/projects/', 'Projects'],
    ] as const) {
      const page = await bare.page(url);
      expect(texts(page, 'main h1'), url).toEqual([heading]);
      expect($$(page, 'main > section > .md-content'), url).toEqual([]);
      expect(page.title, url).toBe(`${heading} · Site`);
    }
    expect(bare.result.warnings.filter((w) => w.includes('index.md'))).toEqual([]);
  });

  describe('a draft introduction', () => {
    const drafts = {
      'blog/index.md': intro('Secret blog', '2026-12-24', 'Draft blog text.', 'draft: true'),
      'blog/secret.png': 'S1',
      'blog/one/index.md': post('One', '2026-01-01'),
      'projects/index.md': intro(
        'Secret work',
        '2026-12-25',
        'Draft projects text.',
        'draft: true',
      ),
      'projects/secret.png': 'S2',
      'projects/a/index.md': project('A', '2026-04-04'),
    };

    it('does not leak into a build without drafts', async () => {
      const built = await buildTree(drafts);
      const everything = (
        await Promise.all(
          (
            await built.manifest()
          ).files
            .filter((f) => f.endsWith('.html') || f.endsWith('.xml') || f.endsWith('.json'))
            .map((f) => built.read(f)),
        )
      ).join('\n');
      expect(everything).not.toMatch(/Secret|Draft (blog|projects) text|secret\.png/);
      expect((await built.manifest()).files.filter((f) => /secret\.png/.test(f))).toEqual([]);
      const xml = await built.read('sitemap.xml');
      expect(xml).toContain('<loc>https://example.com/blog/</loc><lastmod>2026-01-01</lastmod>');
      expect(xml).toContain(
        '<loc>https://example.com/projects/</loc><lastmod>2026-04-04</lastmod>',
      );
      expect(texts(await built.page('/blog/'), 'main h1')).toEqual(['Blog']);
      expect($$(await built.page('/projects/'), 'meta[name="robots"]')).toEqual([]);
    });

    it('shows in a preview build, marked noindex, and stays out of the sitemap', async () => {
      const built = await buildTree(drafts, { drafts: true });
      const blog = await built.page('/blog/');
      expect(texts(blog, 'main h1')).toEqual(['Secret blog']);
      expect(attrs(blog, 'meta[name="robots"]', 'content')).toEqual(['noindex']);
      expect(await built.read('blog/secret.png')).toBe('S1');
      const xml = await built.read('sitemap.xml');
      expect(xml).toContain('<loc>https://example.com/blog/</loc><lastmod>2026-01-01</lastmod>');
    });
  });

  it('takes the section names from the configuration: menu, headings, titles', async () => {
    const renamed = await buildTree(
      {
        'blog/one/index.md': post('One', '2026-01-01'),
        'projects/a/index.md': project('A', '2026-04-04'),
      },
      {
        config: {
          ...config,
          sections: {
            blog: { ...STREAM, label: 'Scribings' },
            projects: { ...CARDS, label: 'Works' },
          },
        },
      },
    );
    for (const [url, label] of [
      ['/blog/', 'Scribings'],
      ['/projects/', 'Works'],
    ] as const) {
      const page = await renamed.page(url);
      expect(texts(page, 'main h1'), url).toEqual([label]);
      expect(page.title, url).toBe(`${label} · Site`);
    }
    const menu = await renamed.page('/blog/');
    expect(texts(menu, '.site-menu summary')).toEqual(['Scribings', 'Works']);
  });

  it('refuses a top-level bundle where a generated page goes', async () => {
    const built = await buildTree({ 'attributions/index.md': doc('title: A', 'x\n') }).catch(
      (err: unknown) => err,
    );
    expect(built).toBeInstanceOf(Error);
    expect(String(built)).toContain(
      'two sources produce the same output file: attributions/index.html',
    );
  });

  it('builds a section page from its introduction alone, on a site with no items', async () => {
    const built = await buildTree({ 'blog/index.md': intro('Writing', '2026-05-05', 'Soon.') });
    expect(texts(await built.page('/blog/'), '.empty')).toEqual(['No posts yet.']);
    expect(await built.sitemap()).toEqual(['/blog/']);
  });
});

describe('a renamed blog section', () => {
  const renamed: SiteConfig = {
    ...config,
    sections: {
      blog: { ...STREAM, label: 'Scribings', noun: { singular: 'piece', plural: 'pieces' } },
      projects: CARDS,
    },
  };
  let site: Built;
  let pages: readonly Document[] = [];

  beforeAll(async () => {
    site = await buildTree(
      {
        'index.md': doc('title: Home', 'Welcome.\n'),
        'blog/one/index.md': post('One', '2026-01-01'),
        'blog/two/index.md': post('Two', '2026-02-02', 'tags: [rt]\n'),
        'blog/three/index.md': post('Three', '2026-03-03'),
        'projects/a/index.md': project('A', '2026-04-04', 'tags: [rt]\n'),
      },
      { config: renamed },
    );
    const { files } = await site.manifest();
    pages = await Promise.all(
      files.filter((f) => f.endsWith('.html')).map(async (f) => parseHtml(await site.read(f))),
    );
  });

  it('names the section in the menu, the listing heading and the title', async () => {
    const listing = await site.page('/blog/');
    expect(texts(listing, 'main h1')).toEqual(['Scribings']);
    expect(listing.title).toBe('Scribings · Site');
    expect(texts(listing, '.site-menu summary')).toEqual(['Scribings', 'Projects']);
  });

  it('shows neither the old section name nor the old noun on any page the reader can see', () => {
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      for (const el of page.querySelectorAll('script, style')) {
        el.remove();
      }
      expect(`${page.title}\n${page.body.textContent}`, page.title).not.toMatch(
        /\bblog\b|\bposts?\b/i,
      );
    }
  });

  it('calls the entries by the configured noun in the menu, home page, listings and stream list', async () => {
    const home = await site.page('/');
    expect(texts(home, '.home-latest h2')).toEqual(['Latest pieces']);
    expect(texts(home, '.home-more a')).toEqual(['All pieces →']);
    expect(texts(home, '.site-menu a').filter((t) => t?.startsWith('All'))).toEqual([
      'All pieces',
      'All projects',
    ]);
    const list = $(await site.page('/blog/'), 'ol.stream-rest');
    expect(list.dataset.noun).toBe('piece');
    expect(list.dataset.nounPlural).toBe('pieces');
  });

  it('says there are no entries in the configured noun', async () => {
    const empty = await buildTree(
      { 'blog/index.md': doc('title: Writing', 'Soon.\n') },
      { config: renamed },
    );
    expect(texts(await empty.page('/blog/'), '.empty')).toEqual(['No pieces yet.']);
  });

  it('hands the labels to the search dialog', async () => {
    const { files } = await site.manifest();
    expect(files).toContain(SEARCH_INDEX_FILE);
    const file: unknown = JSON.parse(await site.read(SEARCH_INDEX_FILE));
    expect(isRecord(file) && file.sections).toEqual({ blog: 'Scribings', projects: 'Projects' });
  });
});
