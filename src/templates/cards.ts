import type { Item, ItemNoun, TermLookup } from '../types.ts';
import { termList } from './article.ts';
import { heading, html, Markup } from './html.ts';

/** One item as a card: title link, status, summary, tags, repository. `level` is the title's heading level. */
export function card(item: Item, terms: TermLookup, level: 2 | 3): Markup {
  const { title, status, summary, repo } = item.meta;
  return html`<li class="card">
${heading(level, html`<a href="${item.url}">${title}</a>`)}
${status && html`<p class="card-status"><span class="badge">${status}</span></p>`}
${summary && html`<p class="card-summary">${summary}</p>`}
${termList(item, 'tags', terms.tag, 'article-tags')}
${repo && html`<p class="card-repo"><a href="${repo}">Repository</a></p>`}
</li>`;
}

/** The cards as a grid, in the order given. */
export function cardGrid(items: readonly Item[], terms: TermLookup, level: 2 | 3): Markup {
  return html`<ul class="cards">${items.map((i) => card(i, terms, level))}</ul>`;
}

export interface CardsOptions {
  readonly heading: string;
  /** Rendered content of the optional introduction. */
  readonly intro?: string | undefined;
  /** Already sorted. */
  readonly items: readonly Item[];
  readonly terms: TermLookup;
  readonly noun: ItemNoun;
}

/** `<main>` content of a cards section's index and term pages. */
export function renderCards({ heading: title, intro, items, terms, noun }: CardsOptions): Markup {
  return html`<section class="cards-page">
${heading(1, title)}
${intro && html`<div class="md-content">${new Markup(intro)}</div>`}
${items.length === 0 ? html`<p class="empty">No ${noun.plural} yet.</p>` : cardGrid(items, terms, 2)}
</section>`;
}
