import type { Token } from 'markdown-it';
import { createShikiHighlighter } from './highlight/shiki.ts';
import { fenceMeta } from './markdown/fences.ts';
import type { LanguageName } from './markdown/languages.ts';
import { createMarkdown } from './markdown/markdown.ts';
import rebaseLinks, { rebaseHtml } from './markdown/rebase.ts';
import { renderToc } from './markdown/toc.ts';
import { analyzeTokens } from './text.ts';

export interface RenderContext {
  /** Root-relative URL of the article's own page; relative links resolve against it. */
  readonly baseUrl: string;
  /** Unique per article on a page; prefixes heading and footnote ids. */
  readonly docId: string;
  /** Article title; names the table of contents. */
  readonly title: string;
  /** Front-matter `toc`: force the table of contents on or off; absent = automatic. */
  readonly toc?: boolean | undefined;
}

export interface Rendered {
  /** Table of contents; '' when the article has none. */
  readonly toc: string;
  /** Article content without the table of contents. */
  readonly body: string;
  /** Plain text for search indexing. */
  readonly text: string;
  /** Problems found in the source, without a file prefix. */
  readonly warnings: readonly string[];
}

/** Turns the source of one content format into HTML, search text and warnings. */
export interface Renderer {
  readonly format: string;
  render(source: string, ctx: RenderContext): Promise<Rendered>;
}

const shiki = createShikiHighlighter();
const markdown = createMarkdown({ highlight: shiki.highlight }).use(rebaseLinks);

/** Highlightable languages of the code fences. */
function fenceLanguages(tokens: readonly Token[]): ReadonlySet<LanguageName> {
  const languages = tokens
    .filter((t) => t.type === 'fence')
    .map((t) => fenceMeta(t).language)
    .filter((l): l is LanguageName => l !== undefined);
  return new Set(languages);
}

/** The tokens of a Markdown document as the renderer parses it (`env` as in `RenderContext`). */
export function parseMarkdown(source: string, env: Readonly<Record<string, unknown>>): Token[] {
  return markdown.parse(source, env);
}

const inlineMarkdown = createMarkdown({ html: false }).use(rebaseLinks);

/** Inline Markdown as HTML, without block elements. Raw HTML is escaped; relative links resolve against `baseUrl`. */
export function renderInline(source: string, baseUrl: string): string {
  return inlineMarkdown.renderInline(source, { baseUrl });
}

const markdownRenderer: Renderer = {
  format: 'markdown',
  /** One parse feeds HTML, search text and warnings. Grammars load before the synchronous render. */
  async render(source, { baseUrl, docId, title, toc }) {
    const env = { baseUrl, docId };
    const tokens = parseMarkdown(source, env);
    const grammarProblems = await shiki.load(fenceLanguages(tokens));
    const body = markdown.renderer.render(tokens, markdown.options, env);
    const { text, warnings } = analyzeTokens(tokens);
    return {
      toc: renderToc(tokens, { toc, title }),
      body,
      text,
      warnings: [...warnings, ...grammarProblems],
    };
  },
};

/** A hand-written HTML fragment: its URLs resolve against the page; nothing else changes. */
const htmlRenderer: Renderer = {
  format: 'html',
  async render(source, { baseUrl }) {
    const body = rebaseHtml(source, { baseUrl, idPrefix: '', headingIds: new Set() });
    return { toc: '', body, text: '', warnings: [] };
  },
};

export const RENDERERS: ReadonlyMap<string, Renderer> = new Map(
  [markdownRenderer, htmlRenderer].map((r) => [r.format, r]),
);

/** @throws if no renderer handles `format` */
export function getRenderer(format: string): Renderer {
  const renderer = RENDERERS.get(format);
  if (!renderer) {
    throw new Error(`no renderer for format "${format}"`);
  }
  return renderer;
}
