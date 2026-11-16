import type { Token } from 'markdown-it';
import { escapeHtml } from '../../lib/escape.ts';
import { headingText } from './heading-ids.ts';

/** Headings from this count on get a table of contents unless the article decides. */
const MIN_HEADINGS = 3;

export interface TocEntry {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

export interface TocOptions {
  /** Front-matter `toc`: force the table on or off; absent = automatic. */
  readonly toc?: boolean | undefined;
  /** Article title, appended to the navigation's name as hidden text. */
  readonly title?: string;
}

/** An entry with the h3 entries nested under it. */
interface Branch {
  readonly entry: TocEntry;
  readonly children: TocEntry[];
  /** Only an h2 takes h3s as children. */
  readonly nests: boolean;
}

/** Linkable h2/h3 headings (those with an id) that have some text. */
export function tocEntries(tokens: readonly Token[]): readonly TocEntry[] {
  return tokens.flatMap((token, index): TocEntry[] => {
    if (token.type !== 'heading_open') {
      return [];
    }
    const id = token.attrGet('id');
    const text = headingText(tokens[index + 1]).trim();
    const level = token.tag === 'h2' ? 2 : token.tag === 'h3' ? 3 : undefined;
    return typeof id === 'string' && text && level ? [{ id, text, level }] : [];
  });
}

/** Two levels: h3 entries nest under the preceding h2 (top level if there is none). */
function branches(entries: readonly TocEntry[]): readonly Branch[] {
  const tops: Branch[] = [];
  for (const entry of entries) {
    const last = tops.at(-1);
    if (entry.level === 3 && last?.nests) {
      last.children.push(entry);
    } else {
      tops.push({ entry, children: [], nests: entry.level === 2 });
    }
  }
  return tops;
}

const link = ({ id, text }: TocEntry): string =>
  `<a href="#${escapeHtml(id)}">${escapeHtml(text)}</a>`;

function item({ entry, children }: Branch): string {
  const sub = children.map((c) => `<li>${link(c)}</li>`).join('');
  return `<li>${link(entry)}${sub && `<ol>${sub}</ol>`}</li>`;
}

/**
 * Table of contents of the h2/h3 headings, or '' when there are none; its summary carries the
 * article title as hidden text. Readability only skips a list for an explicit `role="navigation"`
 * (it ignores the implicit role of `<nav>`), so the role is spelled out.
 */
export function renderToc(tokens: readonly Token[], { toc, title = '' }: TocOptions = {}): string {
  const entries = tocEntries(tokens);
  const first = entries[0];
  const wanted = toc === undefined ? entries.length >= MIN_HEADINGS : toc && entries.length > 0;
  if (!first || !wanted) {
    return '';
  }
  const labelId = escapeHtml(`${first.id}--toc`);
  const hidden = title && `<span class="visually-hidden">: ${escapeHtml(title)}</span>`;
  const list = branches(entries).map(item).join('');
  return `<nav class="toc" role="navigation" aria-labelledby="${labelId}"><details open><summary id="${labelId}">Contents${hidden}</summary><ol>${list}</ol></details></nav>\n`;
}
