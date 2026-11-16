import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { slugify } from '../../content/slug.ts';
import { escapeHtml } from '../../lib/escape.ts';

const LEVELS: ReadonlySet<string> = new Set(['h2', 'h3', 'h4']);
const TEXT: ReadonlySet<string> = new Set(['text', 'code_inline']);

/** Id prefix of a document (`<docId>--`, or nothing without a docId); slugs never contain `--`, so ids of different documents cannot collide. */
export function idPrefix(env: Readonly<Record<string, unknown>>): string {
  return typeof env.docId === 'string' && env.docId ? `${env.docId}--` : '';
}

/** Text and inline code of a heading's `inline` token, without markup. */
export function headingText(inline: Token | undefined): string {
  return (inline?.children ?? [])
    .filter((c) => TEXT.has(c.type))
    .map((c) => c.content)
    .join('');
}

function assignIds(state: StateCore): void {
  const { tokens, env } = state;
  const prefix = idPrefix(env);
  const used = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading_open' || !LEVELS.has(token.tag)) {
      continue;
    }
    const base = `${prefix}${slugify(headingText(tokens[index + 1])) || 'section'}`;
    let id = base;
    for (let n = 2; used.has(id); n++) {
      id = `${base}-${n}`;
    }
    used.add(id);
    token.attrSet('id', id);
  }
}

/** Ids for h2–h4 (`<docId>--<slug>`, or `<slug>` without a docId; duplicates get `-2`, `-3`, …) and a trailing permalink anchor; headings without a usable slug are `section`. */
export default function headingIds(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'heading_ids', assignIds);
  md.renderer.rules.heading_close = (tokens, index, options, _env, self) => {
    const id = tokens[index - 2]?.attrGet('id');
    const close = self.renderToken(tokens, index, options);
    if (typeof id !== 'string') {
      return close;
    }
    const anchor = `<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a>`;
    return `${anchor}${close}`;
  };
}
