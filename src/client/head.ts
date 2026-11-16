import {
  isTextSize,
  isTheme,
  MAIN_SCRIPT_ATTRIBUTE,
  SIDEBAR_COLLAPSED,
  STORAGE_KEYS,
} from '../shared/ui-state.ts';

/**
 * Applies the remembered theme, sidebar state and text size and marks the page `js`, so the
 * script-driven controls show from the first paint. Runs inline in `<head>`. A failed load of the
 * module script removes `js`, and the page falls back to its script-free form; the text size and
 * theme attributes stay, since the stylesheet alone applies them.
 */
export function applyHead(root: HTMLElement): void {
  root.classList.add('js');
  root.ownerDocument.addEventListener(
    'error',
    ({ target }) => {
      if (target instanceof Element && target.hasAttribute(MAIN_SCRIPT_ATTRIBUTE)) {
        root.classList.remove('js');
      }
    },
    true,
  );
  try {
    const theme = localStorage.getItem(STORAGE_KEYS.theme);
    if (isTheme(theme)) {
      root.dataset.theme = theme;
    }
    if (localStorage.getItem(STORAGE_KEYS.sidebar) === SIDEBAR_COLLAPSED) {
      root.dataset.sidebar = SIDEBAR_COLLAPSED;
    }
    const size = localStorage.getItem(STORAGE_KEYS.textSize);
    if (isTextSize(size)) {
      root.dataset.textSize = size;
    }
  } catch {
    // Storage is unavailable: the defaults apply.
  }
}
