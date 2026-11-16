import { beforeAll, describe, expect, it } from 'vitest';
import { isAlertType } from '../../src/generator/markdown/alerts.ts';
import { contrastRatio } from '../../src/lib/contrast.ts';
import { parseRules, type Rule, readStyle, styleFiles, usedVariables } from './css.ts';

const LIGHT_MEDIA = '@media (prefers-color-scheme: light)';

type Tokens = ReadonlyMap<string, string>;

let rules: Rule[] = [];
let allRules: { file: string; rule: Rule }[] = [];

const tokenBlock = (selector: string, at: readonly string[] = []): Tokens => {
  const found = rules.filter((r) => r.selector === selector && r.at.join('|') === at.join('|'));
  expect(found, `${selector} in tokens.css`).toHaveLength(1);
  return found[0]?.declarations ?? new Map();
};

const dark = () => tokenBlock(':root');
const darkExplicit = () => tokenBlock(':root[data-theme="dark"]');
const light = () => tokenBlock(':root:not([data-theme="dark"])', [LIGHT_MEDIA]);
const lightExplicit = () => tokenBlock(':root[data-theme="light"]');
const statics = () => tokenBlock('html');

beforeAll(async () => {
  rules = parseRules(await readStyle('tokens.css'));
  allRules = (
    await Promise.all(
      (
        await styleFiles()
      ).map(async (file) => ({
        file,
        rules: parseRules(await readStyle(file)),
      })),
    )
  ).flatMap(({ file, rules: list }) => list.map((rule) => ({ file, rule })));
});

describe('tokens.css structure', () => {
  it('has a dark fallback, an OS-light block and both explicit blocks', () => {
    expect(dark().get('color-scheme')).toBe('dark');
    expect(light().get('color-scheme')).toBe('light');
    expect(lightExplicit().get('color-scheme')).toBe('light');
    expect(darkExplicit().get('color-scheme')).toBe('dark');
  });

  it('keeps each theme identical in its two copies', () => {
    expect([...light()]).toEqual([...lightExplicit()]);
    expect([...dark()]).toEqual([...darkExplicit()]);
  });

  it('defines the same colour tokens for light and dark', () => {
    expect([...light().keys()].sort()).toEqual([...dark().keys()].sort());
  });
});

describe('var() usage', () => {
  // Set inline on the markup at run time: by Shiki, and per code block for the first line number.
  const RUNTIME = /^--(shiki-|line-start$)/;

  it('only references tokens defined for both themes, static tokens, runtime variables or local ones', () => {
    const themed = new Set([...light().keys()].filter((k) => k.startsWith('--')));
    const known = new Set([...themed, ...[...statics().keys()]]);
    const unknown = allRules.flatMap(({ file, rule }) => {
      const local = new Set([...rule.declarations.keys()].filter((k) => k.startsWith('--')));
      return [...rule.declarations.values()]
        .flatMap(usedVariables)
        .filter((name) => !known.has(name) && !local.has(name) && !RUNTIME.test(name))
        .map((name) => `${file}: ${rule.selector} uses ${name}`);
    });
    expect(unknown).toEqual([]);
  });

  it('defines no colour token outside tokens.css and the print palette (text-size.css sets only the text-size tokens)', () => {
    const stray = allRules
      .filter(({ file }) => !['tokens.css', 'print.css', 'text-size.css'].includes(file))
      .flatMap(({ file, rule }) =>
        [...rule.declarations.keys()].filter((k) => k.startsWith('--')).map((k) => `${file}: ${k}`),
      );
    expect(stray).toEqual([]);
  });

  it('notices a variable that is missing from one theme (parser sanity)', () => {
    const [sample] = parseRules('a { color: var(--x); background: var(--y, red) }');
    expect(sample?.declarations.get('color')).toBe('var(--x)');
    expect(usedVariables('var(--y, var(--z))')).toEqual(['--y', '--z']);
  });

  it('styles every alert type the Markdown renderer emits', () => {
    const types = ['note', 'tip', 'important', 'warning', 'caution'];
    expect(types.every(isAlertType)).toBe(true);
    const selectors = allRules.map(({ rule }) => rule.selector);
    for (const type of types) {
      expect(selectors, type).toContain(`.alert-${type}`);
      expect(selectors, type).toContain(`.alert-${type} .alert-title`);
      expect(statics().has(`--${type}`) || light().has(`--${type}`), type).toBe(true);
      expect(light().has(`--${type}-bg`), type).toBe(true);
    }
  });
});

describe('control borders', () => {
  const CONTROLS = ['button', '.search-input'];

  it('draws buttons and the search input with --control-border, decorative lines with --line', () => {
    const borders = new Map(
      allRules
        .filter(({ rule }) => CONTROLS.includes(rule.selector))
        .map(({ rule }) => [rule.selector, rule.declarations.get('border')]),
    );
    for (const selector of CONTROLS) {
      expect(borders.get(selector), selector).toBe('1px solid var(--control-border)');
    }
    expect(
      allRules.find(({ rule }) => rule.selector === 'hr')?.rule.declarations.get('border-top'),
    ).toBe('1px solid var(--line)');
  });

  it('is told apart from --line in both themes', () => {
    for (const t of [light(), dark()]) {
      expect(t.get('--control-border')).not.toBe(t.get('--line'));
    }
  });
});

describe('contrast', () => {
  const themes: [string, () => Tokens][] = [
    ['light', light],
    ['dark', dark],
  ];
  const colour = (t: Tokens, name: string): string => {
    const value = t.get(`--${name}`);
    if (!value?.startsWith('#')) {
      throw new Error(`--${name} is not a hex colour: ${value}`);
    }
    return value;
  };
  const alerts = ['note', 'tip', 'important', 'warning', 'caution'];
  const surfaces = ['bg', 'surface', 'code-bg', 'hover'];

  describe.each(themes)('%s theme', (_name, tokens) => {
    it.each(['bg', 'surface', 'code-bg', 'hover', 'hl', ...alerts.map((a) => `${a}-bg`)])(
      'body text on --%s is at least 7:1',
      (surface) => {
        const t = tokens();
        expect(contrastRatio(colour(t, 'fg'), colour(t, surface))).toBeGreaterThanOrEqual(7);
      },
    );

    it.each(surfaces)('muted text and links on --%s are at least 4.5:1', (surface) => {
      const t = tokens();
      expect(contrastRatio(colour(t, 'muted'), colour(t, surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colour(t, 'link'), colour(t, surface))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(['bg', 'surface', 'code-bg', 'hover', 'hl'])(
      'accent on --%s is at least 4.5:1',
      (surface) => {
        const t = tokens();
        expect(contrastRatio(colour(t, 'accent'), colour(t, surface))).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each(['bg', 'surface', 'code-bg'])('the focus ring on --%s is at least 4.5:1', (surface) => {
      const t = tokens();
      expect(contrastRatio(colour(t, 'focus'), colour(t, surface))).toBeGreaterThanOrEqual(4.5);
    });

    it('reads --bg on --accent (a pressed chip) at least 4.5:1', () => {
      const t = tokens();
      expect(contrastRatio(colour(t, 'bg'), colour(t, 'accent'))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(['bg', 'surface', 'hover'])(
      'the control border on --%s is at least 3:1 (non-text)',
      (surface) => {
        const t = tokens();
        expect(
          contrastRatio(colour(t, 'control-border'), colour(t, surface)),
        ).toBeGreaterThanOrEqual(3);
      },
    );

    it.each(alerts)('the %s title and links on its background are at least 4.5:1', (type) => {
      const t = tokens();
      const bg = colour(t, `${type}-bg`);
      expect(contrastRatio(colour(t, type), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colour(t, 'link'), bg)).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text and links on the highlighted-line background are at least 4.5:1', () => {
      const t = tokens();
      expect(contrastRatio(colour(t, 'muted'), colour(t, 'hl'))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colour(t, 'link'), colour(t, 'hl'))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(alerts)('muted text on the %s background is at least 4.5:1', (type) => {
      const t = tokens();
      expect(contrastRatio(colour(t, 'muted'), colour(t, `${type}-bg`))).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it('marks search matches in a colour pair that is at least 4.5:1', () => {
      const t = tokens();
      expect(contrastRatio(colour(t, 'mark-fg'), colour(t, 'mark-bg'))).toBeGreaterThanOrEqual(4.5);
    });

    it('sets the mark background apart from the surfaces it sits on', () => {
      const t = tokens();
      for (const surface of ['bg', 'surface', 'hover']) {
        expect(colour(t, 'mark-bg'), surface).not.toBe(colour(t, surface));
      }
    });

    it('draws the diagram error message in a colour that is at least 4.5:1 on --bg', () => {
      const t = tokens();
      const rule = allRules.find(({ rule: r }) => r.selector === '.mermaid-error-message')?.rule;
      const name = usedVariables(rule?.declarations.get('color') ?? '')[0];
      expect(name, 'colour token of .mermaid-error-message').toBeDefined();
      expect(
        contrastRatio(colour(t, (name ?? '').slice(2)), colour(t, 'bg')),
      ).toBeGreaterThanOrEqual(4.5);
    });
  });
});
