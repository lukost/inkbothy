import { describe, expect, it } from 'vitest';
import { formatLines, parseFenceInfo } from '../../../src/generator/markdown/fence-info.ts';

const parsed = (info: string) => {
  const { highlight, ...rest } = parseFenceInfo(info);
  return { ...rest, highlight: [...highlight].sort((a, b) => a - b) };
};

describe('parseFenceInfo', () => {
  it('parses every option together', () => {
    expect(parsed('c title="dma.c" {3,5-7} showLineNumbers=42')).toEqual({
      lang: 'c',
      title: 'dma.c',
      highlight: [3, 5, 6, 7],
      lineNumbers: { start: 42 },
      problems: [],
    });
  });

  it.each([
    ['', { lang: '' }],
    ['   ', { lang: '' }],
    ['rust', { lang: 'rust' }],
    ['c++', { lang: 'c++' }],
    ['c{3}', { lang: 'c', highlight: [3] }],
    ['{2}', { lang: '', highlight: [2] }],
    ['c title=x', { lang: 'c', title: 'x' }],
    ['c title="two words"', { lang: 'c', title: 'two words' }],
    ['c title="a=b {1}"', { lang: 'c', title: 'a=b {1}' }],
    ['c title="a" {1}', { lang: 'c', title: 'a', highlight: [1] }],
    ['c title="a" title="b"', { lang: 'c', title: 'b' }],
    ['showLineNumbers', { lang: '', lineNumbers: { start: 1 } }],
    ['c showLineNumbers', { lang: 'c', lineNumbers: { start: 1 } }],
    ['c showLineNumbers=7', { lang: 'c', lineNumbers: { start: 7 } }],
    ['c {1,3} {5-6}', { lang: 'c', highlight: [1, 3, 5, 6] }],
    ['c {2-2}', { lang: 'c', highlight: [2] }],
    ['c { 2 , 4 - 5 }', { lang: 'c', highlight: [2, 4, 5] }],
    ['c {1,1,1}', { lang: 'c', highlight: [1] }],
  ])('%j', (info, expected) => {
    expect(parsed(info)).toMatchObject({ problems: [], ...expected });
  });

  it.each([
    ['{5-3}', 'invalid line range "5-3"'],
    ['{a}', 'invalid line range "a"'],
    ['{}', 'invalid line range ""'],
    ['{3,}', 'invalid line range ""'],
    ['{0}', 'invalid line range "0"'],
    ['{1-2-3}', 'invalid line range "1-2-3"'],
    ['{-3}', 'invalid line range "-3"'],
    ['{1-999999}', 'invalid line range "1-999999"'],
    ['{1.5}', 'invalid line range "1.5"'],
    ['c {1', 'unterminated line list "{1"'],
    ['c title="abc', 'unterminated quote in "title"'],
    ['c foo=1', 'unknown option "foo"'],
    ['c foo', 'unknown option "foo"'],
    ['c extra', 'unknown option "extra"'],
    ['=x', 'unknown option "=x"'],
    ['"quoted"', 'unknown option "\\"quoted\\""'],
    ['c title=""', 'empty title'],
    ['c title=', 'empty title'],
    ['c title=x{3}', 'value of "title" swallowed a line list; quote it: "x{3}"'],
    ['c title={1}x', 'value of "title" swallowed a line list; quote it: "{1}x"'],
    ['c showLineNumbers=0', 'invalid showLineNumbers value "0"'],
    ['c showLineNumbers=abc', 'invalid showLineNumbers value "abc"'],
    ['c showLineNumbers=-4', 'invalid showLineNumbers value "-4"'],
    ['c showLineNumbers=100001', 'invalid showLineNumbers value "100001"'],
  ])('reports %j', (info, problem) => {
    expect(parseFenceInfo(info).problems).toEqual([problem]);
  });

  it('ignores malformed parts but keeps the valid ones', () => {
    const r = parsed('c {5-3,2} title="ok" bogus=1 showLineNumbers=x');
    expect(r).toMatchObject({ lang: 'c', title: 'ok', highlight: [2] });
    expect(r.lineNumbers).toBeUndefined();
    expect(r.problems).toEqual([
      'invalid line range "5-3"',
      'unknown option "bogus"',
      'invalid showLineNumbers value "x"',
    ]);
  });

  it('stops at an unterminated quote and keeps what came before', () => {
    expect(parsed('c {1} title="oops {2}')).toMatchObject({
      lang: 'c',
      highlight: [1],
      problems: ['unterminated quote in "title"'],
    });
  });

  it('does not take a title for an empty value', () => {
    expect(parseFenceInfo('c title=""').title).toBeUndefined();
  });

  it('keeps a quoted title that contains a line list as is, without a problem', () => {
    expect(parseFenceInfo('c title="a {1} b"')).toMatchObject({ title: 'a {1} b', problems: [] });
  });

  it('terminates on pathological input', () => {
    for (const info of ['}', '}}}', '=', '==', '""', '{{{', 'a=b=c=d', '\u0000{', 'c  \t  {1}']) {
      expect(() => parseFenceInfo(info)).not.toThrow();
    }
  });
});

describe('formatLines', () => {
  it('serialises ascending', () => {
    expect(formatLines(new Set([5, 1, 3]))).toBe('1,3,5');
    expect(formatLines([])).toBe('');
    expect(formatLines([7, 2, 2])).toBe('2,2,7');
  });
});
