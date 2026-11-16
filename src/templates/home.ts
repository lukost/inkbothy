import type { Item, ItemNoun, TermLookup } from '../types.ts';
import { articleFull } from './article.ts';
import { cardGrid } from './cards.ts';
import { html, type Markup } from './html.ts';
import { postList } from './list.ts';

/** A block of the home page: some of a section's items, with a link to the section. */
export interface HomeBlock {
  readonly kind: 'latest' | 'featured';
  /** URL of the section's index page. */
  readonly url: string;
  readonly noun: ItemNoun;
  /** Not empty. */
  readonly items: readonly Item[];
  readonly terms: TermLookup;
}

export interface HomeOptions {
  readonly item: Item;
  /** Rendered content of the home page. */
  readonly content: string;
  readonly terms: TermLookup;
  readonly blocks: readonly HomeBlock[];
}

function block({ kind, url, noun, items, terms }: HomeBlock): Markup {
  const [title, list] =
    kind === 'latest'
      ? [`Latest ${noun.plural}`, postList(items, 3)]
      : [`Featured ${noun.plural}`, cardGrid(items, terms, 3)];
  return html`<section class="home-section home-${kind}">
<h2>${title}</h2>
${list}
<p class="home-more"><a href="${url}">All ${noun.plural} →</a></p>
</section>`;
}

/** `<main>` content of the home page: the page itself, then its blocks in order. */
export function renderHome({ item, content, terms, blocks }: HomeOptions): Markup {
  return html`${articleFull(item, terms, content)}
${blocks.map(block)}`;
}
