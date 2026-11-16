import { isTheme, STORAGE_KEYS, type Theme } from '../shared/ui-state.ts';
import { createStatus } from './announce.ts';
import { remember } from './storage.ts';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

const opposite = (theme: Theme): Theme => (theme === 'light' ? 'dark' : 'light');

/** The operating system's theme; dark when it has no preference for light. */
export function systemTheme(): Theme {
  return matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

/** The theme on screen: the stored override, else the system theme. */
export function effectiveTheme(): Theme {
  const { theme } = document.documentElement.dataset;
  return isTheme(theme) ? theme : systemTheme();
}

/** Show `theme`, and remember it only when it differs from the system theme. */
export function setTheme(theme: Theme): void {
  const { dataset } = document.documentElement;
  if (theme === systemTheme()) {
    delete dataset.theme;
    remember(STORAGE_KEYS.theme, null);
  } else {
    dataset.theme = theme;
    remember(STORAGE_KEYS.theme, theme);
  }
}

function syncButton(button: HTMLElement): void {
  const theme = effectiveTheme();
  const action = `Switch to ${opposite(theme)} theme`;
  button.setAttribute('aria-label', action);
  button.title = action;
}

/**
 * Wires every theme toggle and announces changes to screen readers. An override that matches the
 * system theme is dropped, both on wiring and whenever the system theme changes.
 *
 * @returns a function that undoes the wiring
 */
export function initTheme(): () => void {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const buttons = [...document.querySelectorAll<HTMLElement>('.theme-toggle')];
  const status = createStatus();
  document.body.append(status);
  const syncAll = (): void => {
    for (const button of buttons) {
      syncButton(button);
    }
  };
  /** Keeps "stored implies different from the system" when either side changes. */
  const reconcile = (): void => {
    const { theme } = document.documentElement.dataset;
    if (isTheme(theme)) {
      setTheme(theme);
    }
    syncAll();
  };
  reconcile();
  matchMedia(LIGHT_QUERY).addEventListener('change', reconcile, { signal });
  for (const button of buttons) {
    button.addEventListener(
      'click',
      () => {
        setTheme(opposite(effectiveTheme()));
        syncAll();
        status.textContent = `${effectiveTheme() === 'light' ? 'Light' : 'Dark'} theme`;
      },
      { signal },
    );
  }
  return () => {
    lifetime.abort();
    status.remove();
  };
}
