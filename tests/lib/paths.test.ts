import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertInside,
  BUILD,
  DOCS,
  isSameOrInside,
  PUBLISH,
  ROOT,
  SITE_DEFAULT,
  SITE_SAMPLE,
  SRC,
  siteConfigFile,
} from '../../src/lib/paths.ts';

describe('project paths', () => {
  const dirs = { SRC, SITE_DEFAULT, SITE_SAMPLE, DOCS, BUILD, PUBLISH };

  it('ROOT is the project root (contains package.json)', () => {
    expect(path.isAbsolute(ROOT)).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'package.json'))).toBe(true);
  });

  it.each(Object.entries(dirs))('%s is an absolute direct child of ROOT', (_name, dir) => {
    expect(path.isAbsolute(dir)).toBe(true);
    expect(path.dirname(dir)).toBe(ROOT);
  });

  it('all directories are distinct', () => {
    expect(new Set(Object.values(dirs)).size).toBe(Object.keys(dirs).length);
  });

  it('BUILD and PUBLISH do not nest in either direction', () => {
    expect(() => assertInside(BUILD, PUBLISH)).toThrow(RangeError);
    expect(() => assertInside(PUBLISH, BUILD)).toThrow(RangeError);
  });
});

describe('assertInside', () => {
  const base = path.resolve('/srv/site/publish');

  it.each([
    ['plain child', 'index.html', path.join(base, 'index.html')],
    ['nested child', 'blog/post/index.html', path.join(base, 'blog/post/index.html')],
    ['base itself (empty)', '', base],
    ['base itself (dot)', '.', base],
    ['inner .. that stays inside', 'blog/../about.html', path.join(base, 'about.html')],
    ['redundant separators', 'blog//./x.md', path.join(base, 'blog/x.md')],
    ['absolute path inside base', path.join(base, 'a/b'), path.join(base, 'a/b')],
    ['name beginning with dots', '..hidden', path.join(base, '..hidden')],
    ['name ending with dots', 'x..', path.join(base, 'x..')],
  ])('accepts %s', (_desc, p, expected) => {
    expect(assertInside(base, p)).toBe(expected);
  });

  it('normalises a base given with a trailing separator', () => {
    expect(assertInside(`${base}${path.sep}`, 'a')).toBe(path.join(base, 'a'));
  });

  it.each([
    ['parent', '..'],
    ['parent with trailing slash', '../'],
    ['traversal to sibling', '../build/x'],
    ['deep traversal', 'a/b/../../../../etc/passwd'],
    ['absolute escape', '/etc/passwd'],
    ['sibling-prefix trick', '/srv/site/publish-evil/x'],
    ['sibling-prefix via traversal', '../publish-evil'],
  ])('rejects %s', (_desc, p) => {
    expect(() => assertInside(base, p)).toThrow(RangeError);
  });

  it('rejects NUL bytes', () => {
    expect(() => assertInside(base, 'index.html\0.png')).toThrow(/NUL/);
  });

  it('throws TypeError for a relative base', () => {
    expect(() => assertInside('publish', 'x')).toThrow(TypeError);
  });
});

describe('isSameOrInside', () => {
  it.each([
    ['/a/b', '/a/b', true],
    ['/a/b/c', '/a/b', true],
    ['/a/bc', '/a/b', false],
    ['/a', '/a/b', false],
    ['/x', '/a/b', false],
  ])('%s within %s: %s', (p, base, expected) => {
    expect(isSameOrInside(p, base)).toBe(expected);
  });
});

describe('siteConfigFile', () => {
  it('is site.yaml at the top of the site directory', () => {
    expect(siteConfigFile('/srv/my-site')).toBe(path.join('/srv/my-site', 'site.yaml'));
  });
});
