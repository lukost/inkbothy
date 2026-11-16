import { Parser } from 'htmlparser2';
import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { required } from '../../shared/guards.ts';
import { idPrefix } from './heading-ids.ts';
import { rebaseAttribute, rebaseUrl } from './rebase-url.ts';

/** Where a document lives and which ids its headings were given. */
export interface RebaseContext {
  /** Root-relative URL of the document's own page. */
  readonly baseUrl: string;
  /** Prefix of the ids generated for its headings (`<docId>--`, or ''). */
  readonly idPrefix: string;
  /** Ids generated for its headings. */
  readonly headingIds: ReadonlySet<string>;
}

interface Splice {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/**
 * An author's `#fragment` names a heading by its slug; the heading's id carries
 * the document prefix. Fragments that match no generated id stay as written.
 */
function anchor(value: string, { idPrefix, headingIds }: RebaseContext): string | undefined {
  const id = `${idPrefix}${value.slice(1)}`;
  return value.startsWith('#') && headingIds.has(id) ? `#${id}` : undefined;
}

function rebaseHref(value: string, context: RebaseContext): string {
  return anchor(value, context) ?? rebaseUrl(value, context.baseUrl);
}

function rebaseValue(name: string, value: string, context: RebaseContext): string {
  return name === 'href'
    ? (anchor(value, context) ?? rebaseAttribute(name, value, context.baseUrl))
    : rebaseAttribute(name, value, context.baseUrl);
}

/** `value` as an attribute value, in the quote character of the source (double quotes if none). */
function quoted(value: string, quote: string | null | undefined): string {
  const mark = quote === "'" ? "'" : '"';
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll(mark, mark === '"' ? '&quot;' : '&#39;');
  return `${mark}${escaped}${mark}`;
}

/**
 * Rebase the URL attributes of the tags in an HTML fragment against the document.
 * Only changed values are replaced; everything else (quoting, entities, spacing,
 * comments, malformed markup) stays byte-identical.
 */
export function rebaseHtml(source: string, context: RebaseContext): string {
  const splices: Splice[] = [];
  const parser: Parser = new Parser({
    onattribute(name, value, quote) {
      const rebased = rebaseValue(name, value, context);
      if (rebased === value) {
        return;
      }
      // The attribute spans its name, optional blanks around `=`, and the value with its quotes.
      const [blanks] = required(
        /^\s*=\s*/.exec(source.slice(parser.startIndex + name.length, parser.endIndex)),
        'attribute value',
      );
      splices.push({
        from: parser.startIndex + name.length + blanks.length,
        to: parser.endIndex,
        text: quoted(rebased, quote),
      });
    },
  });
  parser.end(source);
  const pieces: string[] = [];
  let end = 0;
  for (const { from, to, text } of splices) {
    pieces.push(source.slice(end, from), text);
    end = to;
  }
  pieces.push(source.slice(end));
  return pieces.join('');
}

function rebaseToken(token: Token, context: RebaseContext): void {
  switch (token.type) {
    case 'link_open': {
      const href = token.attrGet('href');
      if (typeof href === 'string') {
        token.attrSet('href', rebaseHref(href, context));
      }
      break;
    }
    case 'image': {
      const src = token.attrGet('src');
      if (typeof src === 'string') {
        token.attrSet('src', rebaseUrl(src, context.baseUrl));
      }
      break;
    }
    case 'html_block':
    case 'html_inline':
      token.content = rebaseHtml(token.content, context);
      break;
  }
}

function rebaseDocument(state: StateCore): void {
  const { baseUrl } = state.env;
  if (typeof baseUrl !== 'string') {
    return;
  }
  const headingIds = new Set(
    state.tokens.flatMap((t) => {
      const id = t.type === 'heading_open' ? t.attrGet('id') : null;
      return typeof id === 'string' ? [id] : [];
    }),
  );
  const context: RebaseContext = { baseUrl, idPrefix: idPrefix(state.env), headingIds };
  for (const token of state.tokens) {
    rebaseToken(token, context);
    for (const child of token.children ?? []) {
      rebaseToken(child, context);
    }
  }
}

/**
 * Document-relative links, images and raw HTML URLs resolve against
 * `env.baseUrl` (the URL of the document's own page); without it nothing changes.
 * An author's `#slug` becomes the id of the heading it names.
 */
export default function rebaseLinks(md: MarkdownIt): void {
  md.core.ruler.push('rebase_links', rebaseDocument);
}
