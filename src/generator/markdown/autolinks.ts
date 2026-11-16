import type { MarkdownIt, StateCore, Token } from 'markdown-it';

/** Markup that markdown-it gives the links it makes from an address. */
const AUTOLINK_MARKUP: ReadonlySet<string> = new Set(['linkify', 'autolink']);

/** A link whose only content is its own address as text. */
function showsAddress(children: readonly Token[], open: number): boolean {
  const [link, text, close] = children.slice(open, open + 3);
  return (
    text?.type === 'text' && close?.type === 'link_close' && text.content === link?.attrGet('href')
  );
}

function markAutolinks(state: StateCore): void {
  for (const block of state.tokens) {
    const children = block.children ?? [];
    for (const [i, token] of children.entries()) {
      if (
        token.type === 'link_open' &&
        (AUTOLINK_MARKUP.has(token.markup) || showsAddress(children, i))
      ) {
        token.attrJoin('class', 'autolink');
      }
    }
  }
}

/** Marks links whose text is their address (linkify, `<address>`, or written out) with `class="autolink"`. */
export default function autolinks(md: MarkdownIt): void {
  md.core.ruler.after('linkify', 'autolink_class', markAutolinks);
}
