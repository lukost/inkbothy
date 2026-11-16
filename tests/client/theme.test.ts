// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveTheme, initTheme, setTheme, systemTheme } from '../../src/client/theme.ts';
import { STORAGE_KEYS } from '../../src/shared/ui-state.ts';
import { $, $$ } from '../helpers.ts';

const root = () => document.documentElement;
const stored = () => localStorage.getItem(STORAGE_KEYS.theme);

/** A controllable `matchMedia`: `setSystemLight` changes the preference and notifies listeners. */
let systemLight: boolean | null = null;
let listeners = new Set<() => void>();

function mockMatchMedia(light: boolean): void {
  systemLight = light;
  listeners = new Set();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return query.includes('light') && systemLight === true;
    },
    addEventListener(_type: string, listener: () => void, options?: { signal?: AbortSignal }) {
      listeners.add(listener);
      options?.signal?.addEventListener('abort', () => listeners.delete(listener));
    },
  }));
}

function setSystemLight(light: boolean): void {
  systemLight = light;
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Two toggles: every `.theme-toggle` on the page is wired and kept in sync. */
const TOGGLE =
  '<button type="button" class="theme-toggle" id="first" aria-label="Switch theme" title="Switch theme"><svg></svg></button>' +
  '<button type="button" class="theme-toggle" id="second" aria-label="Switch theme" title="Switch theme"></button>';

let teardown: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = TOGGLE;
});
afterEach(() => {
  teardown();
  teardown = () => undefined;
  delete root().dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const start = () => {
  teardown = initTheme();
};
const full = () => $(document, '#first');
const rail = () => $(document, '#second');
const label = () => full().getAttribute('aria-label');
const status = () => $$(document, '[role="status"]');

describe('systemTheme and effectiveTheme', () => {
  it.each([
    [true, 'light'],
    [false, 'dark'],
  ])('follow the OS when nothing is stored (light: %s)', (light, expected) => {
    mockMatchMedia(light);
    expect(systemTheme()).toBe(expected);
    expect(effectiveTheme()).toBe(expected);
  });

  it('falls back to dark when the OS has no preference', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: false }));
    expect(effectiveTheme()).toBe('dark');
  });

  it.each(['light', 'dark'] as const)('an override of %s beats the OS', (theme) => {
    mockMatchMedia(theme === 'dark');
    root().dataset.theme = theme;
    expect(effectiveTheme()).toBe(theme);
  });

  it('ignores an unknown data-theme', () => {
    mockMatchMedia(true);
    root().dataset.theme = 'sepia';
    expect(effectiveTheme()).toBe('light');
  });
});

describe('setTheme', () => {
  it('stores a theme that differs from the OS', () => {
    mockMatchMedia(false);
    setTheme('light');
    expect(root().dataset.theme).toBe('light');
    expect(stored()).toBe('light');
  });

  it('stores nothing for the OS theme, and drops an earlier override', () => {
    mockMatchMedia(false);
    setTheme('light');
    setTheme('dark');
    expect(root().dataset.theme).toBeUndefined();
    expect(stored()).toBeNull();
  });

  it('still applies the theme when storage throws', () => {
    mockMatchMedia(false);
    vi.stubGlobal('localStorage', {
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('denied');
      },
    });
    expect(() => setTheme('light')).not.toThrow();
    expect(root().dataset.theme).toBe('light');
    expect(() => setTheme('dark')).not.toThrow();
    expect(root().dataset.theme).toBeUndefined();
  });
});

describe('theme toggle', () => {
  it.each([
    [true, 'Switch to dark theme'],
    [false, 'Switch to light theme'],
  ])('first load follows the OS (light: %s) and says what a click does', (light, action) => {
    mockMatchMedia(light);
    start();
    expect(root().dataset.theme).toBeUndefined();
    for (const button of [full(), rail()]) {
      expect(button.getAttribute('aria-label')).toBe(action);
      expect(button.title).toBe(action);
    }
  });

  it('treats an OS without preference as dark', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      matches: false,
      addEventListener() {},
    }));
    start();
    expect(full().getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('flips the effective theme on every click', () => {
    mockMatchMedia(false);
    start();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      full().click();
      seen.push(effectiveTheme());
    }
    expect(seen).toEqual(['light', 'dark', 'light', 'dark']);
  });

  it('stores a click away from the OS and clears it on a click back, so two clicks follow the OS again', () => {
    mockMatchMedia(false);
    start();
    full().click();
    expect([root().dataset.theme, stored()]).toEqual(['light', 'light']);
    full().click();
    expect([root().dataset.theme, stored()]).toEqual([undefined, null]);
  });

  it('works the same on a light OS', () => {
    mockMatchMedia(true);
    start();
    rail().click();
    expect([root().dataset.theme, stored()]).toEqual(['dark', 'dark']);
    rail().click();
    expect([root().dataset.theme, stored()]).toEqual([undefined, null]);
  });

  it('follows OS changes live while nothing is stored', () => {
    mockMatchMedia(false);
    start();
    setSystemLight(true);
    expect(full().getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(rail().getAttribute('aria-label')).toBe('Switch to dark theme');
    setSystemLight(false);
    expect(label()).toBe('Switch to light theme');
  });

  it('keeps an override while the OS changes away from it', () => {
    mockMatchMedia(false);
    start();
    full().click();
    setSystemLight(false);
    expect([root().dataset.theme, stored(), effectiveTheme()]).toEqual(['light', 'light', 'light']);
  });

  it('clears an override when the OS changes to match it', () => {
    mockMatchMedia(false);
    start();
    full().click();
    setSystemLight(true);
    expect([root().dataset.theme, stored()]).toEqual([undefined, null]);
    expect(label()).toBe('Switch to dark theme');
    setSystemLight(false);
    expect(label()).toBe('Switch to light theme');
  });

  it('shows and keeps a restored override that differs from the OS', () => {
    mockMatchMedia(false);
    localStorage.setItem(STORAGE_KEYS.theme, 'light');
    root().dataset.theme = 'light';
    start();
    expect(rail().getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(stored()).toBe('light');
  });

  it('drops a restored override the OS has caught up with', () => {
    mockMatchMedia(true);
    localStorage.setItem(STORAGE_KEYS.theme, 'light');
    root().dataset.theme = 'light';
    start();
    expect([root().dataset.theme, stored()]).toEqual([undefined, null]);
  });

  it('keeps both toggles in sync, whichever is clicked', () => {
    mockMatchMedia(false);
    start();
    rail().click();
    expect([full().title, rail().title]).toEqual(['Switch to dark theme', 'Switch to dark theme']);
    full().click();
    expect([full().title, rail().title]).toEqual([
      'Switch to light theme',
      'Switch to light theme',
    ]);
    expect(rail().getAttribute('aria-label')).toBe('Switch to light theme');
  });

  it('puts the same words in the accessible name and the tooltip', () => {
    mockMatchMedia(false);
    start();
    for (let i = 0; i < 3; i++) {
      expect(full().getAttribute('aria-label')).toBe(full().title);
      full().click();
    }
  });

  it('works with a bare toggle button', () => {
    mockMatchMedia(false);
    document.body.innerHTML = '<button type="button" class="theme-toggle"></button>';
    start();
    $(document, '.theme-toggle').click();
    expect($(document, '.theme-toggle').getAttribute('aria-label')).toBe('Switch to dark theme');
  });

  it('keeps one handler per button: a click flips exactly once', () => {
    mockMatchMedia(false);
    start();
    rail().click();
    expect(effectiveTheme()).toBe('light');
  });

  it('stops following the OS and removes its live region once torn down', () => {
    mockMatchMedia(false);
    start();
    teardown();
    expect(listeners.size).toBe(0);
    expect(status()).toHaveLength(0);
    full().click();
    expect(root().dataset.theme).toBeUndefined();
  });

  it('works on a page without the toggle', () => {
    mockMatchMedia(false);
    document.body.innerHTML = '';
    expect(() => start()).not.toThrow();
  });

  describe('announcements', () => {
    it('adds one visually hidden live region, silent until the first change', () => {
      mockMatchMedia(false);
      start();
      expect(status()).toHaveLength(1);
      expect(status()[0]?.className).toBe('visually-hidden');
      expect(status()[0]?.textContent).toBe('');
    });

    it('names the theme that is now on screen', () => {
      mockMatchMedia(false);
      start();
      const said: (string | null)[] = [];
      for (let i = 0; i < 3; i++) {
        full().click();
        said.push(status()[0]?.textContent ?? null);
      }
      expect(said).toEqual(['Light theme', 'Dark theme', 'Light theme']);
    });
  });

  it('shows no System wording anywhere on the toggles', () => {
    mockMatchMedia(false);
    start();
    for (let i = 0; i < 3; i++) {
      expect(document.body.innerHTML).not.toMatch(/system|auto/i);
      full().click();
    }
  });
});
