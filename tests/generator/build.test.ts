// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { main } from '../../src/generator/cli.ts';
import { assertReplaceable, checkOutDir, resetOutDir } from '../../src/generator/out-dir.ts';
import { SEARCH_INDEX_FILE } from '../../src/generator/search.ts';
import { contentSecurityPolicy } from '../../src/lib/http-policy.ts';
import { BUILD, DATA, DOCS, ROOT, SITE_DEFAULT, SITE_SAMPLE, SRC } from '../../src/lib/paths.ts';
import type { BuildOptions, BuildResult } from '../../src/types.ts';
import { $, $$, doc, dom, parseHtml, siteConfig, TMP, texts, trackedTrees } from '../helpers.ts';

const config = siteConfig({
  home: [
    { kind: 'latest', section: 'blog', count: 2 },
    { kind: 'featured', section: 'projects', count: 3 },
  ],
});
const now = new Date('2027-06-01T00:00:00Z');

const post = (title: string, published: string, categories: string, tags: string, extra = '') =>
  doc(
    `title: "${title}"\npublished: ${published}\ncategories: [${categories}]\ntags: [${tags}]\n${extra}`,
    `Body of ${title}.\n`,
  );

const files: Record<string, string> = {
  'index.md': doc('title: Welcome\npublished: 2025-03-01\nsummary: Hi'),
  'resume/index.md': doc('title: Resume\npublished: 2026-01-01'),
  'blog/one/index.md': post('One', '2026-01-01', 'Linux', 'kernel'),
  'blog/one/diagram.png': 'PNG',
  'blog/two/index.md': post(
    'Two',
    '2026-02-01',
    'linux, Embedded',
    'kernel, C++',
    'updates:\n  - { date: 2026-05-05, note: "Fixed" }',
  ),
  'blog/three/index.md': post('Three', '2026-03-01', 'Embedded', 'rt'),
  'blog/wip/index.md': post('Wip', '2026-04-01', 'Secret', 'secrettag', 'draft: true'),
  'projects/tool/index.md': doc('title: Tool\npublished: 2026-02-02\ntags: [kernel, tooling]'),
  '_templates/post.md': 'ignored',
};

/** Hand-kept site data outside the content tree. */
const dataFiles: Record<string, string> = {
  'attributions.yaml':
    '- { name: Font, author: F, url: "https://f.dev", license: OFL-1.1, licenseFile: OFL.txt }',
  'licenses/OFL.txt': 'OFL',
  'license-overrides.yaml': 'khroma: MIT\nnot-shipped: MIT\n',
};

const { tree, outFor } = trackedTrees();

/** Fresh content and data trees plus the output directory, built with the shared config. */
async function buildTree(
  content: Record<string, string>,
  options: BuildOptions = {},
  data: Record<string, string> = {},
) {
  const siteDir = await tree(content);
  const dataDir = await tree(data);
  const outDir = outFor(siteDir);
  return {
    out: outDir,
    run: () => build({ siteDir, dataDir, outDir, config, now, ...options }),
  };
}

/** Files whose names do not depend on the installed dependency tree. */
const isFixedFile = (file: string) =>
  !file.startsWith('assets/chunks/') && !file.startsWith('attributions/licenses/');

/** File name with the content hash and package versions masked. */
const stable = (file: string) =>
  file.replace(/-[A-Z0-9]{8}\.(js|css|woff2)$/, '-HASH.$1').replace(/@\d+\.\d+\.\d+/, '@V');

const FONT_FILES = [
  'assets/fonts/0xProto-Bold-HASH.woff2',
  'assets/fonts/0xProto-Italic-HASH.woff2',
  'assets/fonts/0xProto-Regular-HASH.woff2',
  'assets/fonts/ibm-plex-sans-latin-ext-wght-italic-HASH.woff2',
  'assets/fonts/ibm-plex-sans-latin-ext-wght-normal-HASH.woff2',
  'assets/fonts/ibm-plex-sans-latin-wght-italic-HASH.woff2',
  'assets/fonts/ibm-plex-sans-latin-wght-normal-HASH.woff2',
  'assets/fonts/literata-latin-ext-opsz-italic-HASH.woff2',
  'assets/fonts/literata-latin-ext-opsz-normal-HASH.woff2',
  'assets/fonts/literata-latin-opsz-italic-HASH.woff2',
  'assets/fonts/literata-latin-opsz-normal-HASH.woff2',
];

/** Every HTML page: content pages and the not-found page, not the post fragments. */
const pagesOf = (listed: readonly string[]) =>
  listed.filter((f) => f.endsWith('index.html') || f === '404.html');

const read = (dir: string, rel: string) => fs.readFile(path.join(dir, rel), 'utf8');

/** The search index file, asserted to be among `listed`. */
function searchFile(listed: readonly string[]): string {
  expect(listed.filter((f) => f.startsWith('search-index'))).toEqual([SEARCH_INDEX_FILE]);
  return SEARCH_INDEX_FILE;
}
const parse = parseHtml;

async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    out.push(...(e.isDirectory() ? await listFiles(dir, r) : [r]));
  }
  return out;
}

describe('build (end-to-end)', () => {
  let out = '';
  let result: BuildResult = { files: [], warnings: [] };

  beforeAll(async () => {
    const b = await buildTree(files, {}, dataFiles);
    out = b.out;
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, '.generated'), '');
    await fs.writeFile(path.join(out, 'stale.html'), 'old');
    result = await b.run();
  });

  it('writes exactly the manifest files (plus manifest.json) and wipes stale output', async () => {
    const manifest = JSON.parse(await read(out, 'manifest.json'));
    expect(manifest.files).toEqual(result.files);
    expect((await listFiles(out)).sort()).toEqual(
      [...manifest.files, 'manifest.json', '.generated'].sort(),
    );
    expect(manifest.files).not.toContain('.generated');
    expect(manifest.files).not.toContain('stale.html');
    expect(manifest.generated).toBe('2027-06-01T00:00:00.000Z');
    expect(manifest.files.filter(isFixedFile).map(stable)).toEqual([
      '404.html',
      ...FONT_FILES,
      'assets/main-HASH.js',
      'assets/site-HASH.css',
      'attributions/index.html',
      'blog/category/embedded/index.html',
      'blog/category/linux/index.html',
      'blog/index.html',
      'blog/one/diagram.png',
      'blog/one/fragment.html',
      'blog/one/index.html',
      'blog/tag/cpp/index.html',
      'blog/tag/kernel/index.html',
      'blog/tag/rt/index.html',
      'blog/three/fragment.html',
      'blog/three/index.html',
      'blog/two/fragment.html',
      'blog/two/index.html',
      'index.html',
      'projects/index.html',
      'projects/tag/kernel/index.html',
      'projects/tag/tooling/index.html',
      'projects/tool/index.html',
      'resume/index.html',
      'robots.txt',
      'search-index.json',
      'sitemap.xml',
    ]);
  });

  it('reports spelling-variant warnings, naming the section', () => {
    expect(result.warnings.filter((w) => !w.startsWith('attributions:'))).toEqual([
      'blog: categories: "Linux" is also spelled "linux"',
    ]);
  });

  it('leaves drafts out of everything', async () => {
    const all = (
      await Promise.all(result.files.filter((f) => !f.endsWith('.png')).map((f) => read(out, f)))
    ).join('\n');
    expect(all).not.toMatch(/Wip|Secret|secrettag/);
  });

  it('copies assets and writes a fragment, but no Markdown source, per post', async () => {
    expect(await read(out, 'blog/one/diagram.png')).toBe('PNG');
    expect(await read(out, 'blog/one/fragment.html')).toBe(
      '<div class="md-content"><p>Body of One.</p>\n</div>\n',
    );
    expect(result.files.filter((f) => f.endsWith('.md'))).toEqual([]);
    expect(await read(out, 'attributions/licenses/Font.txt')).toBe('OFL');
  });

  it('renders no page with an unrendered Markdown source', async () => {
    for (const f of result.files.filter((x) => x.endsWith('index.html'))) {
      const d = parse(await read(out, f));
      expect(
        d.querySelector('pre.md-source, [data-format], [data-base], [data-doc]'),
        f,
      ).toBeNull();
    }
  });

  it('makes the fragment of a post equal to its page content plus footer', async () => {
    const page = parse(await read(out, 'blog/two/index.html'));
    const fragment = dom(await read(out, 'blog/two/fragment.html'));
    expect($(fragment, '.md-content').innerHTML).toBe($(page, '.md-content').innerHTML);
    expect($(fragment, '.article-updates li').textContent).toBe('2026-05-05 — Fixed');
    expect(fragment.querySelector('header, h1')).toBeNull();
  });

  it('lists every data-fragment URL of a listing in the manifest', async () => {
    const manifest = JSON.parse(await read(out, 'manifest.json'));
    for (const f of result.files.filter((x) => x.startsWith('blog/') && x.endsWith('index.html'))) {
      for (const li of $$(parse(await read(out, f)), 'li[data-fragment]')) {
        expect(manifest.files, f).toContain(li.dataset.fragment?.slice(1));
      }
    }
  });

  it('renders article pages with menu, embedded source and footers', async () => {
    const d = parse(await read(out, 'blog/two/index.html'));
    expect(d.title).toBe('Two · Site');
    expect($(d, 'meta[property="og:type"]').getAttribute('content')).toBe('article');
    expect($(d, 'main .md-content').textContent).toBe('Body of Two.\n');
    expect($(d, '.article-updates li').textContent).toBe('2026-05-05 — Fixed');
    expect($$(d, '.article-categories a').map((a) => a.textContent)).toEqual(['Linux', 'Embedded']);
    expect($(d, 'details[open] > summary').textContent).toBe('Blog');
    expect($(d, '.site-footer').textContent).toContain('© 2025–2027 Holder. All rights reserved.');
  });

  it('renders the home page with the site title only', async () => {
    const d = parse(await read(out, 'index.html'));
    expect(d.title).toBe('Site');
    expect($(d, '[aria-current="page"]').textContent).toBe('Home');
  });

  it('renders stream listings newest first, filtered per term', async () => {
    const blog = parse(await read(out, 'blog/index.html'));
    expect($$(blog, 'article h2').map((h) => h.textContent)).toEqual(['Three', 'Two']);
    expect($$(blog, '.stream-rest > li').map((li) => li.dataset.fragment)).toEqual([
      '/blog/one/fragment.html',
    ]);
    const linux = parse(await read(out, 'blog/category/linux/index.html'));
    expect(linux.title).toBe('Category: Linux · Site');
    expect($$(linux, 'article h2').map((h) => h.textContent)).toEqual(['Two', 'One']);
    const kernel = parse(await read(out, 'blog/tag/kernel/index.html'));
    expect($$(kernel, 'article h2').map((h) => h.textContent)).toEqual(['Two', 'One']);
  });

  it('does not create tag pages for project-only tags', () => {
    expect(result.files).not.toContain('blog/tag/tooling/index.html');
  });

  it('links Attributions from every page footer', async () => {
    for (const f of result.files.filter((x) => x.endsWith('index.html'))) {
      const d = parse(await read(out, f));
      expect(d.querySelector('.site-footer a[href="/attributions/"]'), f).not.toBeNull();
    }
  });

  it('lists what ships, extras included, apart from what builds the site', async () => {
    const d = parse(await read(out, 'attributions/index.html'));
    expect($$(d, 'h2').map((h) => h.textContent)).toEqual(['Distributed', 'Built with']);
    const [shipped, built] = $$(d, 'ul.attribution-list').map((ul) => texts(ul, 'li > strong'));
    expect(shipped).toEqual(expect.arrayContaining(['Font', 'mermaid', 'minisearch']));
    expect(shipped).not.toContain('markdown-it');
    expect(built).toEqual(
      expect.arrayContaining([
        'markdown-it',
        'markdown-it-footnote',
        'linkify-it',
        'shiki',
        '@shikijs/core',
        '@shikijs/engine-javascript',
        '@shikijs/langs',
        'htmlparser2',
        'yaml',
        'esbuild',
      ]),
    );
    expect(built).not.toContain('Font');
    expect(built).not.toContain('minisearch');
    for (const pkg of ['~40shikijs~2Fcore', 'mermaid', 'markdown-it', 'esbuild']) {
      const licence = new RegExp(`^attributions/licenses/${pkg}@[\\d.]+\\.txt$`);
      expect(
        result.files.some((f) => licence.test(f)),
        pkg,
      ).toBe(true);
    }
  });

  it('applies licence overrides to bundled packages and warns about unused ones', async () => {
    const d = parse(await read(out, 'attributions/index.html'));
    const khroma = $$(d, '.attribution-list li').find((li) => li.textContent?.includes('khroma'));
    expect(khroma?.textContent).toContain('Licence: MIT');
    expect(result.warnings.filter((w) => w.startsWith('attributions:'))).toEqual([
      'attributions: licence override for "not-shipped" unused',
    ]);
  });

  it('reads the data directory independently of the site directory', async () => {
    const siteDir = await tree({});
    const outDir = outFor(siteDir);
    const { warnings } = await build({ siteDir, outDir, config, now });
    expect(warnings.filter((w) => w.startsWith('attributions:'))).toEqual([]);
    const d = parse(await read(outDir, 'attributions/index.html'));
    const khroma = $$(d, '.attribution-list li').find((li) => li.textContent?.includes('khroma'));
    expect(khroma?.textContent).toContain('Licence: MIT');
  });

  it('ignores data files inside the content tree', async () => {
    const { out, run } = await buildTree({ '_data/attributions.yaml': '- { name: Ghost }' });
    await run();
    expect(await read(out, 'attributions/index.html')).not.toContain('Ghost');
  });

  it('ships diagram chunks beside the entry, but no grammar or Markdown code', async () => {
    const chunks = result.files.filter((f) => f.startsWith('assets/chunks/'));
    expect(chunks.length).toBeGreaterThan(20);
    const scripts = await Promise.all(
      result.files.filter((f) => f.endsWith('.js')).map((f) => read(out, f)),
    );
    expect(scripts.filter((js) => /textmate|markdown-it|shiki/i.test(js))).toEqual([]);
  });

  it('declares cross-document view transitions, off for reduced motion', async () => {
    const css = await read(out, result.files.find((f) => f.endsWith('.css')) ?? '');
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*@view-transition\s*\{\s*navigation:\s*auto/,
    );
    expect(css).toMatch(/view-transition-name:\s*sidebar/);
    expect(css).toMatch(/view-transition-name:\s*topbar/);
  });

  it('references the hashed bundle from every page, and ships it', async () => {
    const js = result.files.find((f) => /^assets\/main-[A-Z0-9]{8}\.js$/.test(f));
    const css = result.files.find((f) => /^assets\/site-[A-Z0-9]{8}\.css$/.test(f));
    expect(js).toBeDefined();
    expect(css).toBeDefined();
    for (const f of result.files.filter((x) => x.endsWith('index.html'))) {
      const d = parse(await read(out, f));
      expect($(d, 'script[type="module"]').getAttribute('src'), f).toBe(`/${js}`);
      expect($(d, 'link[rel="stylesheet"]').getAttribute('href'), f).toBe(`/${css}`);
    }
    expect((await read(out, js ?? '')).length).toBeGreaterThan(1_000);
  });

  it('puts the head script before the stylesheet, then the skip link, sidebar and toggle', async () => {
    for (const f of result.files.filter((x) => x.endsWith('index.html'))) {
      const text = await read(out, f);
      const d = parse(text);
      const inline = $$(d, 'head script:not([src]):not([type])');
      expect(inline, f).toHaveLength(1);
      expect(inline[0]?.textContent, f).toContain('site-theme');
      expect(d.querySelectorAll('head script[type="speculationrules"]'), f).toHaveLength(1);
      expect(text.indexOf('<script>'), f).toBeLessThan(text.indexOf('rel="stylesheet"'));
      expect($(d, 'body').firstElementChild?.getAttribute('href'), f).toBe('#main');
      expect($(d, 'a.skip-link').textContent, f).toBe('Skip to content');
      expect($(d, 'main').id, f).toBe('main');
      expect($(d, '.topbar .theme-toggle').getAttribute('aria-label'), f).toBe('Switch theme');
      expect(d.querySelector('#sidebar .theme-toggle, #sidebar .search-trigger'), f).toBeNull();
      expect($(d, '#sidebar-body .site-menu'), f).toBeTruthy();
      expect($(d, '.menu-button').getAttribute('aria-controls'), f).toBe('sidebar');
      expect(
        $$(d, '.topbar-start > *').map((c) => c.className),
        f,
      ).toEqual(['menu-button', 'site-title']);
      expect($$(d, 'a.site-title'), f).toHaveLength(1);
    }
  });

  it('records the CSP hashes of the inline scripts, which match every page', async () => {
    const manifest = JSON.parse(await read(out, 'manifest.json'));
    expect(manifest.csp.scriptHashes).toHaveLength(2);
    const [headHash, rulesHash] = manifest.csp.scriptHashes;
    for (const hash of manifest.csp.scriptHashes) {
      expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    }
    const sha = (text: string | null) =>
      `sha256-${createHash('sha256')
        .update(text ?? '')
        .digest('base64')}`;
    const pages = pagesOf(result.files);
    expect(pages).toContain('404.html');
    const inlineHashes = new Set<string>();
    for (const f of pages) {
      const d = parse(await read(out, f));
      for (const el of $$(d, 'script:not([src])')) {
        inlineHashes.add(sha(el.textContent));
      }
      expect(sha($(d, 'head script:not([src]):not([type])').textContent), f).toBe(headHash);
      expect(sha($(d, 'script[type="speculationrules"]').textContent), f).toBe(rulesHash);
    }
    expect([...inlineHashes].sort()).toEqual([...manifest.csp.scriptHashes].sort());
  });

  it('lets the policy a host sends allow exactly those inline scripts', async () => {
    const manifest = JSON.parse(await read(out, 'manifest.json'));
    const policy = contentSecurityPolicy(manifest.csp);
    const scriptSrc = policy.split('; ').find((d) => d.startsWith('script-src ')) ?? '';
    for (const hash of manifest.csp.scriptHashes) {
      expect(scriptSrc).toContain(`'${hash}'`);
    }
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('records no style hashes, yet keeps the print title style on every page', async () => {
    const manifest = JSON.parse(await read(out, 'manifest.json'));
    expect(manifest.csp).toEqual({ scriptHashes: [expect.any(String), expect.any(String)] });
    for (const f of pagesOf(result.files)) {
      const style = $(parse(await read(out, f)), 'head style').textContent ?? '';
      expect(style, f).toMatch(/^@page \{ @top-left \{ content: ".*"; \} \}$/);
    }
  });

  it('names the article in the top bar and in reader metadata on article pages only', async () => {
    const titled = async (rel: string) => {
      const d = parse(await read(out, rel));
      return {
        bar: d.querySelector('.topbar > .topbar-title')?.textContent ?? null,
        author: d.querySelector('meta[name="author"]')?.getAttribute('content') ?? null,
        published:
          d.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ??
          null,
        single: d.querySelectorAll('main .article-single').length,
      };
    };
    expect(await titled('blog/one/index.html')).toEqual({
      bar: 'One',
      author: 'Holder',
      published: '2026-01-01',
      single: 1,
    });
    expect(await titled('projects/tool/index.html')).toMatchObject({ bar: 'Tool', single: 1 });
    for (const listing of [
      'index.html',
      'blog/index.html',
      'projects/index.html',
      'blog/category/linux/index.html',
      '404.html',
    ]) {
      expect(await titled(listing), listing).toEqual({
        bar: null,
        author: null,
        published: null,
        single: 0,
      });
    }
  });

  it('puts the contents list of an article beside its content, and of no listing', async () => {
    const withToc = '## A\n\n### A1\n\n## B\n\nText.\n';
    const { out: toced, run } = await buildTree({
      'blog/long/index.md': doc('title: Long\npublished: 2026-01-01', withToc),
      'blog/short/index.md': doc('title: Short\npublished: 2026-01-02', 'Text.\n'),
    });
    await run();
    const long = parse(await read(toced, 'blog/long/index.html'));
    expect(
      $$(long, 'main > .column > .article-single > *').map((el) => el.getAttribute('class')),
    ).toEqual(['article-header', 'toc', 'md-content']);
    expect(long.querySelector('.md-content .toc')).toBeNull();
    const short = parse(await read(toced, 'blog/short/index.html'));
    expect(short.querySelector('.toc')).toBeNull();
    const listing = parse(await read(toced, 'blog/index.html'));
    expect(listing.querySelector('.article-single')).toBeNull();
    expect(listing.querySelector('.column > .toc')).toBeNull();
  });

  it.each([
    ['home', 'index.html'],
    ['blog stream', 'blog/index.html'],
    ['category', 'blog/category/linux/index.html'],
    ['tag', 'blog/tag/kernel/index.html'],
    ['article', 'blog/one/index.html'],
    ['projects listing', 'projects/index.html'],
    ['project', 'projects/tool/index.html'],
    ['resume', 'resume/index.html'],
    ['attributions', 'attributions/index.html'],
    ['not found', '404.html'],
  ])('gives the %s page one h1, and it is the page title', async (_kind, file) => {
    const d = parse(await read(out, file));
    expect($$(d, 'main h1').map((h) => h.className)).toEqual(['page-title']);
  });

  it('stays free of the controls that moved to the top bar, on every page', async () => {
    for (const f of pagesOf(result.files)) {
      const d = parse(await read(out, f));
      expect(
        $$(d, '.topbar-tools button').map((b) => b.className),
        f,
      ).toEqual(['search-trigger', 'text-smaller', 'text-larger', 'theme-toggle', 'print-button']);
      expect(d.querySelector('.sidebar button'), f).toBeNull();
    }
  });

  it('emits a noindex not-found page with the site layout and root-relative links only', async () => {
    const d = parse(await read(out, '404.html'));
    expect($(d, 'meta[name="robots"]').getAttribute('content')).toBe('noindex');
    expect($(d, 'main h1').textContent).toBe('Page not found');
    expect($(d, 'main a').getAttribute('href')).toBe('/');
    expect($(d, '#sidebar-body .site-menu')).toBeTruthy();
    expect($(d, '.search-trigger').getAttribute('data-index')).toBe(`/${searchFile(result.files)}`);
    expect($(d, 'title').textContent).toBe('Page not found · Site');
    const references = $$(d, '[href]:not([rel="canonical"]), [src]').map(
      (el) => el.getAttribute('href') ?? el.getAttribute('src'),
    );
    expect(references.length).toBeGreaterThan(5);
    for (const ref of references) {
      expect(ref, `${ref}`).toMatch(/^\/(?!\/)|^#/);
    }
  });

  it('keeps the not-found page out of the sitemap, the search index and the page list', async () => {
    expect(await read(out, 'sitemap.xml')).not.toContain('404');
    expect(await read(out, searchFile(result.files))).not.toContain('Page not found');
    const manifest = JSON.parse(await read(out, 'manifest.json'));
    expect(manifest.pages.map((p: { url: string }) => p.url)).not.toContain('/404.html');
  });

  it('preloads the Literata and IBM Plex Sans Latin fonts from every page, as the bundle names them', async () => {
    const fonts = ['literata-latin-opsz-normal', 'ibm-plex-sans-latin-wght-normal'].map((name) =>
      result.files.find((f) => f.startsWith(`assets/fonts/${name}-`)),
    );
    expect(fonts.every((f) => f !== undefined)).toBe(true);
    for (const f of result.files.filter((x) => x.endsWith('index.html'))) {
      const links = $$(parse(await read(out, f)), 'link[rel="preload"]');
      expect(
        links.map((l) => l.getAttribute('href')),
        f,
      ).toEqual(fonts.map((font) => `/${font}`));
      for (const link of links) {
        expect(link.getAttribute('as'), f).toBe('font');
        expect(link.hasAttribute('crossorigin'), f).toBe(true);
      }
    }
  });

  it('keeps dev-only tools and duplicates out of the attributions', async () => {
    const d = parse(await read(out, 'attributions/index.html'));
    const names = texts(d, '.attribution-list strong').map((n) => n ?? '');
    for (const tool of ['vitest', '@biomejs/biome', 'typescript', 'happy-dom', 'tsx']) {
      expect(names).not.toContain(tool);
    }
    const [shipped = [], built = []] = $$(d, 'ul.attribution-list').map((ul) =>
      texts(ul, 'li > strong'),
    );
    expect(built.filter((name) => shipped.includes(name))).toEqual([]);
  });

  it('writes a sitemap without drafts or taxonomy pages', async () => {
    const xml = await read(out, 'sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
      (m[1] ?? '').replace('https://example.com', ''),
    );
    expect(locs).toEqual([
      '/',
      '/blog/',
      '/blog/one/',
      '/blog/three/',
      '/blog/two/',
      '/projects/',
      '/projects/tool/',
      '/resume/',
    ]);
    expect(xml).toContain('<loc>https://example.com/blog/</loc><lastmod>2026-05-05</lastmod>');
    expect(xml).toContain('<loc>https://example.com/blog/two/</loc><lastmod>2026-05-05</lastmod>');
    expect(xml).toContain('<loc>https://example.com/projects/</loc><lastmod>2026-02-02</lastmod>');
  });

  it('writes robots.txt: crawl everything but the fragments, and point to the sitemap', async () => {
    expect(await read(out, 'robots.txt')).toBe(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /blog/*/fragment.html',
        '',
        'Sitemap: https://example.com/sitemap.xml',
        '',
      ].join('\n'),
    );
    expect(JSON.parse(await read(out, 'manifest.json')).files).toContain('robots.txt');
  });

  it('writes a versioned search file with its filter terms, under its fixed name', async () => {
    const name = searchFile(result.files);
    const file = JSON.parse(await read(out, name));
    expect(Object.keys(file)).toEqual(['version', 'index', 'facets', 'sections']);
    expect(file.version).toBe(3);
    expect(file.sections).toEqual({ blog: 'Blog', projects: 'Projects' });
    expect(file.index.documentCount).toBe(5);
    expect(file.facets).toEqual({
      categories: [
        { slug: 'embedded', label: 'Embedded' },
        { slug: 'linux', label: 'Linux' },
      ],
      tags: [
        { slug: 'cpp', label: 'C++' },
        { slug: 'kernel', label: 'kernel' },
        { slug: 'rt', label: 'rt' },
        { slug: 'tooling', label: 'tooling' },
      ],
    });
  });

  it('points the search button of every page at that file', async () => {
    const name = `/${searchFile(result.files)}`;
    const pages = result.files.filter((f) => f.endsWith('index.html'));
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      const d = parse(await read(out, page));
      expect(d.querySelector('.search-trigger')?.getAttribute('data-index'), page).toBe(name);
    }
  });
});

describe('build with drafts', () => {
  it('includes drafts, marked and noindexed, but keeps them out of the sitemap', async () => {
    const { out, run } = await buildTree(files, { drafts: true });
    const { files: written } = await run();
    expect(written).toContain('blog/wip/index.html');
    expect(written).toContain('blog/category/secret/index.html');
    const d = parse(await read(out, 'blog/wip/index.html'));
    expect(d.querySelector('.draft-banner')).not.toBeNull();
    expect($(d, 'meta[name="robots"]').getAttribute('content')).toBe('noindex');
    expect(await read(out, 'sitemap.xml')).not.toContain('/blog/wip/');
    expect(JSON.parse(await read(out, 'manifest.json')).drafts).toBe(true);
    expect($(d, '.site-footer').textContent).toContain('© 2025–2027 Holder.');
  });
});

describe('build edge cases', () => {
  it('builds an empty content tree', async () => {
    const { out, run } = await buildTree({});
    const { files: written } = await run();
    expect(written.filter(isFixedFile).map(stable)).toEqual([
      '404.html',
      ...FONT_FILES,
      'assets/main-HASH.js',
      'assets/site-HASH.css',
      'attributions/index.html',
      'robots.txt',
      'search-index.json',
      'sitemap.xml',
    ]);
    const d = parse(await read(out, 'attributions/index.html'));
    expect($(d, '.site-footer').textContent).toContain('© 2027 Holder.');
  });

  it('warns about unhighlighted and malformed code fences in any item', async () => {
    const { run } = await buildTree({
      'index.md': doc('title: Home\npublished: 2026-01-01', '```pcap\nx\n```\n'),
      'blog/p/index.md': doc(
        'title: P\npublished: 2026-01-01\ntoc: false',
        '```c {9-1}\nx\n```\n\n```mermaid\ng\n```\n\n```\nplain\n```\n',
      ),
      'projects/t/index.md': doc('title: T\npublished: 2026-01-01\ntoc: maybe', '## a\n'),
    });
    const { warnings } = await run();
    expect(warnings.filter((w) => !w.startsWith('attributions:')).sort()).toEqual([
      'blog/p/index.md: code block "c {9-1}": invalid line range "9-1"',
      'index.md: code block language "pcap" is not highlighted',
      'projects/t/index.md: toc: unrecognised value "maybe"; ignored',
    ]);
  });

  it('renders headings with ids, tables of contents where wanted, and highlighted code', async () => {
    const headings = '## A\n\n### A1\n\n## B\n\n';
    const { out, run } = await buildTree({
      'blog/auto/index.md': doc('title: Auto\npublished: 2026-01-01', `${headings}\n`),
      'blog/off/index.md': doc('title: Off\npublished: 2026-01-01\ntoc: false', headings),
      'blog/few/index.md': doc('title: Few\npublished: 2026-01-01', '## Only\n'),
      'blog/forced/index.md': doc('title: Forced\npublished: 2026-01-01\ntoc: true', '## Only\n'),
      'blog/code/index.md': doc('title: Code\npublished: 2026-01-01', '```c {1}\nint x;\n```\n'),
    });
    await run();
    const toc = async (slug: string) =>
      parse(await read(out, `blog/${slug}/index.html`)).querySelector('.article-single > nav.toc');
    expect(await toc('auto')).not.toBeNull();
    expect(await toc('off')).toBeNull();
    expect(await toc('few')).toBeNull();
    expect(await toc('forced')).not.toBeNull();
    const auto = parse(await read(out, 'blog/auto/index.html'));
    expect($$(auto, '.md-content h2').map((h) => h.id)).toEqual(['auto--a', 'auto--b']);
    expect($$(auto, '.toc a').map((a) => a.getAttribute('href'))).toEqual([
      '#auto--a',
      '#auto--a1',
      '#auto--b',
    ]);
    const code = parse(await read(out, 'blog/code/index.html'));
    expect($(code, 'figure.code-block > pre.shiki').getAttribute('style')).toContain(
      '--shiki-dark',
    );
    expect($(code, 'figure.code-block .line.highlighted').textContent).toBe('int x;');
  });

  it('keeps tables of contents unique on a listing page', async () => {
    const body = '## A\n\n## B\n\n## C\n';
    const { out, run } = await buildTree({
      'blog/one/index.md': doc('title: One\npublished: 2026-01-01', body),
      'blog/two/index.md': doc('title: Two\npublished: 2026-01-02', body),
    });
    await run();
    const d = parse(await read(out, 'blog/index.html'));
    const labels = $$(d, 'nav.toc').map((n) => n.getAttribute('aria-labelledby'));
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(texts(d, 'nav.toc summary')).toEqual(['Contents: Two', 'Contents: One']);
    const ids = $$(d, '[id]').map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('parses each article once and shares the result between page, listings, fragment and search', async () => {
    const parse = vi.spyOn(MarkdownIt.prototype, 'parse');
    try {
      const { out, run } = await buildTree({
        'blog/one/index.md': doc(
          'title: One\npublished: 2026-01-01\ncategories: [c]',
          'UNIQUEWORD',
        ),
        'blog/two/index.md': doc('title: Two\npublished: 2026-01-02\ncategories: [c]', 'two'),
        'resume/index.md': doc('title: R\npublished: 2026-01-01', 'r'),
      });
      await run();
      expect(parse).toHaveBeenCalledTimes(3);
      expect(await read(out, searchFile(await listFiles(out)))).toContain('uniqueword');
    } finally {
      parse.mockRestore();
    }
  });

  it('indexes search text from code-free prose only', async () => {
    const { out, run } = await buildTree({
      'blog/p/index.md': doc(
        'title: P\npublished: 2026-01-01',
        '> [!NOTE]\n> findable\n\n```c\nhidden_code\n```\n',
      ),
    });
    await run();
    const index = await read(out, searchFile(await listFiles(out)));
    expect(index).toContain('findable');
    expect(index).not.toContain('hidden_code');
    expect(index).not.toContain('[!NOTE]');
  });

  it.each([
    ['blog/x/index.md', 'blog/x/index.html'],
    ['index.md', 'index.html'],
    ['blog/index.md', 'blog/index.html'],
  ])('refuses index.html beside %s before it can collide with a page', async (md, html) => {
    const { run } = await buildTree({
      [md]: doc('title: X\npublished: 2026-01-01'),
      [html]: '<h1>hand-written</h1>',
    });
    await expect(run()).rejects.toThrow(
      `${html}: only allowed as the sole index of a top-level page`,
    );
  });

  it('escapes hostile text everywhere it is rendered', async () => {
    const evil = `<script>alert("x")</script>'&`;
    const { out, run } = await buildTree({
      'index.md': doc(
        `title: ${JSON.stringify(evil)}\npublished: 2026-01-01\nsummary: ${JSON.stringify(evil)}`,
      ),
      'blog/p/index.md': doc(
        `title: ${JSON.stringify(evil)}\npublished: 2026-01-01\ncategories: [${JSON.stringify(`${evil}cat`)}]\ntags: [${JSON.stringify(`${evil}tag`)}]\ncopyright: ${JSON.stringify(evil)}\nupdates:\n  - { date: 2026-02-02, note: ${JSON.stringify(evil)} }`,
        `\`${evil}\`\n`,
      ),
      'projects/t/index.md': doc(`title: ${JSON.stringify(evil)}\npublished: 2026-01-01`),
    });
    const { files: written } = await run();
    for (const f of written.filter((x) => x.endsWith('index.html'))) {
      const text = await read(out, f);
      expect(text, f).not.toContain('<script>alert');
      const d = parse(text);
      expect($$(d, 'script:not([src]):not([type])'), f).toHaveLength(1);
    }
    const post = parse(await read(out, 'blog/p/index.html'));
    expect(post.title).toBe(`${evil} · Site`);
    expect($(post, 'meta[property="og:title"]').getAttribute('content')).toBe(evil);
    expect($(post, 'main .md-content code').textContent).toBe(evil);
    expect($(post, '.article-copyright').textContent).toBe(evil);
    expect($(post, '.article-updates li').textContent).toBe(`2026-02-02 — ${evil}`);
    expect($$(post, '.site-menu a').map((a) => a.textContent)).toContain(`${evil}cat (1)`);
    const home = parse(await read(out, 'index.html'));
    expect($(home, 'meta[name="description"]').getAttribute('content')).toBe(evil);
  });
});

describe('checkOutDir', () => {
  it('accepts a dedicated directory inside the project', () => {
    expect(checkOutDir(BUILD, SITE_DEFAULT)).toBe(BUILD);
    expect(checkOutDir(path.join(TMP, 'x'), SITE_DEFAULT)).toBe(path.join(TMP, 'x'));
  });

  it.each([
    ['outside the project', '/tmp/somewhere'],
    ['the project root', ROOT],
    ['the source tree', SRC],
    ['inside the source tree', path.join(SRC, 'out')],
    ['the default site directory', SITE_DEFAULT],
    ['the sample site', SITE_SAMPLE],
    ['inside the sample site', path.join(SITE_SAMPLE, 'out')],
    ['the documentation', DOCS],
    ['the data tree', DATA],
    ['inside the data tree', path.join(DATA, 'out')],
    ['node_modules', path.join(ROOT, 'node_modules')],
    ['the tests tree', path.join(ROOT, 'tests')],
    ['the git directory', path.join(ROOT, '.git')],
    ['inside the git directory', path.join(ROOT, '.git', 'objects')],
  ])('refuses %s', (_desc, dir) => {
    expect(() => checkOutDir(dir, SITE_DEFAULT)).toThrow(RangeError);
  });

  it('refuses the data directory in use, wherever it is', () => {
    expect(() => checkOutDir(path.join(TMP, 'd'), SITE_DEFAULT, path.join(TMP, 'd'))).toThrow(
      RangeError,
    );
    expect(() =>
      checkOutDir(path.join(TMP, 'd', 'out'), SITE_DEFAULT, path.join(TMP, 'd')),
    ).toThrow(RangeError);
  });

  it('refuses a directory containing or inside one of the extra protected directories', () => {
    const extra = path.join(TMP, 'b');
    expect(() => checkOutDir(extra, SITE_DEFAULT, DATA, [extra])).toThrow(RangeError);
    expect(() => checkOutDir(path.join(extra, 'p'), SITE_DEFAULT, DATA, [extra])).toThrow(
      RangeError,
    );
    expect(() => checkOutDir(TMP, SITE_DEFAULT, DATA, [extra])).toThrow(RangeError);
    expect(checkOutDir(path.join(TMP, 'p'), SITE_DEFAULT, DATA, [extra])).toBe(path.join(TMP, 'p'));
  });

  it('refuses the site directory in use, wherever it is, and a directory containing it', () => {
    const site = path.join(TMP, 'a', 'my-site');
    expect(() => checkOutDir(site, site)).toThrow(RangeError);
    expect(() => checkOutDir(path.join(site, 'out'), site)).toThrow(RangeError);
    expect(() => checkOutDir(path.join(TMP, 'a'), site)).toThrow(RangeError);
  });

  it('refuses before touching anything', async () => {
    await expect(build({ outDir: '/tmp/x', siteDir: '/nonexistent' })).rejects.toThrow(RangeError);
  });
});

describe('cli main', () => {
  const sink = () => {
    const s = {
      text: '',
      write(t: string) {
        s.text += t;
      },
    };
    return s;
  };

  it('passes flags through and reports warnings and file count', async () => {
    const stdout = sink();
    const stderr = sink();
    let got: BuildOptions | undefined;
    const run = async (o: BuildOptions): Promise<BuildResult> => {
      got = o;
      return { files: ['a', 'b'], warnings: ['w1'] };
    };
    const code = await main(['--drafts', '--site', 'some/dir'], { stdout, stderr, run, env: {} });
    expect(code).toBe(0);
    expect(got).toEqual({
      drafts: true,
      siteDir: path.resolve('some/dir'),
      outDir: BUILD,
    });
    expect(stderr.text).toBe('warning: w1\n');
    expect(stdout.text).toBe('built 2 files into build/ (drafts included)\n');
  });

  it('uses defaults without flags', async () => {
    let got: BuildOptions | undefined;
    const stdout = sink();
    await main([], {
      stdout,
      stderr: sink(),
      env: {},
      run: async (o) => {
        got = o;
        return { files: [], warnings: [] };
      },
    });
    expect(got).toEqual({ drafts: false, siteDir: SITE_DEFAULT, outDir: BUILD });
    expect(stdout.text).toBe('built 0 files into build/\n');
  });

  it('takes site, output and drafts from the environment, and the flags win over it', async () => {
    const got: BuildOptions[] = [];
    const run = async (o: BuildOptions): Promise<BuildResult> => {
      got.push(o);
      return { files: [], warnings: [] };
    };
    const env = { SITE_DIR: 'env/site', OUT_DIR: '.tmp/env-out', DRAFTS: '1' };
    await main([], { stdout: sink(), stderr: sink(), run, env });
    await main(['--site', 'flag/site', '--out', '.tmp/flag-out'], {
      stdout: sink(),
      stderr: sink(),
      run,
      env,
    });
    expect(got).toEqual([
      { drafts: true, siteDir: path.resolve('env/site'), outDir: path.resolve('.tmp/env-out') },
      { drafts: true, siteDir: path.resolve('flag/site'), outDir: path.resolve('.tmp/flag-out') },
    ]);
  });

  it('returns 2 with usage on a bad DRAFTS', async () => {
    const stderr = sink();
    const run = async (): Promise<BuildResult> => ({ files: [], warnings: [] });
    expect(await main([], { stdout: sink(), stderr, run, env: { DRAFTS: 'maybe' } })).toBe(2);
    expect(stderr.text).toBe(
      'error: DRAFTS must be 1, true, 0 or false: maybe\nusage: build [--drafts] [--site <dir>] [--out <dir>]\n',
    );
  });

  it('returns 1 and prints the error when the build fails', async () => {
    const stderr = sink();
    const run = async () => {
      throw new Error('blog/x/index.md: unterminated front-matter');
    };
    expect(await main([], { stdout: sink(), stderr, run, env: {} })).toBe(1);
    expect(stderr.text).toBe('error: blog/x/index.md: unterminated front-matter\n');
  });

  it('returns 2 with usage when --site is empty', async () => {
    const stderr = sink();
    const run = async (): Promise<BuildResult> => ({ files: [], warnings: [] });
    expect(await main(['--site', ''], { stdout: sink(), stderr, run, env: {} })).toBe(2);
    expect(stderr.text).toBe(
      'error: --site needs a directory\nusage: build [--drafts] [--site <dir>] [--out <dir>]\n',
    );
  });

  it('returns 2 when --site has no value', async () => {
    const stderr = sink();
    const run = async (): Promise<BuildResult> => ({ files: [], warnings: [] });
    expect(await main(['--site'], { stdout: sink(), stderr, run, env: {} })).toBe(2);
  });

  it('returns 2 with usage on unknown flags', async () => {
    const stderr = sink();
    expect(
      await main(['--bogus'], {
        stdout: sink(),
        stderr,
        env: {},
        run: async () => ({ files: [], warnings: [] }),
      }),
    ).toBe(2);
    expect(stderr.text).toMatch(/^error: .*bogus.*\nusage: build/s);
  });
});

describe('output directory sentinel', () => {
  const { tree: dirTree } = trackedTrees();

  it('wipes an absent, an empty and a previously generated directory, then marks it', async () => {
    const parent = await dirTree();
    const absent = path.join(parent, 'absent');
    const empty = await dirTree();
    const generated = await dirTree({ '.generated': '', 'old/file.html': 'x' });
    for (const dir of [absent, empty, generated]) {
      await resetOutDir(dir);
      expect(await fs.readdir(dir), dir).toEqual(['.generated']);
    }
  });

  it.each([
    ['holding files', { 'a.txt': 'x' }],
    ['a coverage report', { 'lcov.info': 'x', 'index.html': '<html>' }],
    ['a nested tree', { 'sub/dir/file': 'x' }],
  ])('refuses a directory %s without the marker and leaves it alone', async (_name, files) => {
    const dir = await dirTree(files);
    const before = (await fs.readdir(dir, { recursive: true })).sort();
    await expect(resetOutDir(dir)).rejects.toThrow(/refusing to replace .*\.generated/);
    await expect(assertReplaceable(dir)).rejects.toThrow(RangeError);
    expect((await fs.readdir(dir, { recursive: true })).sort()).toEqual(before);
  });

  it('passes other file system errors through', async () => {
    const dir = await dirTree({ 'file.txt': 'x' });
    await expect(assertReplaceable(path.join(dir, 'file.txt', 'child'))).rejects.toThrow(/ENOTDIR/);
  });

  it('makes build refuse such a directory without touching it, and mark the ones it writes', async () => {
    const content = await dirTree({ 'index.md': doc('title: Home\npublished: 2026-01-01') });
    const dataDir = await dirTree();
    const foreign = await dirTree({ 'report.html': 'precious' });
    await expect(
      build({ siteDir: content, dataDir, outDir: foreign, config, now }),
    ).rejects.toThrow(/refusing to replace/);
    expect(await fs.readFile(path.join(foreign, 'report.html'), 'utf8')).toBe('precious');
    const fresh = path.join(await dirTree(), 'site');
    await build({ siteDir: content, dataDir, outDir: fresh, config, now });
    expect(await fs.readFile(path.join(fresh, '.generated'), 'utf8')).toBe('');
    await build({ siteDir: content, dataDir, outDir: fresh, config, now });
  });
});

describe('content that the CSP would block', () => {
  it('warns per source file, without failing the build', async () => {
    const b = await buildTree({
      'index.md': doc('title: Home\npublished: 2026-01-01', 'Clean.\n'),
      'blog/bad/index.md': doc(
        'title: Bad\npublished: 2026-01-01',
        '<script>alert(1)</script>\n\n<a href="javascript:x()">x</a> <b onclick="y()">z</b>\n\n<base href="/">\n',
      ),
    });
    const { warnings } = await b.run();
    const csp = warnings.filter((w) => w.includes('Content-Security-Policy'));
    expect(csp.every((w) => w.startsWith('blog/bad/index.md: '))).toBe(true);
    expect(csp.map((w) => w.replace('blog/bad/index.md: ', '')).sort()).toEqual([
      '<base> is not allowed by the Content-Security-Policy',
      'event-handler attribute onclick is blocked by the Content-Security-Policy',
      'inline <script> is blocked by the Content-Security-Policy',
      'javascript: URL is blocked by the Content-Security-Policy',
    ]);
  });

  it('is silent for ordinary content', async () => {
    const b = await buildTree({
      'index.md': doc('title: Home\npublished: 2026-01-01', 'Hi [x](/y/).\n'),
    });
    const { warnings } = await b.run();
    expect(warnings.filter((w) => w.includes('Content-Security-Policy'))).toEqual([]);
  });
});
