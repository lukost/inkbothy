import { describe, expect, it } from 'vitest';
import { cssString, escapeHtml } from '../../src/lib/escape.ts';
import { absoluteUrl, safeHttpUrl } from '../../src/lib/url.ts';

describe('safeHttpUrl', () => {
  it.each([
    ['https://e.com/x', 'https://e.com/x'],
    ['http://e.com', 'http://e.com/'],
    ['javascript:alert(1)', null],
    ['file:///etc/passwd', null],
    ['not a url', null],
    [undefined, null],
    [['https://x.com'], null],
    [{ toString: () => 'https://x.com' }, null],
    [42, null],
  ])('%j -> %j', (v, expected) => {
    expect(safeHttpUrl(v)).toBe(expected);
  });
});

describe('escapeHtml', () => {
  it('escapes all five significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('treats entities as text (no passthrough)', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('stringifies non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('absoluteUrl', () => {
  it.each([
    ['https://example.com', '/blog/x/', 'https://example.com/blog/x/'],
    ['https://example.com/', '/', 'https://example.com/'],
    ['https://example.com', '/a b/', 'https://example.com/a%20b/'],
  ])('%s + %s -> %s', (base, url, expected) => {
    expect(absoluteUrl(base, url)).toBe(expected);
  });
});

describe('cssString', () => {
  it.each([
    ['plain', '"plain"'],
    ['', '""'],
    ['say "hi"', '"say \\22 hi\\22 "'],
    ['a\\b', '"a\\5c b"'],
    ['two\nlines\r\n', '"two\\a lines\\d \\a "'],
    ['tab\there', '"tab\\9 here"'],
    ['nul\u0000del\u007f', '"nul\\0 del\\7f "'],
    ['</style><script>', '"\\3c /style>\\3c script>"'],
    ['Zażółć – 日本 🙂', '"Zażółć – 日本 🙂"'],
    ["it's & <3", '"it\'s & \\3c 3"'],
  ])('%j -> %s', (input, expected) => {
    expect(cssString(input)).toBe(expected);
  });

  it('passes a lone surrogate through unchanged, as it has no escape of its own', () => {
    expect(cssString('a\ud800b')).toBe('"a\ud800b"');
    expect(cssString('\udc00')).toBe('"\udc00"');
  });

  it('passes U+2028 and U+2029 through: CSS does not treat them as newlines', () => {
    expect(cssString('a\u2028b\u2029c')).toBe('"a\u2028b\u2029c"');
  });

  it('never leaves a raw quote, backslash, `<` or control character inside the string', () => {
    const all = String.fromCodePoint(...Array.from({ length: 0xa0 }, (_, i) => i));
    const inner = cssString(all).slice(1, -1);
    expect(inner).not.toMatch(/["<\p{Cc}]/u);
    expect(inner.replace(/\\[0-9a-f]+ /g, '')).not.toContain('\\');
  });
});
