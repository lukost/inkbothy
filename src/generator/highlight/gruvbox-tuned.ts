import type { ThemeRegistration } from 'shiki/core';

export const GRUVBOX_TUNED = 'gruvbox-tuned';

/** Upstream colours below 4.5:1 on the dark code or highlighted-line background, and the brighter gruvbox colour replacing each. */
export const REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ['#458588', '#83a598'],
  ['#928374', '#a89984'],
  ['#b16286', '#d3869b'],
  ['#cc241d', '#ff6b57'],
  ['#fb4934', '#ff6b57'],
  ['#d65d0e', '#fe8019'],
  ['#689d6a', '#8ec07c'],
  ['#98971a', '#b8bb26'],
]);

const lighten = (colour: string): string => REPLACEMENTS.get(colour.toLowerCase()) ?? colour;

/** gruvbox-dark-medium with the low-contrast colours replaced. */
export async function loadGruvboxTuned(): Promise<ThemeRegistration> {
  const { default: base } = await import('@shikijs/themes/gruvbox-dark-medium');
  return {
    ...base,
    name: GRUVBOX_TUNED,
    tokenColors: (base.tokenColors ?? []).map(({ settings, ...rule }) => {
      const { foreground, ...rest } = settings;
      return {
        ...rule,
        settings:
          foreground === undefined ? settings : { ...rest, foreground: lighten(foreground) },
      };
    }),
  };
}
