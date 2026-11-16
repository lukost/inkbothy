import { describe, expect, it } from 'vitest';
import { heading, html } from '../../src/templates/html.ts';

describe('html', () => {
  it('escapes interpolated values', () => {
    const evil = '<script>alert("x")</script>';
    expect(String(html`<p>${evil}</p>`)).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>',
    );
  });

  it('keeps an embedded </pre> inert', () => {
    expect(String(html`<pre>${'a</pre><b>x</b>'}</pre>`)).toBe(
      '<pre>a&lt;/pre&gt;&lt;b&gt;x&lt;/b&gt;</pre>',
    );
  });

  it('escapes attribute breakouts', () => {
    expect(String(html`<a href="${'" onclick="x'}">`)).toBe('<a href="&quot; onclick=&quot;x">');
  });

  it('does not re-escape nested html', () => {
    const inner = html`<b>${'<i>'}</b>`;
    expect(String(html`<p>${inner}</p>`)).toBe('<p><b>&lt;i&gt;</b></p>');
  });

  it('cannot be fooled by a look-alike object (Markup is nominal)', () => {
    const fake = { toString: () => '<script>x</script>' };
    // @ts-expect-error a plain object is not an Interpolation
    expect(String(html`${fake}`)).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('renders arrays (escaping strings, keeping markup)', () => {
    expect(String(html`<ul>${['<a>', html`<li>b</li>`]}</ul>`)).toBe(
      '<ul>&lt;a&gt;<li>b</li></ul>',
    );
  });

  it.each([null, undefined, false, ''] as const)('renders %j as nothing', (v) => {
    expect(String(html`[${v}]`)).toBe('[]');
  });

  it('renders 0 (falsy but meaningful)', () => {
    expect(String(html`[${0}]`)).toBe('[0]');
  });

  it('works with no interpolations', () => {
    expect(String(html`<hr>`)).toBe('<hr>');
  });
});

describe('heading', () => {
  it.each([2, 3] as const)('makes an h%i', (level) => {
    expect(String(heading(level, 'T'))).toBe(`<h${level}>T</h${level}>`);
  });

  it('marks the h1 as the page title, and no other level', () => {
    expect(String(heading(1, 'T'))).toBe('<h1 class="page-title">T</h1>');
    expect(String(heading(1, '<b>'))).toBe('<h1 class="page-title">&lt;b&gt;</h1>');
  });

  it('escapes text and keeps markup', () => {
    expect(String(heading(2, '<b>'))).toBe('<h2>&lt;b&gt;</h2>');
    expect(String(heading(2, html`<a href="/x/">y</a>`))).toBe('<h2><a href="/x/">y</a></h2>');
  });
});
