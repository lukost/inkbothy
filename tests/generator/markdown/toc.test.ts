// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createMarkdown } from '../../../src/generator/markdown/markdown.ts';
import { renderToc, type TocOptions, tocEntries } from '../../../src/generator/markdown/toc.ts';
import { $, $$, attrs, dom, texts } from '../../helpers.ts';

const md = createMarkdown();
const tokens = (src: string, docId = 'a') => md.parse(src, { docId });

/** The table of contents of `src` as a DOM tree ('' renders as an empty container). */
const toc = (src: string, opts?: TocOptions, docId = 'a') =>
  dom(renderToc(tokens(src, docId), opts));

const three = '## One\n\n### Two\n\n## Three\n';

describe('toc thresholds', () => {
  it('builds an open details list from 3 headings', () => {
    const el = toc(three);
    const nav = $(el, 'nav.toc');
    expect($(nav, 'details').hasAttribute('open')).toBe(true);
    expect($(nav, 'summary').textContent).toBe('Contents');
  });

  it('skips articles with fewer than 3 h2/h3', () => {
    expect(renderToc(tokens('## One\n\n### Two\n'))).toBe('');
    expect(renderToc(tokens('## One\n\n#### Four\n\n#### Five\n\n# Six'))).toBe('');
  });

  it('forces the table with toc=true, but not for an article without headings', () => {
    expect(toc('## Only', { toc: true }).querySelector('.toc')).not.toBeNull();
    expect(renderToc(tokens('no headings'), { toc: true })).toBe('');
  });

  it('suppresses it with toc=false', () => {
    expect(renderToc(tokens(three), { toc: false })).toBe('');
  });

  it('is automatic when toc is undefined', () => {
    expect(renderToc(tokens(three), { toc: undefined })).not.toBe('');
    expect(renderToc(tokens('## One'), { toc: undefined })).toBe('');
  });

  it('is empty for an empty document', () => {
    expect(renderToc([], { toc: true })).toBe('');
    expect(renderToc(tokens(''))).toBe('');
  });

  it('does not count headings without text towards the threshold', () => {
    expect(renderToc(tokens('## A\n\n## B\n\n## <img src=x>\n\n## ![](p.png)\n'))).toBe('');
  });

  it('ends with a newline, so it separates from the content that follows', () => {
    expect(renderToc(tokens(three)).endsWith('</nav>\n')).toBe(true);
  });
});

describe('toc structure', () => {
  it('nests h3 under the preceding h2 and links to the heading ids', () => {
    const el = toc('## A\n\n### A1\n\n### A2\n\n## B\n\n### B1\n');
    expect(texts(el, '.toc > details > ol > li > a')).toEqual(['A', 'B']);
    expect(texts(el, '.toc li > ol > li > a')).toEqual(['A1', 'A2', 'B1']);
    expect(attrs(el, '.toc a', 'href')).toEqual(['#a--a', '#a--a1', '#a--a2', '#a--b', '#a--b1']);
  });

  it('puts an h3 before any h2 at the top level', () => {
    const el = toc('### Lead\n\n## A\n\n### A1\n');
    expect(texts(el, '.toc > details > ol > li > a')).toEqual(['Lead', 'A']);
    expect(texts(el, '.toc li > ol > li > a')).toEqual(['A1']);
  });

  it('returns to the top level for an h2 after h3s, and keeps empty sublists out', () => {
    const el = toc('## A\n\n### A1\n\n## B\n\n## C\n');
    expect($$(el, '.toc ol ol')).toHaveLength(1);
    expect(texts(el, '.toc > details > ol > li > a')).toEqual(['A', 'B', 'C']);
  });

  it('lists a run of h3s after another top-level h3 flat', () => {
    const el = toc('### X\n\n### Y\n\n### Z\n');
    expect(texts(el, '.toc > details > ol > li > a')).toEqual(['X', 'Y', 'Z']);
    expect(el.querySelector('.toc ol ol')).toBeNull();
  });

  it('uses the heading text without the permalink anchor and ignores h1/h4', () => {
    const el = toc('# T\n\n## Use `ioctl()`\n\n#### deep\n\n## B\n\n## C');
    expect(texts(el, '.toc a')).toEqual(['Use ioctl()', 'B', 'C']);
  });

  it('reads the text of emphasis and entities, not their markup', () => {
    const el = toc('## A *b* **c** &amp; d\n\n## B\n\n## C');
    expect(texts(el, '.toc a')[0]).toBe('A b c & d');
    expect(renderToc(tokens('## A *b* &amp; d\n\n## B\n\n## C'))).toContain('A b &amp; d');
  });

  it('omits raw HTML headings (no id) and headings without text, and never injects markup', () => {
    const el = toc('<h2>no id</h2>\n\n## A\n\n## B\n\n## C\n\n## <img src=x onerror=alert(1)>\n');
    expect(texts(el, '.toc a')).toEqual(['A', 'B', 'C']);
    expect(el.querySelector('.toc img')).toBeNull();
  });

  it('escapes heading text and ids', () => {
    const out = renderToc(tokens('## a <b> "q"\n\n## B\n\n## C'));
    expect(out).toContain('>a  &quot;q&quot;</a>');
    expect(out).not.toContain('<b>');
  });

  it('lists the entries with their level', () => {
    expect(tocEntries(tokens('# T\n\n## A\n\n### B\n\n#### C\n\n## \n'))).toEqual([
      { id: 'a--a', text: 'A', level: 2 },
      { id: 'a--b', text: 'B', level: 3 },
    ]);
  });
});

describe('toc accessibility', () => {
  it('names the nav by its summary, with the article title as hidden text', () => {
    const el = toc(three, { title: 'First <post>' }, 'one');
    const nav = $(el, 'nav.toc');
    const summary = $(nav, 'summary');
    expect(nav.hasAttribute('aria-label')).toBe(false);
    expect(nav.getAttribute('role')).toBe('navigation');
    expect(nav.getAttribute('aria-labelledby')).toBe(summary.id);
    expect(summary.textContent).toBe('Contents: First <post>');
    expect($(summary, '.visually-hidden').textContent).toBe(': First <post>');
  });

  it('gives every nav on a listing page a unique label id, resolvable within the page', () => {
    const page = dom(
      `${renderToc(tokens(three, 'one'), { title: 'One' })}${renderToc(tokens(three, 'two'), { title: 'Two' })}`,
    );
    const ids = $$(page, 'nav.toc').map((n) => n.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(page.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
    const hrefs = $$(page, '.toc a').map((a) => a.getAttribute('href') ?? '');
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('is plainly "Contents" without a title', () => {
    const el = toc(three);
    expect($(el, 'nav.toc summary').textContent).toBe('Contents');
    expect(el.querySelector('nav.toc .visually-hidden')).toBeNull();
    expect($(toc(three, { title: '' }), 'nav.toc summary').textContent).toBe('Contents');
  });

  it('names the nav even without a document id', () => {
    const el = dom(renderToc(md.parse(three, {})));
    expect($(el, 'summary').id).toBe('one--toc');
    expect(attrs(el, '.toc a', 'href')).toEqual(['#one', '#two', '#three']);
  });
});
