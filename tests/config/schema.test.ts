import { describe, expect, it } from 'vitest';
import { type SectionConfig, siteSchema } from '../../src/config/schema.ts';
import { CARDS, LIST, STREAM } from '../helpers.ts';

/** The configuration as YAML parses it: a section's noun is a pair. */
const yamlSection = ({ noun, ...rest }: SectionConfig) => ({
  ...rest,
  noun: [noun.singular, noun.plural],
});

const valid = {
  title: 'Site',
  baseUrl: 'https://example.com',
  copyright: { holder: 'Holder', rights: 'All rights reserved.' },
  sections: {
    blog: yamlSection(STREAM),
    projects: yamlSection(CARDS),
    notes: yamlSection(LIST),
  },
  menu: ['about', 'blog'],
  home: [
    { latest: 'blog', count: 5 },
    { featured: 'projects', count: 3 },
  ],
};

const REMOVE = Symbol('remove');

/** A copy of the valid configuration with the value at the dotted `path` replaced (or removed). */
function patched(path: string, value: unknown): unknown {
  const config = structuredClone(valid);
  const keys = path.split('.');
  const parent = keys
    .slice(0, -1)
    .reduce<unknown>((node, key) => Reflect.get(Object(node), key), config);
  const key = keys.at(-1) ?? '';
  if (value === REMOVE) {
    Reflect.deleteProperty(Object(parent), key);
  } else {
    Reflect.set(Object(parent), key, value);
  }
  return config;
}

/** The issues of `config`, each as `path: message`. */
function problems(config: unknown): string[] {
  const result = siteSchema.safeParse(config);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

const withSection = (key: string) => ({
  ...valid,
  sections: { ...valid.sections, ...Object.fromEntries([[key, valid.sections.notes]]) },
});

describe('siteSchema', () => {
  it('accepts a complete configuration and returns nouns as pairs of forms', () => {
    const parsed = siteSchema.parse(valid);
    expect(parsed.sections.blog).toEqual(STREAM);
    expect(parsed.sections.projects).toEqual(CARDS);
    expect(parsed.sections.notes).toEqual(LIST);
    expect(parsed.home).toEqual([
      { kind: 'latest', section: 'blog', count: 5 },
      { kind: 'featured', section: 'projects', count: 3 },
    ]);
  });

  it('accepts a zero home count, a zero initial count and a batch of one', () => {
    const parsed = siteSchema.parse({
      ...valid,
      home: [{ latest: 'blog', count: 0 }],
      sections: {
        ...valid.sections,
        blog: { ...valid.sections.blog, stream: { initial: 0, batch: 1 } },
      },
    });
    expect(parsed.home).toEqual([{ kind: 'latest', section: 'blog', count: 0 }]);
    expect(parsed.sections.blog).toMatchObject({ stream: { initial: 0, batch: 1 } });
  });

  it('accepts the smallest site', () => {
    const minimal = { ...valid, sections: {}, menu: [], home: [] };
    expect(siteSchema.parse(minimal).sections).toEqual({});
  });

  it('trims texts', () => {
    expect(siteSchema.parse({ ...valid, title: '  Site  ' }).title).toBe('Site');
  });

  it.each([
    ['the site', 'extra', 1, ': Unrecognized key: "extra"'],
    ['copyright', 'copyright.year', 1, 'copyright: Unrecognized key: "year"'],
    ['a section', 'sections.blog.lable', 'x', 'sections.blog: Unrecognized key: "lable"'],
    [
      'the stream block',
      'sections.blog.stream.max',
      1,
      'sections.blog.stream: Unrecognized key: "max"',
    ],
  ])('rejects an unknown key in %s', (_, path, value, expected) => {
    expect(problems(patched(path, value)).join('\n')).toContain(expected);
  });

  it.each([
    ['a numeric title', 'title', 3, 'title: '],
    ['an empty title', 'title', '  ', 'title: must not be empty'],
    ['an empty holder', 'copyright.holder', '', 'copyright.holder: must not be empty'],
    ['missing rights', 'copyright.rights', REMOVE, 'copyright.rights: '],
    ['sections as a list', 'sections', [], 'sections: '],
    ['a section as text', 'sections.blog', 'x', 'sections.blog: '],
    ['an empty label', 'sections.blog.label', '', 'sections.blog.label: must not be empty'],
    ['a numeric label', 'sections.blog.label', 3, 'sections.blog.label: '],
    ['a noun of one form', 'sections.blog.noun', ['post'], 'sections.blog.noun: '],
    ['a noun of three forms', 'sections.blog.noun', ['a', 'b', 'c'], 'sections.blog.noun: '],
    [
      'an empty noun form',
      'sections.blog.noun',
      ['post', ''],
      'sections.blog.noun.1: must not be empty',
    ],
    ['a noun as text', 'sections.blog.noun', 'post', 'sections.blog.noun: '],
    ['taxonomies as text', 'sections.blog.taxonomies', 'tags', 'sections.blog.taxonomies: '],
    ['missing taxonomies', 'sections.blog.taxonomies', REMOVE, 'sections.blog.taxonomies: '],
    [
      'an unknown taxonomy',
      'sections.blog.taxonomies',
      ['tags', 'topics'],
      'sections.blog.taxonomies.1: expected one of categories|tags',
    ],
    [
      'a repeated taxonomy',
      'sections.blog.taxonomies',
      ['tags', 'tags'],
      'sections.blog.taxonomies: must not repeat a taxonomy',
    ],
    [
      'an unknown menu mode',
      'sections.blog.menu',
      'tree',
      'sections.blog.menu: expected one of taxonomy|items|none',
    ],
    [
      'a boolean menu mode',
      'sections.blog.menu',
      true,
      'sections.blog.menu: expected one of taxonomy|items|none',
    ],
    [
      'an unknown layout',
      'sections.blog.layout',
      'page',
      'sections.blog.layout: expected one of stream|cards|list',
    ],
    [
      'a missing layout',
      'sections.blog.layout',
      REMOVE,
      'sections.blog.layout: expected one of stream|cards|list',
    ],
    [
      'a numeric layout',
      'sections.blog.layout',
      1,
      'sections.blog.layout: expected one of stream|cards|list',
    ],
    ['a stream layout without stream', 'sections.blog.stream', REMOVE, 'sections.blog.stream: '],
    [
      'stream on cards',
      'sections.projects.stream',
      { initial: 1, batch: 1 },
      'sections.projects: Unrecognized key: "stream"',
    ],
    [
      'stream on a list',
      'sections.notes.stream',
      { initial: 1, batch: 1 },
      'sections.notes: Unrecognized key: "stream"',
    ],
    [
      'a negative initial count',
      'sections.blog.stream.initial',
      -1,
      'sections.blog.stream.initial: ',
    ],
    [
      'a fractional initial count',
      'sections.blog.stream.initial',
      1.5,
      'sections.blog.stream.initial: ',
    ],
    [
      'a textual initial count',
      'sections.blog.stream.initial',
      '3',
      'sections.blog.stream.initial: ',
    ],
    ['a zero batch', 'sections.blog.stream.batch', 0, 'sections.blog.stream.batch: '],
    [
      'an infinite batch',
      'sections.blog.stream.batch',
      Number.POSITIVE_INFINITY,
      'sections.blog.stream.batch: ',
    ],
    ['menu as text', 'menu', 'blog', 'menu: '],
    ['a non-text menu entry', 'menu', ['blog', 3], 'menu.1: '],
    ['a repeated menu entry', 'menu', ['blog', 'blog'], 'menu: must not repeat an entry'],
    ['home as a mapping', 'home', {}, 'home: '],
    ['a home block of nothing', 'home', [{}], 'home.0'],
    [
      'a home block of both kinds',
      'home',
      [{ latest: 'blog', featured: 'projects', count: 1 }],
      'home.0',
    ],
    ['a home block without a count', 'home', [{ latest: 'blog' }], 'home.0'],
    ['a negative home count', 'home', [{ latest: 'blog', count: -1 }], 'home.0'],
    ['a dangling latest', 'home.0.latest', 'news', 'home.0.latest: unknown section "news"'],
    ['a dangling featured', 'home.1.featured', 'news', 'home.1.featured: unknown section "news"'],
    [
      'an inherited name as a section',
      'home.0.latest',
      'constructor',
      'home.0.latest: unknown section "constructor"',
    ],
    [
      'menu: taxonomy without taxonomies',
      'sections.blog.taxonomies',
      [],
      'sections.blog.menu: taxonomy needs at least one entry in taxonomies',
    ],
  ])('rejects %s, naming the place', (_, path, value, expected) => {
    expect(problems(patched(path, value)).join('\n')).toContain(expected);
  });

  it.each([
    ['https://example.com/', 'a trailing slash'],
    ['https://example.com/blog', 'a path'],
    ['example.com', 'no scheme'],
    ['ftp://example.com', 'another scheme'],
    ['https://', 'no host'],
    ['https://Example.com', 'an uppercase host'],
    ['', 'nothing'],
    ['javascript:alert(1)', 'a script URL'],
  ])('rejects the base URL %j (%s)', (baseUrl) => {
    expect(problems({ ...valid, baseUrl })).toEqual([
      'baseUrl: must be an http(s) origin without a path, e.g. https://example.com',
    ]);
  });

  it.each(['https://example.com', 'http://localhost:8000', 'https://sub.example.org:8443'])(
    'accepts the base URL %s',
    (baseUrl) => {
      expect(siteSchema.parse({ ...valid, baseUrl }).baseUrl).toBe(baseUrl);
    },
  );

  it.each([
    ['My Blog', 'section key must be a clean slug (suggest "my-blog")'],
    ['Blog', 'section key must be a clean slug (suggest "blog")'],
    ['a/b', 'section key must be a clean slug (suggest "a-b")'],
    ['', 'section key must be a clean slug (suggest "")'],
    ['_notes', 'section key must be a clean slug (suggest "notes")'],
    ['2024', 'section key must contain a letter, or it loses its place in the order'],
    ['007', 'section key must contain a letter, or it loses its place in the order'],
    ['attributions', 'section key "attributions" is reserved'],
    ['assets', 'section key "assets" is reserved'],
  ])('rejects the section key %j', (key, message) => {
    expect(problems(withSection(key))).toEqual([`sections.${key}: ${message}`]);
  });

  it('accepts a section key that is the name of an Object property', () => {
    expect(problems(withSection('constructor'))).toEqual([]);
  });

  it('reports every structural problem at once', () => {
    const config = {
      ...valid,
      title: '',
      sections: {
        blog: { ...valid.sections.blog, menu: 'tree' },
        projects: { ...valid.sections.projects, noun: 'x' },
      },
    };
    expect(problems(config)).toHaveLength(3);
  });

  it('checks references only once the structure is sound', () => {
    const config = {
      ...valid,
      sections: { blog: { ...valid.sections.blog, menu: 'tree' } },
      home: [{ latest: 'news', count: 1 }],
    };
    expect(problems(config)).toEqual(['sections.blog.menu: expected one of taxonomy|items|none']);
  });
});

describe('icon settings', () => {
  it('are optional, and kept as written when valid', () => {
    expect(siteSchema.parse(valid).favicon).toBeUndefined();
    const parsed = siteSchema.parse({
      ...valid,
      favicon: 'icons/Site.SVG',
      appleTouchIcon: 'apple.png',
    });
    expect([parsed.favicon, parsed.appleTouchIcon]).toEqual(['icons/Site.SVG', 'apple.png']);
  });

  it.each(['icon.svg', 'a/b/icon.png', 'favicon.ico', 'x.ICO', 'dir.v2/icon.svg'])(
    'accepts the favicon %s',
    (favicon) => {
      expect(problems({ ...valid, favicon })).toEqual([]);
    },
  );

  const BAD = 'must be a relative path with / separators, below the site directory';
  const EMPTY = 'must not contain empty, "." or ".." segments';
  const UNDER = 'must not sit under a _-prefixed name, which is not published';
  const EXT = 'must be a .svg | .png | .ico file';

  it.each([
    ['icon.gif', EXT],
    ['icon', EXT],
    ['icon.svg.txt', EXT],
    ['/icon.svg', BAD],
    ['a\\icon.svg', BAD],
    ['../icon.svg', EMPTY],
    ['a/../../icon.svg', EMPTY],
    ['a//icon.svg', EMPTY],
    ['./icon.svg', EMPTY],
    ['', EMPTY],
    ['_private/icon.svg', UNDER],
    ['a/_icon.svg', UNDER],
  ])('rejects the favicon %j', (favicon, message) => {
    expect(problems({ ...valid, favicon })).toEqual([`favicon: ${message}`]);
  });

  it.each([
    ['icon.svg', 'must be a .png file'],
    ['icon.ico', 'must be a .png file'],
    ['../a.png', EMPTY],
    ['/a.png', BAD],
  ])('rejects the Apple touch icon %j', (appleTouchIcon, message) => {
    expect(problems({ ...valid, appleTouchIcon })).toEqual([`appleTouchIcon: ${message}`]);
  });

  it.each([
    ['favicon', 3],
    ['favicon', ['a.svg']],
    ['favicon', null],
    ['appleTouchIcon', true],
  ])('rejects %s = %j as the wrong type', (key, value) => {
    expect(problems({ ...valid, [key]: value })).toHaveLength(1);
  });
});
