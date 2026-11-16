import type { Item, ItemNoun, TermLookup } from '../types.ts';
import { articleFull, articleHeader, FRAGMENT_FILE, LISTING_HEADINGS } from './article.ts';
import { heading, html, Markup } from './html.ts';

export interface StreamOptions {
  heading: string;
  /** Rendered content of the optional introduction. */
  intro?: string | undefined;
  /** Already sorted. */
  items: readonly Item[];
  terms: TermLookup;
  /** Names the items for the reader, including in the client script's messages. */
  noun: ItemNoun;
  /** Rendered content of an item. */
  content: (item: Item) => string;
  /** Items rendered in full. */
  initial: number;
  batch: number;
}

/** The first `initial` items in full; the rest as headers, each with a `data-fragment` URL for its content and footer. */
export function renderStream({
  heading: title,
  intro,
  items,
  terms,
  noun,
  content,
  initial,
  batch,
}: StreamOptions): Markup {
  const head = items.slice(0, initial);
  const rest = items.slice(initial);
  return html`<section class="stream">
${heading(1, title)}
${intro && html`<div class="md-content">${new Markup(intro)}</div>`}
${items.length === 0 && html`<p class="empty">No ${noun.plural} yet.</p>`}
${head.map((i) => articleFull(i, terms, content(i), LISTING_HEADINGS))}
${
  rest.length > 0 &&
  html`<ol class="stream-rest" data-batch="${batch}" data-noun="${noun.singular}" data-noun-plural="${noun.plural}">${rest.map(
    (i) =>
      html`<li data-fragment="${i.url}${FRAGMENT_FILE}">${articleHeader(i, terms, LISTING_HEADINGS)}</li>`,
  )}</ol>`
}
</section>`;
}
