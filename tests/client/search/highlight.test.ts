// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { highlight, splitMatches } from '../../../src/client/search/highlight.ts';
import { $$, texts } from '../../helpers.ts';

const matched = (text: string, terms: string[]) =>
  splitMatches(text, terms)
    .filter((s) => s.match)
    .map((s) => s.text);

describe('splitMatches', () => {
  it('splits at matched words and keeps the rest', () => {
    expect(splitMatches('The Linux kernel, today', ['kernel'])).toEqual([
      { text: 'The Linux ', match: false },
      { text: 'kernel', match: true },
      { text: ', today', match: false },
    ]);
  });

  it('matches regardless of case, in the text and in the term', () => {
    expect(matched('KERNEL Kernel kernel', ['kernel'])).toEqual(['KERNEL', 'Kernel', 'kernel']);
    expect(matched('kernel', ['KERNEL'])).toEqual(['kernel']);
  });

  it('matches regardless of diacritics, the way the index folds them', () => {
    expect(matched('Żółw płynie, zazółć gęślą', ['zolw', 'zazolc', 'gesla'])).toEqual([
      'Żółw',
      'zazółć',
      'gęślą',
    ]);
    expect(matched('zolw ZOLW', ['żółw'])).toEqual(['zolw', 'ZOLW']);
    expect(matched('zółw', ['zolw'])).toEqual(['zółw']);
  });

  it('slices by the original text even where folding changes its length', () => {
    expect(splitMatches('Straße und Ørsted', ['strasse', 'orsted'])).toEqual([
      { text: 'Straße', match: true },
      { text: ' und ', match: false },
      { text: 'Ørsted', match: true },
    ]);
    expect(matched('ÆTHER i STRASSE', ['aether', 'strasse'])).toEqual(['ÆTHER', 'STRASSE']);
  });

  it('marks adjacent terms separately, keeping what lies between', () => {
    expect(splitMatches('foo bar', ['foo', 'bar'])).toEqual([
      { text: 'foo', match: true },
      { text: ' ', match: false },
      { text: 'bar', match: true },
    ]);
    expect(matched('foo-bar/baz', ['foo', 'bar', 'baz'])).toEqual(['foo', 'bar', 'baz']);
  });

  it('marks a word once when several terms overlap it', () => {
    expect(matched('kernel', ['kern', 'kernel', 'kernel'])).toEqual(['kernel']);
    expect(matched('kernels', ['kernel'])).toEqual([]);
  });

  it('treats terms as plain text, not as patterns', () => {
    expect(matched('c++ (c) .* a.b', ['c++', '.*', 'a.b'])).toEqual(['c++']);
    expect(matched('c', ['c++'])).toEqual([]);
  });

  it('matches nothing for empty terms or an empty list', () => {
    expect(splitMatches('some text', [])).toEqual([{ text: 'some text', match: false }]);
    expect(splitMatches('some text', [''])).toEqual([{ text: 'some text', match: false }]);
    expect(splitMatches('', ['x'])).toEqual([]);
    expect(splitMatches('', [])).toEqual([]);
  });

  it('keeps the text intact however it is split', () => {
    for (const [text, terms] of [
      ['  leading and trailing  ', ['and']],
      ['Żółć, żółć; ŻÓŁĆ!', ['zolc']],
      ['a b c', ['a', 'c']],
      ['no match here', ['zzz']],
      ['tail match', ['match']],
    ] as const) {
      expect(
        splitMatches(text, terms)
          .map((s) => s.text)
          .join(''),
        text,
      ).toBe(text);
    }
  });

  it('never yields an empty segment', () => {
    for (const s of splitMatches('kernel kernel', ['kernel'])) {
      expect(s.text).not.toBe('');
    }
  });
});

describe('highlight', () => {
  const render = (text: string, terms: string[]) => {
    const box = document.createElement('div');
    box.append(highlight(text, terms));
    return box;
  };

  it('wraps matched words in <mark> and leaves the rest as text', () => {
    const box = render('Linux kernel and kernel', ['kernel']);
    expect(texts(box, 'mark')).toEqual(['kernel', 'kernel']);
    expect(box.textContent).toBe('Linux kernel and kernel');
    expect(box.innerHTML).toBe('Linux <mark>kernel</mark> and <mark>kernel</mark>');
  });

  it('shows markup in the text as text, whether or not it matches', () => {
    const hostile = '<img src=x onerror=alert(1)> kernel <b>bold</b>';
    const box = render(hostile, ['kernel', '<img']);
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('b')).toBeNull();
    expect(box.textContent).toBe(hostile);
    expect($$(box, 'mark').map((m) => m.textContent)).toEqual(['<img', 'kernel']);
  });

  it('yields an empty fragment for empty text', () => {
    expect(render('', ['x']).childNodes).toHaveLength(0);
  });

  it('yields a single text node without terms', () => {
    const box = render('plain', []);
    expect(box.childNodes).toHaveLength(1);
    expect(box.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });
});
