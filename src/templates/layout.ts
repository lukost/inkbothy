import type { SiteConfig } from '../config/schema.ts';
import { cssString } from '../lib/escape.ts';
import { absoluteUrl } from '../lib/url.ts';
import { MAIN_SCRIPT_ATTRIBUTE } from '../shared/ui-state.ts';
import type { Assets } from '../types.ts';
import { html, Markup } from './html.ts';

/** `© 2026–2028 Holder. Rights.` with the range collapsed when the years match. */
export function copyrightLine(
  { holder, rights }: SiteConfig['copyright'],
  firstYear: number | null,
  currentYear: number,
): string {
  const years =
    firstYear && firstYear < currentYear ? `${firstYear}–${currentYear}` : `${currentYear}`;
  return `© ${years} ${holder}. ${rights}`;
}

/** An icon `<link>` of the head: the site icon (with its media type) or the Apple touch icon. */
export interface IconLink {
  readonly rel: 'icon' | 'apple-touch-icon';
  readonly href: string;
  readonly type?: string | undefined;
}

export interface LayoutOptions {
  config: Pick<SiteConfig, 'baseUrl' | 'title' | 'copyright'>;
  assets: Assets;
  /** Icons every page links; none by default. */
  icons?: readonly IconLink[];
  /** Source of the inline script that runs before the stylesheet; must not contain `</script`. */
  headScript: string;
  /** Names the printed page; see `pageStyle`. */
  pageStyle: PageStyle;
  /** Root-relative URL of the page. */
  url: string;
  /** Page title; '' for the home page. */
  title: string;
  description?: string;
  type?: 'website' | 'article';
  /** e.g. drafts in preview builds */
  noindex?: boolean;
  /** Root-relative URL of the search index file. */
  searchIndex: string;
  /** Source of the `speculationrules` script; must not contain `</script`. */
  speculationRules: string;
  /** Set on pages that are one article: names it in the top bar and in reader-mode metadata. */
  article?: ArticleMeta;
  menu: Markup;
  main: Markup;
  copyright: string;
}

/** What reader modes and the top bar need to know about a page that is one article. */
export interface ArticleMeta {
  readonly title: string;
  /** `YYYY-MM-DD`, or null when unknown. */
  readonly published: string | null;
}

/** Inline stylesheet that names the printed page. */
export interface PageStyle {
  readonly source: string;
}

/** The `@page` rule that puts the page title in the top-left margin box of every printed sheet. */
export function pageStyle(
  { title: siteTitle }: Pick<SiteConfig, 'title'>,
  title: string,
): PageStyle {
  return { source: `@page { @top-left { content: ${cssString(title || siteTitle)}; } }` };
}

const svg = (inner: string, cls = 'icon'): string =>
  `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${inner}</svg>`;

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"';

/** Theme icons; CSS shows the one for the theme in force. */
const THEME_ICONS = new Markup(
  [
    svg(
      '<circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
      'icon icon-light',
    ),
    svg(
      '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" fill="currentColor"/>',
      'icon icon-dark',
    ),
  ].join(''),
);

const MENU_ICON = new Markup(svg(`<path d="M2 4h12M2 8h12M2 12h12" ${STROKE}/>`));

const SEARCH_ICON = new Markup(
  svg(`<circle cx="6.5" cy="6.5" r="4.5" ${STROKE}/><path d="M10 10l4 4" ${STROKE}/>`),
);

/** A capital A with a minus or plus sign. */
const textSizeIcon = (sign: string): Markup =>
  new Markup(svg(`<path d="M1.5 13L5.5 3l4 10M3 9.5h5" ${STROKE}/><path d="${sign}" ${STROKE}/>`));

const PRINT_ICON = new Markup(
  svg(
    `<path d="M4.5 6V2h7v4M4.5 12H2V6h12v6h-2.5" ${STROKE}/><path d="M4.5 9.5h7V14h-7z" ${STROKE}/>`,
  ),
);

const SMALLER_ICON = textSizeIcon('M11 6h4');
const LARGER_ICON = textSizeIcon('M11 6h4M13 4v4');

/** Keys that open the search dialog; announced to assistive technology. */
const SEARCH_SHORTCUTS = '/ Control+K Meta+K';

/** Full HTML document around pre-rendered menu and main content. */
export function renderLayout({
  config,
  assets,
  icons = [],
  headScript,
  pageStyle: style,
  url,
  title,
  description = '',
  type = 'website',
  noindex = false,
  searchIndex,
  speculationRules,
  article,
  menu,
  main,
  copyright,
}: LayoutOptions): string {
  const fullTitle = title ? `${title} · ${config.title}` : config.title;
  const canonical = absoluteUrl(config.baseUrl, url);
  return `<!doctype html>
${html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
${description && html`<meta name="description" content="${description}">`}
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${config.title}">
<meta property="og:title" content="${title || config.title}">
${description && html`<meta property="og:description" content="${description}">`}
<meta property="og:url" content="${canonical}">
${noindex && html`<meta name="robots" content="noindex">`}
${
  article &&
  html`<meta name="author" content="${config.copyright.holder}">
${article.published && html`<meta property="article:published_time" content="${article.published}">`}`
}
<script>${new Markup(headScript)}</script>
<script type="speculationrules">${new Markup(speculationRules)}</script>
${icons.map(({ rel, href, type }) => html`<link rel="${rel}" href="${href}"${type && html` type="${type}"`}>`)}
${assets.preload.map((href) => html`<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`)}
<link rel="stylesheet" href="${assets.css}">
<style>${new Markup(style.source)}</style>
<script type="module" src="${assets.js}" ${MAIN_SCRIPT_ATTRIBUTE}></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar">
<div class="topbar-start">
<button type="button" class="menu-button" aria-expanded="false" aria-controls="sidebar" aria-label="Menu" title="Menu">${MENU_ICON}</button>
<a class="site-title" href="/">${config.title}</a>
</div>
${article && html`<p class="topbar-title" aria-hidden="true">${article.title}</p>`}
<div class="topbar-tools" role="group" aria-label="Page tools">
<button type="button" class="search-trigger" data-index="${searchIndex}" aria-label="Search" title="Search (/)" aria-keyshortcuts="${SEARCH_SHORTCUTS}">${SEARCH_ICON}</button>
<button type="button" class="text-smaller" aria-label="Decrease text size" title="Decrease text size">${SMALLER_ICON}</button>
<button type="button" class="text-larger" aria-label="Increase text size" title="Increase text size">${LARGER_ICON}</button>
<button type="button" class="theme-toggle" aria-label="Switch theme" title="Switch theme">${THEME_ICONS}</button>
<button type="button" class="print-button" aria-label="Print" title="Print">${PRINT_ICON}</button>
</div>
</header>
<div class="backdrop"></div>
<div class="page">
<aside id="sidebar" class="sidebar" aria-label="Sidebar">
<div id="sidebar-body" class="sidebar-body">
${menu}
</div>
</aside>
<div class="content">
<main id="main">
<div class="column">
${main}
</div>
</main>
<footer class="site-footer"><p>${copyright} · <a href="/attributions/">Attributions</a></p></footer>
</div>
</div>
</body>
</html>`}
`;
}
