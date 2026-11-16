// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { parseResume } from '../../src/content/resume.ts';
import { getRenderer } from '../../src/generator/render.ts';
import { contrastRatio } from '../../src/lib/contrast.ts';
import { required } from '../../src/shared/guards.ts';
import { html } from '../../src/templates/html.ts';
import { renderResume } from '../../src/templates/resume.ts';
import { $$, fullHtml, item, parseHtml, renderPage } from '../helpers.ts';
import {
  parseRules,
  type Rule,
  readStyle,
  splitSelectors,
  styleFiles,
  usedVariables,
} from './css.ts';

const PRINT = '@media print';
const PAGE_BOXES = [PRINT, '@page'];
const LIGHT_MEDIA = '@media (prefers-color-scheme: light)';
const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const RUNTIME = /^--(shiki-|line-start$)/;

interface Sourced {
  readonly file: string;
  readonly rule: Rule;
}

let print: Rule[] = [];
let others: Sourced[] = [];
let tokens: Rule[] = [];

beforeAll(async () => {
  print = parseRules(await readStyle('print.css'));
  tokens = parseRules(await readStyle('tokens.css'));
  const files = (await styleFiles()).filter((f) => f !== 'print.css');
  others = (
    await Promise.all(
      files.map(async (file) => ({ file, rules: parseRules(await readStyle(file)) })),
    )
  ).flatMap(({ file, rules }) => rules.map((rule) => ({ file, rule })));
});

const context = (rule: Rule): string => rule.at.join('|');

/** The one print rule with exactly this selector text. */
function printRule(selector: string, at: readonly string[] = [PRINT]): Rule {
  const found = print.filter((r) => r.selector === selector && context(r) === at.join('|'));
  expect(found, `${selector} in ${at.join(' ')}`).toHaveLength(1);
  return found[0] ?? { at, selector, declarations: new Map() };
}

/** Print rules in `@media print` whose selector list contains `part` and that set `property`. */
const setting = (part: string, property: string): Rule[] =>
  print.filter(
    (r) =>
      context(r) === PRINT &&
      splitSelectors(r.selector).includes(part) &&
      r.declarations.has(property),
  );

/** Value of `property` set by exactly one print rule for `part`. */
function declared(part: string, property: string): string {
  const found = setting(part, property);
  expect(found, `${part} { ${property} }`).toHaveLength(1);
  return found[0]?.declarations.get(property) ?? '';
}

/** `part` has no print rule that sets `property`. */
function absent(part: string, property: string): void {
  expect(setting(part, property), `${part} { ${property} }`).toEqual([]);
}

/** Selectors of the rule that hides the interface. */
function hiddenSelectors(): string[] {
  const rules = print.filter(
    (r) =>
      context(r) === PRINT &&
      r.declarations.get('display') === 'none' &&
      splitSelectors(r.selector).includes('.sidebar'),
  );
  expect(rules, 'rule hiding the interface').toHaveLength(1);
  return splitSelectors(rules[0]?.selector ?? '');
}

const lightTokens = (): ReadonlyMap<string, string> =>
  tokens.find((r) => r.selector === ':root:not([data-theme="dark"])' && context(r) === LIGHT_MEDIA)
    ?.declarations ?? new Map();

const palette = (): ReadonlyMap<string, string> => printRule(':root').declarations;

function hex(name: string): string {
  const value = palette().get(`--${name}`);
  if (!value?.startsWith('#')) {
    throw new Error(`--${name} is not a hex colour: ${value}`);
  }
  return value;
}

const imports = async (): Promise<{ file: string; layer: string | undefined }[]> =>
  [
    ...(await readStyle('site.css')).matchAll(/@import "\.\/([\w-]+\.css)"(?: layer\((\w+)\))?;/g),
  ].map((m) => ({ file: m[1] ?? '', layer: m[2] }));

describe('cascade layers', () => {
  it('declares the layer order before anything else', async () => {
    const lines = (await readStyle('site.css')).split('\n').filter((l) => l.trim());
    expect(lines[0]).toBe('@layer screen, print;');
  });

  it('imports every screen sheet into the screen layer and print.css into the print layer', async () => {
    const found = await imports();
    const byFile = new Map(found.map((i) => [i.file, i.layer]));
    const screen = (await styleFiles()).filter(
      (f) => !['site.css', 'fonts.css', 'print.css'].includes(f),
    );
    expect(screen.length).toBeGreaterThan(5);
    for (const file of screen) {
      expect(byFile.get(file), file).toBe('screen');
    }
    expect(byFile.get('print.css')).toBe('print');
    expect(found.at(-1)?.file).toBe('print.css');
  });

  it('imports every stylesheet, and fonts without a layer', async () => {
    const found = await imports();
    const files = (await styleFiles()).filter((f) => f !== 'site.css');
    expect(found.map((i) => i.file).sort()).toEqual(files);
    expect(found.find((i) => i.file === 'fonts.css')?.layer).toBeUndefined();
  });

  it('wraps no sheet in a layer itself, so the imports decide', async () => {
    for (const file of (await styleFiles()).filter((f) => f !== 'site.css')) {
      expect(await readStyle(file), file).not.toMatch(/@layer/);
    }
  });

  it('wins over the screen sheets by order, with plain selectors and no !important', async () => {
    const text = await readStyle('print.css');
    expect(text).not.toContain('!important');
    expect(text).not.toMatch(/:root:root|:where\(/);
    expect(print.filter((r) => /:root:root/.test(r.selector))).toEqual([]);
  });
});

describe('structure', () => {
  it('keeps every rule inside @media print', () => {
    expect(print.length).toBeGreaterThan(20);
    expect(print.filter((r) => r.at[0] !== PRINT)).toEqual([]);
  });

  it('is the only sheet with a print media rule', () => {
    expect(others.filter(({ rule }) => rule.at.includes(PRINT))).toEqual([]);
  });
});

describe('hidden interface', () => {
  const chrome = [
    '.sidebar',
    '.topbar',
    '.backdrop',
    '.skip-link',
    '.search-trigger',
    '.search-dialog',
    '.theme-toggle',
    '.menu-button',
    '.copy-code',
    '.copy-code + .visually-hidden',
    '.heading-anchor',
    '.footnote-backref',
    '.no-print',
  ];

  it('hides every piece of chrome', () => {
    expect(hiddenSelectors()).toEqual(chrome);
  });

  it('hides the top bar, whatever it holds', () => {
    expect(declared('.topbar', 'display')).toBe('none');
    expect(hiddenSelectors()).toContain('.topbar');
  });

  it('names elements that the generated pages have', async () => {
    const doc = parseHtml(renderPage({ main: html`<p>x</p>` }));
    const layout = chrome.filter(
      (s) => !/copy-code|heading-anchor|footnote|no-print|search-dialog/.test(s),
    );
    expect(layout.filter((s) => $$(doc, s).length === 0)).toEqual([]);
    const body = fullHtml(
      await getRenderer('markdown').render('## H\n\nA[^1]\n\n[^1]: n', {
        baseUrl: '/x/',
        docId: 'd',
        title: 'T',
      }),
    );
    const root = document.createElement('div');
    root.innerHTML = body;
    for (const s of ['.heading-anchor', '.footnote-backref']) {
      expect($$(root, s).length, s).toBeGreaterThan(0);
    }
  });

  it('keeps the footers, the draft banner and the copyright visible', () => {
    const kept = [
      '.site-footer',
      '.article-footer',
      '.article-copyright',
      '.draft-banner',
      '.toc',
      '.footnotes',
    ];
    expect(hiddenSelectors().filter((s) => kept.some((k) => s.includes(k)))).toEqual([]);
  });
});

describe('overflow', () => {
  it('lets the page overflow, so an open drawer or dialog cannot clip the printout', () => {
    expect(declared('html', 'overflow')).toBe('visible');
    expect(declared('body', 'overflow')).toBe('visible');
  });

  it('answers screen rules that lock the scroll (a test that would be vacuous otherwise)', () => {
    const locks = others.filter(
      ({ rule }) =>
        rule.declarations.get('overflow') === 'hidden' &&
        /\.drawer-open|\.search-dialog/.test(rule.selector),
    );
    expect(locks.map(({ rule }) => rule.selector)).toEqual(
      expect.arrayContaining(['.drawer-open, .drawer-open body']),
    );
  });
});

describe('disclosures', () => {
  it('shows the content of collapsed details', () => {
    const rule = printRule('main details::details-content');
    expect(rule.declarations.get('content-visibility')).toBe('visible');
    expect(rule.declarations.get('display')).toBe('block');
  });

  it('falls back to showing the children of a closed details', () => {
    expect(printRule('details:not([open]) > :not(summary)').declarations.get('display')).toBe(
      'block',
    );
  });
});

describe('light palette', () => {
  it('forces a light colour scheme', () => {
    expect(palette().get('color-scheme')).toBe('light');
  });

  it('defines exactly the colour tokens of the light theme', () => {
    const own = [...palette().keys()].filter((k) => k !== 'color-scheme').sort();
    const themed = [...lightTokens().keys()].filter((k) => k !== 'color-scheme').sort();
    expect(themed.length).toBeGreaterThan(20);
    expect(own).toEqual(themed);
  });

  it('covers every variable that the stylesheets use', () => {
    const statics = tokens.find((r) => r.selector === 'html')?.declarations ?? new Map();
    const unresolved = [...others, ...print.map((rule) => ({ file: 'print.css', rule }))].flatMap(
      ({ file, rule }) => {
        const local = new Set([...rule.declarations.keys()].filter((k) => k.startsWith('--')));
        return [...rule.declarations.values()]
          .flatMap(usedVariables)
          .filter((n) => !palette().has(n) && !statics.has(n) && !local.has(n) && !RUNTIME.test(n))
          .map((n) => `${file}: ${rule.selector} uses ${n}`);
      },
    );
    expect(unresolved).toEqual([]);
  });

  it('differs from the dark theme in every colour but the scrim', () => {
    const dark = tokens.find((r) => r.selector === ':root')?.declarations ?? new Map();
    const shared = [...palette()].filter(
      ([k, v]) => k !== 'color-scheme' && k !== '--scrim' && dark.get(k) === v,
    );
    expect(shared).toEqual([]);
  });

  it('paints the page with the white background token and near-black text', () => {
    expect(palette().get('--bg')).toBe('#fff');
    expect(declared('body', 'background')).toBe('var(--bg)');
    expect(declared('body', 'color')).toBe('var(--fg)');
  });
});

describe('shiki', () => {
  it('always uses the light variables', () => {
    const d = printRule('.shiki span').declarations;
    expect(d.get('color')).toBe('var(--shiki-light)');
    expect(d.get('font-style')).toBe('var(--shiki-light-font-style)');
    expect(d.get('font-weight')).toBe('var(--shiki-light-font-weight)');
    expect(d.get('text-decoration')).toBe('var(--shiki-light-text-decoration)');
    expect(print.flatMap((r) => [...r.declarations.values()]).join(' ')).not.toContain(
      'shiki-dark',
    );
  });

  it('does not set print-color-adjust on text, where it has no effect', () => {
    expect(printRule('.shiki span').declarations.has('print-color-adjust')).toBe(false);
  });
});

describe('typography', () => {
  it('sets 11pt body text with a 1.45 line height and 9pt code', () => {
    expect(declared('html', 'font-size')).toBe('11pt');
    expect(declared('body', 'line-height')).toBe('1.45');
    for (const part of ['code', 'pre', '.code-block pre']) {
      expect(declared(part, 'font-size'), part).toBe('9pt');
    }
  });

  it('keeps three lines of a paragraph together at either end of a page', () => {
    for (const part of ['p', 'li', 'blockquote']) {
      expect(declared(part, 'orphans'), part).toBe('3');
      expect(declared(part, 'widows'), part).toBe('3');
    }
  });
});

describe('page breaks', () => {
  it('keeps headings with the text that follows', () => {
    for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(declared(h, 'break-after'), h).toBe('avoid');
    }
  });

  it('keeps alerts, images, diagrams, tables and the contents list whole', () => {
    for (const part of ['.alert', 'img', 'figure.mermaid', '.table-wrap', 'tr', '.toc']) {
      expect(declared(part, 'break-inside'), part).toBe('avoid');
    }
  });

  it('lets code blocks span pages', () => {
    absent('.code-block', 'break-inside');
    absent('.code-block pre', 'break-inside');
  });

  it('keeps a caption with what it labels: before a code block, after a diagram', () => {
    expect(declared('.code-block figcaption', 'break-after')).toBe('avoid');
    absent('.code-block figcaption', 'break-inside');
    expect(declared('figure.mermaid > figcaption', 'break-before')).toBe('avoid');
  });

  it('sets no break rule on lines, which are inline boxes', () => {
    expect(print.filter((r) => splitSelectors(r.selector).includes('.code-block .line'))).toEqual(
      [],
    );
  });

  it('lays code out as blocks, which can fragment, not inline-blocks', () => {
    expect(declared('.shiki code', 'display')).toBe('block');
    expect(declared('.shiki code', 'min-width')).toBe('0');
  });
});

describe('code and tables', () => {
  it('wraps long lines instead of scrolling or clipping', () => {
    for (const part of ['.code-block pre', '.mermaid-source']) {
      expect(declared(part, 'white-space'), part).toBe('pre-wrap');
      expect(declared(part, 'overflow-wrap'), part).toBe('anywhere');
      expect(declared(part, 'overflow'), part).toBe('visible');
    }
  });

  it('shows every scroll container in full', () => {
    for (const part of ['.code-block', '.toc', '.table-wrap', 'figure.mermaid']) {
      expect(declared(part, 'overflow'), part).toBe('visible');
    }
  });

  it('wraps wide tables to the page width', () => {
    expect(declared('.table-wrap', 'overflow-wrap')).toBe('anywhere');
    expect(declared('.table-wrap table', 'width')).toBe('100%');
  });

  it('keeps line numbers and a light band behind highlighted lines', () => {
    expect(print.some((r) => r.selector.includes('.line-numbers'))).toBe(false);
    expect(declared('.code-block .line.highlighted', 'background')).toBe('var(--hl)');
    expect(declared('.code-block .line.highlighted', 'border-left')).toMatch(/^3px solid /);
  });
});

describe('colour fidelity', () => {
  it('forces exact colours only where colour carries meaning', () => {
    const exact = print
      .filter((r) => r.declarations.get('print-color-adjust') === 'exact')
      .flatMap((r) => splitSelectors(r.selector));
    expect(exact.sort()).toEqual(['.alert', '.code-block .line.highlighted', 'mark', 'th']);
  });
});

describe('diagram copies', () => {
  const MARKDOWN = 'markdown.css';
  type Mode = 'light' | 'dark' | undefined;
  type Os = 'light' | 'dark' | 'none';

  /**
   * Whether the copy named `copy` shows (unless a rule hides it), from the markdown.css rules that
   * apply to the state, in source order: each override is at least as specific and follows its rule.
   */
  function shown(copy: 'light' | 'dark', theme: Mode, os: Os): boolean {
    const applicable = others
      .filter(({ file, rule }) => file === MARKDOWN && rule.selector.includes(`.mermaid-${copy}`))
      .filter(({ rule }) => {
        const media = rule.at.at(0);
        const mediaOk =
          media === undefined ||
          (media === LIGHT_MEDIA && os === 'light') ||
          (media === DARK_MEDIA && os === 'dark');
        const excluded = /:not\(\[data-theme="(\w+)"\]\)/.exec(rule.selector)?.[1];
        const pinned = /:root\[data-theme="(\w+)"\]/.exec(rule.selector)?.[1];
        const themeOk =
          excluded !== undefined
            ? theme !== excluded
            : pinned !== undefined
              ? pinned === theme
              : true;
        return mediaOk && themeOk;
      });
    return applicable.at(-1)?.rule.declarations.get('display') !== 'none';
  }

  // Mirrors tokens.css: dark is the fallback, light only when chosen or preferred by the OS.
  it.each([
    ['dark', undefined, 'none'],
    ['dark', undefined, 'dark'],
    ['light', undefined, 'light'],
    ['light', 'light', 'none'],
    ['light', 'light', 'dark'],
    ['light', 'light', 'light'],
    ['dark', 'dark', 'none'],
    ['dark', 'dark', 'dark'],
    ['dark', 'dark', 'light'],
  ] as const)(
    'shows the %s copy for data-theme=%s, OS preference %s, and not the other',
    (copy, theme, os) => {
      const other = copy === 'light' ? 'dark' : 'light';
      expect(shown(copy, theme, os)).toBe(true);
      expect(shown(other, theme, os)).toBe(false);
    },
  );

  it('removes the hidden copy from the page, so screen readers do not read it twice', () => {
    const hiding = others.filter(
      ({ file, rule }) =>
        file === MARKDOWN &&
        rule.selector.includes('.mermaid-') &&
        rule.declarations.get('display') === 'none',
    );
    expect(hiding).toHaveLength(3);
    expect(
      others.filter(
        ({ rule }) =>
          rule.selector.includes('.mermaid-') &&
          /visibility|opacity|clip|height/.test([...rule.declarations.keys()].join(' ')),
      ),
    ).toEqual([]);
  });

  it('always prints the light copy', () => {
    expect(declared('.mermaid-light', 'display')).toBe('block');
    expect(declared('.mermaid-dark', 'display')).toBe('none');
  });
});

describe('link expansion', () => {
  const rule = (): Rule => {
    const found = print.filter((r) => r.declarations.get('content')?.includes('attr(href)'));
    expect(found).toHaveLength(1);
    return found[0] ?? printRule('');
  };
  const matches = async (): Promise<Map<string, boolean>> => {
    const rendered = await getRenderer('markdown').render(
      [
        '[external](https://example.com/a) [plain http](http://example.com/b)',
        'https://auto.example.com/c <https://angle.example.com/d>',
        '[https://same.example.com/e](https://same.example.com/e)',
        '[internal](/blog/) [relative](../x/) [anchor](#top) [mail](mailto:a@b.c)',
        '',
        '## Top',
        '',
        'Note[^1]',
        '',
        '[^1]: The note.',
      ].join('\n'),
      { baseUrl: '/x/', docId: 'd', title: 'T' },
    );
    const root = document.createElement('div');
    root.innerHTML = fullHtml(rendered);
    const selector = rule().selector.replace(/::after$/, '');
    return new Map(
      $$(root, 'a').map((a) => [`${a.textContent} ${a.getAttribute('href')}`, a.matches(selector)]),
    );
  };

  it('spells out external links, in small muted text', () => {
    const d = rule().declarations;
    expect(rule().selector).toMatch(/::after$/);
    expect(d.get('content')).toBe('" (" attr(href) ")"');
    expect(d.get('color')).toBe('var(--muted)');
    expect(d.get('font-size')).toBe('0.8em');
    expect(d.get('text-decoration')).toBe('none');
  });

  it('applies to external links with their own text only', async () => {
    const found = [...(await matches())].filter(([, expanded]) => expanded).map(([name]) => name);
    expect(found).toEqual(['external https://example.com/a', 'plain http http://example.com/b']);
  });

  it('leaves out autolinks, written-out addresses, anchors, footnotes and internal links', async () => {
    const skipped = [...(await matches())]
      .filter(([, expanded]) => !expanded)
      .map(([name]) => name);
    expect(skipped).toEqual(
      expect.arrayContaining([
        'https://auto.example.com/c https://auto.example.com/c',
        'https://angle.example.com/d https://angle.example.com/d',
        'https://same.example.com/e https://same.example.com/e',
        'internal /blog/',
        'relative /x/',
        'anchor #d--top',
        'mail mailto:a@b.c',
        '# #d--top',
        '[1] #fn-d-1',
        '↩︎ #fnref-d-1',
      ]),
    );
  });

  it('leaves out heading anchors and footnote links even with an external address', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<a class="heading-anchor" href="https://x.example/">#</a><a class="footnote-ref" href="https://x.example/">1</a><a class="footnote-backref" href="https://x.example/">↩</a><a href="https://x.example/">x</a>';
    const selector = rule().selector.replace(/::after$/, '');
    expect($$(root, 'a').map((a) => a.matches(selector))).toEqual([false, false, false, true]);
  });
});

describe('page boxes', () => {
  it('sets the page margin and leaves the paper size to the browser', () => {
    const page = printRule('@page');
    expect(page.declarations.get('margin')).toBe('18mm 16mm');
    expect(page.declarations.has('size')).toBe(false);
  });

  it('prints "page / pages" at the bottom right', () => {
    expect(printRule('@bottom-right', PAGE_BOXES).declarations.get('content')).toBe(
      'counter(page) " / " counter(pages)',
    );
  });

  it('styles the margin boxes small and muted, and leaves the title to the page', () => {
    const left = printRule('@top-left', PAGE_BOXES);
    const right = printRule('@bottom-right', PAGE_BOXES);
    expect(left.declarations.has('content')).toBe(false);
    for (const box of [left, right]) {
      expect(box.declarations.get('color')).toBe(hex('muted'));
      expect(box.declarations.get('font-size')).toMatch(/^[0-9.]+pt$/);
      expect(Number.parseFloat(box.declarations.get('font-size') ?? '99')).toBeLessThanOrEqual(9);
    }
  });

  it('cuts a long title off with an ellipsis instead of wrapping it', () => {
    const d = printRule('@top-left', PAGE_BOXES).declarations;
    expect([d.get('overflow'), d.get('text-overflow'), d.get('white-space')]).toEqual([
      'hidden',
      'ellipsis',
      'nowrap',
    ]);
  });
});

describe('layout', () => {
  it('lays the page out as one column of full width', () => {
    expect(declared('.page', 'display')).toBe('block');
    expect(declared('.content', 'display')).toBe('block');
    expect(declared('main', 'display')).toBe('block');
    expect(declared('main', 'max-width')).toBe('none');
    expect(declared('main', 'padding')).toBe('0');
  });

  it('prints the header as plain text: categories and tags are not pills', () => {
    for (const part of ['.article-categories li', '.article-tags li']) {
      expect(declared(part, 'display'), part).toBe('inline');
      expect(declared(part, 'border'), part).toBe('0');
      expect(declared(part, 'background'), part).toBe('none');
    }
  });
});

describe('contrast on white', () => {
  const alerts = ['note', 'tip', 'important', 'warning', 'caution'];
  const surfaces = ['bg', 'surface', 'code-bg', 'hl', ...alerts.map((a) => `${a}-bg`)];

  it.each(surfaces)('body text on --%s is at least 7:1', (surface) => {
    expect(contrastRatio(hex('fg'), hex(surface))).toBeGreaterThanOrEqual(7);
  });

  it.each(['bg', 'surface', 'code-bg', 'hl'])(
    'muted text and links on --%s are at least 4.5:1',
    (s) => {
      for (const name of ['muted', 'link', 'accent']) {
        expect(contrastRatio(hex(name), hex(s)), name).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(alerts)('the %s title is at least 4.5:1 on white and on its background', (type) => {
    expect(contrastRatio(hex(type), hex('bg'))).toBeGreaterThanOrEqual(4.5);
    for (const name of [type, 'muted', 'link']) {
      expect(contrastRatio(hex(name), hex(`${type}-bg`)), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('marks text in a pair that is at least 4.5:1', () => {
    expect(contrastRatio(hex('mark-fg'), hex('mark-bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['bg', 'surface'])('draws the control border at least 3:1 on --%s', (surface) => {
    expect(contrastRatio(hex('control-border'), hex(surface))).toBeGreaterThanOrEqual(3);
  });
});

describe('resume', () => {
  it('sets a compact type scale below the body size', () => {
    expect(declared('.resume', 'font-size')).toBe('0.9rem');
    expect(declared('.resume', 'line-height')).toBe('1.35');
    expect(declared('.resume .resume-header h1', 'font-size')).toBe('1.7rem');
    expect(declared('.resume .resume-section > h2', 'font-size')).toBe('1.15rem');
    expect(declared('.resume .resume-entry h3', 'font-size')).toBe('1rem');
  });

  it('keeps each position or degree on one page', () => {
    expect(declared('.resume .resume-entry', 'break-inside')).toBe('avoid');
  });

  it('puts the contact details in one row that wraps when it is too wide', () => {
    expect(declared('.resume .resume-contact', 'display')).toBe('flex');
    expect(declared('.resume .resume-contact', 'flex-wrap')).toBe('wrap');
  });

  it('does not spell out the contact links, whose labels carry the address', () => {
    expect(declared('.resume .resume-contact a[href^="http"]::after', 'content')).toBe('none');
  });

  it('sets the skills in two balanced columns, each group kept whole', () => {
    expect(declared('.resume .resume-skills', 'column-count')).toBe('2');
    expect(declared('.resume .resume-skills > div', 'break-inside')).toBe('avoid');
    expect(declared('.resume .resume-skills > div', 'grid-template-columns')).toBe(
      'max-content minmax(0, 1fr)',
    );
  });

  it('keeps project cards whole', () => {
    expect(declared('.card', 'break-inside')).toBe('avoid');
  });

  it('styles only elements that the resume template emits', () => {
    const { resume } = parseResume(
      {
        headline: 'H',
        contact: { location: 'L', links: [{ label: 'Web', url: 'https://example.com' }] },
        experience: [{ role: 'R', org: 'O', start: '2020-01', end: 'present', highlights: ['x'] }],
        skills: [{ group: 'G', items: ['a'] }],
      },
      new Date('2026-06-15T00:00:00Z'),
    );
    const root = document.createElement('div');
    root.innerHTML = String(
      renderResume({
        item: item({ url: '/resume/', section: null }),
        intro: '',
        resume: required(resume, 'resume'),
        inline: (source) => source,
      }),
    );
    const selectors = print
      .filter((r) => context(r) === PRINT && r.selector.startsWith('.resume'))
      .flatMap((r) => splitSelectors(r.selector))
      .map((s) => s.replace(/::\w+$/, ''));
    expect(selectors.length).toBeGreaterThan(5);
    expect(selectors.filter((s) => $$(root, s).length === 0)).toEqual([]);
  });
});

describe('parser', () => {
  it('reads the declarations of at-rules and nested margin boxes', () => {
    const rules = parseRules(
      '@media print { @page { margin: 1mm; @top-left { color: red; } } a { b: c } }',
    );
    expect(rules.map((r) => [r.at.join('|'), r.selector, [...r.declarations]])).toEqual([
      ['@media print', '@page', [['margin', '1mm']]],
      ['@media print|@page', '@top-left', [['color', 'red']]],
      ['@media print', 'a', [['b', 'c']]],
    ]);
  });

  it('splits selector lists at top-level commas', () => {
    expect(splitSelectors('a, :not(b, c), d')).toEqual(['a', ':not(b, c)', 'd']);
  });
});
