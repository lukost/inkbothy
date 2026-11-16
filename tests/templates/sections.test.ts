// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseResume, type Resume } from '../../src/content/resume.ts';
import { required } from '../../src/shared/guards.ts';
import { card, renderCards } from '../../src/templates/cards.ts';
import { type HomeBlock, renderHome } from '../../src/templates/home.ts';
import { postList, renderList } from '../../src/templates/list.ts';
import { renderResume } from '../../src/templates/resume.ts';
import type { ItemNoun, TermLookup } from '../../src/types.ts';
import { $, $$, attrs, dom, item, NOUN, noTerms, texts } from '../helpers.ts';

const PROJECTS = { singular: 'project', plural: 'projects' };
const NOTES = { singular: 'note', plural: 'notes' };

const project = (name: string, extra: Parameters<typeof item>[0] = {}) =>
  item({ url: `/projects/${name}/`, section: 'projects', title: name, ...extra });

describe('card', () => {
  const full = project('tool', {
    title: 'Tool <1>',
    status: 'active',
    summary: 'Does "things" & more',
    tags: ['Kernel', 'c++'],
    repo: 'https://example.com/tool',
  });

  it('shows title link, status badge, summary, tags and repository', () => {
    const el = dom(card(full, noTerms, 2));
    expect(texts(el, 'h2 a')).toEqual(['Tool <1>']);
    expect(attrs(el, 'h2 a', 'href')).toEqual(['/projects/tool/']);
    expect(texts(el, '.card-status .badge')).toEqual(['active']);
    expect(texts(el, '.card-summary')).toEqual(['Does "things" & more']);
    expect(texts(el, '.article-tags li')).toEqual(['Kernel', 'c++']);
    expect(attrs(el, '.article-tags a', 'href')).toEqual([
      '/projects/tag/kernel/',
      '/projects/tag/cpp/',
    ]);
    expect(attrs(el, '.card-repo a', 'href')).toEqual(['https://example.com/tool']);
  });

  it('escapes everything it shows', () => {
    const markup = String(card(full, noTerms, 2));
    expect(markup).toContain('Tool &lt;1&gt;');
    expect(markup).toContain('Does &quot;things&quot; &amp; more');
  });

  it('leaves out what the item lacks', () => {
    const el = dom(card(project('bare', { summary: '' }), noTerms, 3));
    expect(texts(el, 'h3')).toEqual(['bare']);
    for (const part of ['.card-status', '.card-summary', '.article-tags', '.card-repo']) {
      expect($$(el, part), part).toEqual([]);
    }
  });

  it('spells tags the way the taxonomy does', () => {
    const lookup: TermLookup = {
      category: () => undefined,
      tag: (label) => (label === 'kernel' ? { slug: 'kernel', label: 'Kernel' } : undefined),
    };
    const el = dom(card(project('x', { tags: ['kernel'] }), lookup, 2));
    expect(texts(el, '.article-tags li')).toEqual(['Kernel']);
  });
});

describe('renderCards', () => {
  const options = { terms: noTerms, noun: PROJECTS };

  it('lists the cards in the order given, under the heading', () => {
    const el = dom(
      renderCards({ heading: 'Projects', items: [project('b'), project('a')], ...options }),
    );
    expect(texts(el, 'h1')).toEqual(['Projects']);
    expect(texts(el, 'ul.cards > li h2')).toEqual(['b', 'a']);
    expect($$(el, '.md-content')).toEqual([]);
    expect($$(el, '.empty')).toEqual([]);
  });

  it('puts the introduction before the cards', () => {
    const el = dom(
      renderCards({
        heading: 'My projects',
        intro: '<p>Intro <em>text</em></p>',
        items: [project('a')],
        ...options,
      }),
    );
    expect(texts(el, 'h1')).toEqual(['My projects']);
    expect($(el, '.md-content').innerHTML).toBe('<p>Intro <em>text</em></p>');
    expect($(el, '.md-content').nextElementSibling?.className).toBe('cards');
  });

  it('says so, in the section noun, when there are no items', () => {
    const el = dom(renderCards({ heading: 'Projects', intro: '', items: [], ...options }));
    expect(texts(el, '.empty')).toEqual(['No projects yet.']);
    expect($$(el, '.cards, .md-content')).toEqual([]);
    const toys = { singular: 'toy', plural: 'toys' };
    const other = dom(renderCards({ heading: 'T', items: [], terms: noTerms, noun: toys }));
    expect(texts(other, '.empty')).toEqual(['No toys yet.']);
  });
});

describe('postList and renderList', () => {
  const note = (n: number, extra: Parameters<typeof item>[0] = {}) =>
    item({
      url: `/notes/n${n}/`,
      section: 'notes',
      title: `Note ${n}`,
      published: `2026-01-0${n}`,
      ...extra,
    });

  it('lists title link, date and summary at the requested heading level', () => {
    const el = dom(postList([note(2, { summary: 'S2' }), note(1)], 3));
    expect(texts(el, 'li h3 a')).toEqual(['Note 2', 'Note 1']);
    expect(attrs(el, 'li h3 a', 'href')).toEqual(['/notes/n2/', '/notes/n1/']);
    expect(attrs(el, 'time', 'datetime')).toEqual(['2026-01-02', '2026-01-01']);
    expect(texts(el, 'li > p:not(.article-dates)')).toEqual(['S2']);
    expect($$(dom(postList([note(1)], 2)), 'h2')).toHaveLength(1);
  });

  it('omits a date that is not known and escapes titles', () => {
    const el = dom(postList([note(1, { published: null, title: '<b>' })], 3));
    expect($$(el, 'time')).toEqual([]);
    expect(texts(el, 'h3')).toEqual(['<b>']);
  });

  it('renders the page: heading, introduction, then the list', () => {
    const el = dom(
      renderList({ heading: 'Notes', intro: '<p>Hi</p>', items: [note(1)], noun: NOTES }),
    );
    expect(texts(el, 'h1')).toEqual(['Notes']);
    expect($(el, '.md-content').nextElementSibling?.className).toBe('post-list');
    expect(texts(el, '.post-list h2')).toEqual(['Note 1']);
  });

  it('says so, in the section noun, when there are no items', () => {
    const el = dom(renderList({ heading: 'N', items: [], noun: NOTES }));
    expect(texts(el, '.empty')).toEqual(['No notes yet.']);
    expect($$(el, '.post-list')).toEqual([]);
  });
});

describe('renderHome', () => {
  const home = item({ url: '/', section: null, title: 'Welcome' });
  const post = (n: number, extra: Parameters<typeof item>[0] = {}) =>
    item({ url: `/blog/p${n}/`, title: `Post ${n}`, published: `2026-01-0${n}`, ...extra });
  const latest = (
    items: ReturnType<typeof post>[],
    url = '/blog/',
    noun: ItemNoun = NOUN,
  ): HomeBlock => ({
    kind: 'latest',
    url,
    noun,
    items,
    terms: noTerms,
  });
  const featured = (items: ReturnType<typeof project>[]): HomeBlock => ({
    kind: 'featured',
    url: '/projects/',
    noun: PROJECTS,
    items,
    terms: noTerms,
  });
  const render = (...blocks: HomeBlock[]) =>
    dom(renderHome({ item: home, content: '<p>About me</p>', terms: noTerms, blocks }));

  it('shows the page, then each block in the order given', () => {
    const el = render(
      latest([post(3, { summary: 'S3' }), post(2)]),
      featured([project('a', { featured: true, summary: 'Sa' })]),
    );
    expect(Array.from(el.children, (c) => c.className)).toEqual([
      'article',
      'home-section home-latest',
      'home-section home-featured',
    ]);
    expect(texts(el, '.article h1')).toEqual(['Welcome']);
    expect(texts(el, '.article .md-content')).toEqual(['About me']);
    expect(texts(el, '.home-latest h2')).toEqual(['Latest posts']);
    expect(texts(el, '.home-latest h3 a')).toEqual(['Post 3', 'Post 2']);
    expect(attrs(el, '.home-latest h3 a', 'href')).toEqual(['/blog/p3/', '/blog/p2/']);
    expect(attrs(el, '.home-latest time', 'datetime')).toEqual(['2026-01-03', '2026-01-02']);
    expect(texts(el, '.home-latest li > p:not(.article-dates)')).toEqual(['S3']);
    expect(texts(el, '.home-latest .home-more a')).toEqual(['All posts →']);
    expect(attrs(el, '.home-latest .home-more a', 'href')).toEqual(['/blog/']);
    expect(texts(el, '.home-featured h2')).toEqual(['Featured projects']);
    expect(texts(el, '.home-featured .card h3')).toEqual(['a']);
    expect(attrs(el, '.home-featured .home-more a', 'href')).toEqual(['/projects/']);
  });

  it('follows the order of the blocks and takes nouns and URLs from them', () => {
    const el = render(
      featured([project('a')]),
      latest([post(1)], '/notes/', NOTES),
      latest([post(2)]),
    );
    expect(Array.from(el.children, (c) => c.className)).toEqual([
      'article',
      'home-section home-featured',
      'home-section home-latest',
      'home-section home-latest',
    ]);
    expect(texts(el, 'h2')).toEqual(['Featured projects', 'Latest notes', 'Latest posts']);
    expect(attrs(el, '.home-more a', 'href')).toEqual(['/projects/', '/notes/', '/blog/']);
  });

  it('omits a post date that is not known', () => {
    expect($$(render(latest([post(1, { published: null })])), '.home-latest time')).toEqual([]);
  });

  it('is just the page without blocks', () => {
    expect(Array.from(render().children, (c) => c.className)).toEqual(['article']);
  });
});

const READ: Resume = required(
  parseResume(
    {
      headline: 'Engineer',
      contact: {
        location: 'Berlin',
        email: 'me@example.com',
        links: [{ label: 'Code', url: 'https://example.com/me' }],
      },
      experience: [
        {
          role: 'Lead <dev>',
          org: 'Acme',
          location: 'Remote',
          start: '2020-03',
          end: 'present',
          highlights: ['Cut **latency** by `40%`', 'Plain'],
        },
        { role: 'Dev', org: 'Old Co', start: '2015-01', end: '2019-12' },
      ],
      education: [
        { degree: 'MSc', institution: 'Uni', start: '2010-10', end: '2015-06', note: 'Thesis' },
      ],
      skills: [
        { group: 'Languages', items: ['C', 'Rust'] },
        { group: 'Tools', items: ['git'] },
      ],
      languages: [{ name: 'English', level: 'fluent' }, { name: 'Polish' }],
      publications: [
        { title: 'Paper', venue: 'Conf', year: '2019', url: 'https://example.com/p' },
        { title: 'Other', venue: 'Journal', year: '2018' },
      ],
      teaching: [{ role: 'Lecturer', org: 'Uni', start: '2016-10', end: '2018-06' }],
    },
    new Date('2026-06-15T00:00:00Z'),
  ).resume,
  'resume',
);

const page = item({ url: '/resume/', section: null, title: 'Resume' });
const inline = (source: string) => `[${source}]`;
const render = (resume: Resume, intro = '<p>Intro</p>') =>
  dom(renderResume({ item: page, intro, resume, inline }));

describe('renderResume', () => {
  const el = render(READ);

  it('has a header with the title, headline and one contact list', () => {
    expect(texts(el, 'header h1')).toEqual(['Resume']);
    expect(texts(el, '.resume-headline')).toEqual(['Engineer']);
    expect(texts(el, '.resume-contact li')).toEqual(['Berlin', 'me@example.com', 'Code']);
    expect(attrs(el, '.resume-contact a', 'href')).toEqual([
      'mailto:me@example.com',
      'https://example.com/me',
    ]);
  });

  it('shows the page text below the header', () => {
    expect(texts(el, '.md-content')).toEqual(['Intro']);
    expect($(el, '.resume-header').nextElementSibling?.className).toBe('md-content');
  });

  it('orders the sections', () => {
    expect(texts(el, 'h2')).toEqual([
      'Experience',
      'Education',
      'Teaching',
      'Publications',
      'Skills',
      'Languages',
    ]);
  });

  it('makes each position a list item with machine-readable dates', () => {
    const roles = $$(el, '.resume-section:first-of-type ul.resume-entries > li.resume-entry');
    expect(roles).toHaveLength(2);
    const [first, second] = roles;
    expect(texts(first ?? el, 'h3')).toEqual(['Lead <dev>']);
    expect(texts(first ?? el, '.resume-place')).toEqual(['Acme, Remote']);
    expect(texts(first ?? el, '.resume-period')).toEqual(['Mar 2020 – Present']);
    expect(attrs(first ?? el, 'time', 'datetime')).toEqual(['2020-03']);
    expect(texts(second ?? el, '.resume-place')).toEqual(['Old Co']);
    expect(texts(second ?? el, '.resume-period')).toEqual(['Jan 2015 – Dec 2019']);
    expect(attrs(second ?? el, 'time', 'datetime')).toEqual(['2015-01', '2019-12']);
    expect($$(second ?? el, 'ul')).toEqual([]);
  });

  it('puts highlights through the inline renderer, unescaped', () => {
    expect(texts(el, '.resume-entry ul li')).toEqual(['[Cut **latency** by `40%`]', '[Plain]']);
    const out = String(
      renderResume({ item: page, intro: '', resume: READ, inline: () => '<strong>x</strong>' }),
    );
    expect(out).toContain('<li><strong>x</strong></li>');
  });

  it('shows education with its note', () => {
    const edu = $(el, '.resume-section:nth-of-type(2) li.resume-entry');
    expect(texts(edu, 'h3')).toEqual(['MSc']);
    expect(texts(edu, '.resume-place')).toEqual(['Uni']);
    expect(texts(edu, ':scope > p')).toEqual(['Thesis']);
  });

  it('lists skills as a definition list', () => {
    expect(texts(el, 'dl.resume-skills > div > dt')).toEqual(['Languages', 'Tools']);
    expect(texts(el, 'dl.resume-skills > div > dd')).toEqual(['C, Rust', 'git']);
  });

  it('lists languages with and without a level, and publications with and without a link', () => {
    expect(texts(el, '.resume-languages li')).toEqual(['English — fluent', 'Polish']);
    expect(texts(el, '.resume-publications li')).toEqual([
      'Paper. Conf, 2019.',
      'Other. Journal, 2018.',
    ]);
    expect(attrs(el, '.resume-publications a', 'href')).toEqual(['https://example.com/p']);
  });

  it('escapes text fields', () => {
    expect(String(render(READ).innerHTML)).toContain('Lead &lt;dev&gt;');
  });

  it('leaves out every section and detail that has no data', () => {
    const bare = render(
      {
        contact: { links: [] },
        experience: [],
        education: [],
        skills: [],
        languages: [],
        publications: [],
        teaching: [],
      },
      '',
    );
    expect($$(bare, 'h2, .resume-contact, .resume-headline, .md-content')).toEqual([]);
    expect(texts(bare, 'h1')).toEqual(['Resume']);
  });

  it('shows a draft banner for a draft', () => {
    const draft = dom(
      renderResume({
        item: item({ ...page, title: 'R', draft: true }),
        intro: '',
        resume: READ,
        inline,
      }),
    );
    expect($$(draft, '.draft-banner')).toHaveLength(1);
    expect($$(el, '.draft-banner')).toEqual([]);
  });

  it('shows each contact item on its own when only some are given', () => {
    const only = (contact: Resume['contact']) => render({ ...READ, contact });
    expect(texts(only({ location: 'X', links: [] }), '.resume-contact li')).toEqual(['X']);
    expect(texts(only({ email: 'a@b.cd', links: [] }), '.resume-contact li')).toEqual(['a@b.cd']);
    expect($$(only({ links: [] }), '.resume-contact')).toEqual([]);
  });
});
