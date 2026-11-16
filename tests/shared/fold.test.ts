import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/content/slug.ts';
import { foldLetters } from '../../src/shared/fold.ts';
import { foldTerm } from '../../src/shared/search-config.ts';

const NON_DECOMPOSING: readonly (readonly [string, string, string])[] = [
  ['ß', 'ẞ', 'ss'],
  ['ø', 'Ø', 'o'],
  ['đ', 'Đ', 'd'],
  ['ð', 'Ð', 'd'],
  ['ı', 'I', 'i'],
  ['æ', 'Æ', 'ae'],
  ['œ', 'Œ', 'oe'],
  ['þ', 'Þ', 'th'],
  ['ł', 'Ł', 'l'],
];

describe('foldLetters', () => {
  it.each(NON_DECOMPOSING)('maps %s and %s to %s', (lower, upper, ascii) => {
    expect(foldLetters(lower)).toBe(ascii);
    expect(foldLetters(upper)).toBe(ascii);
    expect(foldLetters(`a${lower}b`)).toBe(`a${ascii}b`);
  });

  it('lower-cases and strips combining marks, composed or decomposed', () => {
    expect(foldLetters('ŻÓŁW Crème BRÛLÉE')).toBe('zolw creme brulee');
    expect(foldLetters('zółw')).toBe('zolw');
  });

  it('leaves ASCII, digits and punctuation alone, apart from case', () => {
    expect(foldLetters('C++ 20!')).toBe('c++ 20!');
    expect(foldLetters('')).toBe('');
  });
});

describe('one folding for slugs and search terms', () => {
  it.each(NON_DECOMPOSING)('treats %s the same in both', (lower, upper, ascii) => {
    expect(foldTerm(upper)).toBe(ascii);
    expect(slugify(`x ${upper}`)).toBe(`x-${ascii}`);
    expect(slugify(`x ${lower}`)).toBe(`x-${ascii}`);
  });

  it('foldTerm is foldLetters', () => {
    expect(foldTerm('Straße ŁÓDŹ')).toBe(foldLetters('Straße ŁÓDŹ'));
  });
});
