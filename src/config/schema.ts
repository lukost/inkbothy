import { z } from 'zod';
import { RESERVED_ROOT_SLUGS, slugify } from '../content/slug.ts';
import { ownValue } from '../shared/guards.ts';

const TAXONOMY_FIELDS = ['categories', 'tags'] as const;

const text = z.string().trim().min(1, 'must not be empty');
const count = z.int().min(0);

const isOrigin = (value: string): boolean =>
  /^https?:\/\//.test(value) && URL.canParse(value) && new URL(value).origin === value;

const origin = z
  .string()
  .refine(isOrigin, 'must be an http(s) origin without a path, e.g. https://example.com');

/** Why `value` cannot name an icon file below the site directory, or undefined. */
function iconPathProblem(value: string, extensions: readonly string[]): string | undefined {
  const segments = value.split('/');
  if (value.startsWith('/') || value.includes('\\')) {
    return 'must be a relative path with / separators, below the site directory';
  }
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return 'must not contain empty, "." or ".." segments';
  }
  if (segments.some((s) => s.startsWith('_'))) {
    return 'must not sit under a _-prefixed name, which is not published';
  }
  const ext = value.slice(value.lastIndexOf('.')).toLowerCase();
  return extensions.includes(ext) ? undefined : `must be a ${extensions.join(' | ')} file`;
}

const iconPath = (extensions: readonly string[]) =>
  z.string().superRefine((value, ctx) => {
    const message = iconPathProblem(value, extensions);
    if (message) {
      ctx.addIssue({ code: 'custom', message });
    }
  });

const unique = (list: readonly string[]): boolean => new Set(list).size === list.length;

const section = z.strictObject({
  label: text.describe(
    "Name of the section in the menu, and heading of its page unless the section's index.md has a title.",
  ),
  noun: z
    .tuple([text, text])
    .transform(([singular, plural]) => ({ singular, plural }))
    .describe(
      'Singular and plural name of one item, e.g. [post, posts]; used in texts such as "All posts" and "No posts yet".',
    ),
  taxonomies: z
    .array(z.enum(TAXONOMY_FIELDS, 'expected one of categories|tags'))
    .refine(unique, 'must not repeat a taxonomy')
    .describe(
      'Taxonomies the section uses: categories and/or tags. Each gets a term index and a page per term. The first declared one fills the menu when `menu` is `taxonomy`.',
    ),
  menu: z
    .enum(['taxonomy', 'items', 'none'], 'expected one of taxonomy|items|none')
    .describe(
      'What the menu group of the section lists besides its "All ..." link: `taxonomy` (the terms of the first declared taxonomy), `items` (the items by title) or `none` (a plain link, no group).',
    ),
});

const stream = z
  .strictObject({
    initial: count.describe('Items rendered on the section page at first load.'),
    batch: z.int().min(1).describe('Items revealed per further step while scrolling.'),
  })
  .describe(
    'Progressive loading of a `stream` section. Required for the `stream` layout, forbidden for the others.',
  );

const layout = <L extends string>(name: L) =>
  z
    .literal(name)
    .describe(
      'How the section page shows its items: `stream` (full articles, further ones loaded while scrolling), `cards` (a grid of cards) or `list` (titles and dates).',
    );

const sectionOfLayout = z.discriminatedUnion(
  'layout',
  [
    z.strictObject({ ...section.shape, layout: layout('stream'), stream }),
    z.strictObject({ ...section.shape, layout: layout('cards') }),
    z.strictObject({ ...section.shape, layout: layout('list') }),
  ],
  {
    error: (issue) =>
      issue.code === 'invalid_union' ? 'expected one of stream|cards|list' : undefined,
  },
);

const homeBlock = z.union([
  z
    .strictObject({
      latest: text.describe('Key of the section whose newest items are shown (by published date).'),
      count: count.describe('Number of items shown.'),
    })
    .transform(({ latest, count }) => ({ kind: 'latest' as const, section: latest, count })),
  z
    .strictObject({
      featured: text.describe(
        'Key of the section whose items with `featured: true` are shown, newest first.',
      ),
      count: count.describe('Number of items shown.'),
    })
    .transform(({ featured, count }) => ({ kind: 'featured' as const, section: featured, count })),
]);

export const siteSchema = z
  .strictObject({
    title: text.describe('Site title, shown in the header and in page titles.'),
    baseUrl: origin.describe(
      'Absolute http(s) origin the site is served from, without a path. Used for canonical URLs, the sitemap and `robots.txt`.',
    ),
    favicon: iconPath(['.svg', '.png', '.ico'])
      .optional()
      .describe('Site icon: a .svg, .png or .ico file below the site directory.'),
    appleTouchIcon: iconPath(['.png'])
      .optional()
      .describe('Apple touch icon: a .png file below the site directory (180x180 recommended).'),
    copyright: z
      .strictObject({
        holder: text.describe('Name shown in the copyright line.'),
        rights: text.describe('Rights statement after the holder, e.g. "All rights reserved."'),
      })
      .describe(
        'Copyright line in the footer; the years run from the earliest year of a published item to the current year.',
      ),
    sections: z
      .record(z.string(), sectionOfLayout)
      .describe(
        'Sections of the site. Each key is a directory below the site directory and the first URL segment of its items; it must be a clean slug.',
      ),
    menu: z
      .array(text)
      .refine(unique, 'must not repeat an entry')
      .describe(
        'Menu entries after the implicit Home: names of sections or of top-level pages, in order.',
      ),
    home: z
      .array(homeBlock)
      .describe(
        'Blocks of the home page, in order. Each has either `latest` or `featured`, plus `count`.',
      ),
  })
  .superRefine((site, ctx) => {
    const problem = (path: (string | number)[], message: string): void =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const [key, { taxonomies, menu }] of Object.entries(site.sections)) {
      if (key === '' || slugify(key) !== key) {
        problem(['sections', key], `section key must be a clean slug (suggest "${slugify(key)}")`);
      } else if (/^\d+$/.test(key)) {
        problem(
          ['sections', key],
          'section key must contain a letter, or it loses its place in the order',
        );
      } else if (RESERVED_ROOT_SLUGS.has(key)) {
        problem(['sections', key], `section key "${key}" is reserved`);
      }
      if (menu === 'taxonomy' && taxonomies.length === 0) {
        problem(['sections', key, 'menu'], 'taxonomy needs at least one entry in taxonomies');
      }
    }
    for (const [i, { kind, section }] of site.home.entries()) {
      if (ownValue(site.sections, section) === undefined) {
        problem(['home', i, kind], `unknown section "${section}"`);
      }
    }
  });

export type SiteConfig = z.output<typeof siteSchema>;
export type SectionConfig = SiteConfig['sections'][string];
export type TaxonomyField = (typeof TAXONOMY_FIELDS)[number];
