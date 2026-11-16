// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createMarkdown } from '../../../src/generator/markdown/markdown.ts';
import { $, $$, attrs, dom, texts } from '../../helpers.ts';

const md = createMarkdown();
const render = (src: string, docId?: string) =>
  dom(md.render(src, docId === undefined ? {} : { docId }));

describe('dialect', () => {
  it('renders tables, strikethrough and linkified URLs', () => {
    const el = render('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~ see https://example.com/x');
    expect(texts(el, 'th')).toEqual(['a', 'b']);
    expect(texts(el, 'td')).toEqual(['1', '2']);
    expect($(el, 's').textContent).toBe('gone');
    expect(attrs(el, 'a', 'href')).toEqual(['https://example.com/x']);
  });

  it('marks links whose text is their address, and no other', () => {
    const el = render(
      [
        'https://auto.example.com/a <https://angle.example.com/b> [text](https://text.example.com/c)',
        '[https://same.example.com/d](https://same.example.com/d) [ref][r] <a href="https://raw.example.com/e">raw</a>',
        '',
        '[r]: https://ref.example.com/f',
      ].join('\n'),
    );
    expect($$(el, 'a').map((a) => [a.getAttribute('href'), a.getAttribute('class')])).toEqual([
      ['https://auto.example.com/a', 'autolink'],
      ['https://angle.example.com/b', 'autolink'],
      ['https://text.example.com/c', null],
      ['https://same.example.com/d', 'autolink'],
      ['https://ref.example.com/f', null],
      ['https://raw.example.com/e', null],
    ]);
  });

  it('marks only a link whose whole text is its address', () => {
    const el = render(
      [
        '[https://a.example.com/](https://b.example.com/)',
        '[**https://c.example.com/**](https://c.example.com/)',
        '[see https://d.example.com/](https://d.example.com/)',
        '[https://e.example.com/ ](https://e.example.com/)',
        '[`https://f.example.com/`](https://f.example.com/)',
      ].join('\n\n'),
    );
    expect(attrs(el, 'a', 'class')).toEqual([null, null, null, null, null]);
  });

  it('marks autolinks inside lists, emphasis and tables', () => {
    const el = render('- *https://a.example.com/*\n\n| h |\n|---|\n| https://b.example.com/ |');
    expect(attrs(el, 'a', 'class')).toEqual(['autolink', 'autolink']);
  });

  it('wraps every table in its own scroll container, and nothing else', () => {
    const el = render('| a |\n|---|\n| 1 |\n\ntext\n\n| b | c |\n|---|---|\n| 2 | 3 |');
    const wraps = $$(el, 'div.table-wrap');
    expect(wraps).toHaveLength(2);
    expect(wraps.map((w) => w.children.length)).toEqual([1, 1]);
    expect(wraps.map((w) => w.firstElementChild?.tagName)).toEqual(['TABLE', 'TABLE']);
    expect($$(el, 'table')).toHaveLength(2);
    expect($(el, 'p').parentElement).toBe(el);
  });

  it('makes each table box keyboard-scrollable and named', () => {
    const wraps = $$(render('| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |'), '.table-wrap');
    expect(wraps).toHaveLength(2);
    for (const wrap of wraps) {
      expect([wrap.tabIndex, wrap.getAttribute('role'), wrap.getAttribute('aria-label')]).toEqual([
        0,
        'region',
        'Table',
      ]);
    }
  });

  it('does not wrap pipes that are not a table, and keeps raw HTML tables untouched', () => {
    const el = render('a | b\n\n<table><tr><td>x</td></tr></table>');
    expect($$(el, '.table-wrap')).toHaveLength(0);
    expect($$(el, 'table')).toHaveLength(1);
  });

  it('passes raw HTML through and leaves quotes and dashes alone', () => {
    const el = render('<div class="x">raw</div>\n\n"quoted" -- (c)');
    expect($(el, 'div.x').textContent).toBe('raw');
    expect($(el, 'p').textContent).toBe('"quoted" -- (c)');
  });
});

describe('footnotes', () => {
  const src = 'Text[^1].\n\n[^1]: The note.';

  it('prefixes ids with the document id', () => {
    const el = render(src, 'post');
    expect(attrs(el, 'sup a', 'href')).toEqual(['#fn-post-1']);
    expect(attrs(el, 'sup a', 'id')).toEqual(['fnref-post-1']);
    expect(attrs(el, 'li.footnote-item', 'id')).toEqual(['fn-post-1']);
    expect(attrs(el, 'a.footnote-backref', 'href')).toEqual(['#fnref-post-1']);
  });

  it('keeps working with an empty document id', () => {
    const el = render(src, '');
    expect(attrs(el, 'sup a', 'href')).toEqual(['#fn--1']);
    expect(attrs(el, 'li.footnote-item', 'id')).toEqual(['fn--1']);
  });

  it('yields unique ids for different documents on one page', () => {
    const page = dom(md.render(src, { docId: 'a' }) + md.render(src, { docId: 'b' }));
    const ids = $$(page, '[id]').map((n) => n.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('task lists', () => {
  const boxes = (src: string) => $$(render(src), 'input[type="checkbox"]');

  it('renders unticked and ticked items, accepting [X]', () => {
    const items = boxes('- [ ] a\n- [x] b\n- [X] c');
    expect(items.map((i) => i.hasAttribute('checked'))).toEqual([false, true, true]);
    expect(items.every((i) => i.hasAttribute('disabled'))).toBe(true);
  });

  it('marks the item and its list, once', () => {
    const el = render('- [ ] a\n- [x] b\n- plain');
    expect($(el, 'ul').className).toBe('contains-task-list');
    expect($$(el, 'li').map((li) => li.className)).toEqual([
      'task-list-item',
      'task-list-item',
      '',
    ]);
    expect($(el, 'li').textContent?.trim()).toBe('a');
  });

  it('works in ordered, loose and nested lists', () => {
    expect(boxes('1. [ ] a\n2. [x] b')).toHaveLength(2);
    expect(boxes('- [ ] a\n\n- [x] b')).toHaveLength(2);
    const el = render('- plain\n  - [x] nested\n- other');
    expect($(el, 'ul ul').className).toBe('contains-task-list');
    expect($(el, 'ul').className).toBe('');
    expect($(el, 'ul ul li').className).toBe('task-list-item');
  });

  it.each([
    ['mid-text', '- text [x] more'],
    ['code span', '- `[x] code`'],
    ['code block', '```\n- [x] code\n```'],
    ['escaped marker', '- \\[x] text'],
    ['marker without text', '- [x]'],
    ['no space after marker', '- [x]text'],
    ['other letter', '- [y] text'],
    ['paragraph, not an item', '[x] text'],
  ])('leaves %s untouched', (_name, src) => {
    expect(boxes(src)).toHaveLength(0);
    expect(render(src).querySelector('.task-list-item')).toBeNull();
  });

  it('converts items inside a blockquote', () => {
    const el = render('> - [x] quoted\n> - [ ] too');
    expect($$(el, 'blockquote li.task-list-item')).toHaveLength(2);
    expect($(el, 'blockquote ul').className).toBe('contains-task-list');
  });

  it('does not treat a marker wrapped in emphasis as a task', () => {
    expect(boxes('- *[x]* a')).toHaveLength(0);
  });

  it('leaves a marker alone when the item text starts on the next line', () => {
    const el = render('- [ ]\n  text');
    expect(el.querySelector('input')).toBeNull();
    expect($(el, 'li').textContent).toContain('[ ]');
  });

  it('keeps inline markup after the marker', () => {
    const el = render('- [x] **bold** text');
    expect($(el, 'li strong').textContent).toBe('bold');
  });
});
