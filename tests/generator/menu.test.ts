// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/config/load.ts';
import { checkMenu, renderMenu } from '../../src/generator/menu.ts';
import {
  $$,
  attrs,
  CARDS,
  dom,
  item,
  LIST,
  menuOf,
  STREAM,
  siteConfig,
  texts,
} from '../helpers.ts';

const resume = item({ url: '/resume/', section: null, title: 'Résumé', kind: 'resume' });
const about = item({ url: '/about/', section: null, title: 'About <me>', format: 'html' });
const items = [
  item({ url: '/blog/a/', categories: ['Linux', 'Embedded'] }),
  item({ url: '/blog/b/', categories: ['Linux'] }),
  item({ url: '/projects/z/', section: 'projects', title: 'zeta <tool>' }),
  item({ url: '/projects/a/', section: 'projects', title: 'Alpha' }),
  resume,
  about,
  item({ url: '/', section: null, title: 'Home' }),
  item({ url: '/notes/n/', section: 'notes', title: 'Note' }),
];
const config = siteConfig({
  sections: { blog: STREAM, projects: CARDS, notes: LIST },
  menu: ['resume', 'blog', 'projects', 'about'],
});
const render = (url: string, site = config, content = items) =>
  dom(renderMenu(menuOf(content, site), url));

describe('renderMenu', () => {
  it('follows the configured order after Home: pages as links, sections as their menu asks', () => {
    const el = render('/');
    expect(texts(el, 'nav > ul > li > a')).toEqual(['Home', 'Résumé', 'About <me>']);
    expect(attrs(el, 'nav > ul > li > a', 'href')).toEqual(['/', '/resume/', '/about/']);
    expect(texts(el, 'summary')).toEqual(['Blog', 'Projects']);
    expect(
      $$(el, 'nav > ul > li').map((li) => li.querySelector('a, summary')?.textContent),
    ).toEqual(['Home', 'Résumé', 'Blog', 'Projects', 'About <me>']);
  });

  it('lists the first taxonomy with counts, and items by title', () => {
    const [blog, projects] = $$(render('/'), 'details');
    if (!blog || !projects) {
      throw new Error('expected two menu groups');
    }
    expect(texts(blog, 'a')).toEqual(['All posts', 'Embedded (1)', 'Linux (2)']);
    expect(attrs(blog, 'a', 'href')).toEqual([
      '/blog/',
      '/blog/category/embedded/',
      '/blog/category/linux/',
    ]);
    expect(texts(projects, 'a')).toEqual(['All projects', 'Alpha', 'zeta <tool>']);
    expect(attrs(projects, 'a', 'href')).toEqual(['/projects/', '/projects/a/', '/projects/z/']);
  });

  it('lists the tags of a section whose first taxonomy is tags', () => {
    const tagged = [item({ url: '/blog/a/', tags: ['C++', 'kernel'], categories: ['Linux'] })];
    const site = siteConfig({
      sections: { blog: { ...STREAM, taxonomies: ['tags', 'categories'] } },
      menu: ['blog'],
    });
    const el = render('/', site, tagged);
    expect(attrs(el, 'details a', 'href')).toEqual([
      '/blog/',
      '/blog/tag/cpp/',
      '/blog/tag/kernel/',
    ]);
    expect(texts(el, 'details a')).toEqual(['All posts', 'C++ (1)', 'kernel (1)']);
  });

  it('offers just the link for menu: none, under the section label', () => {
    const site = siteConfig({
      sections: { blog: { ...STREAM, menu: 'none' } },
      menu: ['blog'],
    });
    const el = render('/', site);
    expect($$(el, 'details')).toEqual([]);
    expect(texts(el, 'nav > ul > li > a')).toEqual(['Home', 'Blog']);
    expect(attrs(el, 'nav > ul > li > a', 'href')).toEqual(['/', '/blog/']);
  });

  it('shows menu: taxonomy without terms as the link to all items only', () => {
    const el = render('/', siteConfig({ menu: ['blog'] }), [item({ url: '/blog/a/' })]);
    expect(texts(el, 'details a')).toEqual(['All posts']);
  });

  it('puts the section label and noun of each section into its group', () => {
    const site = siteConfig({
      sections: { notes: { ...LIST, label: 'Jottings' } },
      menu: ['notes'],
    });
    const el = render('/', site);
    expect(texts(el, 'summary')).toEqual(['Jottings']);
    expect(texts(el, 'details a')).toEqual(['All notes', 'Note']);
  });

  it('escapes hostile titles', () => {
    const markup = String(renderMenu(menuOf(items, config), '/'));
    expect(markup).toContain('zeta &lt;tool&gt;');
    expect(markup).toContain('About &lt;me&gt;');
  });

  it.each([
    ['/', 'Home'],
    ['/blog/', 'All posts'],
    ['/blog/category/linux/', 'Linux (2)'],
    ['/blog/a/', null],
    ['/projects/', 'All projects'],
    ['/projects/a/', 'Alpha'],
    ['/resume/', 'Résumé'],
    ['/about/', 'About <me>'],
  ])('on %s marks %j current and keeps every group open', (url, current) => {
    const el = render(url);
    expect(texts(el, '[aria-current="page"]')).toEqual(current ? [current] : []);
    expect(texts(el, 'details[open] > summary')).toEqual(['Blog', 'Projects']);
    expect($$(el, 'details:not([open])')).toHaveLength(0);
  });

  it('leaves out entries that have nothing to show: absent pages, empty sections', () => {
    const el = render('/', config, [item({ url: '/blog/a/' })]);
    expect(texts(el, 'a')).toEqual(['Home', 'All posts']);
    expect(texts(el, 'summary')).toEqual(['Blog']);
  });

  it('shows a section that has only an introduction', () => {
    const intro = item({ url: '/projects/', section: null, kind: 'intro', title: 'Intro' });
    const el = render('/', siteConfig({ menu: ['projects'] }), [intro]);
    expect(texts(el, 'details a')).toEqual(['All projects']);
  });

  it('shows only Home when the menu is empty', () => {
    expect(texts(render('/', siteConfig({ menu: [] })), 'a')).toEqual(['Home']);
  });
});

describe('checkMenu', () => {
  it('accepts sections and pages', () => {
    expect(() => checkMenu(config, new Set(['resume', 'about']))).not.toThrow();
  });

  it('accepts a declared section that has no content', () => {
    expect(() => checkMenu(siteConfig({ menu: ['blog'] }), new Set())).not.toThrow();
  });

  it('names the first entry that is neither, with its index', () => {
    const site = siteConfig({ menu: ['blog', 'about', 'nowhere'] });
    expect(() => checkMenu(site, new Set(['about']))).toThrow(
      new ConfigError('site.yaml: menu[2]: "nowhere" is neither a section nor a top-level page'),
    );
  });

  it('does not mistake the name of an Object property for a section', () => {
    expect(() => checkMenu(siteConfig({ menu: ['constructor'] }), new Set())).toThrow(ConfigError);
  });
});
