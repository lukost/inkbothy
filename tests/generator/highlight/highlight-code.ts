import { createShikiHighlighter } from '../../../src/generator/highlight/shiki.ts';
import type { LanguageName } from '../../../src/generator/markdown/languages.ts';
import { required } from '../../../src/shared/guards.ts';

const shiki = createShikiHighlighter();

/** Shiki markup for `code`, loading the grammar first. */
export async function highlightCode(
  code: string,
  lang: LanguageName,
  lines: ReadonlySet<number> = new Set(),
): Promise<string> {
  await shiki.load([lang]);
  return required(shiki.highlight(code, lang, lines), `highlighted ${lang}`);
}
