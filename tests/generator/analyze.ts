import { parseMarkdown } from '../../src/generator/render.ts';
import { analyzeTokens } from '../../src/generator/text.ts';

/** Text and warnings of one Markdown source, from the tokens the renderer itself parses. */
export const analyzeMarkdown = (source: string) => analyzeTokens(parseMarkdown(source, {}));

export const markdownToText = (source: string): string => analyzeMarkdown(source).text;
