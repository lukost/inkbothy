/** State shared by the inline head script and the client: storage keys, theme names, text sizes, breakpoints. */

export const STORAGE_KEYS = {
  theme: 'site-theme',
  sidebar: 'site-sidebar',
  textSize: 'site-text-size',
} as const;

/** Stored under `STORAGE_KEYS.sidebar` and set as `data-sidebar` while the sidebar is hidden on a wide viewport. */
export const SIDEBAR_COLLAPSED = 'collapsed';

export const THEMES = ['light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/** Article text sizes in percent, smallest first; the stylesheet defines the same steps in `text-size.css`. */
export const TEXT_SIZES = ['75', '82', '90', '100', '112', '125'] as const;

export type TextSize = (typeof TEXT_SIZES)[number];

/** The size without an override. */
export const DEFAULT_TEXT_SIZE: TextSize = '100';

export function isTextSize(value: unknown): value is TextSize {
  return TEXT_SIZES.some((size) => size === value);
}

/** The sidebar is a column from this width up, and a drawer below it (`em`, so it follows the browser's font size). */
export const WIDE_QUERY = '(min-width: 56.25em)';

/** The table of contents moves into the right spacer, beside the article, from this width up: the spacer then holds the rail (see layout.css). */
export const RAIL_QUERY = '(min-width: 100em)';

/** Attribute of the module script's tag; the head script watches that element for a failed load. */
export const MAIN_SCRIPT_ATTRIBUTE = 'data-main';
