import { foldTerm } from '../../shared/search-config.ts';

/** A run of text, and whether it is one of the matched terms. */
export interface Segment {
  readonly text: string;
  readonly match: boolean;
}

/** Runs between MiniSearch's default separators (whitespace and punctuation). */
const WORD = /[^\n\r\p{Z}\p{P}]+/gu;

/** Splits `text` into plain and matched segments. Words match `terms` after the index's folding; the segments always join back to `text`. */
export function splitMatches(text: string, terms: readonly string[]): Segment[] {
  const wanted = new Set(terms.map(foldTerm).filter((t) => t !== ''));
  const segments: Segment[] = [];
  let end = 0;
  for (const { 0: word, index } of text.matchAll(WORD)) {
    if (wanted.has(foldTerm(word))) {
      if (index > end) {
        segments.push({ text: text.slice(end, index), match: false });
      }
      segments.push({ text: word, match: true });
      end = index + word.length;
    }
  }
  return end < text.length ? [...segments, { text: text.slice(end), match: false }] : segments;
}

/** `text` as DOM nodes with matched words in `<mark>`; text is never parsed as markup. */
export function highlight(text: string, terms: readonly string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const segment of splitMatches(text, terms)) {
    if (segment.match) {
      const mark = document.createElement('mark');
      mark.textContent = segment.text;
      fragment.append(mark);
    } else {
      fragment.append(segment.text);
    }
  }
  return fragment;
}
