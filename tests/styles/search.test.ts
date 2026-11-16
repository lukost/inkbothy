import { beforeAll, describe, expect, it } from 'vitest';
import { parseRules, type Rule, readStyle, usedVariables } from './css.ts';

const NARROW = '@media (max-width: 56.2499em)';
const MOTION = '@media (prefers-reduced-motion: no-preference)';

let rules: Rule[] = [];

beforeAll(async () => {
  rules = parseRules(await readStyle('search.css'));
});

const rulesOf = (selector: string, at: readonly string[] = []): Rule[] =>
  rules.filter((r) => r.selector === selector && r.at.join('|') === at.join('|'));

function rule(selector: string, at: readonly string[] = []): Rule {
  const found = rulesOf(selector, at);
  expect(found, `${selector} ${at.join(' ')}`).toHaveLength(1);
  return found[0] ?? { at, selector, declarations: new Map() };
}

const decl = (r: Rule, name: string) => r.declarations.get(name);

describe('search button', () => {
  it('is styled with the other top bar tools, not here', () => {
    expect(rules.filter((r) => /search-trigger|search-ready/.test(r.selector))).toEqual([]);
    expect(rules.filter((r) => r.selector.includes('data-sidebar'))).toEqual([]);
  });
});

describe('dialog', () => {
  it('is only displayed while open, so a closed dialog stays hidden', () => {
    expect(rule('.search-dialog').declarations.has('display')).toBe(false);
    expect(decl(rule('.search-dialog[open]'), 'display')).toBe('flex');
  });

  it('is top-anchored and at most 40rem wide on wide viewports', () => {
    const dialog = rule('.search-dialog');
    expect(decl(dialog, 'width')).toContain('40rem');
    expect(decl(dialog, 'margin')).toMatch(/^8vh auto auto$/);
  });

  it('fills the screen below the wide breakpoint, the exact complement of the wide query', () => {
    const full = rule('.search-dialog', [NARROW]);
    expect(decl(full, 'inset')).toBe('0');
    expect(decl(full, 'width')).toBe('100%');
    expect(decl(full, 'height')).toBe('100%');
    expect(decl(full, 'margin')).toBe('0');
    expect(decl(full, 'max-height')).toBe('none');
  });

  it('dims the page behind it with the scrim colour', () => {
    expect(decl(rule('.search-dialog::backdrop'), 'background')).toContain('var(--scrim');
  });

  it('animates its opening only for people who accept motion', () => {
    expect(rulesOf('.search-dialog[open]', [MOTION])).toHaveLength(1);
    const animated = rules.filter((r) => r.declarations.has('animation'));
    expect(animated.map((r) => r.at)).toEqual([[MOTION]]);
  });

  it('scrolls its results, not the page behind it', () => {
    expect(decl(rule('.search-results'), 'overflow-y')).toBe('auto');
    expect(decl(rule('.search-results'), 'overscroll-behavior')).toBe('contain');
    expect(decl(rule('html:has(.search-dialog[open])'), 'overflow')).toBe('hidden');
  });
});

describe('results and chips', () => {
  it('colours matches with the mark tokens', () => {
    const mark = rule('.search-dialog mark');
    expect(usedVariables(decl(mark, 'background') ?? '')).toEqual(['--mark-bg']);
    expect(usedVariables(decl(mark, 'color') ?? '')).toEqual(['--mark-fg']);
  });

  it('shows the active option with a background and an accent bar, not by colour alone', () => {
    const active = rule('.search-result[aria-selected="true"] .search-result-link');
    expect(decl(active, 'box-shadow')).toContain('var(--accent)');
    expect(
      rule('.search-result[aria-selected="true"] .search-result-link, .search-result-link:hover'),
    ).toBeDefined();
  });

  it('shows a pressed chip in the accent colour, and with system colours in forced-colors mode', () => {
    const pressed = rule('.search-chip[aria-pressed="true"]');
    expect(decl(pressed, 'background')).toBe('var(--accent)');
    expect(decl(pressed, 'color')).toBe('var(--bg)');
    const forced = rule('.search-chip[aria-pressed="true"]', ['@media (forced-colors: active)']);
    expect(decl(forced, 'background')).toBe('Highlight');
  });
});
