// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHtml, renderPage } from '../helpers.ts';

const inits = vi.hoisted((): { order: string[]; failing: Set<string> } => ({
  order: [],
  failing: new Set(),
}));

/** Replaces an init module by one that records its call and may fail on demand. */
function fake(name: string, exportName: string) {
  return {
    [exportName]: () => {
      inits.order.push(name);
      if (inits.failing.has(name)) {
        throw new Error(`${name} broke`);
      }
      return () => undefined;
    },
  };
}

vi.mock('../../src/client/theme.ts', () => fake('theme', 'initTheme'));
vi.mock('../../src/client/text-size.ts', () => fake('text size', 'initTextSize'));
vi.mock('../../src/client/sidebar.ts', () => fake('sidebar', 'initSidebar'));
vi.mock('../../src/client/search/init.ts', () => fake('search', 'initSearch'));
vi.mock('../../src/client/print.ts', () => fake('print', 'initPrint'));
vi.mock('../../src/client/stream.ts', () => fake('stream', 'initStream'));
vi.mock('../../src/client/topbar-title.ts', () => fake('top bar title', 'initTopbarTitle'));
vi.mock('../../src/client/scrollspy.ts', () => fake('scroll spy', 'initScrollSpy'));

const ALL = [
  'theme',
  'text size',
  'sidebar',
  'search',
  'print',
  'stream',
  'top bar title',
  'scroll spy',
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  inits.order.length = 0;
  inits.failing.clear();
});

async function boot(): Promise<void> {
  document.body.innerHTML = parseHtml(renderPage()).body.innerHTML;
  await import('../../src/client/main.ts');
}

describe('main', () => {
  it('starts every module, in order', async () => {
    await boot();
    expect(inits.order).toEqual(ALL);
  });

  it.each(ALL)('keeps starting the others when %s fails, and says which failed', async (name) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    inits.failing.add(name);
    await expect(boot()).resolves.toBeUndefined();
    expect(inits.order).toEqual(ALL);
    expect(error).toHaveBeenCalledExactlyOnceWith(`${name} failed to start`, expect.any(Error));
  });

  it('survives every module failing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const name of ALL) {
      inits.failing.add(name);
    }
    await expect(boot()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(ALL.length);
  });
});
