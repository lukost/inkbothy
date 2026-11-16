import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitFrontMatter } from '../../src/content/frontmatter.ts';
import {
  isIgnored,
  isValidDate,
  listOf,
  locate,
  normalize as normalizeIn,
  placeBundle,
} from '../../src/content/model.ts';
import { SITE_SAMPLE } from '../../src/lib/paths.ts';
import { CARDS, LIST, SECTIONS } from '../helpers.ts';

const base = { title: 'T', published: '2026-11-13' };
const normalize = (data: Record<string, unknown>, rel: string) => normalizeIn(data, rel, SECTIONS);

describe('isValidDate', () => {
  it.each(['2026-11-13', '2024-02-29', '2000-02-29', '1999-12-31'])('accepts %s', (d) => {
    expect(isValidDate(d)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '1900-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '26-1-1',
    '2026-1-01',
    '2026-11-13T10:00',
    ' 2026-11-13',
    '',
    20261113,
    null,
    undefined,
  ])('rejects %j', (d) => {
    expect(isValidDate(d)).toBe(false);
  });
});

describe('isIgnored', () => {
  it.each(['_templates', '_templates/post.md', 'blog/_wip/index.md', 'blog/x/_notes.md'])(
    'ignores %s',
    (p) => expect(isIgnored(p)).toBe(true),
  );
  it.each(['', 'blog/x/index.md', 'blog/my_post/index.md'])('keeps %j', (p) =>
    expect(isIgnored(p)).toBe(false),
  );
});

describe('locate', () => {
  it.each([
    ['', '/', []],
    ['.', '/', []],
    ['resume', '/resume/', ['resume']],
    ['blog/dma-intro', '/blog/dma-intro/', ['blog', 'dma-intro']],
    ['blog/./dma-intro/', '/blog/dma-intro/', ['blog', 'dma-intro']],
  ])('%j -> %s', (rel, url, segments) => {
    expect(locate(rel)).toEqual({ url, segments });
  });

  it('normalises inner .. that stays inside', () => {
    expect(locate('blog/x/../y')).toEqual({ url: '/blog/y/', segments: ['blog', 'y'] });
  });

  it.each(['..', '../src', 'blog/../../etc', '/etc', '/abs/content/blog/x', 'blog\0x'])(
    'rejects invalid path %j',
    (rel) => {
      expect(() => locate(rel)).toThrow(RangeError);
    },
  );
});

describe('normalize: placement', () => {
  it.each([
    ['', '/', null, ''],
    ['resume', '/resume/', null, 'resume'],
    ['blog', '/blog/', null, 'blog'],
    ['blog/dma', '/blog/dma/', 'blog', 'dma'],
    ['projects/tool', '/projects/tool/', 'projects', 'tool'],
    ['blog/a/b', '/blog/a/b/', null, 'b'],
    ['notes/x', '/notes/x/', null, 'x'],
    ['constructor/x', '/constructor/x/', null, 'x'],
    ['__proto__/x', '/__proto__/x/', null, 'x'],
  ])('%j -> url %s, section %s, slug %j', (rel, url, section, slug) => {
    const r = normalize(base, rel);
    expect(r).toMatchObject({ url, section, slug });
  });

  it('warns about directories that are not clean slugs', () => {
    expect(normalize(base, 'blog/My Post').warnings).toEqual([
      'directory "My Post" is not a clean slug (suggest "my-post")',
    ]);
  });

  it.each([
    ['blog', 'category', true],
    ['blog', 'tag', true],
    ['projects', 'tag', true],
    ['projects', 'category', false],
    ['blog', 'tags', false],
  ])('%s/%s is reserved: %s', (section, slug, reserved) => {
    expect(normalize(base, `${section}/${slug}`).warnings).toEqual(
      reserved ? [`slug "${slug}" is reserved under ${section}/`] : [],
    );
  });

  it('reserves nothing in a section without taxonomies', () => {
    const sections = { notes: { ...LIST, taxonomies: [] } };
    expect(normalizeIn(base, 'notes/tag', sections).warnings).toEqual([]);
  });

  it('puts an item in any declared section, whatever its layout', () => {
    expect(normalizeIn(base, 'notes/x', { notes: LIST }).section).toBe('notes');
  });

  it('finds sections by their own keys only', () => {
    const warnings: string[] = [];
    expect(placeBundle('toString/x', { blog: CARDS }, (m) => warnings.push(m)).section).toBeNull();
  });
});

describe('normalize: fields', () => {
  it('produces a clean record with no warnings for complete data', () => {
    const r = normalize(
      {
        title: '  DMA  ',
        summary: ' S ',
        published: '2026-11-13',
        categories: ['Embedded', 'Linux'],
        tags: ['dma'],
        copyright: '© me',
      },
      'blog/dma',
    );
    expect(r.warnings).toEqual([]);
    expect(r.meta).toMatchObject({
      title: 'DMA',
      summary: 'S',
      published: '2026-11-13',
      updates: [],
      updated: null,
      categories: ['Embedded', 'Linux'],
      tags: ['dma'],
      draft: false,
      copyright: '© me',
    });
  });

  it('normalises project fields', () => {
    const r = normalize(
      {
        ...base,
        status: ' active ',
        repo: 'https://example.com/r',
        links: [{ label: ' Docs ', url: 'https://example.com/d' }],
      },
      'projects/p',
    );
    expect(r.meta).toMatchObject({
      status: 'active',
      repo: 'https://example.com/r',
      links: [{ label: 'Docs', url: 'https://example.com/d' }],
    });
    expect(r.warnings).toEqual([]);
  });

  it('omits absent optional fields entirely', () => {
    const { meta } = normalize(base, 'blog/x');
    for (const key of ['copyright', 'status', 'repo', 'links']) {
      expect(meta).not.toHaveProperty(key);
    }
  });

  it('stringifies a numeric copyright', () => {
    expect(normalize({ ...base, copyright: 2026 }, 'blog/x').meta.copyright).toBe('2026');
  });

  it('drops a non-http repo with a warning', () => {
    const r = normalize({ ...base, repo: 'javascript:alert(1)' }, 'projects/p');
    expect(r.meta).not.toHaveProperty('repo');
    expect(r.warnings).toEqual(['repo: not an http(s) URL "javascript:alert(1)"; ignored']);
  });

  it('drops malformed links with indexed warnings', () => {
    const r = normalize(
      {
        ...base,
        links: [
          { label: 'ok', url: 'https://e.com' },
          { label: '', url: 'https://e.com' },
          { label: 'x', url: 'file:///etc' },
          'str',
        ],
      },
      'projects/p',
    );
    expect(r.meta.links).toEqual([{ label: 'ok', url: 'https://e.com/' }]);
    expect(r.warnings).toEqual([
      'links[1]: needs a label and an http(s) url; entry ignored',
      'links[2]: needs a label and an http(s) url; entry ignored',
      'links[3]: needs a label and an http(s) url; entry ignored',
    ]);
  });

  it('warns when links is not a list', () => {
    const r = normalize({ ...base, links: 'https://e.com' }, 'projects/p');
    expect(r.meta).not.toHaveProperty('links');
    expect(r.warnings).toEqual(['links: expected a list of { label, url }; ignored']);
  });

  it('collects unknown keys in extra, untouched', () => {
    const nested = { deep: [1, 2] };
    const r = normalize({ ...base, mood: 'happy', nested }, 'blog/x');
    expect(r.meta.extra).toEqual({ mood: 'happy', nested });
    expect(r.meta.extra.nested).toBe(nested);
    expect(r.meta).not.toHaveProperty('mood');
  });

  it('does not mutate the input', () => {
    const data = { ...base, tags: 'x', updates: [{ date: '2026-01-01', note: 'n' }] };
    const snapshot = structuredClone(data);
    normalize(data, 'blog/p');
    expect(data).toEqual(snapshot);
  });

  describe('title', () => {
    it.each([undefined, '', '   ', { a: 1 }])('falls back to slug for %j', (title) => {
      const r = normalize({ ...base, title }, 'blog/my-post');
      expect(r.meta.title).toBe('my-post');
      expect(r.warnings).toEqual(['missing title; using "my-post"']);
    });

    it('falls back to "home" at the root', () => {
      expect(normalize({ published: '2026-01-01' }, '').meta.title).toBe('home');
    });

    it('accepts a numeric title', () => {
      expect(normalize({ ...base, title: 1984 }, 'blog/x').meta.title).toBe('1984');
    });
  });

  describe('published', () => {
    it('warns when missing but keeps going', () => {
      const r = normalize({ title: 'T' }, 'blog/x');
      expect(r.meta.published).toBeNull();
      expect(r.warnings).toEqual(['missing published date']);
    });

    it('warns and drops an invalid date', () => {
      const r = normalize({ title: 'T', published: '2026-02-30' }, 'blog/x');
      expect(r.meta.published).toBeNull();
      expect(r.warnings).toEqual(['published: invalid date "2026-02-30" (expected YYYY-MM-DD)']);
    });
  });

  describe('updates', () => {
    it('sorts newest first and sets updated', () => {
      const r = normalize(
        {
          ...base,
          updates: [
            { date: '2026-11-20', note: 'b' },
            { date: '2026-12-02', note: 'c' },
            { date: '2026-11-14', note: 'a' },
          ],
        },
        'blog/x',
      );
      expect(r.meta.updates.map((u) => u.note)).toEqual(['c', 'b', 'a']);
      expect(r.meta.updated).toBe('2026-12-02');
    });

    it('keeps author order for equal dates', () => {
      const updates = [
        { date: '2026-11-20', note: 'first' },
        { date: '2026-11-20', note: 'second' },
      ];
      const r = normalize({ ...base, updates }, 'blog/x');
      expect(r.meta.updates.map((u) => u.note)).toEqual(['first', 'second']);
    });

    it('drops malformed entries with indexed warnings and strips extra keys', () => {
      const r = normalize(
        {
          ...base,
          updates: [
            { date: '2026-13-01', note: 'bad date' },
            { date: '2026-11-20' },
            { date: '2026-11-21', note: '   ' },
            null,
            'just a string',
            { date: '2026-11-22', note: ' ok ', extra: 1 },
          ],
        },
        'blog/x',
      );
      expect(r.meta.updates).toEqual([{ date: '2026-11-22', note: 'ok' }]);
      expect(r.warnings).toEqual([
        'updates[0]: invalid or missing date; entry ignored',
        'updates[1]: missing note; entry ignored',
        'updates[2]: missing note; entry ignored',
        'updates[3]: invalid or missing date; entry ignored',
        'updates[4]: invalid or missing date; entry ignored',
      ]);
    });

    it('treats an empty list as no updates', () => {
      const r = normalize({ ...base, updates: [] }, 'blog/x');
      expect(r.meta).toMatchObject({ updates: [], updated: null });
      expect(r.warnings).toEqual([]);
    });

    it('warns when updates is not a list', () => {
      const r = normalize({ ...base, updates: { date: '2026-01-01', note: 'x' } }, 'blog/x');
      expect(r.meta.updates).toEqual([]);
      expect(r.warnings).toEqual(['updates: expected a list of { date, note }; ignored']);
    });
  });

  describe('tags and categories', () => {
    it('coerces a single string to a list', () => {
      const r = normalize({ ...base, tags: 'kernel', categories: 'Linux' }, 'blog/x');
      expect(r.meta.tags).toEqual(['kernel']);
      expect(r.meta.categories).toEqual(['Linux']);
    });

    it('trims, drops empties and exact duplicates, stringifies numbers', () => {
      const r = normalize({ ...base, tags: [' a ', '', 'a', 'b', '  ', 2026] }, 'blog/x');
      expect(r.meta.tags).toEqual(['a', 'b', '2026']);
      expect(r.warnings).toEqual([]);
    });

    it('keeps case variants (collision handling is the generator’s job)', () => {
      expect(normalize({ ...base, tags: ['Linux', 'linux'] }, 'blog/x').meta.tags).toEqual([
        'Linux',
        'linux',
      ]);
    });

    it('warns about non-text entries and labels without slug characters', () => {
      const r = normalize({ ...base, tags: ['ok', true, { x: 1 }, '!!!'] }, 'blog/x');
      expect(r.meta.tags).toEqual(['ok']);
      expect(r.warnings).toEqual([
        'tags: ignoring non-text entry true',
        'tags: ignoring non-text entry {"x":1}',
        'tags: "!!!" has no URL-safe characters; ignored',
      ]);
    });

    it('warns when given a mapping', () => {
      const r = normalize({ ...base, tags: { a: 1 } }, 'blog/x');
      expect(r.meta.tags).toEqual([]);
      expect(r.warnings).toEqual(['tags: expected a list or a string; ignored']);
    });

    it.each([
      ['projects/p', 'categories', 'projects/'],
      ['resume', 'categories', 'pages'],
      ['', 'tags', 'pages'],
      ['notes/n', 'tags', 'notes/'],
    ])('ignores %s %s the section does not declare (%s)', (rel, field, where) => {
      const sections = { ...SECTIONS, notes: { ...LIST, taxonomies: [] } };
      const r = normalizeIn({ ...base, [field]: ['Linux'] }, rel, sections);
      expect(r.meta[field === 'tags' ? 'tags' : 'categories']).toEqual([]);
      expect(r.warnings).toEqual([`${field} are not enabled for ${where}; ignored`]);
    });

    it('does not warn for an empty list the section does not declare', () => {
      expect(normalize({ ...base, categories: [] }, 'projects/p').warnings).toEqual([]);
    });

    it('keeps tags where the section declares them', () => {
      expect(normalize({ ...base, tags: ['a'] }, 'projects/p').meta.tags).toEqual(['a']);
    });
  });

  describe('draft', () => {
    it.each([
      [undefined, false],
      [null, false],
      [false, false],
      [true, true],
      ['yes', true],
      [' True ', true],
      ['no', false],
      ['FALSE', false],
    ])('%j -> %s without warning', (draft, expected) => {
      const r = normalize({ ...base, draft }, 'blog/x');
      expect(r.meta.draft).toBe(expected);
      expect(r.warnings).toEqual([]);
    });

    it.each(['maybe', 1, 0])('treats unrecognised %j as draft, with a warning', (draft) => {
      const r = normalize({ ...base, draft }, 'blog/x');
      expect(r.meta.draft).toBe(true);
      expect(r.warnings).toEqual([
        `draft: unrecognised value ${JSON.stringify(draft)}; treating as draft`,
      ]);
    });
  });

  describe('toc', () => {
    it.each([
      [true, true],
      [false, false],
      ['yes', true],
      [' No ', false],
      ['TRUE', true],
    ])('%j -> %s without warning', (toc, expected) => {
      const r = normalize({ ...base, toc }, 'blog/x');
      expect(r.meta.toc).toBe(expected);
      expect(r.warnings).toEqual([]);
    });

    it.each([undefined, null])('leaves %j absent (automatic)', (toc) => {
      const r = normalize({ ...base, toc }, 'blog/x');
      expect('toc' in r.meta).toBe(false);
      expect(r.warnings).toEqual([]);
    });

    it.each(['maybe', 1, 0, ''])('warns about %j and leaves the field absent', (toc) => {
      const r = normalize({ ...base, toc }, 'blog/x');
      expect('toc' in r.meta).toBe(false);
      expect(r.meta.draft).toBe(false);
      expect(r.warnings).toEqual([`toc: unrecognised value ${JSON.stringify(toc)}; ignored`]);
    });

    it('is a known key, not passed through as extra', () => {
      expect(normalize({ ...base, toc: true }, 'blog/x').meta.extra).toEqual({});
    });
  });

  describe('featured', () => {
    it.each([
      [true, true],
      ['yes', true],
      [' No ', false],
      [false, false],
    ])('%j -> %s without warning', (featured, expected) => {
      const r = normalize({ ...base, featured }, 'projects/x');
      expect(r.meta.featured).toBe(expected);
      expect(r.warnings).toEqual([]);
      expect(r.meta.extra).toEqual({});
    });

    it('is absent when not given', () => {
      expect('featured' in normalize(base, 'projects/x').meta).toBe(false);
    });

    it.each(['maybe', 1, ''])('warns about %j and leaves the field absent', (featured) => {
      const r = normalize({ ...base, featured }, 'projects/x');
      expect('featured' in r.meta).toBe(false);
      expect(r.warnings).toEqual([
        `featured: unrecognised value ${JSON.stringify(featured)}; ignored`,
      ]);
    });
  });

  it('warns about a top-level slug that a generated page uses, but not about a deeper one', () => {
    expect(normalize(base, 'attributions').warnings).toEqual(['slug "attributions" is reserved']);
    expect(normalize(base, 'blog/attributions').warnings).toEqual([]);
    expect(normalize(base, 'blog').warnings).toEqual([]);
    expect(normalize(base, 'projects').warnings).toEqual([]);
  });

  it('throws for a bundle path escaping the site directory', () => {
    expect(() => normalize(base, '../src')).toThrow(RangeError);
  });
});

describe('templates stay in sync with the model', () => {
  it.each([
    ['post.md', 'blog/example-post', 1],
    ['project.md', 'projects/example-project', 1],
    ['page.md', 'example-page', 0],
  ])('%s normalises without warnings', (file, rel, updates) => {
    const text = fs.readFileSync(path.join(SITE_SAMPLE, '_templates', file), 'utf8');
    const { data } = splitFrontMatter(text, file);
    const r = normalize(data, rel);
    expect(r.warnings).toEqual([]);
    expect(r.meta.published).not.toBeNull();
    expect(r.meta.draft).toBe(false);
    expect(r.meta.updates).toHaveLength(updates);
  });
});

describe('listOf', () => {
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);
  const each = (entry: unknown, at: string) =>
    typeof entry === 'string' ? `${at}=${entry}` : undefined;

  it.each([undefined, null])('reads %j as an empty list without a warning', (value) => {
    warnings.length = 0;
    expect(listOf(value, 'f', warn, 'x', each)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it.each([['text'], [3], [{ a: 1 }], [true]])('warns about %j and ignores it', (value) => {
    warnings.length = 0;
    expect(listOf(value, 'f', warn, '{ a }', each)).toEqual([]);
    expect(warnings).toEqual(['f: expected a list of { a }; ignored']);
  });

  it('leaves the shape out of the warning when there is none', () => {
    warnings.length = 0;
    listOf('x', 'f', warn, '', each);
    expect(warnings).toEqual(['f: expected a list; ignored']);
  });

  it('hands each entry its indexed place, keeps the order and drops what `each` rejects', () => {
    warnings.length = 0;
    expect(listOf(['a', 1, 'b', null, 'c'], 'f', warn, 'x', each)).toEqual([
      'f[0]=a',
      'f[2]=b',
      'f[4]=c',
    ]);
    expect(warnings).toEqual([]);
  });

  it('keeps entries that are falsy but not undefined', () => {
    expect(listOf([0, '', false], 'f', warn, 'x', (entry) => entry)).toEqual([0, '', false]);
  });
});
