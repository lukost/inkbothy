import base from '@shikijs/themes/gruvbox-dark-medium';
import { describe, expect, it } from 'vitest';
import {
  GRUVBOX_TUNED,
  loadGruvboxTuned,
  REPLACEMENTS,
} from '../../../src/generator/highlight/gruvbox-tuned.ts';
import { contrastRatio } from '../../../src/lib/contrast.ts';
import { parseRules, readStyle } from '../../styles/css.ts';
import { highlightCode } from './highlight-code.ts';
import { foregrounds } from './theme-colours.ts';

const darkTokens = async () => {
  const block = parseRules(await readStyle('tokens.css')).find((r) => r.selector === ':root');
  return block?.declarations ?? new Map<string, string>();
};

const failing = (colours: readonly string[], bg: string) =>
  colours.filter((c) => contrastRatio(c, bg) < 4.5);

describe('tuned gruvbox', () => {
  it.each(['--code-bg', '--hl', '--bg'])(
    'keeps every foreground at least 4.5:1 on the dark %s',
    async (token) => {
      const tuned = await loadGruvboxTuned();
      const background = (await darkTokens()).get(token) ?? '';
      expect(background).toMatch(/^#/);
      expect(failing(foregrounds(tuned.tokenColors, tuned.colors), background)).toEqual([]);
    },
  );

  it('needed the replacements: the untouched theme fails on the same backgrounds', async () => {
    const original = foregrounds(base.tokenColors, base.colors);
    const bgs = [...['--code-bg', '--hl'].map(async (t) => (await darkTokens()).get(t) ?? '')];
    const failed = new Set((await Promise.all(bgs)).flatMap((bg) => failing(original, bg)));
    expect([...failed].sort()).toEqual([...REPLACEMENTS.keys()].sort());
  });

  it('replaces exactly the weak colours, each by a colour the theme or gruvbox already has', async () => {
    const tuned = await loadGruvboxTuned();
    const before = foregrounds(base.tokenColors, base.colors);
    const after = foregrounds(tuned.tokenColors, tuned.colors);
    expect([...REPLACEMENTS.keys()].every((c) => before.includes(c))).toBe(true);
    expect(after.some((c) => REPLACEMENTS.has(c))).toBe(false);
    const kept = before.filter((c) => !REPLACEMENTS.has(c));
    expect(kept.every((c) => after.includes(c))).toBe(true);
    // Every target but one is already a colour of the theme; the red is the only new colour.
    expect(after.filter((c) => !before.includes(c))).toEqual(['#ff6b57']);
    expect([...REPLACEMENTS.values()].every((c) => after.includes(c))).toBe(true);
  });

  it('keeps comments in the muted gruvbox grey, still italic', async () => {
    const tuned = await loadGruvboxTuned();
    const comment = tuned.tokenColors?.find((r) => [r.scope].flat().includes('comment'));
    expect(comment?.settings.foreground).toBe('#a89984');
    expect(comment?.settings.fontStyle).toBe('italic');
  });

  it('changes nothing but foregrounds, and leaves the imported theme alone', async () => {
    const tuned = await loadGruvboxTuned();
    const stripped = (rules: typeof base.tokenColors) =>
      rules?.map(({ settings: { foreground: _f, ...rest }, ...r }) => ({ ...r, settings: rest }));
    expect(stripped(tuned.tokenColors)).toEqual(stripped(base.tokenColors));
    expect(tuned.colors).toEqual(base.colors);
    expect(tuned.type).toBe('dark');
    expect(tuned.name).toBe(GRUVBOX_TUNED);
    await loadGruvboxTuned();
    expect(base.name).toBe('gruvbox-dark-medium');
    expect(foregrounds(base.tokenColors, base.colors)).toContain('#928374');
  });

  it('keeps rules without a foreground intact', async () => {
    const tuned = await loadGruvboxTuned();
    const withoutColour = (rules: typeof base.tokenColors) =>
      rules?.filter((r) => r.settings.foreground === undefined);
    expect(withoutColour(tuned.tokenColors)).toEqual(withoutColour(base.tokenColors));
  });

  it('is what Shiki uses for the dark variables', async () => {
    const out = (await highlightCode('// note\nint x = 1;', 'c', new Set())).toLowerCase();
    expect(out).toContain('gruvbox-tuned');
    expect(out).not.toContain('gruvbox-dark-medium');
    expect(out).toMatch(/--shiki-dark:#a89984;--shiki-dark-font-style:italic/);
    expect(out).not.toContain('#928374');
  });
});
