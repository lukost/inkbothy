import { describe, expect, it } from 'vitest';
import { createMarkdown } from '../../../src/generator/markdown/markdown.ts';
import rebaseLinks, {
  type RebaseContext,
  rebaseHtml,
} from '../../../src/generator/markdown/rebase.ts';

const BASE = '/blog/post/';
const plain: RebaseContext = { baseUrl: BASE, idPrefix: '', headingIds: new Set() };
const rebase = (html: string) => rebaseHtml(html, plain);

describe('rebaseHtml', () => {
  it.each([
    ['<img src="a.png">', '<img src="/blog/post/a.png">'],
    ["<img src='a.png'>", "<img src='/blog/post/a.png'>"],
    ['<img src=a.png>', '<img src="/blog/post/a.png">'],
    ['<img src = "a.png" alt="x">', '<img src = "/blog/post/a.png" alt="x">'],
    ['<img\n  src="a.png"\n  alt="x"\n>', '<img\n  src="/blog/post/a.png"\n  alt="x"\n>'],
    ['<IMG SRC="a.png">', '<IMG SRC="/blog/post/a.png">'],
    ['<a href="../x/">t</a>', '<a href="/blog/x/">t</a>'],
    [
      '<img src="a.png" srcset="a.png 1x, ../b.png 2x">',
      '<img src="/blog/post/a.png" srcset="/blog/post/a.png 1x, /blog/b.png 2x">',
    ],
    [
      '<video poster="p.jpg" src="v.mp4"></video>',
      '<video poster="/blog/post/p.jpg" src="/blog/post/v.mp4"></video>',
    ],
    ['<object data="o.svg"></object>', '<object data="/blog/post/o.svg"></object>'],
    [
      '<blockquote cite="q.html">q</blockquote>',
      '<blockquote cite="/blog/post/q.html">q</blockquote>',
    ],
    [
      '<svg><a href="s.html"><use href="i.svg#i"/></a><use xlink:href="x.svg#j"/></svg>',
      '<svg><a href="/blog/post/s.html"><use href="/blog/post/i.svg#i"/></a><use xlink:href="/blog/post/x.svg#j"/></svg>',
    ],
    [
      '<a href="a/">1</a> text <a href="b/">2</a>',
      '<a href="/blog/post/a/">1</a> text <a href="/blog/post/b/">2</a>',
    ],
    ['<img src="">', '<img src="">'],
  ])('%s', (source, expected) => {
    expect(rebase(source)).toBe(expected);
  });

  it.each([
    '<img src="/abs.png" alt="x">',
    '<a href="https://e.com/">e</a>',
    '<a href="//cdn.example/x">cdn</a>',
    '<a href="mailto:a@b.c">m</a>',
    '<a href="#frag">f</a>',
    '<a href="\\\\host\\share">unc</a>',
    '<img src="data:image/png;base64,AAAA">',
    '<img src>',
    '<input disabled checked>',
    '<a name="top" id="x" class=\'c\' title="a &amp; b">anchor</a>',
    '<p style="background:url(rel.png)">style is not rebased</p>',
    '<a href="x/" title="t">no relative URL in an attribute that is not one</a>'.replace(
      'x/',
      '/x/',
    ),
  ])('leaves %s byte-identical', (source) => {
    expect(rebase(source)).toBe(source);
  });

  it('leaves everything but the changed values byte-identical', () => {
    const source = [
      '<!-- <img src="comment.png"> -->',
      '<DIV   Class = \'a  b\'\tDATA-X="1&lt;2"  >Text &copy; &#169; &nbsp;<br/>',
      '<img  alt="a &quot;quoted&quot; &amp; text"   src=\'pic.png\'  />',
      '</div>',
      '<![CDATA[ raw ]]>',
      '<?php echo "<img src=x.png>" ?>',
    ].join('\n');
    const expected = source.replace("src='pic.png'", "src='/blog/post/pic.png'");
    expect(expected).not.toBe(source);
    expect(rebase(source)).toBe(expected);
  });

  it('decodes entities in a value before rebasing and encodes the result for the quotes used', () => {
    expect(rebase('<a href="a&amp;b.html?x=1&amp;y=2#h">x</a>')).toBe(
      '<a href="/blog/post/a&amp;b.html?x=1&amp;y=2#h">x</a>',
    );
    expect(rebase('<a href="it&#39;s.html">x</a>')).toBe('<a href="/blog/post/it\'s.html">x</a>');
    expect(rebase("<a href='it&#39;s.html'>x</a>")).toBe(
      "<a href='/blog/post/it&#39;s.html'>x</a>",
    );
    expect(rebase('<a href=a&amp;b>x</a>')).toBe('<a href="/blog/post/a&amp;b">x</a>');
  });

  it('keeps a double quote of the value inside double quotes escaped', () => {
    expect(rebase('<a href="a&quot;b.html">x</a>')).toBe('<a href="/blog/post/a%22b.html">x</a>');
    expect(rebase("<a href='a&quot;b&#39;c.html'>x</a>")).toBe(
      "<a href='/blog/post/a%22b&#39;c.html'>x</a>",
    );
  });

  it('does not look into script, style, comments or text', () => {
    const source =
      '<script>document.write(\'<img src="a.png">\')</script><style>a{background:url(b.png)}</style><!-- <a href="c/"> -->&lt;img src="d.png"&gt;';
    expect(rebase(source)).toBe(source);
  });

  it('handles fragments that are a single open or close tag', () => {
    expect(rebase('<a href="x/">')).toBe('<a href="/blog/post/x/">');
    expect(rebase('</a>')).toBe('</a>');
    expect(rebase('<span>')).toBe('<span>');
    expect(rebase('')).toBe('');
    expect(rebase('plain text, no markup')).toBe('plain text, no markup');
  });

  it('rewrites every candidate when attributes repeat or tags are nested', () => {
    expect(rebase('<a href="a/" href="b/"><img src="c.png"></a>')).toBe(
      '<a href="/blog/post/a/" href="/blog/post/b/"><img src="/blog/post/c.png"></a>',
    );
  });

  it.each([
    ['unterminated attribute value', '<img src="a.png'],
    ['unterminated tag', '<img src="a.png" alt="x"'],
    ['stray angle brackets', 'a < b > c <3 <> << <a href="x">'],
    ['tag without a name', '< src="a.png">'],
    ['closing tag with attributes', '</a href="x/">'],
    ['unclosed comment', '<!-- <img src="a.png">'],
    ['broken entities', '<a title="&amp &#xZZ; &unknown;">x</a>'],
    ['lone quotes', '<a href=">x</a>\'">'],
  ])('does not throw on malformed HTML: %s', (_name, source) => {
    expect(() => rebase(source)).not.toThrow();
  });

  it('only rewrites the attributes of well-formed tags in malformed input', () => {
    expect(rebase('<img src="a.png')).toBe('<img src="a.png');
    expect(rebase('< b ><img src="a.png"> <3')).toBe('< b ><img src="/blog/post/a.png"> <3');
  });
});

describe('rebaseLinks', () => {
  const md = createMarkdown().use(rebaseLinks);
  const render = (source: string, env: Record<string, unknown> = { baseUrl: BASE, docId: 'd' }) =>
    md.render(source, env);

  it('keeps the autolink class on a rebased link, and adds none to a link with other text', () => {
    const out = render(
      'https://auto.link/x <https://angle.link/> [a](rel/) [https://t.link/](https://t.link/)',
    );
    expect(out.match(/<a [^>]*>/g)).toEqual([
      '<a href="https://auto.link/x" class="autolink">',
      '<a href="https://angle.link/" class="autolink">',
      `<a href="${BASE}rel/">`,
      '<a href="https://t.link/" class="autolink">',
    ]);
  });

  it('rebases links and images, reference style and autolinks included', () => {
    const out = render(
      [
        '[rel](other/) [up](../x/) [abs](/a/) [ext](https://e.com/) [mail](mailto:a@b.c) [frag](#sec)',
        '![alt](img.png "t") [ref][r] <https://auto.link/> https://bare.link/x',
        '',
        '[r]: refs/page.html',
      ].join('\n'),
    );
    expect([...out.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1])).toEqual([
      '/blog/post/other/',
      '/blog/x/',
      '/a/',
      'https://e.com/',
      'mailto:a@b.c',
      '#sec',
      '/blog/post/img.png',
      '/blog/post/refs/page.html',
      'https://auto.link/',
      'https://bare.link/x',
    ]);
  });

  it('rebases inside raw HTML blocks and inline HTML', () => {
    const out = render(
      [
        '<div class="x"><img src="p.png" srcset="p.png 1x, ../q.png 2x" alt=""></div>',
        '',
        'Inline <a href="rel/">link</a> and <img src=i.png>.',
        '',
        '<picture><source srcset="s.png 480w"><img src="//cdn/x.png" alt=""></picture>',
      ].join('\n'),
    );
    expect(out).toContain(
      '<img src="/blog/post/p.png" srcset="/blog/post/p.png 1x, /blog/q.png 2x" alt="">',
    );
    expect(out).toContain('<a href="/blog/post/rel/">link</a>');
    expect(out).toContain('<img src="/blog/post/i.png">');
    expect(out).toContain('<source srcset="/blog/post/s.png 480w"><img src="//cdn/x.png" alt="">');
  });

  it('rebases in nested containers: footnotes, tables, alerts, lists, headings', () => {
    const out = render(
      [
        'Text[^1]',
        '',
        '| a |',
        '|---|',
        '| [t](cell/) |',
        '',
        '> [!NOTE]',
        '> see [n](note/)',
        '',
        '- item [l](list/)',
        '',
        '## Head [h](head/)',
        '',
        '[^1]: Foot [f](foot/) ![i](foot.png)',
      ].join('\n'),
    );
    expect([...out.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1])).toEqual([
      '/blog/post/cell/',
      '/blog/post/note/',
      '/blog/post/list/',
      '/blog/post/head/',
      '/blog/post/foot/',
      '/blog/post/foot.png',
    ]);
  });

  it('rebases per document: the same source under two base URLs', () => {
    expect(render('![a](a.png)', { baseUrl: '/blog/one/' })).toContain('src="/blog/one/a.png"');
    expect(render('![a](a.png)', { baseUrl: '/blog/two/' })).toContain('src="/blog/two/a.png"');
  });

  it('changes nothing without a base URL', () => {
    const source = '[x](rel/) ![i](img.png) <a href="raw/">r</a>';
    expect(render(source, {})).toBe(createMarkdown().render(source, {}));
    expect(render(source, { baseUrl: 42 })).toBe(createMarkdown().render(source, {}));
  });

  it('skips links and images that have no URL attribute', () => {
    const bare = createMarkdown().use(rebaseLinks);
    bare.core.ruler.before('rebase_links', 'strip_urls', (state) => {
      for (const token of state.tokens.flatMap((t) => t.children ?? [])) {
        token.attrs = token.type === 'image' ? [['alt', '']] : [];
      }
    });
    expect(bare.render('[a](x/) ![b](y.png)', { baseUrl: BASE })).toBe(
      '<p><a>a</a> <img alt="b"></p>\n',
    );
  });

  it('leaves code untouched', () => {
    const out = render('`[x](rel/)`\n\n```html\n<img src="a.png">\n```\n\n    <a href="b/">\n');
    expect(out).not.toContain('/blog/post/');
  });
});

describe('rebaseHtml performance', () => {
  it('stays linear in the size of a block with many URL attributes', () => {
    const block = (n: number) =>
      Array.from({ length: n }, (_, i) => `<img src="img${i}.png" alt="${i}">`).join('\n');
    const time = (n: number) => {
      const start = performance.now();
      const out = rebase(block(n));
      expect(out.match(/src="\/blog\/post\/img\d+\.png"/g)).toHaveLength(n);
      return performance.now() - start;
    };
    time(200);
    const small = time(2_000);
    const large = time(20_000);
    // Time grows linearly with input size: no per-attribute rescan of the source.
    expect(large).toBeLessThan(Math.max(small, 5) * 40);
  });

  it('reads the blanks around = only inside the attribute', () => {
    const source = `<a   href = "x/"   title="=" >${' ='.repeat(1000)}</a>`;
    expect(rebase(source)).toBe(
      `<a   href = "/blog/post/x/"   title="=" >${' ='.repeat(1000)}</a>`,
    );
  });
});

describe('author anchors', () => {
  const md = createMarkdown().use(rebaseLinks);
  const render = (source: string, docId = 'doc') => md.render(source, { baseUrl: BASE, docId });
  const hrefs = (out: string) => [...out.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  it('points a slug fragment at the prefixed id of the heading it names', () => {
    const out = render('## Intro\n\n[x](#intro) <a href="#intro">raw</a> and [y](#intro "t")');
    expect(out).toContain('<h2 id="doc--intro">');
    expect(hrefs(out)).toEqual(['#doc--intro', '#doc--intro', '#doc--intro', '#doc--intro']);
    // The first of the four is the heading's own permalink.
    expect(out.match(/<a href="#doc--intro">x<\/a>/)).not.toBeNull();
    expect(out).toContain('<a href="#doc--intro">raw</a>');
  });

  it('leaves fragments that name no generated heading alone', () => {
    const out = render(
      [
        '## Intro',
        '',
        '[unknown](#nope) [bare](#) [fn](#fn-doc-1) [ref](#doc--intro) [case](#Intro)',
        '<a id="top"></a> [own](#top) <a href="#top">raw</a> <a href="#nope">raw</a>',
        'Note[^1]',
        '',
        '[^1]: Foot',
      ].join('\n'),
    );
    expect(out).toContain('<a href="#nope">unknown</a>');
    expect(out).toContain('<a href="#doc--intro">ref</a>');
    expect(out).toContain('<a href="#top">own</a>');
    expect(out).toContain('<a href="#top">raw</a>');
    expect(out).toContain('<a href="#nope">raw</a>');
    expect(out).toContain('<a href="#">bare</a>');
    expect(out).toContain('<a href="#Intro">case</a>');
    expect(out).toContain('<a href="#fn-doc-1">fn</a>');
  });

  it('leaves generated links alone: footnotes, heading anchors', () => {
    const out = render('## Intro\n\nNote[^1]\n\n[^1]: Foot');
    expect(out).toContain('href="#fn-doc-1"');
    expect(out).toContain('href="#fnref-doc-1"');
    expect(hrefs(out).filter((h) => h === '#doc--intro')).toHaveLength(1);
  });

  it('follows duplicate slugs to their numbered ids', () => {
    const out = render('## Same\n\n## Same\n\n[a](#same) [b](#same-2) [c](#same-3)');
    expect(out).toContain('<a href="#doc--same">a</a>');
    expect(out).toContain('<a href="#doc--same-2">b</a>');
    expect(out).toContain('<a href="#same-3">c</a>');
  });

  it('works without a docId: the ids are the bare slugs', () => {
    const out = md.render('## Intro\n\n[x](#intro) [y](#other)', { baseUrl: BASE });
    expect(out).toContain('<h2 id="intro">');
    expect(out).toContain('<a href="#intro">x</a>');
    expect(out).toContain('<a href="#other">y</a>');
    const empty = md.render('## Intro\n\n[x](#intro)', { baseUrl: BASE, docId: '' });
    expect(empty).toContain('<a href="#intro">x</a>');
  });

  it('resolves each article of a listing page against its own headings', () => {
    const source = '## Intro\n\n[x](#intro)';
    const page = render(source, 'one') + render(source, 'two') + render('[x](#intro)', 'three');
    expect(page).toContain('<a href="#one--intro">x</a>');
    expect(page).toContain('<a href="#two--intro">x</a>');
    expect(page).toContain('<a href="#intro">x</a>');
    const ids = [...page.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
    const targets = [...page.matchAll(/<a href="#([^"]*)">x<\/a>/g)].map((m) => m[1]);
    expect(targets).toEqual(['one--intro', 'two--intro', 'intro']);
    expect(ids).toEqual(expect.arrayContaining(['one--intro', 'two--intro']));
  });

  it('does not touch fragments of other documents or absolute URLs', () => {
    const out = render(
      '## Intro\n\n[a](other/#intro) [b](https://e.com/#intro) <a href="x.html#intro">c</a>',
    );
    expect(hrefs(out)).toEqual(
      expect.arrayContaining([
        '/blog/post/other/#intro',
        'https://e.com/#intro',
        '/blog/post/x.html#intro',
      ]),
    );
  });
});
