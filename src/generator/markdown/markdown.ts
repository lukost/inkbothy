import MarkdownIt, { type MarkdownIt as Markdown } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { escapeHtml } from '../../lib/escape.ts';
import alerts from './alerts.ts';
import autolinks from './autolinks.ts';
import { formatLines } from './fence-info.ts';
import fences, { fenceMeta } from './fences.ts';
import headingIds from './heading-ids.ts';
import type { LanguageName } from './languages.ts';
import taskLists from './task-lists.ts';

/** Number of lines in fence content (a trailing newline does not start a line). */
function lineCount(code: string): number {
  return code.replace(/\n$/, '').split('\n').length;
}

const attr = (name: string, value: string | false): string =>
  value === false ? '' : ` ${name}="${escapeHtml(value)}"`;

/** Highlighted `<pre>` markup for `code` in `lang`, with `lines` marked; undefined leaves the block plain. */
export type CodeHighlighter = (
  code: string,
  lang: LanguageName,
  lines: ReadonlySet<number>,
) => string | undefined;

export interface MarkdownOptions {
  readonly highlight?: CodeHighlighter;
  /** Pass raw HTML through (default); off, it is escaped. */
  readonly html?: boolean;
}

/** Code fences as `<figure>`s with a header bar; `mermaid` fences as diagram sources. */
function fenceRules(md: Markdown, highlighter: CodeHighlighter | undefined): void {
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    if (!token) {
      return '';
    }
    const code = escapeHtml(token.content);
    const { info, lang, language: resolved } = fenceMeta(token);
    if (lang === 'mermaid') {
      return `<pre class="mermaid-source"${attr('data-title', info.title ?? false)}>${code}</pre>\n`;
    }
    const lines = lineCount(token.content);
    const highlight = formatLines([...info.highlight].filter((n) => n <= lines));
    const { lineNumbers } = info;
    const figure = [
      ` class="code-block${lineNumbers ? ' line-numbers' : ''}"`,
      attr('data-lang', lang || false),
      attr('data-highlight', highlight || false),
      attr('style', lineNumbers ? `--line-start:${lineNumbers.start}` : false),
    ].join('');
    const title = info.title ? `<span class="code-title">${escapeHtml(info.title)}</span>` : '';
    const language = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    // The bar is always there; the copy button joins it, and it is empty for an untagged, untitled block.
    const caption = `<figcaption>${title}${title && language ? ' ' : ''}${language}</figcaption>\n`;
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    const block =
      (resolved && highlighter?.(token.content.replace(/\n$/, ''), resolved, info.highlight)) ||
      `<pre><code${cls}>${code}</code></pre>`;
    return `<figure${figure}>\n${caption}${block}\n</figure>\n`;
  };
}

/** Tables scroll inside their own box, so a wide one never widens the page; the box is focusable for keyboard scrolling. */
function tableRules(md: Markdown): void {
  md.renderer.rules.table_open = (tokens, index, options, _env, self) =>
    `<div class="table-wrap" role="region" aria-label="Table" tabindex="0">${self.renderToken(tokens, index, options)}`;
  md.renderer.rules.table_close = (tokens, index, options, _env, self) =>
    `${self.renderToken(tokens, index, options)}</div>\n`;
}

/** The site's Markdown dialect: raw HTML is allowed (content is trusted); footnote and heading ids take `env.docId` as prefix; fences in a `highlight` language are rendered by it. */
export function createMarkdown({ highlight, html = true }: MarkdownOptions = {}): Markdown {
  const md = new MarkdownIt({ html, linkify: true, typographer: false })
    .use(footnote)
    .use(fences)
    .use(taskLists)
    .use(headingIds)
    .use(alerts)
    .use(autolinks);
  fenceRules(md, highlight);
  tableRules(md);
  return md;
}
