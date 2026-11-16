import { codeToTokens } from 'shiki';
import { describe, expect, it } from 'vitest';
import { PAPER_THEME, paperTheme } from '../../../src/generator/highlight/paper-theme.ts';
import { contrastRatio } from '../../../src/lib/contrast.ts';
import { required } from '../../../src/shared/guards.ts';
import { parseRules, readStyle } from '../../styles/css.ts';
import { highlightCode } from './highlight-code.ts';
import { foregrounds } from './theme-colours.ts';

const declarationsOf = async (file: string, selector: string) =>
  required(
    parseRules(await readStyle(file)).find(
      (r) => r.selector === selector && r.declarations.has('--code-bg'),
    ),
    `${selector} in ${file}`,
  ).declarations;

const lightTokens = () => declarationsOf('tokens.css', ':root[data-theme="light"]');
const printTokens = () => declarationsOf('print.css', ':root');

const failing = (colours: readonly string[], bg: string) =>
  colours.filter((c) => contrastRatio(c, bg) < 4.5);

/** The foreground the theme gives a rule that lists `scope`. */
function colourOf(scope: string): string {
  const rule = paperTheme.settings?.find((r) => r.scope?.includes(scope));
  return required(rule?.settings?.foreground, `colour of ${scope}`).toLowerCase();
}

const fontStyleOf = (scope: string): string | undefined =>
  paperTheme.settings?.find((r) => r.scope?.includes(scope))?.settings?.fontStyle;

describe('paper theme', () => {
  const bg = paperTheme.colors?.['editor.background'];
  const fg = paperTheme.colors?.['editor.foreground'];
  const colours = foregrounds(paperTheme.settings, paperTheme.colors);

  it('is a light theme drawn on the light code background, in the light text colour', async () => {
    const tokens = await lightTokens();
    expect(paperTheme.type).toBe('light');
    expect(paperTheme.name).toBe(PAPER_THEME);
    expect(bg).toBe(tokens.get('--code-bg'));
    expect(fg).toBe(tokens.get('--fg'));
  });

  it('paints a rich palette', () => {
    expect(colours.length).toBeGreaterThanOrEqual(8);
  });

  it.each([
    ['light', lightTokens, ['--code-bg', '--hl', '--bg']],
    ['print', printTokens, ['--code-bg', '--hl']],
  ] as const)(
    'keeps every foreground at least 4.5:1 on the %s backgrounds',
    async (_n, tokens, names) => {
      const palette = await tokens();
      for (const name of names) {
        const background = palette.get(name) ?? '';
        expect(background, name).toMatch(/^#/);
        expect(failing(colours, background), name).toEqual([]);
      }
    },
  );

  it('is what Shiki uses for the light variables, comments in italics', async () => {
    const out = (await highlightCode('// note\nint x = 1;', 'c', new Set())).toLowerCase();
    expect(out).toContain(`--shiki-light:${colourOf('keyword')}`);
    expect(out).toContain(
      `--shiki-light:${colourOf('comment')};--shiki-light-font-style:${fontStyleOf('comment')}`,
    );
    expect(fontStyleOf('comment')).toBe('italic');
    expect(out).not.toContain('github');
  });
});

describe('paper theme on real grammar output', () => {
  /** Light colour of the first token whose text is exactly `text`. */
  async function paint(
    lang: 'javascript' | 'diff' | 'markdown',
    code: string,
    text: string,
  ): Promise<string | undefined> {
    const { tokens } = await codeToTokens(code, { lang, theme: paperTheme });
    return tokens
      .flat()
      .find((t) => t.content === text)
      ?.color?.toLowerCase();
  }

  const REGEX = 'const r = /a+(b)?[x-z]\\d/gi; const s = "a\\n";';
  const DIFF = 'diff --git a/x b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n ctx';

  it.each([
    ['javascript', REGEX, 'a', 'string.regexp'],
    ['javascript', REGEX, '+', 'keyword.operator.quantifier.regexp'],
    ['javascript', REGEX, '\\d', 'constant.other.character-class.regexp'],
    ['javascript', REGEX, '\\n', 'constant.character.escape'],
    ['diff', DIFF, 'diff --git a/x b/x', 'meta.diff.header'],
    ['diff', DIFF, ' -1,2 +1,2 ', 'meta.diff.range'],
    ['diff', DIFF, 'old', 'markup.deleted'],
    ['markdown', '# Title\n\ntext', ' Title', 'markup.heading'],
  ] as const)('paints %s token %j by its %s rule', async (lang, code, text, scope) => {
    const painted = await paint(lang, code, text);
    expect(painted, `${text} in ${lang}`).toBe(colourOf(scope));
  });

  it('makes headings bold and leaves plain regexp text on the regexp colour', async () => {
    expect(fontStyleOf('markup.heading')).toBe('bold');
    expect(await paint('javascript', REGEX, 'gi')).not.toBe(colourOf('string.regexp'));
  });

  it('colours the scopes the grammars emit, each distinct from the default text', () => {
    for (const scope of [
      'string.regexp',
      'constant.other.character-class.regexp',
      'keyword.operator.quantifier.regexp',
      'constant.character.escape',
      'meta.diff.header',
      'meta.diff.range',
      'markup.changed',
      'markup.heading',
    ]) {
      expect(colourOf(scope), scope).not.toBe(paperTheme.colors?.['editor.foreground']);
    }
  });
});
