import type { Item, ItemNoun } from '../types.ts';
import { heading, html, Markup } from './html.ts';

/** Compact list: title link, date, summary. `level` is the title's heading level. */
export function postList(items: readonly Item[], level: 2 | 3): Markup {
  return html`<ul class="post-list">${items.map(
    ({ url, meta }) => html`<li>
${heading(level, html`<a href="${url}">${meta.title}</a>`)}
${meta.published && html`<p class="article-dates"><time datetime="${meta.published}">${meta.published}</time></p>`}
${meta.summary && html`<p>${meta.summary}</p>`}
</li>`,
  )}</ul>`;
}

export interface ListOptions {
  readonly heading: string;
  /** Rendered content of the optional introduction. */
  readonly intro?: string | undefined;
  /** Already sorted. */
  readonly items: readonly Item[];
  readonly noun: ItemNoun;
}

/** `<main>` content of a list section's index and term pages. */
export function renderList({ heading: title, intro, items, noun }: ListOptions): Markup {
  return html`<section class="list-page">
${heading(1, title)}
${intro && html`<div class="md-content">${new Markup(intro)}</div>`}
${items.length === 0 ? html`<p class="empty">No ${noun.plural} yet.</p>` : postList(items, 2)}
</section>`;
}
