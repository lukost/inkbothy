// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildTaxonomy, termIndex } from '../../src/content/taxonomy.ts';
import { MAIN_SCRIPT_ATTRIBUTE } from '../../src/shared/ui-state.ts';
import {
  articleFooter,
  articleFragment,
  articleFull,
  articleHeader,
} from '../../src/templates/article.ts';
import { html } from '../../src/templates/html.ts';
import {
  copyrightLine,
  type LayoutOptions,
  pageStyle,
  renderLayout,
} from '../../src/templates/layout.ts';
import { renderStream } from '../../src/templates/stream.ts';
import type { Item } from '../../src/types.ts';
import { $, $$, dom, item, NOUN, noTerms, parseHtml } from '../helpers.ts';

const config = {
  baseUrl: 'https://example.com',
  title: 'Site & Co',
  copyright: { holder: 'Holder', rights: 'All rights reserved.' },
};

describe('articleHeader', () => {
  const post = item({
    url: '/blog/p/',
    title: 'A <b>title</b>',
    published: '2026-01-02',
    updated: '2026-03-04',
    categories: ['linux', 'Linux', 'Embedded'],
    tags: ['C++'],
  });
  const { terms } = buildTaxonomy(
    [
      post,
      item({ url: '/blog/q/', categories: ['Linux'] }),
      item({ url: '/blog/r/', categories: ['Linux'] }),
    ],
    'categories',
  );
  const lookup = { category: termIndex(terms), tag: () => undefined };

  it('renders title, dates and canonical, de-duplicated, linked terms', () => {
    const el = dom(articleHeader(post, lookup));
    expect($(el, 'h1').textContent).toBe('A <b>title</b>');
    expect($$(el, 'time').map((t) => t.getAttribute('datetime'))).toEqual([
      '2026-01-02',
      '2026-03-04',
    ]);
    const cats = $$(el, '.article-categories a');
    expect(cats.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Linux', '/blog/category/linux/'],
      ['Embedded', '/blog/category/embedded/'],
    ]);
    expect($(el, '.article-tags a').getAttribute('href')).toBe('/blog/tag/cpp/');
  });

  it('renders an h2 with a linked title for listings', () => {
    const el = dom(articleHeader(post, lookup, { level: 2, linkTitle: true }));
    expect(el.querySelector('h1')).toBeNull();
    expect($(el, 'h2 a').getAttribute('href')).toBe('/blog/p/');
  });

  it('omits dates and term lists when absent', () => {
    const el = dom(articleHeader(item({ published: null }), noTerms));
    expect(el.querySelector('.article-dates')).toBeNull();
    expect(el.querySelector('ul')).toBeNull();
  });

  it('links the terms of any section to the term pages of that section', () => {
    const p = item({ url: '/notes/t/', section: 'notes', tags: ['kernel'] });
    const el = dom(articleHeader(p, noTerms));
    expect($(el, '.article-tags a').getAttribute('href')).toBe('/notes/tag/kernel/');
  });

  it('shows no terms for a page, which has no section to link them to', () => {
    const page = item({ url: '/about/', section: null, tags: ['kernel'], categories: ['Linux'] });
    expect(dom(articleHeader(page, noTerms)).querySelector('ul')).toBeNull();
  });

  it('shows a draft banner for drafts only', () => {
    expect(
      dom(articleHeader(item({ draft: true }), noTerms)).querySelector('.draft-banner'),
    ).not.toBeNull();
    expect(dom(articleHeader(item(), noTerms)).querySelector('.draft-banner')).toBeNull();
  });
});

describe('articleFooter', () => {
  it('renders update history (one line per entry) and copyright', () => {
    const el = dom(
      articleFooter(
        item({
          updates: [
            { date: '2026-02-02', note: 'second <fix>' },
            { date: '2026-01-01', note: 'first' },
          ],
          copyright: '© 2026 Me',
        }),
      ),
    );
    expect($$(el, '.article-updates li').map((li) => li.textContent)).toEqual([
      '2026-02-02 — second <fix>',
      '2026-01-01 — first',
    ]);
    expect($(el, '.article-copyright').textContent).toBe('© 2026 Me');
  });

  it('renders only what is present', () => {
    expect(
      dom(articleFooter(item({ copyright: 'c' }))).querySelector('.article-updates'),
    ).toBeNull();
    const onlyUpdates = dom(articleFooter(item({ updates: [{ date: '2026-01-01', note: 'n' }] })));
    expect(onlyUpdates.querySelector('.article-copyright')).toBeNull();
  });

  it('puts its heading one level below the article title', () => {
    const it1 = item({ updates: [{ date: '2026-01-01', note: 'n' }] });
    expect(dom(articleFooter(it1)).querySelector('.article-updates h2')).not.toBeNull();
    const el = dom(articleFooter(it1, { level: 2 }));
    expect(el.querySelector('.article-updates h2')).toBeNull();
    expect($(el, '.article-updates h3').textContent).toBe('Update history');
  });

  it('renders nothing without updates or copyright', () => {
    expect(String(articleFooter(item()))).toBe('');
  });
});

describe('articleFull', () => {
  it('puts header, rendered content and footer in that order, content unescaped', () => {
    const el = dom(
      articleFull(
        item({ updates: [{ date: '2026-01-01', note: 'n' }] }),
        noTerms,
        '<p>Hello <b>there</b></p>',
      ),
    );
    expect($$(el, 'article > *').map((n) => n.tagName)).toEqual(['HEADER', 'DIV', 'FOOTER']);
    expect($(el, 'div.md-content').innerHTML).toBe('<p>Hello <b>there</b></p>');
    expect(el.querySelector('pre.md-source')).toBeNull();
    expect($(el, 'div.md-content').attributes).toHaveLength(1);
  });
});

describe('articleFull as a page of its own', () => {
  const toc = '<nav class="toc"><ol><li><a href="#a">A</a></li></ol></nav>';

  it('puts the contents list between header and content, as a sibling of both', () => {
    const el = dom(articleFull(item(), noTerms, '<h2 id="a">A</h2>', { toc }));
    expect($$(el, 'article > *').map((n) => n.className)).toEqual([
      'article-header',
      'toc',
      'md-content',
    ]);
    expect($(el, 'article').className).toBe('article article-single');
    expect($(el, '.md-content').innerHTML).toBe('<h2 id="a">A</h2>');
    expect(el.querySelector('.md-content .toc')).toBeNull();
  });

  it('has no gap where the article has no contents list, and keeps its footer last', () => {
    const el = dom(articleFull(item({ copyright: 'c' }), noTerms, '<p>x</p>', { toc: '' }));
    expect($$(el, 'article > *').map((n) => n.tagName)).toEqual(['HEADER', 'DIV', 'FOOTER']);
  });

  it('renders the title as the page heading', () => {
    const el = dom(articleFull(item({ title: 'T <1>' }), noTerms, '', { toc: '' }));
    expect($$(el, 'h1').map((h) => h.textContent)).toEqual(['T <1>']);
    expect(el.querySelector('h2 a')).toBeNull();
  });

  it('is the only article layout that carries the rail class', () => {
    expect(
      dom(articleFull(item(), noTerms, '<p>x</p>')).querySelector('.article-single'),
    ).toBeNull();
  });
});

describe('articleFragment', () => {
  it('is the content and the footer with a listing-level heading, and no page shell', () => {
    const post = item({ updates: [{ date: '2026-01-01', note: 'n' }], copyright: 'c' });
    const out = String(articleFragment(post, '<p>x</p>'));
    expect(out.startsWith('<div class="md-content"><p>x</p></div>\n<footer')).toBe(true);
    expect(out).not.toMatch(/<html|<article|<header/);
    const el = dom(out);
    expect($(el, '.article-updates h3').textContent).toBe('Update history');
  });

  it('is just the content for a post without a footer', () => {
    expect(String(articleFragment(item(), '<p>x</p>')).trim()).toBe(
      '<div class="md-content"><p>x</p></div>',
    );
  });
});

describe('renderStream', () => {
  const posts = ['/blog/1/', '/blog/2/', '/blog/3/', '/blog/4/', '/blog/5/'].map((url) =>
    item({ url, title: url, copyright: `c${url}` }),
  );
  const content = (post: Item) => `<p>text of ${post.url}</p>`;
  const options = { terms: noTerms, noun: NOUN, content, initial: 3, batch: 2 };

  it('embeds the first `initial` posts and lists the rest by fragment URL', () => {
    const el = dom(renderStream({ heading: 'Blog', items: posts, ...options }));
    expect($(el, 'h1').textContent).toBe('Blog');
    expect($$(el, 'article h2').map((h) => h.textContent)).toEqual([
      '/blog/1/',
      '/blog/2/',
      '/blog/3/',
    ]);
    expect($$(el, 'article .md-content').map((c) => c.textContent)).toEqual([
      'text of /blog/1/',
      'text of /blog/2/',
      'text of /blog/3/',
    ]);
    const rest = $(el, 'ol.stream-rest');
    expect(rest.dataset.batch).toBe('2');
    expect($$(rest, ':scope > li').map((li) => li.dataset.fragment)).toEqual([
      '/blog/4/fragment.html',
      '/blog/5/fragment.html',
    ]);
    const first = $(rest, ':scope > li');
    expect($(first, 'h2 a').getAttribute('href')).toBe('/blog/4/');
    expect(first.querySelector('.md-content, template, footer')).toBeNull();
    expect(el.querySelector('[data-md]')).toBeNull();
  });

  it('has no rest list when everything fits', () => {
    const el = dom(renderStream({ heading: 'B', items: posts.slice(0, 3), ...options }));
    expect(el.querySelector('ol.stream-rest')).toBeNull();
    expect(el.querySelector('.empty')).toBeNull();
  });

  it('names the entries by the given noun, for the page and for the client script', () => {
    const noun = { singular: 'piece', plural: 'pieces' };
    const full = dom(renderStream({ heading: 'B', items: posts, ...options, noun }));
    expect($(full, 'ol.stream-rest').dataset.noun).toBe('piece');
    expect($(full, 'ol.stream-rest').dataset.nounPlural).toBe('pieces');
    const empty = dom(renderStream({ heading: 'B', items: [], ...options, noun }));
    expect($(empty, '.empty').textContent).toBe('No pieces yet.');
  });

  it('says so when there are no posts', () => {
    const el = dom(renderStream({ heading: 'B', items: [], ...options }));
    expect(el.querySelector('.empty')).not.toBeNull();
    expect(el.querySelector('article')).toBeNull();
  });
});

describe('layout', () => {
  it('copyrightLine collapses equal or missing years', () => {
    expect(copyrightLine(config.copyright, 2024, 2026)).toBe(
      '© 2024–2026 Holder. All rights reserved.',
    );
    expect(copyrightLine(config.copyright, 2026, 2026)).toBe('© 2026 Holder. All rights reserved.');
    expect(copyrightLine(config.copyright, null, 2026)).toBe('© 2026 Holder. All rights reserved.');
    expect(copyrightLine(config.copyright, 2030, 2026)).toBe('© 2026 Holder. All rights reserved.');
  });

  const page = (over: Partial<LayoutOptions> = {}) =>
    renderLayout({
      config,
      pageStyle: pageStyle(config, over.title ?? 'Post "quoted"'),
      assets: { js: '/assets/main-AAA.js', css: '/assets/site-BBB.css', preload: [] },
      headScript: 'window.headRan = true;',
      speculationRules: '{}',
      url: '/blog/x/',
      title: 'Post "quoted"',
      description: 'Desc <b>',
      type: 'article',
      searchIndex: '/search-index.json',
      menu: html`<nav>m</nav>`,
      main: html`<p>main</p>`,
      copyright: '© 2026 Holder.',
      ...over,
    });

  it('renders a complete document with escaped meta', () => {
    const out = page();
    expect(out.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    const doc = parseHtml(out);
    expect(doc.title).toBe('Post "quoted" · Site & Co');
    expect($(doc, 'meta[name="description"]').getAttribute('content')).toBe('Desc <b>');
    expect($(doc, 'link[rel="canonical"]').getAttribute('href')).toBe(
      'https://example.com/blog/x/',
    );
    expect($(doc, 'meta[property="og:type"]').getAttribute('content')).toBe('article');
    expect(doc.querySelector('meta[name="robots"]')).toBeNull();
    expect($(doc, 'script[type="module"]').getAttribute('src')).toBe('/assets/main-AAA.js');
    expect($(doc, 'link[rel="stylesheet"]').getAttribute('href')).toBe('/assets/site-BBB.css');
    expect($(doc, 'main p').textContent).toBe('main');
    const footer = $(doc, 'footer.site-footer');
    expect(footer.textContent).toContain('© 2026 Holder.');
    expect($(footer, 'a').getAttribute('href')).toBe('/attributions/');
  });

  it('inlines the head script before the stylesheet, unescaped', () => {
    const out = page({ headScript: 'if (a < 1 && b > 2) { window.x = "q"; }' });
    expect(out).toContain('<script>if (a < 1 && b > 2) { window.x = "q"; }</script>');
    expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('rel="stylesheet"'));
    expect(out.indexOf('<script>')).toBeGreaterThan(out.indexOf('<meta name="viewport"'));
    const doc = parseHtml(out);
    expect(doc.querySelectorAll('head script:not([src]):not([type])')).toHaveLength(1);
  });

  describe('print title', () => {
    const styleOf = (over: Partial<LayoutOptions>): string =>
      $(parseHtml(page(over)), 'head style').textContent ?? '';

    it('puts the page title in the top-left margin box, after the stylesheet', () => {
      const out = page({ title: 'My post' });
      expect(styleOf({ title: 'My post' })).toBe('@page { @top-left { content: "My post"; } }');
      expect(out.indexOf('rel="stylesheet"')).toBeLessThan(out.indexOf('<style>'));
      expect(parseHtml(out).querySelectorAll('head style')).toHaveLength(1);
    });

    it('emits the style it is given, without computing another', () => {
      const given = { source: '@page { margin: 1mm; }' };
      expect($(parseHtml(page({ pageStyle: given })), 'head style').textContent).toBe(given.source);
    });

    it('falls back to the site title on the home page', () => {
      expect(styleOf({ title: '' })).toBe('@page { @top-left { content: "Site & Co"; } }');
    });

    it('escapes quotes, backslashes and newlines as CSS hex escapes', () => {
      expect(styleOf({ title: 'a "q" \\ b\nc' })).toBe(
        '@page { @top-left { content: "a \\22 q\\22  \\5c  b\\a c"; } }',
      );
    });

    it('cannot be closed early: `</style>` in a title stays inside the string', () => {
      const out = page({ title: '</style><script>alert(1)</script>' });
      const doc = parseHtml(out);
      expect(doc.querySelectorAll('script:not([src]):not([type])')).toHaveLength(1);
      expect($(doc, 'head style').textContent).toBe(
        '@page { @top-left { content: "\\3c /style>\\3c script>alert(1)\\3c /script>"; } }',
      );
      expect(out.match(/<\/style>/g)).toHaveLength(1);
    });

    it('keeps unicode as it is', () => {
      expect(styleOf({ title: 'Zażółć 日本 🙂' })).toContain('"Zażółć 日本 🙂"');
    });
  });

  it('starts the body with the skip link, then the top bar, sidebar and content column', () => {
    const doc = parseHtml(page());
    const body = $(doc, 'body');
    expect([...body.children].map((c) => c.tagName)).toEqual(['A', 'HEADER', 'DIV', 'DIV']);
    const skip = $(doc, 'a.skip-link');
    expect([skip.getAttribute('href'), skip.textContent]).toEqual(['#main', 'Skip to content']);
    expect($(doc, 'main').id).toBe('main');
    expect($(doc, '.content main')).toBeTruthy();
    expect($(doc, '.content footer.site-footer')).toBeTruthy();
  });

  it('has exactly one top bar and one sidebar, the elements that carry view-transition names', () => {
    const doc = parseHtml(page());
    expect(doc.querySelectorAll('.topbar')).toHaveLength(1);
    expect(doc.querySelectorAll('.sidebar')).toHaveLength(1);
  });

  it('puts only navigation in the sidebar', () => {
    const doc = parseHtml(page());
    const sidebar = $(doc, '#sidebar');
    const body = $(sidebar, '#sidebar-body');
    expect($(body, 'nav')).toBeTruthy();
    expect([...body.children].map((c) => c.tagName)).toEqual(['NAV']);
    expect([...sidebar.children]).toEqual([body]);
    expect($$(sidebar, 'button, a.site-title')).toEqual([]);
    const menuButton = $(doc, '.menu-button');
    expect(menuButton.getAttribute('aria-controls')).toBe($(doc, 'aside').id);
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(menuButton.getAttribute('aria-label')).toBe('Menu');
    expect(menuButton.getAttribute('title')).toBe('Menu');
    expect($(menuButton, 'svg.icon').getAttribute('aria-hidden')).toBe('true');
    expect(menuButton.textContent).toBe('');
    expect(menuButton.closest('.topbar')).not.toBeNull();
  });

  describe('top bar', () => {
    const tools = (over: Partial<LayoutOptions> = {}) =>
      $$($(parseHtml(page(over)), '.topbar-tools'), 'button');

    it('holds the menu button and the site title at the start, then the tools', () => {
      const bar = $(parseHtml(page()), '.topbar');
      expect([...bar.children].map((c) => c.className)).toEqual(['topbar-start', 'topbar-tools']);
      expect([...$(bar, '.topbar-start').children].map((c) => c.tagName)).toEqual(['BUTTON', 'A']);
    });

    it('lists the tools as a labelled group: search, smaller, larger, theme, print', () => {
      const group = $(parseHtml(page()), '.topbar-tools');
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-label')).toBe('Page tools');
      expect(tools().map((b) => b.className)).toEqual([
        'search-trigger',
        'text-smaller',
        'text-larger',
        'theme-toggle',
        'print-button',
      ]);
    });

    it('names every tool for assistive technology and for the pointer, without visible text', () => {
      expect(tools().map((b) => [b.getAttribute('aria-label'), b.title])).toEqual([
        ['Search', 'Search (/)'],
        ['Decrease text size', 'Decrease text size'],
        ['Increase text size', 'Increase text size'],
        ['Switch theme', 'Switch theme'],
        ['Print', 'Print'],
      ]);
      for (const button of tools()) {
        expect(button.getAttribute('type')).toBe('button');
        expect(button.textContent).toBe('');
        const icons = $$(button, 'svg');
        expect(icons.length).toBeGreaterThan(0);
        for (const icon of icons) {
          expect(icon.getAttribute('aria-hidden')).toBe('true');
          expect(icon.getAttribute('focusable')).toBe('false');
        }
      }
    });

    it('draws both theme icons, for CSS to choose between', () => {
      const toggle = $(parseHtml(page()), '.topbar-tools .theme-toggle');
      expect($$(toggle, 'svg').map((i) => i.getAttribute('class'))).toEqual([
        'icon icon-light',
        'icon icon-dark',
      ]);
    });

    it('gives the search button the index file and the shortcuts', () => {
      const [search] = tools({ searchIndex: '/search-index-"q".json' });
      expect(search?.getAttribute('data-index')).toBe('/search-index-"q".json');
      expect(search?.getAttribute('aria-keyshortcuts')).toBe('/ Control+K Meta+K');
    });

    it('shows the article title, as plain text, only on article pages', () => {
      const doc = parseHtml(page({ article: { title: 'A <b> post', published: null } }));
      const title = $(doc, '.topbar > .topbar-title');
      expect(title.textContent).toBe('A <b> post');
      expect(title.querySelector('a, button')).toBeNull();
      expect(title.className).toBe('topbar-title');
      expect(title.getAttribute('aria-hidden')).toBe('true');
      expect(parseHtml(page()).querySelector('.topbar-title')).toBeNull();
    });

    it('puts the title between the start and the tools', () => {
      const doc = parseHtml(page({ article: { title: 'T', published: null } }));
      expect([...$(doc, '.topbar').children].map((c) => c.className)).toEqual([
        'topbar-start',
        'topbar-title',
        'topbar-tools',
      ]);
    });
  });

  describe('reader-mode metadata', () => {
    it('names the copyright holder as author and the date as published time on article pages', () => {
      const doc = parseHtml(page({ article: { title: 'T', published: '2026-03-04' } }));
      expect($(doc, 'meta[name="author"]').getAttribute('content')).toBe('Holder');
      expect($(doc, 'meta[property="article:published_time"]').getAttribute('content')).toBe(
        '2026-03-04',
      );
    });

    it('omits the published time of an undated article, and everything on other pages', () => {
      const undated = parseHtml(page({ article: { title: 'T', published: null } }));
      expect(undated.querySelector('meta[property="article:published_time"]')).toBeNull();
      expect(undated.querySelector('meta[name="author"]')).not.toBeNull();
      const other = parseHtml(page());
      expect(other.querySelector('meta[name="author"]')).toBeNull();
      expect(other.querySelector('meta[property="article:published_time"]')).toBeNull();
    });

    it('escapes the holder', () => {
      const doc = parseHtml(
        page({
          config: { ...config, copyright: { ...config.copyright, holder: 'A "B" <c>' } },
          article: { title: 'T', published: null },
        }),
      );
      expect($(doc, 'meta[name="author"]').getAttribute('content')).toBe('A "B" <c>');
    });
  });

  describe('scripts', () => {
    it('emits the speculation rules as given, and only inline scripts that the CSP hashes cover', () => {
      const rules = '{"prerender":[]}';
      const doc = parseHtml(page({ speculationRules: rules }));
      const inline = $$(doc, 'head script:not([src])');
      expect(inline.map((s) => s.getAttribute('type'))).toEqual([null, 'speculationrules']);
      expect(inline[1]?.textContent).toBe(rules);
    });

    it('marks the module script, which the head script watches for a failed load', () => {
      const script = $(parseHtml(page()), 'script[type="module"]');
      expect(script.hasAttribute(MAIN_SCRIPT_ATTRIBUTE)).toBe(true);
      expect(script.getAttribute('src')).toBe('/assets/main-AAA.js');
    });
  });

  it('ships no control as visible by default: revealing is up to the stylesheet', () => {
    const doc = parseHtml(page());
    for (const sel of [
      '.menu-button',
      '.theme-toggle',
      '.search-trigger',
      '.text-smaller',
      '.text-larger',
      '.print-button',
      '.backdrop',
    ]) {
      expect(doc.querySelector(sel), sel).not.toBeNull();
    }
    expect(doc.querySelector('[hidden], .js-only')).toBeNull();
  });

  it('preloads the given fonts after the head script and before the stylesheet', () => {
    const out = page({
      assets: {
        js: '/a.js',
        css: '/a.css',
        preload: ['/assets/fonts/l-AAAA.woff2', '/assets/fonts/m"-BBBB.woff2'],
      },
    });
    const doc = parseHtml(out);
    const links = [...doc.querySelectorAll('link[rel="preload"]')];
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/assets/fonts/l-AAAA.woff2',
      '/assets/fonts/m"-BBBB.woff2',
    ]);
    for (const l of links) {
      expect(l.getAttribute('as')).toBe('font');
      expect(l.getAttribute('type')).toBe('font/woff2');
      expect(l.hasAttribute('crossorigin')).toBe(true);
    }
    expect(out.indexOf('rel="preload"')).toBeGreaterThan(out.indexOf('<script>'));
    expect(out.indexOf('rel="preload"')).toBeLessThan(out.indexOf('rel="stylesheet"'));
  });

  it('emits no preload link without fonts', () => {
    expect(page()).not.toContain('rel="preload"');
  });

  it('shows the site title once, in the top bar, linking home, escaped', () => {
    const doc = parseHtml(page({ config: { ...config, title: 'A <b> & Co' } }));
    const titles = [...doc.querySelectorAll('a.site-title')];
    expect(
      titles.map((a) => [a.getAttribute('href'), a.textContent, a.parentElement?.className]),
    ).toEqual([['/', 'A <b> & Co', 'topbar-start']]);
  });

  it('puts a home link with the site title right after the menu button, as the only link of the bar’s start', () => {
    const start = $(parseHtml(page()), '.topbar-start');
    expect([...start.children].map((c) => c.tagName)).toEqual(['BUTTON', 'A']);
    const link = $(start, 'a.site-title');
    expect(link.getAttribute('href')).toBe('/');
    expect(link.textContent).toBe('Site & Co');
    expect(link.hasAttribute('aria-hidden')).toBe(false);
    expect(link.hasAttribute('aria-label')).toBe(false);
  });

  it('uses the site title alone for the home page and omits empty description', () => {
    const doc = parseHtml(page({ title: '', description: '' }));
    expect(doc.title).toBe('Site & Co');
    expect(doc.querySelector('meta[name="description"]')).toBeNull();
    expect($(doc, 'meta[property="og:title"]').getAttribute('content')).toBe('Site & Co');
  });

  it('marks noindex pages', () => {
    const doc = parseHtml(page({ noindex: true }));
    expect($(doc, 'meta[name="robots"]').getAttribute('content')).toBe('noindex');
  });
});
