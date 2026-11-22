import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../../src/lib/paths.ts';
import { required } from '../../src/shared/guards.ts';
import { RAIL_QUERY, WIDE_QUERY } from '../../src/shared/ui-state.ts';
import { parseRules, type Rule, readStyle, sheet, styleFiles } from './css.ts';

const WIDE = `@media ${WIDE_QUERY}`;
const RAIL = `@media ${RAIL_QUERY}`;
/** What the stylesheet uses below the wide breakpoint: the complement of `WIDE_QUERY`. */
const NARROW_QUERY = '(max-width: 56.2499em)';
const NARROW = `@media ${NARROW_QUERY}`;
const MOTION = '@media (prefers-reduced-motion: no-preference)';

const files = [
  'layout',
  'menu',
  'markdown',
  'code',
  'base',
  'fonts',
  'tokens',
  'cards',
  'article',
  'resume',
] as const;
const sheets: Record<string, Rule[]> = {};

beforeAll(async () => {
  for (const name of files) {
    sheets[name] = parseRules(await readStyle(`${name}.css`));
    sheet(sheets, name);
  }
});

const rulesOf = (file: string, selector: string): Rule[] =>
  sheet(sheets, file).filter((r) => r.selector === selector);

/** The one rule with exactly this selector (and at-rule context), or a failed expectation. */
function rule(file: string, selector: string, at: readonly string[] = []): Rule {
  const found = rulesOf(file, selector).filter((r) => r.at.join('|') === at.join('|'));
  expect(found, `${file}: ${selector} ${at.join(' ')}`).toHaveLength(1);
  return found[0] ?? { at, selector, declarations: new Map() };
}

const decl = (r: Rule, name: string) => r.declarations.get(name);
const normalise = (value: string | undefined) => (value ?? '').replaceAll("'", '"');
const emValue = (query: string) => Number(/(?:min|max)-width: ([\d.]+)em/.exec(query)?.[1]);

describe('breakpoint', () => {
  it('uses only the shared queries for widths, and wide and narrow are exact complements', () => {
    const preludes = new Set(
      sheet(sheets, 'layout')
        .flatMap((r) => r.at)
        .filter((a) => /width/.test(a)),
    );
    expect([...preludes].sort()).toEqual([NARROW, RAIL, WIDE].sort());
    const min = emValue(WIDE_QUERY);
    const max = emValue(NARROW_QUERY);
    expect(min).toBe(56.25);
    expect(min - max).toBeGreaterThan(0);
    expect(min - max).toBeLessThan(0.001);
  });

  it('is in em, so it follows the reader’s font size', () => {
    for (const query of [WIDE_QUERY, NARROW_QUERY, RAIL_QUERY]) {
      expect(query).toMatch(/\dem\)$/);
    }
  });
});

describe('view transitions', () => {
  const names = async () => {
    const found: string[] = [];
    for (const file of await styleFiles()) {
      for (const r of parseRules(await readStyle(file))) {
        const name = r.declarations.get('view-transition-name');
        if (name) {
          found.push(`${r.selector}=${name}@${r.at.join('|')}`);
        }
      }
    }
    return found;
  };

  it('navigates across documents only for people who accept motion', async () => {
    const css = await readStyle('layout.css');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*@view-transition \{\s*navigation: auto;/,
    );
    expect(css.match(/@view-transition/g)).toHaveLength(1);
  });

  it('keeps the top bar and the sidebar in place, each under a name of its own', async () => {
    expect(decl(rule('layout', '.topbar', [MOTION]), 'view-transition-name')).toBe('topbar');
    expect(decl(rule('layout', '.sidebar', [MOTION, WIDE]), 'view-transition-name')).toBe(
      'sidebar',
    );
    expect(await names()).toEqual([
      `.topbar=topbar@${MOTION}`,
      `.sidebar=sidebar@${MOTION}|${WIDE}`,
    ]);
  });

  it('replaces the old top bar at once instead of cross-fading it, only for people who accept motion', () => {
    expect(decl(rule('layout', '::view-transition-old(topbar)', [MOTION]), 'display')).toBe('none');
    expect(decl(rule('layout', '::view-transition-new(topbar)', [MOTION]), 'animation')).toBe(
      'none',
    );
    for (const r of sheet(sheets, 'layout')) {
      if (r.selector.includes('::view-transition')) {
        expect(r.at, r.selector).toEqual([MOTION]);
      }
    }
  });

  it('does not name the sidebar below the wide breakpoint, where it is stacked or a drawer', () => {
    const narrowOrUnconditional = sheet(sheets, 'layout').filter(
      (r) => r.declarations.has('view-transition-name') && !r.at.includes(WIDE),
    );
    expect(narrowOrUnconditional.map((r) => r.selector)).toEqual(['.topbar']);
  });
});

describe('hidden sidebar', () => {
  it('is styled only on wide viewports, and only while the page is scripted', () => {
    const mentioning = Object.entries(sheets).flatMap(([file, list]) =>
      list.filter((r) => r.selector.includes('data-sidebar')).map((r) => ({ file, r })),
    );
    expect(mentioning.length).toBeGreaterThanOrEqual(2);
    for (const { file, r } of mentioning) {
      expect(r.at, `${file}: ${r.selector}`).toEqual([WIDE]);
      expect(r.selector, `${file}: ${r.selector}`).toMatch(/html\.js\[data-sidebar="collapsed"\]/);
    }
  });

  it('removes the whole sidebar, leaving no rail, and gives the content the full width', () => {
    expect(
      decl(rule('layout', 'html.js[data-sidebar="collapsed"] .sidebar', [WIDE]), 'display'),
    ).toBe('none');
    expect(
      decl(
        rule('layout', 'html.js[data-sidebar="collapsed"] .page', [WIDE]),
        'grid-template-columns',
      ),
    ).toBe('minmax(0, 1fr)');
    expect(
      Object.values(sheets)
        .flat()
        .filter((r) => /-rail\b|rail-w/.test(r.selector)),
    ).toEqual([]);
    expect(
      Object.values(sheets)
        .flat()
        .some((r) => [...r.declarations.values()].some((v) => v.includes('--rail-w'))),
    ).toBe(false);
  });

  it('shows the icon of the theme in force, decided by CSS alone, and no other', () => {
    expect(decl(rule('layout', '.icon-light'), 'display')).toBe('none');
    expect(
      decl(
        rule(
          'layout',
          ':root[data-theme="light"] .icon-light, :root[data-theme="light"] .icon-dark',
        ),
        'display',
      ),
    ).toBe('inline');
    expect(decl(rule('layout', ':root[data-theme="light"] .icon-dark'), 'display')).toBe('none');
    const osLight = '@media (prefers-color-scheme: light)';
    expect(
      decl(rule('layout', ':root:not([data-theme="dark"]) .icon-light', [osLight]), 'display'),
    ).toBe('inline');
    expect(
      decl(rule('layout', ':root:not([data-theme="dark"]) .icon-dark', [osLight]), 'display'),
    ).toBe('none');
    expect(sheet(sheets, 'layout').filter((r) => /icon-auto|theme-now/.test(r.selector))).toEqual(
      [],
    );
  });
});

describe('navigation survives a failed script', () => {
  const hides = (r: Rule) =>
    decl(r, 'visibility') === 'hidden' ||
    decl(r, 'display') === 'none' ||
    r.declarations.has('transform') ||
    decl(r, 'position') === 'fixed';
  const targetsSidebar = (r: Rule) =>
    /\.sidebar(?![\w-])|\.sidebar-body|\.site-menu/.test(r.selector);

  it('only hides or moves the sidebar behind .js, which the head script removes if the module fails', () => {
    const offenders = sheet(sheets, 'layout')
      .filter((r) => targetsSidebar(r) && hides(r))
      .filter((r) => !/\.js(?![\w-])/.test(r.selector))
      // On wide viewports the sidebar is a visible column; folding is data-sidebar driven.
      .filter((r) => !r.at.includes(WIDE));
    expect(offenders.map((r) => r.selector)).toEqual([]);
  });

  it('uses no ready class: the head script’s js class alone gates the scripted controls', async () => {
    for (const file of await styleFiles()) {
      const stray = parseRules(await readStyle(file)).filter((r) => /-ready\b/.test(r.selector));
      expect(
        stray.map((r) => r.selector),
        file,
      ).toEqual([]);
    }
  });

  it('shows the menu stacked above the content by default', () => {
    const sidebar = rule('layout', '.sidebar');
    expect(sidebar.at).toEqual([]);
    for (const hidden of ['visibility', 'transform', 'position', 'display']) {
      expect(sidebar.declarations.has(hidden), hidden).toBe(false);
    }
    expect(decl(rule('layout', '.page', [WIDE]), 'display')).toBe('grid');
    expect(rulesOf('layout', '.page').filter((r) => r.at.length === 0)).toHaveLength(0);
  });

  it('moves the sidebar off-canvas on narrow viewports only, and only while scripted', () => {
    const drawer = rule('layout', '.js .sidebar', [NARROW]);
    expect(decl(drawer, 'visibility')).toBe('hidden');
    expect(decl(drawer, 'overscroll-behavior')).toBe('contain');
    const open = rule('layout', '.js.drawer-open .sidebar', [NARROW]);
    expect(decl(open, 'visibility')).toBe('visible');
  });

  it('shows the scripted controls under js, the menu button at every width', () => {
    const hidden = rule('layout', '.menu-button, .backdrop');
    expect(decl(hidden, 'display')).toBe('none');
    expect(decl(rule('layout', '.topbar-tools'), 'display')).toBe('none');
    expect(decl(rule('layout', '.js .topbar-tools'), 'display')).toBe('flex');
    expect(decl(rule('layout', '.topbar-tools button'), 'display')).toBe('inline-flex');
    expect(decl(rule('layout', '.js .menu-button'), 'display')).toBe('inline-flex');
    const menuRules = sheet(sheets, 'layout').filter((r) => /\.menu-button/.test(r.selector));
    expect(menuRules.filter((r) => r.at.length > 0)).toEqual([]);
  });

  it('drops the transitions for reduced motion', () => {
    const r = rule('layout', '.js .sidebar, .topbar-title', [
      '@media (prefers-reduced-motion: reduce)',
    ]);
    expect(decl(r, 'transition')).toBe('none');
  });
});

describe('no pop-in', () => {
  const CLUSTER =
    /topbar-tools|search-trigger|text-smaller|text-larger|theme-toggle|print-button|icon/;
  const hiding = (r: Rule) =>
    ['none'].includes(decl(r, 'display') ?? '') ||
    decl(r, 'visibility') === 'hidden' ||
    decl(r, 'opacity') === '0';

  it('has no rule that hides the cluster under js', async () => {
    for (const file of await styleFiles()) {
      const offenders = parseRules(await readStyle(file)).filter(
        (r) => /\.js(?![\w-])/.test(r.selector) && CLUSTER.test(r.selector) && hiding(r),
      );
      expect(
        offenders.map((r) => r.selector),
        file,
      ).toEqual([]);
    }
  });

  it('hides the cluster before the head script has run only through .topbar-tools and [hidden]', async () => {
    const hidingRules: string[] = [];
    for (const file of await styleFiles()) {
      for (const r of parseRules(await readStyle(file))) {
        if (CLUSTER.test(r.selector) && hiding(r) && r.at.every((a) => !/print/.test(a))) {
          hidingRules.push(`${file}: ${r.selector}`);
        }
      }
    }
    expect(hidingRules.sort()).toEqual([
      'layout.css: .icon-light',
      'layout.css: .topbar-tools',
      'layout.css: .topbar-tools [hidden]',
      'layout.css: :root:not([data-theme="dark"]) .icon-dark',
      'layout.css: :root[data-theme="light"] .icon-dark',
    ]);
  });

  it('reserves the room of the bar before scripts run: its height is fixed and it is always in flow', () => {
    const bar = rule('layout', '.topbar');
    expect(decl(bar, 'height')).toBe('var(--topbar-h)');
    expect(decl(bar, 'display')).toBe('flex');
    expect(decl(bar, 'position')).toBe('sticky');
  });
});

describe('top bar and anchors', () => {
  it('is one sticky bar of a fixed height, between 2.5 and 2.75rem, that every offset below it uses', () => {
    const bar = rule('layout', '.topbar');
    expect(decl(bar, 'position')).toBe('sticky');
    expect(decl(bar, 'height')).toBe('var(--topbar-h)');
    expect(bar.declarations.has('min-height')).toBe(false);
    const height = required(decl(rule('tokens', 'html'), '--topbar-h'), '--topbar-h');
    expect(height).toMatch(/rem$/);
    expect(Number.parseFloat(height)).toBeGreaterThanOrEqual(2.5);
    expect(Number.parseFloat(height)).toBeLessThanOrEqual(2.75);
    for (const [selector, at, property] of [
      ['.js .sidebar', [NARROW], 'top'],
      ['.sidebar', [WIDE], 'top'],
      ['.sidebar', [WIDE], 'height'],
      ['.content', [WIDE], 'min-height'],
      ['.article-single > .toc', [RAIL], 'top'],
      ['.article-single > .toc', [RAIL], 'max-height'],
    ] as const) {
      expect(decl(rule('layout', selector, at), property), `${selector} ${property}`).toContain(
        'var(--topbar-h)',
      );
    }
  });

  it('never hides, moves or animates away on scroll', () => {
    for (const r of sheet(sheets, 'layout')) {
      if (r.selector === '.topbar') {
        expect(r.declarations.has('transform'), r.selector).toBe(false);
        expect(r.declarations.has('translate'), r.selector).toBe(false);
        expect(decl(r, 'display') === 'none', r.selector).toBe(false);
      }
    }
    expect(JSON.stringify(sheets.layout)).not.toMatch(/animation-timeline|scroll-timeline/);
  });

  it('keeps the title in the middle truncated and invisible until shown', () => {
    const title = rule('layout', '.topbar-title');
    expect(decl(title, 'min-width')).toBe('0');
    expect(decl(title, 'text-overflow')).toBe('ellipsis');
    expect(decl(title, 'white-space')).toBe('nowrap');
    expect(decl(title, 'opacity')).toBe('0');
    expect(decl(title, 'visibility')).toBe('hidden');
    const shown = rule('layout', '.topbar-title-shown');
    expect(decl(shown, 'opacity')).toBe('1');
    expect(decl(shown, 'visibility')).toBe('visible');
  });

  it('gives the tools their room first: start and title shrink, tools never do', () => {
    expect(decl(rule('layout', '.topbar-tools'), 'flex')).toBe('none');
    const start = rule('layout', '.topbar-start');
    expect(decl(start, 'flex')).toBe('0 1 auto');
    expect(decl(start, 'min-width')).toBe('0');
    expect(decl(rule('layout', '.topbar-title'), 'flex')).toMatch(/^1 1 0/);
    const title = rule('layout', '.topbar .site-title');
    expect(decl(title, 'min-width')).toBe('0');
    expect(decl(title, 'overflow')).toBe('hidden');
    expect(decl(title, 'text-overflow')).toBe('ellipsis');
    expect(decl(title, 'white-space')).toBe('nowrap');
  });

  it('shows the site title as a home link beside the menu button at every width, scripted or not', () => {
    const hiding = sheet(sheets, 'layout').filter(
      (r) => /\.site-title|\.topbar-start/.test(r.selector) && decl(r, 'display') === 'none',
    );
    expect(hiding).toEqual([]);
    expect(
      sheet(sheets, 'layout').filter((r) => /sidebar-bar|sidebar-collapse/.test(r.selector)),
    ).toEqual([]);
  });

  it('draws the tools as square icon buttons with the control border and a visible focus ring', () => {
    const button = rule('layout', '.topbar button');
    expect(decl(button, 'min-width')).toBe(decl(button, 'height'));
    const base = required(
      sheet(sheets, 'base').find((r) => r.selector === 'button'),
      'button rule',
    );
    expect(decl(base, 'border')).toBe('1px solid var(--control-border)');
    expect(decl(rule('base', ':focus-visible'), 'outline')).toMatch(/^3px solid var\(--focus\)/);
    expect(rulesOf('layout', '.topbar button').some((r) => r.declarations.has('border'))).toBe(
      false,
    );
  });

  it('enlarges the bar’s buttons to at least 2.75rem on touch screens, and only there', () => {
    const coarse = rule('layout', '.topbar button', ['@media (pointer: coarse)']);
    expect(
      Number.parseFloat(required(decl(coarse, 'min-width'), 'min-width')),
    ).toBeGreaterThanOrEqual(2.75);
    expect(
      Number.parseFloat(required(decl(coarse, 'min-height'), 'min-height')),
    ).toBeGreaterThanOrEqual(2.75);
    expect(
      rulesOf('layout', '.topbar button').filter(
        (r) => r.at.length === 0 && r.declarations.has('min-height'),
      ),
    ).toEqual([]);
  });

  it('dims a tool at its bound without removing it from the tab order', () => {
    const dim = rule('layout', '.topbar-tools button[aria-disabled="true"]');
    expect(decl(dim, 'opacity')).toBeDefined();
    expect(decl(dim, 'pointer-events')).toBeUndefined();
  });

  it('keeps anchor targets clear of the sticky top bar at every width', () => {
    expect(rulesOf('layout', 'html')).toHaveLength(1);
    expect(decl(rule('layout', 'html'), 'scroll-padding-top')).toContain('var(--topbar-h)');
    expect(
      sheet(sheets, 'layout').filter(
        (r) => r.at.length > 0 && r.declarations.has('scroll-padding-top'),
      ),
    ).toEqual([]);
  });

  it('has no element-level scroll-margin that would stack with it', () => {
    expect(sheet(sheets, 'markdown').some((r) => r.declarations.has('scroll-margin-top'))).toBe(
      false,
    );
  });
});

/** The reading column and the spacers around it, as the stylesheet defines them. */
function columnModel() {
  const tokens = rule('tokens', 'html');
  const rem = (name: string) => Number.parseFloat(required(decl(tokens, name), name));
  const root =
    (Number.parseFloat(required(decl(rule('base', 'html'), 'font-size'), 'size')) / 100) * 16;
  const share = rem('--column-share') / 100;
  const min = rem('--column-min') * root;
  const max = rem('--column-max') * root;
  const grow = (selector: string) =>
    Number(required(decl(rule('layout', selector), 'flex-grow'), `${selector} flex-grow`));
  const [left, right] = [grow('main::before'), grow('main::after')] as const;
  const cap = (rem('--left-margin-max') - rem('--main-pad')) * root;
  /** Column and spacer widths in a reading area of `area` px; the left spacer stops at its cap and the right one takes the rest. */
  return {
    root,
    cap,
    padding: rem('--main-pad') * root,
    toc: (rem('--toc-w') + rem('--toc-gap')) * root,
    left,
    right,
    at(area: number) {
      const column = Math.max(Math.min(min, area), Math.min(share * area, max));
      const spare = Math.max(area - column, 0);
      const leftWidth = Math.min((spare * left) / (left + right), cap);
      return { column, left: leftWidth, right: spare - leftWidth };
    },
  };
}

describe('wide layout', () => {
  it('lays main out as a row of spacer, column, spacer, the spacers flexing from nothing', () => {
    expect(decl(rule('layout', 'main'), 'display')).toBe('flex');
    const spacers = rule('layout', 'main::before, main::after');
    expect(decl(spacers, 'flex-basis')).toBe('0');
    expect(decl(spacers, 'content')).toBe('""');
    expect(decl(rule('layout', '.column'), 'min-width')).toBe('0');
  });

  it('bounds the column basis by the minimum, the share and the maximum, never by the text size', () => {
    const basis = required(decl(rule('layout', '.column'), 'flex'), 'flex');
    expect(basis).toMatch(
      /^0 1 clamp\(min\(var\(--column-min\), 100%\), var\(--column-share\), var\(--column-max\)\)$/,
    );
  });

  it('splits what the column leaves 0.625 : φ below the cap, so the column sits left of centre', () => {
    const { left, right, at } = columnModel();
    expect(right / left).toBeCloseTo((1 + Math.sqrt(5)) / 2 / 0.625, 3);
    const { left: l, right: r } = at(800);
    expect(l).toBeGreaterThan(0);
    expect(r / l).toBeCloseTo(right / left, 6);
  });

  it('never lets padding plus left spacer exceed 100px, and lets the right spacer take the rest', () => {
    const { at, cap, padding, root } = columnModel();
    expect(padding + cap).toBe(6.25 * root);
    expect(padding).toBe(2 * root);
    for (const area of [700, 900, 1300, 2000, 3000]) {
      const { column, left, right } = at(area);
      expect(padding + left, `${area}px`).toBeLessThanOrEqual(6.25 * root);
      expect(column + left + right, `${area}px`).toBeCloseTo(area, 6);
    }
    const wide = at(3000);
    expect(wide.left).toBe(cap);
    expect(wide.column).toBe(60 * root);
    expect(at(1300).column).toBe(at(1300).column);
  });

  it('fills a narrow screen with the column, and leaves the spacers nothing', () => {
    const { at } = columnModel();
    for (const area of [280, 360, 520, 639]) {
      expect(at(area), `${area}px`).toEqual({ column: area, left: 0, right: 0 });
    }
  });

  it('never goes below the minimum width, nor above the maximum', () => {
    const { at, root } = columnModel();
    for (const area of [700, 900, 1248, 1600, 2400, 4000]) {
      const { column } = at(area);
      expect(column).toBeGreaterThanOrEqual(Math.min(40 * root, area));
      expect(column).toBeLessThanOrEqual(Math.max(60 * root, Math.min(40 * root, area)));
    }
  });

  it('reads wider than the old fixed column: a 1248px reading area gives the column its share', () => {
    const { at } = columnModel();
    expect(at(1248).column).toBeGreaterThan(0.7 * 1248);
  });

  it('does not cap blocks inside the column, which is the one place the width is decided', () => {
    expect(
      sheet(sheets, 'markdown').filter(
        (r) => r.declarations.has('max-width') && /md-content/.test(r.selector),
      ),
    ).toEqual([]);
  });

  it('shows the contents rail only where the right spacer can hold it, with the column at its full basis', () => {
    const model = columnModel();
    const sidebar =
      Number.parseFloat(required(decl(rule('tokens', 'html'), '--sidebar-w'), 'sidebar')) *
      model.root;
    const padding = model.padding;
    const SCROLLBAR = 17;
    const viewport = emValue(RAIL_QUERY) * 16;
    const area = viewport - SCROLLBAR - sidebar - 2 * padding;
    const { right, column } = model.at(area);
    expect(right).toBeGreaterThanOrEqual(model.toc);
    expect(right, 'tuned: not far above what the rail needs').toBeLessThan(model.toc * 1.25);
    expect(column).toBeLessThanOrEqual(60 * model.root);
    // A browser one em narrower would not have room.
    const narrower = model.at(area - 16 * 2);
    expect(narrower.right).toBeLessThan(model.toc);
  });

  it('lifts the table of contents of a single article into a sticky rail, only from the rail breakpoint up', () => {
    const toc = rule('layout', '.article-single > .toc', [RAIL]);
    expect(decl(toc, 'position')).toBe('sticky');
    expect(decl(toc, 'overflow-y')).toBe('auto');
    expect(decl(toc, 'align-self')).toBe('start');
    for (const r of sheet(sheets, 'layout')) {
      if (/article-single/.test(r.selector)) {
        expect(r.at, r.selector).toEqual([RAIL]);
      }
    }
  });

  it('grows the article into the right spacer by exactly the rail, so the text keeps the column width', () => {
    const article = rule('layout', '.article-single', [RAIL]);
    expect(decl(article, 'width')).toBe('calc(100% + var(--toc-w) + var(--toc-gap))');
    expect(decl(article, 'grid-template-columns')).toBe('minmax(0, 1fr) var(--toc-w)');
    expect(decl(article, 'column-gap')).toBe('var(--toc-gap)');
  });

  it('scrolls code, tables and diagrams inside the column and breaks out of it nowhere', async () => {
    for (const file of ['markdown.css', 'code.css', 'article.css']) {
      for (const r of parseRules(await readStyle(file))) {
        for (const name of ['margin-left', 'margin-right', 'margin-inline', 'width', 'min-width']) {
          const value = r.declarations.get(name) ?? '';
          expect(value, `${file}: ${r.selector} ${name}`).not.toMatch(/vw|-\d/);
        }
      }
    }
    expect(decl(rule('markdown', '.table-wrap'), 'max-width')).toBe('100%');
  });

  it('lets the card grid use the room, without a column wider than the column itself', () => {
    const cards = rule('cards', '.cards');
    expect(decl(cards, 'grid-template-columns')).toBe(
      'repeat(auto-fill, minmax(min(16rem, 100%), 1fr))',
    );
  });
});

describe('scrolling and overflow', () => {
  it('locks the root that scrolls, and body too, while the drawer is open', () => {
    const lock = rule('layout', '.drawer-open, .drawer-open body', [NARROW]);
    expect(decl(lock, 'overflow')).toBe('hidden');
  });

  it('keeps the scrollbar’s space when the page stops scrolling, so nothing shifts under a dialog or drawer', () => {
    const root = rule('base', 'html');
    expect(decl(root, 'scrollbar-gutter')).toBe('stable');
    expect(rulesOf('layout', 'html').some((r) => r.declarations.has('scrollbar-gutter'))).toBe(
      false,
    );
  });

  it('does not clip the body horizontally', () => {
    for (const r of sheet(sheets, 'base')) {
      if (r.selector === 'body') {
        expect(r.declarations.has('overflow-x')).toBe(false);
        expect(r.declarations.has('overflow')).toBe(false);
      }
    }
  });

  it('contains the real overflow sources', () => {
    expect(decl(rule('layout', '.page', [WIDE]), 'grid-template-columns')).toContain(
      'minmax(0, 1fr)',
    );
    expect(
      decl(
        rule('layout', 'html.js[data-sidebar="collapsed"] .page', [WIDE]),
        'grid-template-columns',
      ),
    ).toContain('minmax(0, 1fr)');
    expect(decl(rule('layout', '.content'), 'min-width')).toBe('0');
    expect(decl(rule('layout', '.column'), 'min-width')).toBe('0');
    expect(decl(rule('markdown', '.md-content'), 'overflow-wrap')).toBe('anywhere');
    expect(decl(rule('markdown', '.table-wrap'), 'overflow-x')).toBe('auto');
    expect(decl(rule('markdown', '.table-wrap'), 'overflow-wrap')).toBe('normal');
    expect(decl(rule('markdown', 'figure.mermaid'), 'overflow-x')).toBe('auto');
    expect(decl(rule('code', '.code-block pre'), 'overflow-x')).toBe('auto');
    expect(decl(rule('base', 'img, svg, video'), 'max-width')).toBe('100%');
  });
});

describe('main spacers', () => {
  it('weights the spacers 0.625 : φ, the left one capped', () => {
    expect(decl(rule('layout', 'main::before'), 'flex-grow')).toBe('0.625');
    expect(decl(rule('layout', 'main::after'), 'flex-grow')).toBe('1.618');
    expect(decl(rule('layout', 'main::before'), 'max-width')).toBe(
      'calc(var(--left-margin-max) - var(--main-pad))',
    );
  });

  it('keeps padding plus cap at 6.25rem, with the wide padding as the minimum margin', () => {
    const tokens = rule('tokens', 'html');
    const pad = Number.parseFloat(required(decl(tokens, '--main-pad'), '--main-pad'));
    const cap = Number.parseFloat(required(decl(tokens, '--left-margin-max'), '--left-margin-max'));
    expect(decl(tokens, '--main-pad')).toMatch(/rem$/);
    expect(decl(tokens, '--left-margin-max')).toBe('6.25rem');
    expect(pad).toBe(2);
    expect(pad + (cap - pad)).toBe(6.25);
    expect(decl(rule('layout', 'main', [WIDE]), 'padding')).toBe('2rem var(--main-pad) 3rem');
  });
});

describe('page title', () => {
  it('starts at the top of the column through one shared rule, not per page type', () => {
    expect(decl(rule('base', '.page-title'), 'margin-top')).toBe('0');
    expect(rule('base', '.page-title').at).toEqual([]);
    const special = Object.entries(sheets).flatMap(([file, list]) =>
      list
        .filter((r) => /(^|[\s,])h1\b/.test(r.selector) && r.declarations.has('margin-top'))
        .map((r) => `${file}: ${r.selector}`),
    );
    expect(special).toEqual([]);
  });

  it('is the only rule that zeroes the title margin; the article header keeps zeroing only its h2', () => {
    expect(decl(rule('article', '.article-header h2'), 'margin-top')).toBe('0');
    expect(rulesOf('article', '.article-header h1')).toEqual([]);
  });

  it('keeps the resume title where an unclassed h1 sat: 2em of its own size below the top', () => {
    const resume = rule('resume', '.resume-header .page-title');
    expect(decl(resume, 'margin-top')).toBe('2em');
    expect(decl(rule('base', 'h1, h2, h3, h4, h5, h6'), 'margin')).toBe('2em 0 0.5em');
    expect(decl(resume, 'margin-bottom')).toBe('0.12em');
  });
});

describe('menu', () => {
  it('keeps a styled disclosure marker on the summary', () => {
    const summary = rule('menu', '.site-menu summary');
    expect(decl(summary, 'display')).toBe('list-item');
    expect(decl(summary, 'list-style')).toMatch(/^disclosure-closed/);
    expect(decl(rule('menu', '.site-menu details[open] > summary'), 'list-style-type')).toBe(
      'disclosure-open',
    );
    expect(rule('menu', '.site-menu summary::marker').declarations.has('color')).toBe(true);
    const grouped = rule('menu', '.site-menu a');
    expect(decl(grouped, 'display')).toBe('block');
  });

  it('outlines the current page in forced-colors mode', () => {
    const r = rule('menu', '.site-menu a[aria-current="page"]', ['@media (forced-colors: active)']);
    expect(decl(r, 'outline')).toMatch(/^2px solid/);
  });
});

describe('code blocks', () => {
  it('keeps the focus ring of the scrollable code inside the clipping figure', () => {
    expect(decl(rule('code', '.code-block pre:focus-visible'), 'outline-offset')).toMatch(/^-/);
    expect(decl(rule('code', '.code-block'), 'overflow')).toBe('hidden');
  });

  it('keeps the band of an empty highlighted line', () => {
    const line = rule('code', '.code-block .line.highlighted');
    expect(decl(line, 'min-height')).toBe('1lh');
    expect(decl(line, 'vertical-align')).toBe('top');
    expect(decl(line, 'display')).toBe('inline-block');
    expect(decl(line, 'width')).toBe('100%');
  });

  it('counts lines on the line box, regardless of how it is displayed', () => {
    expect(decl(rule('code', '.line-numbers code'), 'counter-reset')).toBe(
      'line calc(var(--line-start, 1) - 1)',
    );
    const before = rule('code', '.line-numbers .line::before');
    expect(decl(before, 'counter-increment')).toBe('line');
    expect(decl(before, 'content')).toBe('counter(line)');
    for (const r of sheet(sheets, 'code')) {
      if (r.selector.includes('.highlighted')) {
        expect(r.declarations.has('counter-increment'), r.selector).toBe(false);
        expect(r.declarations.has('counter-reset'), r.selector).toBe(false);
      }
    }
  });

  it('lays the header bar out as a flex row with the copy button on the right, in flow', () => {
    const bar = rule('code', '.code-block figcaption');
    expect(decl(bar, 'display')).toBe('flex');
    expect(rule('code', '.code-block figcaption:empty').declarations.get('display')).toBe('none');
    const button = rule('code', '.copy-code');
    expect(decl(button, 'margin-left')).toBe('auto');
    expect(button.declarations.has('position')).toBe(false);
  });

  it('scopes figure caption spacing so it cannot reach the code header bar', () => {
    const generic = sheet(sheets, 'markdown').filter((r) => /figcaption/.test(r.selector));
    expect(generic.map((r) => r.selector)).toEqual([
      '.md-content figure:not(.code-block) > figcaption',
    ]);
  });
});

/** hhea metrics (em) of the web fonts, read from the Fontsource woff2 files. */
const HHEA = {
  '"Literata Fallback"': { ascent: 1.177, descent: 0.308 },
  '"IBM Plex Sans Fallback"': { ascent: 1.025, descent: 0.275 },
} as const;

const fontFaces = (family: string): Rule[] =>
  sheet(sheets, 'fonts').filter(
    (r) => r.selector === '@font-face' && normalise(decl(r, 'font-family')) === family,
  );

/** A declaration that must exist, as a number (percent sign dropped). */
const percent = (r: Rule, name: string): number =>
  Number.parseFloat(required(decl(r, name), `${name} of ${r.selector}`));

describe('fonts', () => {
  it.each([
    ['--font-body', '"Literata Fallback"', ['"Literata"'], 'serif'],
    ['--font-ui', '"IBM Plex Sans Fallback"', ['"IBM Plex Sans"'], 'sans-serif'],
  ] as const)(
    'lists the stand-in right after the web font in %s',
    (token, fallback, web, generic) => {
      const stack = normalise(decl(rule('tokens', 'html'), token)).split(/,\s*/);
      expect(stack.slice(0, 2)).toEqual([...web, fallback]);
      expect(stack.at(-1)).toBe(generic);
    },
  );

  it.each(Object.entries(HHEA))(
    'keeps %s faces within the web font hhea metrics',
    (family, hhea) => {
      const faces = fontFaces(family);
      expect(faces.map((r) => [decl(r, 'font-weight') ?? '', decl(r, 'font-style') ?? ''])).toEqual(
        [
          ['', ''],
          ['600 900', ''],
          ['', 'italic'],
        ],
      );
      for (const face of faces) {
        const scale = percent(face, 'size-adjust') / 100;
        expect((percent(face, 'ascent-override') / 100) * scale, 'ascent').toBeCloseTo(
          hhea.ascent,
          2,
        );
        expect((percent(face, 'descent-override') / 100) * scale, 'descent').toBeCloseTo(
          hhea.descent,
          2,
        );
        expect(decl(face, 'line-gap-override')).toBe('0%');
        expect(decl(face, 'src'), 'local() sources only').toMatch(
          /^local\("[^"]+"\)(, local\("[^"]+"\))*$/,
        );
      }
    },
  );

  it('declares IBM Plex Sans upright and italic, Latin and Latin Extended only', () => {
    const plex = fontFaces('"IBM Plex Sans"');
    const files = plex.map((r) =>
      /ibm-plex-sans-([a-z-]+)-wght-(normal|italic)\.woff2/.exec(decl(r, 'src') ?? ''),
    );
    expect(files.map((m) => `${m?.[1]} ${m?.[2]}`).sort()).toEqual([
      'latin italic',
      'latin normal',
      'latin-ext italic',
      'latin-ext normal',
    ]);
  });

  it('declares each bundled face as its Fontsource package does', async () => {
    const compact = (value: string | undefined) =>
      (value ?? '').replaceAll(/\s/g, '').replaceAll("'", '"');
    const format = (src: string | undefined) => /format\(([^)]*)\)/.exec(src ?? '')?.[1];
    const fileOf = (r: Rule) => /\/([\w-]+\.woff2)\)/.exec(decl(r, 'src') ?? '')?.[1];
    const bundled = sheet(sheets, 'fonts').filter(
      (r) => r.selector === '@font-face' && /url\(.*fontsource-variable/.test(decl(r, 'src') ?? ''),
    );
    expect(bundled).toHaveLength(8);
    for (const face of bundled) {
      const name = required(fileOf(face), 'font file of a bundled face');
      const dir = path.join(
        ROOT,
        'node_modules',
        '@fontsource-variable',
        name.startsWith('literata') ? 'literata' : 'ibm-plex-sans',
      );
      const packaged = (
        await Promise.all(
          (
            await fs.readdir(dir)
          )
            .filter((f) => f.endsWith('.css'))
            .map(async (f) => parseRules(await fs.readFile(path.join(dir, f), 'utf8'))),
        )
      )
        .flat()
        .find((r) => fileOf(r) === name);
      const reference = required(packaged, `package rule for ${name}`);
      for (const property of ['font-weight', 'font-style', 'unicode-range']) {
        expect(compact(decl(face, property)), `${name} ${property}`).toBe(
          compact(decl(reference, property)),
        );
      }
      expect(compact(format(decl(face, 'src'))), `${name} format`).toBe(
        compact(format(decl(reference, 'src'))),
      );
    }
  });

  it('swaps every real face in', () => {
    const real = sheet(sheets, 'fonts').filter(
      (r) => r.selector === '@font-face' && /url\(/.test(decl(r, 'src') ?? ''),
    );
    expect(real).toHaveLength(11);
    for (const r of real) {
      expect(decl(r, 'font-display')).toBe('swap');
    }
  });

  it('turns code ligatures off', () => {
    expect(decl(rule('base', 'code, kbd, samp, pre'), 'font-variant-ligatures')).toBe('none');
  });
});
