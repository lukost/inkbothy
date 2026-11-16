import { beforeAll, describe, expect, it } from 'vitest';
import { required } from '../../src/shared/guards.ts';
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, type TextSize } from '../../src/shared/ui-state.ts';
import { parseRules, type Rule, readStyle, styleFiles, usedVariables } from './css.ts';

const sheets: Record<string, Rule[]> = {};

beforeAll(async () => {
  for (const file of await styleFiles()) {
    sheets[file] = parseRules(await readStyle(file));
  }
});

const rulesOf = (file: string, selector: string): Rule[] =>
  (sheets[file] ?? []).filter((r) => r.selector === selector);

function rule(file: string, selector: string, at: readonly string[] = []): Rule {
  const found = rulesOf(file, selector).filter((r) => r.at.join('|') === at.join('|'));
  expect(found, `${file}: ${selector}`).toHaveLength(1);
  return found[0] ?? { at, selector, declarations: new Map() };
}

const decl = (r: Rule, name: string) => r.declarations.get(name);
const num = (value: string | undefined, what: string) => Number(required(value, what));

/** Scale and leading the stylesheet gives each step; the default step is declared in tokens.css. */
function valuesOf(size: TextSize): { scale: number; leading: number } {
  const r =
    size === DEFAULT_TEXT_SIZE
      ? rule('tokens.css', 'html')
      : rule('text-size.css', `html[data-text-size="${size}"]`);
  return {
    scale: num(decl(r, '--content-scale'), `scale of ${size}`),
    leading: num(decl(r, '--content-leading'), `leading of ${size}`),
  };
}

/** Root font sizes in px the stylesheet produces: wide and small screens, from a 16px browser default. */
function rootSizes(): number[] {
  const percent = (r: Rule) => Number.parseFloat(required(decl(r, 'font-size'), 'root size'));
  const wide = rule('base.css', 'html');
  const small = rule('base.css', 'html', ['@media (max-width: 599.98px)']);
  return [percent(wide), percent(small)].map((p) => (p / 100) * 16);
}

/** The em multiplier of a font-size declared in em. */
const em = (r: Rule): number => {
  const value = required(decl(r, 'font-size'), `font-size of ${r.selector}`);
  expect(value, r.selector).toMatch(/^[\d.]+em$/);
  return Number.parseFloat(value);
};

describe('steps', () => {
  it.each(TEXT_SIZES)('give %s%% the scale of that percentage', (size) => {
    expect(valuesOf(size).scale).toBeCloseTo(Number(size) / 100, 5);
  });

  it('are exactly the steps the stylesheet declares, besides the default', () => {
    const declared = (sheets['text-size.css'] ?? []).map((r) => r.selector).sort();
    const expected = TEXT_SIZES.filter((s) => s !== DEFAULT_TEXT_SIZE)
      .map((s) => `html[data-text-size="${s}"]`)
      .sort();
    expect(declared).toEqual(expected);
  });

  it('declare nothing but the two text-size tokens, at no media condition', () => {
    for (const r of sheets['text-size.css'] ?? []) {
      expect([...r.declarations.keys()].sort(), r.selector).toEqual([
        '--content-leading',
        '--content-scale',
      ]);
      expect(r.at, r.selector).toEqual([]);
    }
  });

  it('leave the default unscaled', () => {
    expect(valuesOf(DEFAULT_TEXT_SIZE).scale).toBe(1);
  });
});

describe('line height', () => {
  it('has a discrete value for each step: 1.65 from 100% up, tighter below', () => {
    expect(TEXT_SIZES.map((s) => valuesOf(s).leading)).toEqual([
      1.34, 1.42, 1.52, 1.65, 1.65, 1.65,
    ]);
  });

  it('never rises as the text shrinks, and falls with every step below 100%', () => {
    const leadings = TEXT_SIZES.map((s) => valuesOf(s).leading);
    for (const [i, leading] of leadings.entries()) {
      const next = leadings[i + 1];
      if (next !== undefined) {
        expect(leading, `${TEXT_SIZES[i]}%`).toBeLessThanOrEqual(next);
        if (Number(TEXT_SIZES[i + 1]) <= 100) {
          expect(leading, `${TEXT_SIZES[i]}%`).toBeLessThan(next);
        }
      }
    }
  });

  it('is the body line height at the default, so unscaled text is unchanged', () => {
    expect(decl(rule('base.css', 'body'), 'line-height')).toBe(
      String(valuesOf(DEFAULT_TEXT_SIZE).leading),
    );
  });

  it('is unitless, so it follows each element’s own font size', () => {
    for (const size of TEXT_SIZES) {
      expect(String(valuesOf(size).leading)).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  it('leaves code blocks and tables with their own fixed leading', () => {
    for (const [file, selector] of [
      ['code.css', '.code-block pre'],
      ['markdown.css', '.table-wrap table'],
    ] as const) {
      const leading = required(decl(rule(file, selector), 'line-height'), selector);
      expect(leading, selector).toMatch(/^\d+(\.\d+)?$/);
      expect(usedVariables(leading), selector).toEqual([]);
    }
  });
});

describe('column width', () => {
  it('is set in rem and a share of the reading area, never in the text size', () => {
    const tokens = rule('tokens.css', 'html');
    expect(decl(tokens, '--column-min')).toMatch(/rem$/);
    expect(decl(tokens, '--column-max')).toMatch(/rem$/);
    expect(decl(tokens, '--column-share')).toMatch(/%$/);
    for (const [file, list] of Object.entries(sheets)) {
      for (const r of list) {
        for (const [name, value] of r.declarations) {
          if (/^--column-|^--toc-/.test(name) && file !== 'tokens.css') {
            throw new Error(`${file}: ${r.selector} redefines ${name}`);
          }
          if (/--column-|--toc-/.test(value) || /^(flex|width|max-width|min-width)$/.test(name)) {
            expect(usedVariables(value), `${file}: ${r.selector} ${name}`).not.toContain(
              '--content-scale',
            );
          }
        }
      }
    }
  });

  it('is not measured in ch anywhere, except the code gutter that follows the code font by design', () => {
    const inCh: string[] = [];
    for (const [file, list] of Object.entries(sheets)) {
      for (const r of list) {
        for (const [name, value] of r.declarations) {
          if (/\dch\b/.test(value)) {
            inCh.push(`${file}: ${r.selector} ${name}`);
          }
        }
      }
    }
    expect(inCh).toEqual([
      'code.css: .line-numbers .line::before width',
      'code.css: .line-numbers .line::before margin-right',
    ]);
  });

  it('is not capped by a per-block width in the article content', () => {
    for (const file of ['markdown.css', 'article.css']) {
      for (const r of sheets[file] ?? []) {
        expect(
          r.declarations.has('max-width') && r.selector.includes('md-content'),
          r.selector,
        ).toBe(false);
      }
    }
  });
});

describe('scope', () => {
  it('scales the whole content column from the scale token, leading included', () => {
    const column = rule('layout.css', '.column');
    expect(decl(column, 'font-size')).toBe('calc(1rem * var(--content-scale))');
    expect(decl(column, 'line-height')).toBe('var(--content-leading)');
    expect(rulesOf('article.css', '.article')).toEqual([]);
  });

  it('uses the tokens nowhere but on the column', () => {
    const users = Object.entries(sheets).flatMap(([file, list]) =>
      list
        .filter((r) =>
          [...r.declarations.values()].some((v) => /--content-(scale|leading)/.test(v)),
        )
        .map((r) => `${file}: ${r.selector}`),
    );
    expect(users).toEqual(['layout.css: .column']);
  });

  it('leaves the chrome at fixed sizes: the top bar and menu declare no scaled size', () => {
    for (const file of ['menu.css', 'search.css']) {
      for (const r of sheets[file] ?? []) {
        for (const value of r.declarations.values()) {
          expect(value, `${file}: ${r.selector}`).not.toMatch(/--content-/);
        }
      }
    }
    for (const r of sheets['layout.css'] ?? []) {
      for (const value of r.declarations.values()) {
        if (r.selector !== '.column') {
          expect(value, `layout.css: ${r.selector}`).not.toMatch(/--content-/);
        }
      }
    }
  });

  it('sizes everything inside the column in em, so it follows the column', () => {
    const rem: string[] = [];
    for (const [file, selector] of [
      ['code.css', '.code-block pre'],
      ['markdown.css', '.table-wrap table'],
      ['markdown.css', '.footnotes'],
      ['markdown.css', '.toc'],
      ['base.css', 'figcaption'],
      ['article.css', '.article-dates'],
      ['article.css', '.article-footer'],
      ['article.css', '.article-categories, .article-tags'],
    ] as const) {
      const size = decl(rule(file, selector), 'font-size') ?? '';
      if (!/\dem$/.test(size)) {
        rem.push(`${file}: ${selector} ${size}`);
      }
    }
    expect(rem).toEqual([]);
  });

  it('declares no rem font size or spacing in the content stylesheets, except grid track widths', () => {
    const rem: string[] = [];
    for (const file of ['article.css', 'cards.css', 'code.css', 'markdown.css', 'resume.css']) {
      for (const r of sheets[file] ?? []) {
        for (const [name, value] of r.declarations) {
          if (/\drem\b/.test(value) && name !== 'grid-template-columns') {
            rem.push(`${file}: ${r.selector} ${name}`);
          }
        }
      }
    }
    expect(rem).toEqual([]);
  });

  it('spaces the parts of the article in em, so the gaps tighten with the text', () => {
    const fixed: string[] = [];
    for (const r of sheets['article.css'] ?? []) {
      if (
        !/^\.article-(dates|categories|tags|footer|updates|copyright|header)|^\.draft-banner/.test(
          r.selector,
        )
      ) {
        continue;
      }
      for (const name of ['margin', 'margin-top', 'padding-top', 'gap', 'font-size']) {
        if (/\drem\b/.test(r.declarations.get(name) ?? '')) {
          fixed.push(`${r.selector} ${name}`);
        }
      }
    }
    expect(fixed).toEqual([]);
  });
});

describe('type scale', () => {
  const sizeOfHeading = (tag: 'h1' | 'h2' | 'h3') => em(rule('base.css', tag));

  it('keeps every heading in em, wherever it sits in the article', () => {
    for (const file of ['base.css', 'article.css', 'markdown.css']) {
      for (const r of sheets[file] ?? []) {
        if (/(^|[ >,])h[1-6]\b/.test(r.selector) && r.declarations.has('font-size')) {
          expect(decl(r, 'font-size'), `${file}: ${r.selector}`).toMatch(/em$/);
        }
      }
    }
  });

  it.each(TEXT_SIZES)('orders h1 > h2 > h3 > body text at %s%%, at both root sizes', (size) => {
    const { scale } = valuesOf(size);
    for (const root of rootSizes()) {
      const body = root * scale;
      const [h1, h2, h3] = [sizeOfHeading('h1'), sizeOfHeading('h2'), sizeOfHeading('h3')].map(
        (m) => m * body,
      );
      expect(h1, `h1 at ${root}px`).toBeGreaterThan(required(h2, 'h2'));
      expect(h2, `h2 at ${root}px`).toBeGreaterThan(required(h3, 'h3'));
      expect(h3, `h3 at ${root}px`).toBeGreaterThan(body);
    }
  });

  it('does not shrink code a second time inside a block', () => {
    const block = em(rule('code.css', '.code-block pre'));
    const inner = em(rule('base.css', 'pre code'));
    expect(inner).toBe(1);
    expect(block * inner).toBeCloseTo(0.875, 5);
    const inline = em(rule('base.css', 'code, kbd, samp, pre'));
    expect(inline).toBeCloseTo(0.875, 5);
  });
});

/** Computed font size in px of the innermost element of a chain, outermost first, inside a column of `column` px; an element without a declared size inherits. */
function computedSize(column: number, chain: readonly (readonly [string, string])[]): number {
  return chain.reduce((size, [file, selector]) => {
    const value = decl(rule(file, selector), 'font-size');
    return value === undefined ? size : size * em(rule(file, selector));
  }, column);
}

describe('computed sizes', () => {
  /** Representative elements: their font size in rem before the column scaled them. */
  const elements = [
    ['resume h2', [['base.css', 'h2']], 1.73],
    ['resume headline', [['resume.css', '.resume-headline']], 1.15],
    ['resume entry title', [['resume.css', '.resume-entry h3']], 1.1],
    ['resume place', [['resume.css', '.resume-place, .resume-period']], 0.875],
    ['card title', [['cards.css', '.card h2, .card h3']], 1.15],
    ['card repository', [['cards.css', '.card-repo']], 0.875],
    ['home section heading', [['base.css', 'h2']], 1.73],
    ['post title', [['cards.css', '.post-list h2, .post-list h3']], 1.2],
    ['article dates', [['article.css', '.article-dates']], 0.875],
    ['tag list', [['article.css', '.article-categories, .article-tags']], 0.8125],
  ] as const;

  it.each(elements)('keeps %s at its former size at 100%, at both root sizes', (_, chain, rem) => {
    for (const root of rootSizes()) {
      expect(computedSize(root * valuesOf(DEFAULT_TEXT_SIZE).scale, chain)).toBeCloseTo(
        rem * root,
        5,
      );
    }
  });

  it.each(elements)('scales %s with every step', (_, chain, rem) => {
    for (const size of TEXT_SIZES) {
      for (const root of rootSizes()) {
        expect(computedSize(root * valuesOf(size).scale, chain)).toBeCloseTo(
          rem * root * valuesOf(size).scale,
          5,
        );
      }
    }
  });

  it('keeps the resume title gap at 0.25rem at 100%', () => {
    const title = em(rule('base.css', 'h1'));
    const gap = Number.parseFloat(
      required(decl(rule('resume.css', '.resume-header .page-title'), 'margin-bottom'), 'gap'),
    );
    expect(gap * title).toBeCloseTo(0.25, 2);
  });
});

describe('column width', () => {
  it('does not depend on the text size: no step declares anything else', () => {
    const column = rule('layout.css', '.column');
    expect(decl(column, 'flex')).not.toContain('--content-');
    expect(decl(column, 'min-width')).toBe('0');
    for (const r of sheets['text-size.css'] ?? []) {
      expect([...r.declarations.keys()].every((k) => k.startsWith('--content-'))).toBe(true);
    }
  });
});

describe('print', () => {
  it('ignores the scale and uses its own line height, in the layer that wins over every step', () => {
    const html = rule('print.css', 'html', ['@media print']);
    expect(decl(html, '--content-scale')).toBe('1');
    expect(decl(html, '--content-leading')).toBe('1.45');
    expect(decl(html, 'font-size')).toBe('11pt');
  });
});
