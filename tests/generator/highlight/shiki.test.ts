// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  createShikiHighlighter,
  LANGUAGE_LOADERS,
  type LanguageLoaders,
} from '../../../src/generator/highlight/shiki.ts';
import { LANGUAGES } from '../../../src/generator/markdown/languages.ts';
import { highlightCode } from './highlight-code.ts';

const core = vi.hoisted(() => ({ failNext: false }));
vi.mock('shiki/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('shiki/core')>();
  return {
    ...real,
    createHighlighterCore: vi.fn((...args: Parameters<typeof real.createHighlighterCore>) => {
      if (core.failNext) {
        core.failNext = false;
        return Promise.reject(new Error('themes unavailable'));
      }
      return real.createHighlighterCore(...args);
    }),
  };
});

const code = 'int main(void) {\n  return 0;\n}';
const lines = (markup: string) => [
  ...new DOMParser().parseFromString(markup, 'text/html').querySelectorAll('.line'),
];

describe('createShikiHighlighter', () => {
  it('highlights C with both themes as CSS variables that differ per token', async () => {
    const out = await highlightCode(code, 'c');
    expect(out).toMatch(/^<pre class="shiki[^"]*"/);
    expect(out).toContain('--shiki-light-bg:');
    expect(out).toContain('--shiki-dark-bg:');
    expect(out).not.toMatch(/style="color:#/);
    const doc = new DOMParser().parseFromString(out, 'text/html');
    const colours = [...doc.querySelectorAll('span.line > span')].map((s) => {
      const style = s.getAttribute('style') ?? '';
      return [/--shiki-light:([^;]+)/.exec(style)?.[1], /--shiki-dark:([^;]+)/.exec(style)?.[1]];
    });
    expect(colours.length).toBeGreaterThan(3);
    expect(colours.every(([light, dark]) => light && dark)).toBe(true);
    expect(colours.some(([light, dark]) => light !== dark)).toBe(true);
  });

  it('marks only the requested lines and keeps the code text intact', async () => {
    const out = await highlightCode(code, 'c', new Set([2]));
    expect(lines(out).map((l) => l.classList.contains('highlighted'))).toEqual([
      false,
      true,
      false,
    ]);
    expect(lines(out).map((l) => l.textContent)).toEqual(['int main(void) {', '  return 0;', '}']);
    expect(out).not.toContain('data-line');
  });

  it('ignores highlight numbers beyond the last line', async () => {
    expect(await highlightCode('x', 'c', new Set([5]))).not.toContain('highlighted');
  });

  it('keeps hostile code inert', async () => {
    const doc = new DOMParser().parseFromString(
      await highlightCode('</pre><script>alert(1)</script>', 'javascript'),
      'text/html',
    );
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelectorAll('pre')).toHaveLength(1);
    expect(doc.querySelector('pre')?.textContent).toBe('</pre><script>alert(1)</script>');
  });

  // Loads every grammar for real; slow under a parallel, instrumented run.
  it('has a working grammar for every curated language', { timeout: 30_000 }, async () => {
    for (const lang of LANGUAGES) {
      expect(await highlightCode('a b', lang), lang).toContain('shiki');
    }
  });

  it('leaves languages that were never loaded to the caller', async () => {
    const shiki = createShikiHighlighter();
    expect(shiki.highlight('x', 'c', new Set())).toBeUndefined();
    await shiki.load(['rust']);
    expect(shiki.highlight('fn main() {}', 'rust', new Set())).toContain('shiki');
    expect(shiki.highlight('x', 'c', new Set())).toBeUndefined();
  });

  it('loads grammars in parallel, tolerating duplicates and repeated calls', async () => {
    const shiki = createShikiHighlighter();
    const loader = vi.fn(LANGUAGE_LOADERS.python);
    const loaders: LanguageLoaders = { ...LANGUAGE_LOADERS, python: loader };
    const withSpy = createShikiHighlighter(loaders);
    expect(await withSpy.load(['python', 'python'])).toEqual([]);
    expect(await withSpy.load(['python'])).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await shiki.load([])).toEqual([]);
  });

  it('reports a grammar that fails to load, and still loads the others', async () => {
    const loaders: LanguageLoaders = {
      ...LANGUAGE_LOADERS,
      rust: () => {
        throw new Error('chunk missing');
      },
      lua: () => Promise.reject(new Error('network')),
    };
    const shiki = createShikiHighlighter(loaders);
    const problems = await shiki.load(['rust', 'c', 'lua']);
    expect(problems).toEqual([
      'cannot load the "rust" grammar: chunk missing',
      'cannot load the "lua" grammar: network',
    ]);
    expect(shiki.highlight('fn main() {}', 'rust', new Set())).toBeUndefined();
    expect(shiki.highlight('int x;', 'c', new Set())).toContain('shiki');
  });

  it('does not cache a failed setup, so a retry succeeds', async () => {
    const shiki = createShikiHighlighter();
    core.failNext = true;
    await expect(shiki.load(['c'])).rejects.toThrow('themes unavailable');
    expect(await shiki.load(['c'])).toEqual([]);
    expect(shiki.highlight(code, 'c', new Set())).toContain('shiki');
  });

  it('loads each language once, however many parallel loads ask for it', async () => {
    const loader = vi.fn(LANGUAGE_LOADERS.lua);
    const shiki = createShikiHighlighter({ ...LANGUAGE_LOADERS, lua: loader });
    const results = await Promise.all([
      shiki.load(['lua']),
      shiki.load(['lua', 'lua']),
      shiki.load(['lua', 'c']),
    ]);
    expect(results).toEqual([[], [], []]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(shiki.highlight('x = 1', 'lua', new Set())).toContain('shiki');
    expect(shiki.highlight('int a;', 'c', new Set())).toContain('shiki');
  });

  it('waits for a load another call started before reporting ready', async () => {
    const shiki = createShikiHighlighter();
    const first = shiki.load(['python']);
    await shiki.load(['python']);
    expect(shiki.highlight('print(1)', 'python', new Set())).toContain('shiki');
    await first;
  });

  it('attempts a failing grammar once and warns once, however many documents need it', async () => {
    const loader = vi.fn(() => Promise.reject(new Error('missing')));
    const shiki = createShikiHighlighter({ ...LANGUAGE_LOADERS, rust: loader });
    const results = await Promise.all([
      shiki.load(['rust']),
      shiki.load(['rust']),
      shiki.load(['rust']),
    ]);
    expect(results.flat()).toEqual(['cannot load the "rust" grammar: missing']);
    expect(await shiki.load(['rust'])).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await shiki.load(['python'])).toEqual([]);
    expect(shiki.highlight('print(1)', 'python', new Set())).toContain('shiki');
    expect(shiki.highlight('fn main() {}', 'rust', new Set())).toBeUndefined();
  });
});
