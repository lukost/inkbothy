// @vitest-environment happy-dom
import MarkdownIt from 'markdown-it';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstHeadingText } from '../../src/generator/html-title.ts';
import {
  getRenderer,
  parseMarkdown,
  RENDERERS,
  type RenderContext,
  type Rendered,
  renderInline,
} from '../../src/generator/render.ts';
import { $, $$, attrs, dom, fullHtml, texts, thrown } from '../helpers.ts';

afterEach(() => vi.restoreAllMocks());

const ctx: RenderContext = { baseUrl: '/blog/p/', docId: 'p', title: 'T' };
const renderer = getRenderer('markdown');
const html = async (source: string, over: Partial<RenderContext> = {}) =>
  fullHtml(await renderer.render(source, { ...ctx, ...over }));

describe('registry', () => {
  it('keys every renderer by its own format', () => {
    expect(RENDERERS.size).toBeGreaterThan(0);
    for (const [key, r] of RENDERERS) {
      expect(r.format).toBe(key);
      expect(getRenderer(key)).toBe(r);
    }
  });

  it('rejects a format nobody renders', () => {
    expect(thrown(() => getRenderer('asciidoc')).message).toBe('no renderer for format "asciidoc"');
  });
});

describe('golden output', () => {
  it('renders alerts with an accessible title, and drops an empty alert body', async () => {
    expect(await html('> [!NOTE]\n> Remember [x](y/).\n\n> [!TIP]')).toBe(
      [
        '<div class="alert alert-note" role="note" aria-labelledby="p--alert--1">',
        '<p class="alert-title" id="p--alert--1">Note</p>',
        '<p>Remember <a href="/blog/p/y/">x</a>.</p>',
        '</div>',
        '<div class="alert alert-tip" role="note" aria-labelledby="p--alert--2">',
        '<p class="alert-title" id="p--alert--2">Tip</p>',
        '</div>',
        '',
      ].join('\n'),
    );
  });

  it('renders footnotes with ids prefixed by the document', async () => {
    expect(await html('Claim[^1].\n\n[^1]: The note.')).toBe(
      [
        '<p>Claim<sup class="footnote-ref"><a href="#fn-p-1" id="fnref-p-1">[1]</a></sup>.</p>',
        '<hr class="footnotes-sep">',
        '<section class="footnotes">',
        '<ol class="footnotes-list">',
        '<li id="fn-p-1" class="footnote-item"><p>The note. <a href="#fnref-p-1" class="footnote-backref">↩︎</a></p>',
        '</li>',
        '</ol>',
        '</section>',
        '',
      ].join('\n'),
    );
  });

  it('renders heading ids with a permalink anchor', async () => {
    expect(await html('## Head\n\ntext')).toBe(
      '<h2 id="p--head">Head<a class="heading-anchor" href="#p--head" aria-label="Link to this section">#</a></h2>\n<p>text</p>\n',
    );
  });

  it('renders task lists as disabled checkboxes', async () => {
    expect(await html('- [ ] todo\n- [x] done')).toBe(
      [
        '<ul class="contains-task-list">',
        '<li class="task-list-item"><input type="checkbox" disabled> todo</li>',
        '<li class="task-list-item"><input type="checkbox" disabled checked> done</li>',
        '</ul>',
        '',
      ].join('\n'),
    );
  });

  it('wraps tables in a focusable scroll region', async () => {
    const out = await html('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(
      out.startsWith(
        '<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table>',
      ),
    ).toBe(true);
    expect(out.endsWith('</table>\n</div>\n')).toBe(true);
  });

  it('renders Mermaid sources for the client to draw', async () => {
    expect(await html('```mermaid title="D"\ngraph TD\n```')).toBe(
      '<pre class="mermaid-source" data-title="D">graph TD\n</pre>\n',
    );
  });

  it('keeps plain, untagged and unknown-language code escaped, in the same figure', async () => {
    expect(await html('```pcap\nraw <x>\n```')).toBe(
      '<figure class="code-block" data-lang="pcap">\n<figcaption><span class="code-lang">pcap</span></figcaption>\n<pre><code class="language-pcap">raw &lt;x&gt;\n</code></pre>\n</figure>\n',
    );
    expect(await html('```\nplain\n```')).toBe(
      '<figure class="code-block">\n<figcaption></figcaption>\n<pre><code>plain\n</code></pre>\n</figure>\n',
    );
    expect(await html('```text\n<b>\n```')).toContain(
      '<pre><code class="language-text">&lt;b&gt;\n',
    );
    expect(await html('    indented <i>')).toBe('<pre><code>indented &lt;i&gt;\n</code></pre>\n');
  });
});

describe('Shiki code figures', () => {
  const source = '```c title="a.c" {2} showLineNumbers=3\nint a;\nint b;\n```';

  it('puts the highlighted pre in the figure, after the header bar', async () => {
    const el = dom(await html(source));
    const figure = $(el, 'figure.code-block.line-numbers');
    expect(figure.getAttribute('style')).toBe('--line-start:3');
    expect(figure.dataset).toMatchObject({ lang: 'c', highlight: '2' });
    expect([...figure.children].map((c) => c.tagName)).toEqual(['FIGCAPTION', 'PRE']);
    expect(texts(figure, 'figcaption span')).toEqual(['a.c', 'c']);
    expect(figure.querySelector('pre.shiki > code')).not.toBeNull();
    expect($(figure, 'pre').getAttribute('tabindex')).toBe('0');
    expect(figure.querySelector('code.language-c')).toBeNull();
  });

  it('emits both themes as CSS variables, never as fixed colours', async () => {
    const out = await html(source);
    expect(out).toContain('--shiki-light:');
    expect(out).toContain('--shiki-dark:');
    expect(out).toContain('--shiki-light-bg:#f2f0eb');
    expect(out).toContain('--shiki-dark-bg:#282828');
    expect(out).not.toMatch(/style="color:/);
    expect(out).toMatch(/shiki-themes paper gruvbox-tuned/);
  });

  it('marks exactly the requested lines and keeps the code text intact', async () => {
    const el = dom(await html(source));
    const lines = $$(el, '.line');
    expect(lines.map((l) => l.classList.contains('highlighted'))).toEqual([false, true]);
    expect(lines.map((l) => l.textContent)).toEqual(['int a;', 'int b;']);
    expect($(el, 'pre').textContent).toBe('int a;\nint b;');
  });

  it('ignores highlighted lines beyond the code', async () => {
    const el = dom(await html('```c {1,9}\nint a;\n```'));
    expect($(el, 'figure').dataset.highlight).toBe('1');
    expect($$(el, '.line.highlighted')).toHaveLength(1);
  });

  it('highlights aliases and any case of the language tag', async () => {
    for (const tag of ['sh', 'bash', 'Shell', 'ZSH']) {
      const el = dom(await html(`\`\`\`${tag}\nls -l\n\`\`\``));
      expect(el.querySelector('pre.shiki'), tag).not.toBeNull();
    }
  });

  it('keeps hostile code inert', async () => {
    const out = await html('```js\n</pre><script>alert(1)</script>\n```');
    expect(out).not.toContain('<script>');
    expect(dom(out).querySelector('script')).toBeNull();
    expect(dom(out).querySelector('pre')?.textContent).toBe('</pre><script>alert(1)</script>');
  });

  it('keeps blank lines and a missing trailing newline', async () => {
    const el = dom(await html('```c\na\n\nb\n```'));
    expect($$(el, '.line').map((l) => l.textContent)).toEqual(['a', '', 'b']);
  });

  it('renders documents in parallel without mixing their code up', async () => {
    const langs = ['c', 'rust', 'python', 'lua'];
    const outs = await Promise.all(
      langs.map((l, i) =>
        renderer.render(`\`\`\`${l}\nvalue${i}\n\`\`\``, { ...ctx, docId: `d${i}` }),
      ),
    );
    for (const [i, out] of outs.entries()) {
      expect(dom(fullHtml(out)).querySelector('pre')?.textContent).toBe(`value${i}`);
      expect(fullHtml(out)).toContain('shiki');
    }
  });
});

describe('table of contents', () => {
  const headings = '## A\n\n### A1\n\n## B\n\nBody';

  it('comes before the content, named with the title', async () => {
    const out = await html(headings, { title: 'My <post>' });
    expect(out.startsWith('<nav class="toc"')).toBe(true);
    const el = dom(out);
    expect($(el, 'summary').textContent).toBe('Contents: My <post>');
    expect(attrs(el, 'nav.toc a', 'href')).toEqual(['#p--a', '#p--a1', '#p--b']);
    expect($(el, 'h2').id).toBe('p--a');
  });

  it('is also available apart from the body, which then starts with the content', async () => {
    const out = await renderer.render(headings, ctx);
    expect(out.toc.startsWith('<nav class="toc"')).toBe(true);
    expect(out.body).not.toContain('class="toc"');
    expect(out.body.startsWith('<h2')).toBe(true);
    expect(fullHtml(out)).toBe(out.toc + out.body);
  });

  it('is empty apart from the body when the article has none', async () => {
    const out = await renderer.render('## A\n\nBody', ctx);
    expect(out.toc).toBe('');
    expect(fullHtml(out)).toBe(out.body);
  });

  it('follows the front-matter override', async () => {
    expect(await html(headings, { toc: false })).not.toContain('class="toc"');
    expect(await html('## A', { toc: true })).toContain('class="toc"');
    expect(await html('## A')).not.toContain('class="toc"');
  });
});

describe('rebasing and ids', () => {
  it('resolves relative links, images and raw HTML against the article URL', async () => {
    const out = await html(
      '[a](other/) ![i](img.png) <a href="x/">r</a> <img src="y.png" srcset="y.png 1x">',
      { baseUrl: '/blog/one/' },
    );
    expect(out).toContain('href="/blog/one/other/"');
    expect(out).toContain('src="/blog/one/img.png"');
    expect(out).toContain('<a href="/blog/one/x/">r</a>');
    expect(out).toContain('<img src="/blog/one/y.png" srcset="/blog/one/y.png 1x">');
  });

  it('prefixes ids by document, so two articles on one page never collide', async () => {
    const source = '## Same\n\nText[^1]\n\n[^1]: Note';
    const el = dom((await html(source, { docId: 'one' })) + (await html(source, { docId: 'two' })));
    const ids = $$(el, '[id]').map((n) => n.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  const source = '## A\n\n## B\n\n## C\n\nSee [rel](x/) ![i](y.png) [a](#b)[^1]\n\n[^1]: Note';
  const same = (a: Rendered, b: Rendered) => {
    expect(a.text).toBe(b.text);
    expect(a.warnings).toEqual(b.warnings);
  };

  it('lets docId change only the ids, and what refers to them', async () => {
    const a = await renderer.render(source, { ...ctx, docId: 'dxa' });
    const b = await renderer.render(source, { ...ctx, docId: 'dxb' });
    expect(fullHtml(a)).toContain('dxa--b');
    expect(fullHtml(a).replaceAll('dxa', 'dxb')).toBe(fullHtml(b));
    same(a, b);
  });

  it('lets title change only the summary of the table of contents', async () => {
    const a = await renderer.render(source, { ...ctx, title: 'Alpha' });
    const b = await renderer.render(source, { ...ctx, title: 'Beta' });
    expect(fullHtml(a)).toContain(': Alpha</span>');
    expect(fullHtml(a).replace(': Alpha', ': Beta')).toBe(fullHtml(b));
    same(a, b);
  });

  it('lets baseUrl change only the rebased URLs', async () => {
    const a = await renderer.render(source, { ...ctx, baseUrl: '/b1/' });
    const b = await renderer.render(source, { ...ctx, baseUrl: '/b2/' });
    expect(fullHtml(a)).toContain('href="/b1/x/"');
    expect(fullHtml(a)).toContain('src="/b1/y.png"');
    expect(fullHtml(a).replaceAll('/b1/', '/b2/')).toBe(fullHtml(b));
    same(a, b);
  });
});

describe('search text and warnings', () => {
  it('returns the plain text of prose, without code, raw HTML or markers', async () => {
    const out = await renderer.render(
      '# Title\n\nSome **bold** and `ioctl()`.\n\n```c\nhidden();\n```\n\n<div>raw</div>\n\n> [!NOTE]\n> remember',
      ctx,
    );
    expect(out.text).toBe('Title Some bold and ioctl(). remember');
  });

  it('reports fence and alert problems, without a file prefix', async () => {
    const out = await renderer.render(
      '```pcap\nx\n```\n\n```c {9-1}\ny\n```\n\n> [!FOO]\n> body',
      ctx,
    );
    expect(out.warnings).toEqual([
      'code block language "pcap" is not highlighted',
      'code block "c {9-1}": invalid line range "9-1"',
      'unknown alert type "[!FOO]"; rendered as a blockquote',
    ]);
  });

  it('has no warnings for a clean document', async () => {
    expect((await renderer.render('Just text.', ctx)).warnings).toEqual([]);
  });
});

describe('one parse per article', () => {
  it('parses once and renders from those tokens', async () => {
    const parse = vi.spyOn(MarkdownIt.prototype, 'parse');
    const out = await renderer.render('## A\n\n```c\nint a;\n```\n\nText[^1]\n\n[^1]: n', ctx);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(fullHtml(out)).toContain('shiki');
    expect(out.text).toContain('Text');
    expect(fullHtml(out)).toContain('footnote-ref');
  });

  it('renders a document from tokens parsed after its grammars were loaded', async () => {
    const parse = vi.spyOn(MarkdownIt.prototype, 'parse');
    await Promise.all([renderer.render('```lua\nx = 1\n```', ctx), renderer.render('b', ctx)]);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

describe('parseMarkdown', () => {
  it('yields the tokens the renderer works from, with ids and fence info already attached', () => {
    const tokens = parseMarkdown('## Head\n\n```C {1}\nx\n```', { docId: 'd' });
    expect(tokens.find((t) => t.type === 'heading_open')?.attrGet('id')).toBe('d--head');
    expect(tokens.find((t) => t.type === 'fence')?.meta).toMatchObject({
      lang: 'c',
      language: 'c',
    });
  });
});

describe('renderInline', () => {
  it('renders inline Markdown', () => {
    expect(renderInline('**b** `c` *d* a_b', '/x/')).toBe(
      '<strong>b</strong> <code>c</code> <em>d</em> a_b',
    );
  });

  it('escapes raw HTML instead of passing it through', () => {
    const out = renderInline('<b>x</b> <img src=x onerror=alert(1)> <script>1</script>', '/x/');
    expect(out).toBe(
      '&lt;b&gt;x&lt;/b&gt; &lt;img src=x onerror=alert(1)&gt; &lt;script&gt;1&lt;/script&gt;',
    );
  });

  it('leaves the document renderer passing raw HTML through', async () => {
    const html = fullHtml(
      await getRenderer('markdown').render('<b>x</b>', {
        baseUrl: '/x/',
        docId: 'd',
        title: 'T',
      }),
    );
    expect(html).toContain('<b>x</b>');
  });

  it('produces no block elements: block syntax stays literal text', () => {
    const out = renderInline(
      '# Not a heading\n- not a list\n> not a quote\n\n```\nnot code\n```',
      '/x/',
    );
    expect(out).not.toMatch(/<(h\d|ul|ol|li|blockquote|pre|p)[ >]/);
    expect(out).toContain('# Not a heading');
  });

  it('resolves relative links against the page and leaves absolute ones alone', () => {
    expect(renderInline('[a](doc.pdf) [b](https://e.com/x)', '/resume/')).toBe(
      '<a href="/resume/doc.pdf">a</a> <a href="https://e.com/x">b</a>',
    );
  });

  it('escapes what is not markup', () => {
    expect(renderInline('1 < 2 & 3', '/x/')).toBe('1 &lt; 2 &amp; 3');
  });
});

describe('the HTML renderer', () => {
  const render = (source: string, baseUrl = '/talks/') =>
    getRenderer('html').render(source, { baseUrl, docId: 'talks', title: 'T' });

  it('resolves URLs against the page and changes nothing else', async () => {
    const source =
      '<h1 id=top>T</h1>\n<p><a href=a.png class="x">a</a> <img src="../b.png">  <a href="#top">t</a></p>';
    const { body, toc, text, warnings } = await render(source);
    expect(body).toBe(
      '<h1 id=top>T</h1>\n<p><a href="/talks/a.png" class="x">a</a> <img src="/b.png">  <a href="#top">t</a></p>',
    );
    expect([toc, text, warnings]).toEqual(['', '', []]);
  });

  it('leaves absolute and external URLs alone, and malformed markup byte for byte', async () => {
    const source = '<a href="/x/">a</a><a href="https://e.org/">b</a><p>unclosed <b>';
    expect((await render(source)).body).toBe(source);
  });

  it('is registered under its format', () => {
    expect(getRenderer('html').format).toBe('html');
  });
});

describe('firstHeadingText', () => {
  it.each([
    ['<h1>Title</h1>', 'Title'],
    ['<p>x</p><h1 class="a"> A  <em>b</em>\n c </h1><h1>Other</h1>', 'A b c'],
    ['<h1>Fish &amp; chips</h1>', 'Fish & chips'],
    ['<h2>No</h2><H1>Upper</H1>', 'Upper'],
    ['<h1><span>Nested <b>deep</b></span></h1>', 'Nested deep'],
    ['<h1>Unclosed', 'Unclosed'],
  ])('reads %j as %j', (source, expected) => {
    expect(firstHeadingText(source)).toBe(expected);
  });

  it.each(['', '<p>text</p>', '<h2>x</h2>'])('finds no <h1> in %j', (source) => {
    expect(firstHeadingText(source)).toBeUndefined();
  });

  it.each(['<h1></h1>', '<h1>  \n </h1>', '<h1><img src="x"></h1>'])(
    'finds an empty <h1> in %j',
    (source) => {
      expect(firstHeadingText(source)).toBe('');
    },
  );
});
