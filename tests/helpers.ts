import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll } from 'vitest';
import type { SectionConfig, SiteConfig } from '../src/config/schema.ts';
import { type MenuSite, menuSite } from '../src/generator/menu.ts';
import { sectionPages } from '../src/generator/sections.ts';
import { ROOT } from '../src/lib/paths.ts';
import { html, type Markup } from '../src/templates/html.ts';
import { type LayoutOptions, pageStyle, renderLayout } from '../src/templates/layout.ts';
import type { Item, Meta, TermLookup } from '../src/types.ts';
import { TMP_VAR } from './tmp-root.ts';

/** Per-run temp root: set by `tests/global-setup.ts`, else one for a file run without it. */
export const TMP = process.env[TMP_VAR] ?? path.join(ROOT, '.tmp', `run-${process.pid}`);

/** Create a fresh directory under TMP populated with `files` ({ relPath: content }). */
export async function makeTree(files: Record<string, string> = {}): Promise<string> {
  await fs.mkdir(TMP, { recursive: true });
  const dir = await fs.mkdtemp(path.join(TMP, 't-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return dir;
}

/** Remove `dir`, retrying while a concurrent writer is still adding entries (ENOTEMPTY). */
export const removeTree = (dir: string) =>
  fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

/** Temp trees removed after the calling test file; call at module level. */
export function trackedTrees() {
  const dirs: string[] = [];
  let outputs = 0;
  afterAll(async () => {
    await Promise.all(dirs.splice(0).map(removeTree));
  });
  return {
    async tree(files: Record<string, string> = {}): Promise<string> {
      const dir = await makeTree(files);
      dirs.push(dir);
      return dir;
    },
    /** Output directory paired with a content tree (not created). */
    outFor(content: string): string {
      outputs++;
      const dir = path.join(TMP, `out-${path.basename(content)}-${outputs}`);
      dirs.push(dir);
      return dir;
    },
  };
}

/** An output stream stand-in that collects what is written. */
export const sink = () => {
  const s = {
    text: '',
    write(t: string) {
      s.text += t;
    },
  };
  return s;
};

/** The error thrown by `fn`; fails if nothing (or a non-Error) is thrown. */
export function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error) {
      return err;
    }
    throw new Error(`expected an Error, got ${String(err)}`);
  }
  throw new Error('expected function to throw');
}

/** The default noun for a blog entry. */
export const NOUN = { singular: 'post', plural: 'posts' } as const;

/** A stream section, as the blog of the site configuration. */
type Layout<L extends SectionConfig['layout']> = Extract<SectionConfig, { layout: L }>;

export const STREAM: Layout<'stream'> = {
  label: 'Blog',
  layout: 'stream',
  noun: NOUN,
  taxonomies: ['categories', 'tags'],
  stream: { initial: 2, batch: 2 },
  menu: 'taxonomy',
};

/** A cards section, as the projects of the site configuration. */
export const CARDS: Layout<'cards'> = {
  label: 'Projects',
  layout: 'cards',
  noun: { singular: 'project', plural: 'projects' },
  taxonomies: ['tags'],
  menu: 'items',
};

/** A list section. */
export const LIST: Layout<'list'> = {
  label: 'Notes',
  layout: 'list',
  noun: { singular: 'note', plural: 'notes' },
  taxonomies: ['tags'],
  menu: 'items',
};

/** The sections `blog` (stream) and `projects` (cards). */
export const SECTIONS: SiteConfig['sections'] = { blog: STREAM, projects: CARDS };

/** The menu of the site `config` over `items`, as the build hands it to the menu renderer. */
export const menuOf = (items: readonly Item[], config: SiteConfig = siteConfig()): MenuSite =>
  menuSite(config.menu, items, sectionPages(items, config).pages);

/** A site with a blog and projects; `overrides` replace any of its fields. */
export const siteConfig = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
  title: 'Site',
  baseUrl: 'https://example.com',
  copyright: { holder: 'Holder', rights: 'All rights reserved.' },
  sections: SECTIONS,
  menu: ['blog', 'projects'],
  home: [
    { kind: 'latest', section: 'blog', count: 2 },
    { kind: 'featured', section: 'projects', count: 3 },
  ],
  ...overrides,
});

/** Front-matter + body as file text. */
export function doc(frontMatter: string, body = 'Body.\n'): string {
  return `---\n${frontMatter.trim()}\n---\n${body}`;
}

export type ItemSpec = Partial<Meta> & {
  url?: string;
  section?: string | null;
  body?: string;
  format?: Item['format'];
  kind?: Item['kind'];
};

/** A normalised content item as produced by scanContent. */
export function item({
  url = '/blog/x/',
  section = 'blog',
  body = 'Body.',
  format = 'markdown',
  kind = section === null ? (url === '/' ? 'home' : 'page') : 'member',
  ...meta
}: ItemSpec = {}): Item {
  const slug = url.split('/').filter(Boolean).at(-1) ?? '';
  return {
    rel: url.slice(1, -1),
    source: `${url.slice(1)}index.${format === 'html' ? 'html' : 'md'}`,
    format,
    kind,
    url,
    section,
    slug,
    body,
    assets: [],
    meta: {
      title: 'Title',
      summary: '',
      published: '2026-01-01',
      updates: [],
      updated: null,
      categories: [],
      tags: [],
      draft: false,
      extra: {},
      ...meta,
    },
  };
}

/** TermLookup with no known terms. */
export const noTerms: TermLookup = { category: () => undefined, tag: () => undefined };

/** Parse a markup fragment into a detached container (DOM test environment). */
export function dom(markup: Markup | string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = String(markup);
  return el;
}

/** Parse a full HTML document (DOM test environment). */
export const parseHtml = (text: string): Document =>
  new DOMParser().parseFromString(text, 'text/html');

/** First match or throw, so a missing element fails with the selector in the message. */
export function $<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) {
    throw new Error(`no element matches ${selector}`);
  }
  return el;
}

export const $$ = (root: ParentNode, selector: string): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(selector),
];

export const texts = (root: ParentNode, selector: string): (string | null)[] =>
  $$(root, selector).map((n) => n.textContent);

export const attrs = (root: ParentNode, selector: string, name: string): (string | null)[] =>
  $$(root, selector).map((n) => n.getAttribute(name));

/** A complete page from the real layout; `overrides` replace any of its options. */
export function renderPage(overrides: Partial<LayoutOptions> = {}): string {
  return renderLayout({
    config: siteConfig(),
    assets: { js: '/a.js', css: '/a.css', preload: [] },
    headScript: '',
    speculationRules: '{}',
    pageStyle: pageStyle({ title: 'Site' }, ''),
    url: '/',
    title: '',
    searchIndex: '/s.json',
    menu: html`<nav>menu</nav>`,
    main: html`<p>main</p>`,
    copyright: 'c',
    ...overrides,
  });
}

/** Rendered article content as one string: table of contents first. */
export const fullHtml = ({ toc, body }: { toc: string; body: string }): string => toc + body;
