import { foldLetters } from '../shared/fold.ts';

/** Explicit slugs for "C++" and "C#", which generic slugging would both map to "c". */
const SPECIAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bc\+\+/g, 'cpp'],
  [/\bc#/g, 'csharp'],
];

/** Turns a label (category, tag) into a URL-safe lower-kebab slug; '' when nothing slug-worthy remains. */
export function slugify(label: string): string {
  let s = foldLetters(label);
  for (const [re, rep] of SPECIAL) {
    s = s.replace(re, rep);
  }
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Top-level names taken by generated output. */
export const RESERVED_ROOT_SLUGS: ReadonlySet<string> = new Set(['attributions', 'assets']);
