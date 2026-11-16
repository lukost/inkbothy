import type { Token } from 'markdown-it';
import { alertMarker, isAlertTitle, isAlertType } from './markdown/alerts.ts';
import { fenceMeta } from './markdown/fences.ts';
import { isKnownFenceLanguage } from './markdown/languages.ts';

const INLINE_TEXT: ReadonlySet<string> = new Set(['text', 'code_inline', 'image']);
const INLINE_BREAK: ReadonlySet<string> = new Set(['softbreak', 'hardbreak']);

export interface Analysis {
  /** Plain text for search indexing. */
  readonly text: string;
  /** Code-block problems, without a file prefix. */
  readonly warnings: readonly string[];
}

function fenceWarnings(token: Token): string[] {
  const { info: parsed, language } = fenceMeta(token);
  const label = `code block "${token.info.trim()}"`;
  const decorated = parsed.lineNumbers !== undefined || parsed.highlight.size > 0;
  return [
    ...(parsed.lang && !isKnownFenceLanguage(parsed.lang)
      ? [`code block language "${parsed.lang}" is not highlighted`]
      : []),
    ...(decorated && !language
      ? [`${label}: line numbers and highlighting need a highlighted language; ignored`]
      : []),
    ...parsed.problems.map((problem) => `${label}: ${problem}`),
  ];
}

/** Plain text for search indexing and the problems in the code fences and alerts of a parsed document; fenced and indented code and raw HTML are dropped, inline code and image alt text kept. */
export function analyzeTokens(tokens: readonly Token[]): Analysis {
  const parts: string[] = [];
  const warnings: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'fence') {
      warnings.push(...fenceWarnings(token));
    }
    const marker = token.type === 'blockquote_open' ? alertMarker(tokens, index) : undefined;
    if (marker !== undefined && !isAlertType(marker)) {
      warnings.push(`unknown alert type "[!${marker}]"; rendered as a blockquote`);
    }
    if (token.type !== 'inline' || isAlertTitle(tokens, index)) {
      continue;
    }
    for (const child of token.children ?? []) {
      if (INLINE_TEXT.has(child.type)) {
        parts.push(child.content);
      } else if (INLINE_BREAK.has(child.type)) {
        parts.push(' ');
      }
    }
    parts.push(' ');
  }
  return { text: parts.join('').replace(/\s+/g, ' ').trim(), warnings };
}
