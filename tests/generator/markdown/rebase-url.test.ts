import { describe, expect, it } from 'vitest';
import {
  rebaseAttribute,
  rebaseSrcset,
  rebaseUrl,
} from '../../../src/generator/markdown/rebase-url.ts';

describe('rebaseUrl', () => {
  it.each([
    ['img.png', '/blog/post/img.png'],
    ['./img.png', '/blog/post/img.png'],
    ['../other/', '/blog/other/'],
    ['../../resume/#top', '/resume/#top'],
    ['sub/dir/f.png?v=2', '/blog/post/sub/dir/f.png?v=2'],
    ['?q=1', '/blog/post/?q=1'],
    ['/abs/x.png', '/abs/x.png'],
    ['//cdn.example/x.png', '//cdn.example/x.png'],
    ['https://example.com/x', 'https://example.com/x'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    ['tel:+1', 'tel:+1'],
    ['#fn-post-1', '#fn-post-1'],
    ['\\\\host\\share', '\\\\host\\share'],
    ['\\path', '\\path'],
    ['', ''],
  ])('%s -> %s', (value, expected) => {
    expect(rebaseUrl(value, '/blog/post/')).toBe(expected);
  });

  it('cannot climb above the site root', () => {
    expect(rebaseUrl('../../../../x.png', '/blog/post/')).toBe('/x.png');
  });
});

describe('rebaseSrcset', () => {
  const base = '/blog/post/';
  it.each([
    ['a.png', '/blog/post/a.png'],
    ['a.png 1x, b.png 2x', '/blog/post/a.png 1x, /blog/post/b.png 2x'],
    ['a.png 100w,b.png 200w', '/blog/post/a.png 100w,/blog/post/b.png 200w'],
    ['a.png, b.png 2x', '/blog/post/a.png, /blog/post/b.png 2x'],
    ['  a.png   1.5x ,\n ../b.png 2x ', '  /blog/post/a.png   1.5x ,\n /blog/b.png 2x '],
    ['https://e.com/a.png 1x, /r.png 2x', 'https://e.com/a.png 1x, /r.png 2x'],
    [
      'data:image/png;base64,AAAA 1x, b.png 2x',
      'data:image/png;base64,AAAA 1x, /blog/post/b.png 2x',
    ],
    ['a.png 1x,,b.png', '/blog/post/a.png 1x,,/blog/post/b.png'],
    ['a.png 1x, , b.png 2x', '/blog/post/a.png 1x, , /blog/post/b.png 2x'],
    ['a.png,,b.png', '/blog/post/a.png,,b.png'],
    [',a.png', ',/blog/post/a.png'],
    [',,', ',,'],
    ['a.png 1x,', '/blog/post/a.png 1x,'],
    ['', ''],
  ])('%j', (value, expected) => {
    expect(rebaseSrcset(value, base)).toBe(expected);
  });
});

describe('rebaseAttribute', () => {
  it.each(['href', 'xlink:href', 'src', 'poster', 'data', 'cite'])(
    'rebases %s as one URL',
    (name) => {
      expect(rebaseAttribute(name, 'x/y.png', '/a/')).toBe('/a/x/y.png');
    },
  );

  it('rebases srcset as a list', () => {
    expect(rebaseAttribute('srcset', 'a.png 1x, b.png 2x', '/a/')).toBe('/a/a.png 1x, /a/b.png 2x');
  });

  it.each(['alt', 'style', 'class', 'title', 'action', 'HREF'])('leaves %s alone', (name) => {
    expect(rebaseAttribute(name, 'x/y.png', '/a/')).toBe('x/y.png');
  });
});
