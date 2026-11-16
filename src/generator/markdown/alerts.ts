import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { idPrefix } from './heading-ids.ts';

const TITLES: ReadonlyMap<string, string> = new Map([
  ['note', 'Note'],
  ['tip', 'Tip'],
  ['important', 'Important'],
  ['warning', 'Warning'],
  ['caution', 'Caution'],
]);
const MARKER = /^\[!(\w+)\]$/;
const TITLE_CLASS = 'alert-title';

/** The `[!NAME]` marker (NAME as written) if the blockquote opening at `index` starts with one on its own line. */
export function alertMarker(tokens: readonly Token[], index: number): string | undefined {
  const inline = tokens[index + 2];
  if (tokens[index + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') {
    return undefined;
  }
  const [marker, next] = inline.children ?? [];
  const name = marker?.type === 'text' ? MARKER.exec(marker.content)?.[1] : undefined;
  const lineEnds = next === undefined || next.type === 'softbreak' || next.type === 'hardbreak';
  return lineEnds ? name : undefined;
}

/** The alert's title as an ordinary paragraph, so the renderer escapes its id. */
function titleTokens(state: StateCore, level: number, id: string, title: string): Token[] {
  const open = new state.Token('paragraph_open', 'p', 1);
  open.attrSet('class', TITLE_CLASS);
  open.attrSet('id', id);
  const inline = new state.Token('inline', '', 0);
  const text = new state.Token('text', '', 0);
  text.content = title;
  inline.content = title;
  inline.children = [text];
  const close = new state.Token('paragraph_close', 'p', -1);
  for (const [token, depth] of [
    [open, level],
    [inline, level + 1],
    [close, level],
  ] as const) {
    token.block = true;
    token.level = depth;
  }
  return [open, inline, close];
}

/** Whether the `inline` token at `index` is the title of an alert. */
export function isAlertTitle(tokens: readonly Token[], index: number): boolean {
  return tokens[index - 1]?.attrGet('class') === TITLE_CLASS;
}

function convert(
  state: StateCore,
  open: Token,
  index: number,
  { type, title, n }: { type: string; title: string; n: number },
): void {
  const { tokens } = state;
  const close = tokens.findIndex(
    (t, i) => i > index && t.type === 'blockquote_close' && t.level === open.level,
  );
  const titleId = `${idPrefix(state.env)}alert--${n}`;
  open.tag = 'div';
  open.attrSet('class', `alert alert-${type}`);
  open.attrSet('role', 'note');
  open.attrSet('aria-labelledby', titleId);
  const closing = tokens[close];
  if (closing) {
    closing.tag = 'div';
  }
  const children = tokens[index + 2]?.children ?? [];
  children.splice(0, children[1] ? 2 : 1);
  if (children.length === 0) {
    tokens.splice(index + 1, 3);
  }
  tokens.splice(index + 1, 0, ...titleTokens(state, open.level + 1, titleId, title));
}

function markAlerts(state: StateCore): void {
  let count = 0;
  for (let index = 0; index < state.tokens.length; index++) {
    const token = state.tokens[index];
    if (token?.type !== 'blockquote_open') {
      continue;
    }
    const type = alertMarker(state.tokens, index)?.toLowerCase();
    const title = type === undefined ? undefined : TITLES.get(type);
    if (type !== undefined && title !== undefined) {
      convert(state, token, index, { type, title, n: ++count });
    }
  }
}

/** Whether `name` is an alert type GitHub (and this site) knows. */
export function isAlertType(name: string): boolean {
  return TITLES.has(name.toLowerCase());
}

/** GitHub alerts: `> [!NOTE]` … (note, tip, important, warning, caution). */
export default function alerts(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'alerts', markAlerts);
}
