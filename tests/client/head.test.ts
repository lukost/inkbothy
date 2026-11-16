// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHead } from '../../src/client/head.ts';
import { buildHeadScript } from '../../src/generator/head-script.ts';
import {
  MAIN_SCRIPT_ATTRIBUTE,
  SIDEBAR_COLLAPSED,
  STORAGE_KEYS,
  TEXT_SIZES,
} from '../../src/shared/ui-state.ts';

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  root().removeAttribute('class');
  delete root().dataset.theme;
  delete root().dataset.sidebar;
  delete root().dataset.textSize;
  document.head.innerHTML = '';
});

/** The head logic in both forms: the module function and the inlined script text. */
const runners: [string, () => Promise<void>][] = [
  ['applyHead', async () => applyHead(root())],
  [
    'the inline script',
    async () => {
      // The shipped text, run against the page's globals.
      new Function((await buildHeadScript()).source)();
    },
  ],
];

describe.each(runners)('%s', (_name, run) => {
  it('marks the page scripted and changes nothing else when nothing is stored', async () => {
    await run();
    expect(root().classList.contains('js')).toBe(true);
    expect(root().dataset.theme).toBeUndefined();
    expect(root().dataset.sidebar).toBeUndefined();
  });

  it.each(['light', 'dark'])('applies a stored %s theme', async (theme) => {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
    await run();
    expect(root().dataset.theme).toBe(theme);
  });

  it.each(['', 'system', 'Light', 'DARK', 'purple', ' dark', '"dark"', 'null'])(
    'ignores the garbage theme %j',
    async (value) => {
      localStorage.setItem(STORAGE_KEYS.theme, value);
      await run();
      expect(root().dataset.theme).toBeUndefined();
      expect(root().classList.contains('js')).toBe(true);
    },
  );

  it('restores a collapsed sidebar', async () => {
    localStorage.setItem(STORAGE_KEYS.sidebar, SIDEBAR_COLLAPSED);
    await run();
    expect(root().dataset.sidebar).toBe(SIDEBAR_COLLAPSED);
  });

  it.each(['', 'expanded', 'true', 'Collapsed'])('ignores the sidebar value %j', async (value) => {
    localStorage.setItem(STORAGE_KEYS.sidebar, value);
    await run();
    expect(root().dataset.sidebar).toBeUndefined();
  });

  it.each(TEXT_SIZES)('applies a stored text size of %s%%', async (size) => {
    localStorage.setItem(STORAGE_KEYS.textSize, size);
    await run();
    expect(root().dataset.textSize).toBe(size);
  });

  it.each(['', '80', '100%', ' 100', '0', '-90', '1e2', '090', 'large', 'NaN', 'null', '125.0'])(
    'ignores the garbage text size %j',
    async (value) => {
      localStorage.setItem(STORAGE_KEYS.textSize, value);
      await run();
      expect(root().dataset.textSize).toBeUndefined();
      expect(root().classList.contains('js')).toBe(true);
    },
  );

  it('applies all three remembered states together', async () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'light');
    localStorage.setItem(STORAGE_KEYS.sidebar, SIDEBAR_COLLAPSED);
    localStorage.setItem(STORAGE_KEYS.textSize, '82');
    await run();
    expect([root().dataset.theme, root().dataset.sidebar, root().dataset.textSize]).toEqual([
      'light',
      SIDEBAR_COLLAPSED,
      '82',
    ]);
  });

  it('survives a throwing localStorage and still adds the js class', async () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    await expect(run()).resolves.toBeUndefined();
    expect(root().classList.contains('js')).toBe(true);
    expect(root().dataset.theme).toBeUndefined();
    expect(root().dataset.textSize).toBeUndefined();
  });

  describe('failure of the module script', () => {
    const script = (attributes: Record<string, string>): HTMLScriptElement => {
      const el = document.createElement('script');
      for (const [name, value] of Object.entries(attributes)) {
        el.setAttribute(name, value);
      }
      document.head.append(el);
      return el;
    };
    const fail = (el: Element): void => {
      el.dispatchEvent(new Event('error'));
    };

    it('removes js when the marked script fails to load, and only then', async () => {
      const main = script({ type: 'module', src: '/a.js', [MAIN_SCRIPT_ATTRIBUTE]: '' });
      await run();
      expect(root().classList.contains('js')).toBe(true);
      fail(main);
      expect(root().classList.contains('js')).toBe(false);
    });

    it('ignores the failure of any other script, image or stylesheet', async () => {
      const other = script({ type: 'module', src: '/other.js' });
      const sheet = document.createElement('link');
      document.head.append(sheet);
      const image = document.createElement('img');
      document.body.append(image);
      await run();
      for (const el of [other, sheet, image]) {
        fail(el);
      }
      expect(root().classList.contains('js')).toBe(true);
      image.remove();
    });

    it('ignores a runtime error raised on the window', async () => {
      await run();
      window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
      document.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
      expect(root().classList.contains('js')).toBe(true);
    });

    it('keeps the stored preferences when js is removed', async () => {
      localStorage.setItem(STORAGE_KEYS.textSize, '125');
      const main = script({ [MAIN_SCRIPT_ATTRIBUTE]: '' });
      await run();
      fail(main);
      expect(root().dataset.textSize).toBe('125');
    });
  });

  it('keeps existing classes on the root element', async () => {
    root().classList.add('keep');
    await run();
    expect([...root().classList].sort()).toEqual(['js', 'keep']);
  });
});

describe('buildHeadScript', () => {
  it('is one small, self-contained, inline-safe statement', async () => {
    const { source: script } = await buildHeadScript();
    expect(script.length).toBeLessThan(900);
    expect(script).not.toMatch(/<\/script|<!--|\bimport\b|\bexport\b/i);
    expect(script).toContain(STORAGE_KEYS.theme);
    expect(script).toContain(STORAGE_KEYS.sidebar);
    expect(script).toContain(STORAGE_KEYS.textSize);
    expect(script).toContain(MAIN_SCRIPT_ATTRIBUTE);
  });

  it('hashes exactly the text that is inlined (CSP sha256 source)', async () => {
    const { source, hash } = await buildHeadScript();
    expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    expect(hash).toBe(`sha256-${createHash('sha256').update(source).digest('base64')}`);
  });

  it('is deterministic', async () => {
    expect(await buildHeadScript()).toEqual(await buildHeadScript());
  });
});
