import type { TaxonomyField } from '../config/schema.ts';
import { canonicalTerms, termUrl } from '../content/taxonomy.ts';
import type { Item, Lookup, TermLookup } from '../types.ts';
import { heading, html, Markup } from './html.ts';

export interface HeadingOptions {
  /** Level of the article title: 1 on article pages, 2 in listings. */
  level?: 1 | 2;
  linkTitle?: boolean;
}

/** Pills for the item's categories or tags, each a link to its term page in the item's section. */
export function termList(
  item: Item,
  field: TaxonomyField,
  lookup: Lookup,
  cls: string,
): Markup | '' {
  const { section } = item;
  if (section === null || item.meta[field].length === 0) {
    return '';
  }
  return html`<ul class="${cls}">${canonicalTerms(item.meta[field], lookup).map(
    (t) => html`<li><a href="${termUrl(section, field, t.slug)}">${t.label}</a></li>`,
  )}</ul>`;
}

/** File name of a stream item's fragment, next to its page. */
export const FRAGMENT_FILE = 'fragment.html';

/** Headings of articles inside a listing: the title is an h2. */
export const LISTING_HEADINGS: HeadingOptions = { level: 2, linkTitle: true };

/** Banner of a draft, shown in preview builds. */
export function draftBanner(item: Item): Markup | '' {
  return item.meta.draft ? html`<p class="draft-banner">DRAFT — not published</p>` : '';
}

/** Article header: title, dates, categories, tags. */
export function articleHeader(
  item: Item,
  terms: TermLookup,
  { level = 1, linkTitle = false }: HeadingOptions = {},
): Markup {
  const { meta } = item;
  const title = linkTitle ? html`<a href="${item.url}">${meta.title}</a>` : meta.title;
  const dates = [
    meta.published &&
      html`<span>Published <time datetime="${meta.published}">${meta.published}</time></span>`,
    meta.updated &&
      html`<span>Updated <time datetime="${meta.updated}">${meta.updated}</time></span>`,
  ].filter((d): d is Markup => Boolean(d));

  return html`<header class="article-header">
${draftBanner(item)}
${heading(level, title)}
${dates.length > 0 && html`<p class="article-dates">${dates}</p>`}
${termList(item, 'categories', terms.category, 'article-categories')}
${termList(item, 'tags', terms.tag, 'article-tags')}
</header>`;
}

/** Article footer: updates (one line each) and copyright. Its heading sits one level below the title. */
export function articleFooter(item: Item, { level = 1 }: HeadingOptions = {}): Markup | '' {
  const { updates, copyright } = item.meta;
  if (!updates.length && !copyright) {
    return '';
  }
  return html`<footer class="article-footer">
${
  updates.length > 0 &&
  html`<section class="article-updates">${heading(level === 1 ? 2 : 3, 'Update history')}<ol>${updates.map(
    (u) => html`<li><time datetime="${u.date}">${u.date}</time> — ${u.note}</li>`,
  )}</ol></section>`
}
${copyright && html`<p class="article-copyright">${copyright}</p>`}
</footer>`;
}

export function articleContent(content: string): Markup {
  return html`<div class="md-content">${new Markup(content)}</div>`;
}

export interface ArticleOptions extends HeadingOptions {
  /**
   * Table of contents of a standalone article. When set (even to ''), the article gets
   * `article-single` and the list sits between header and content, so wide screens can move it
   * into a side rail.
   */
  toc?: string;
}

/** Complete article: header, content, footer. */
export function articleFull(
  item: Item,
  terms: TermLookup,
  content: string,
  { toc, ...headings }: ArticleOptions = {},
): Markup {
  return html`<article class="${toc === undefined ? 'article' : 'article article-single'}">
${articleHeader(item, terms, headings)}
${toc && new Markup(toc)}
${articleContent(content)}
${articleFooter(item, headings)}
</article>`;
}

/** What a stream loads for an item it shows as a header only: the content and the footer. */
export function articleFragment(item: Item, content: string): Markup {
  return html`${articleContent(content)}
${articleFooter(item, LISTING_HEADINGS)}`;
}
