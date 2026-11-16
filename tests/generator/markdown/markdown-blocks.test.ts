// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createMarkdown } from '../../../src/generator/markdown/markdown.ts';
import { $, $$, attrs, dom, texts } from '../../helpers.ts';
import { markdownToText } from '../analyze.ts';

const md = createMarkdown();
const render = (src: string, docId = '') => dom(md.render(src, { docId }));

describe('code fences', () => {
  it('renders a readable figure with escaped code', () => {
    const el = render('```c\nif (a < b && c) {}\n```');
    const figure = $(el, 'figure.code-block');
    expect(figure.dataset).toMatchObject({ lang: 'c' });
    expect(figure.dataset.highlight).toBeUndefined();
    expect(figure.className).toBe('code-block');
    expect(figure.hasAttribute('style')).toBe(false);
    expect($(figure, ':scope > figcaption:first-child').textContent).toBe('c');
    expect($(figure, 'pre > code.language-c').textContent).toBe('if (a < b && c) {}\n');
    expect(el.innerHTML).toContain('a &lt; b &amp;&amp; c');
  });

  it('carries title, highlighted lines and the line-number start', () => {
    const el = render('```c title="a<b.c" {3,5-6} showLineNumbers=10\n1\n2\n3\n4\n5\n6\n```');
    const figure = $(el, 'figure.code-block');
    expect(figure.dataset).toMatchObject({ lang: 'c', highlight: '3,5,6' });
    expect(figure.className).toBe('code-block line-numbers');
    expect(figure.getAttribute('style')).toBe('--line-start:10');
    expect(figure.hasAttribute('data-line-start')).toBe(false);
    expect($(figure, 'figcaption .code-title').textContent).toBe('a<b.c');
    expect($(figure, 'figcaption .code-lang').textContent).toBe('c');
  });

  it('caps highlighted lines at the number of lines in the block', () => {
    const el = render('```c {1-100000}\na\nb\nc\n```');
    expect($(el, 'figure').dataset.highlight).toBe('1,2,3');
    expect(el.innerHTML.length).toBeLessThan(400);
  });

  it('omits the highlight attribute when every requested line is beyond the block', () => {
    expect(render('```c {5,9-12}\na\n```').querySelector('figure[data-highlight]')).toBeNull();
  });

  it('counts the lines of an empty and a newline-less block', () => {
    expect($(render('```c {1}\n```'), 'figure').dataset.highlight).toBe('1');
    expect($(render('~~~c {1-3}\na\nb\n~~~'), 'figure').dataset.highlight).toBe('1,2');
  });

  it('omits the language label from the caption of an untagged block', () => {
    const el = render('```title="x.txt"\nraw\n```');
    expect(el.querySelector('.code-lang')).toBeNull();
    expect($(el, 'figcaption').textContent).toBe('x.txt');
    expect(el.querySelector('code[class]')).toBeNull();
  });

  it('always renders the header bar: language only, title and language, or nothing', () => {
    const bar = (src: string) => $(render(src), 'figure.code-block > figcaption');
    const langOnly = bar('```rust\nfn main() {}\n```');
    expect($(langOnly, '.code-lang').textContent).toBe('rust');
    expect(langOnly.querySelector('.code-title')).toBeNull();
    const both = bar('```rust title="m.rs"\nx\n```');
    expect(texts(both, 'span')).toEqual(['m.rs', 'rust']);
    const bare = bar('```\nplain\n```');
    expect(bare.innerHTML).toBe('');
    expect(bare.matches(':empty')).toBe(true);
  });

  it('puts the header bar before the code, and never in a mermaid block', () => {
    const figure = $(render('```c\nx\n```'), 'figure.code-block');
    expect([...figure.children].map((c) => c.tagName)).toEqual(['FIGCAPTION', 'PRE']);
    expect(render('```mermaid\ngraph\n```').querySelector('figcaption')).toBeNull();
  });

  it('escapes a hostile title and language in the header bar', () => {
    const el = render('```c title="<img src=x onerror=alert(1)>"\nx\n```');
    expect(el.querySelector('img')).toBeNull();
    expect($(el, '.code-title').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('keeps a block without language readable and unmarked', () => {
    const el = render('```\nplain\n```');
    expect($(el, 'figure.code-block').dataset.lang).toBeUndefined();
    expect($(el, 'pre > code').textContent).toBe('plain\n');
  });

  it('lowercases the language and escapes hostile tags', () => {
    const el = render('```C<img>\nx\n```');
    expect(el.querySelector('img')).toBeNull();
    expect($(el, 'figure').dataset.lang).toBe('c<img>');
    expect($(el, 'code').className).toBe('language-c<img>');
  });

  it('renders mermaid fences as an inert source block', () => {
    const el = render('```mermaid\ngraph TD; A-->B\n```');
    expect(el.querySelector('figure')).toBeNull();
    expect($(el, 'pre.mermaid-source').textContent).toBe('graph TD; A-->B\n');
    expect($(el, 'pre.mermaid-source').hasAttribute('data-title')).toBe(false);
  });

  it('carries a mermaid title', () => {
    const el = render('```mermaid title="Boot <flow>"\ngraph TD\n```');
    expect($(el, 'pre.mermaid-source').dataset.title).toBe('Boot <flow>');
  });

  it('leaves indented code as a plain block', () => {
    const el = render('    indented');
    expect(el.querySelector('figure')).toBeNull();
    expect($(el, 'pre code').textContent).toBe('indented\n');
  });
});

describe('heading ids', () => {
  const ids = (src: string, docId?: string) => attrs(render(src, docId), 'h1,h2,h3,h4,h5,h6', 'id');

  it('prefixes ids with the document id, or none when it is empty', () => {
    expect(ids('## Hello World', 'post')).toEqual(['post--hello-world']);
    expect(ids('## Hello World', '')).toEqual(['hello-world']);
  });

  it('numbers duplicates across levels', () => {
    expect(ids('## A\n### A\n## A\n#### A', 'd')).toEqual(['d--a', 'd--a-2', 'd--a-3', 'd--a-4']);
  });

  it('does not collide with a heading that already looks like a numbered duplicate', () => {
    expect(ids('## A\n## A-2\n## A', '')).toEqual(['a', 'a-2', 'a-3']);
  });

  it('falls back to "section" for headings without a usable slug, numbering them', () => {
    expect(ids('## Привет\n## !!!\n### 日本語', 'd')).toEqual([
      'd--section',
      'd--section-2',
      'd--section-3',
    ]);
    expect(ids('## !!!', '')).toEqual(['section']);
  });

  it('slugifies the text of inline markup and code', () => {
    expect(ids('## Use `ioctl()` *now*\n### C++ & Rust')).toEqual(['use-ioctl-now', 'cpp-rust']);
  });

  it('leaves h1, h5 and h6 alone', () => {
    const el = render('# One\n##### Five\n###### Six');
    expect($$(el, 'h1, h5, h6').every((h) => !h.hasAttribute('id'))).toBe(true);
    expect(el.querySelector('.heading-anchor')).toBeNull();
  });

  it('appends a permalink anchor to h2-h4 only', () => {
    const el = render('## Title', 'p');
    const a = $(el, 'h2 > a.heading-anchor');
    expect(a.getAttribute('href')).toBe('#p--title');
    expect(a.getAttribute('aria-label')).toBe('Link to this section');
    expect(a.textContent).toBe('#');
  });

  it('keeps ids unique when several documents share a page', () => {
    const page = dom(md.render('## Same', { docId: 'a' }) + md.render('## Same', { docId: 'b' }));
    expect($$(page, 'h2').map((h) => h.id)).toEqual(['a--same', 'b--same']);
  });

  it('escapes a hostile document id in id and href', () => {
    const el = render('## x', 'a"><b');
    expect(el.querySelector('b')).toBeNull();
    expect($(el, 'h2').getAttribute('id')).toBe('a"><b--x');
  });

  it('does not collide across documents whose ids differ only in where the dash falls', () => {
    const ab = md.render('## b-c', { docId: 'a' });
    const ba = md.render('## c', { docId: 'a-b' });
    const ids = $$(dom(ab + ba), 'h2').map((h) => h.id);
    expect(ids).toEqual(['a--b-c', 'a-b--c']);
    expect(new Set(ids).size).toBe(2);
  });

  it('does not collide with footnote ids of another document', () => {
    const heading = md.render('## x-1', { docId: 'fn' });
    const note = md.render('T[^1]\n\n[^1]: n', { docId: 'x' });
    const ids = $$(dom(heading + note), '[id]').map((n) => n.id);
    expect(ids).toContain('fn--x-1');
    expect(ids).toContain('fn-x-1');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps anchors out of search text', () => {
    expect(markdownToText('## Heading\n\nBody')).toBe('Heading Body');
  });
});

describe('alerts', () => {
  it('escapes a hostile document id in the title id and its reference', () => {
    const docId = '"><img src=x onerror=alert(1)>';
    const out = createMarkdown().render('> [!NOTE]\n> body', { docId });
    expect(out).not.toContain('<img');
    const el = dom(out);
    const alert = $(el, 'div.alert');
    const title = $(alert, 'p.alert-title');
    expect(title.id).toBe(`${docId}--alert--1`);
    expect(alert.getAttribute('aria-labelledby')).toBe(title.id);
    expect(title.attributes).toHaveLength(2);
  });

  it('keeps the title a real paragraph: escaped text, before the body', () => {
    const el = render('> [!WARNING]\n> body');
    expect([...$(el, 'div.alert').children].map((c) => `${c.tagName}.${c.className}`)).toEqual([
      'P.alert-title',
      'P.',
    ]);
  });

  it.each([
    ['NOTE', 'note', 'Note'],
    ['TIP', 'tip', 'Tip'],
    ['IMPORTANT', 'important', 'Important'],
    ['WARNING', 'warning', 'Warning'],
    ['CAUTION', 'caution', 'Caution'],
    ['note', 'note', 'Note'],
    ['Caution', 'caution', 'Caution'],
  ])('renders [!%s]', (marker, type, title) => {
    const el = render(`> [!${marker}]\n> Body **text**`);
    const alert = $(el, 'div.alert');
    expect(alert.className).toBe(`alert alert-${type}`);
    expect(alert.getAttribute('role')).toBe('note');
    expect($(alert, 'p.alert-title').textContent).toBe(title);
    expect(alert.getAttribute('aria-labelledby')).toBe($(alert, 'p.alert-title').id);
    expect($(alert, 'p:not(.alert-title)').textContent).toBe('Body text');
    expect(el.querySelector('blockquote')).toBeNull();
  });

  it('gives every alert a unique labelled title id, prefixed with the document id', () => {
    const el = render('> [!NOTE]\n> a\n\n> [!TIP]\n> b', 'doc');
    const ids = $$(el, 'p.alert-title').map((p) => p.id);
    expect(ids).toEqual(['doc--alert--1', 'doc--alert--2']);
    expect($$(el, 'div.alert').map((a) => a.getAttribute('aria-labelledby'))).toEqual(ids);
    expect(attrs(render('> [!NOTE]\n> a'), 'p.alert-title', 'id')).toEqual(['alert--1']);
  });

  it('numbers only real alerts, not plain blockquotes', () => {
    const el = render('> plain\n\n> [!NOPE]\n> x\n\n> [!NOTE]\n> y', 'd');
    expect(attrs(el, 'p.alert-title', 'id')).toEqual(['d--alert--1']);
  });

  it('renders an empty alert as the title alone', () => {
    const el = render('> [!TIP]');
    expect(texts(el, 'div.alert > *')).toEqual(['Tip']);
  });

  it('keeps following paragraphs inside the alert', () => {
    const el = render('> [!NOTE]\n> one\n>\n> two');
    expect(texts(el, 'div.alert p:not(.alert-title)')).toEqual(['one', 'two']);
  });

  it('accepts a marker followed by a hard break', () => {
    const el = render('> [!NOTE]  \n> text');
    expect($(el, 'div.alert')).not.toBeNull();
    expect(texts(el, 'div.alert p:not(.alert-title)')).toEqual(['text']);
  });

  it.each([
    ['unknown type', '> [!NOPE]\n> x'],
    ['inherited property name', '> [!constructor]\n> x'],
    ['marker not alone on its line', '> [!NOTE] inline\n> x'],
    ['marker not first', '> intro\n> [!NOTE]'],
    ['no bang', '> [NOTE]\n> x'],
    ['not a blockquote', '[!NOTE]\nx'],
    ['emphasised marker', '> *[!NOTE]*\n> x'],
    ['quote starting with a list', '> - [!NOTE]\n> - x'],
    ['quote starting with a fence', '> ```c\n> [!NOTE]\n> ```'],
  ])('leaves %s as ordinary text', (_name, src) => {
    const el = render(src);
    expect(el.querySelector('.alert')).toBeNull();
  });

  it('keeps an unknown type as a plain blockquote with its marker', () => {
    const el = render('> [!NOPE]\n> x');
    expect($(el, 'blockquote').textContent).toContain('[!NOPE]');
  });

  it('works inside a list item and around a nested blockquote', () => {
    const el = render('- > [!WARNING]\n  > in list\n\n> [!CAUTION]\n> > inner');
    expect($$(el, 'li div.alert-warning')).toHaveLength(1);
    const caution = $(el, 'div.alert-caution');
    expect($(caution, 'blockquote').textContent?.trim()).toBe('inner');
  });

  it('handles alerts directly after each other', () => {
    const el = render('> [!NOTE]\n> a\n\n> [!TIP]\n> b');
    expect($$(el, 'div.alert').map((a) => a.className)).toEqual([
      'alert alert-note',
      'alert alert-tip',
    ]);
  });

  it('keeps the marker and title out of search text', () => {
    expect(markdownToText('> [!NOTE]\n> remember this')).toBe('remember this');
    expect(markdownToText('> [!TIP]')).toBe('');
  });
});
