// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPrint } from '../../src/client/print.ts';
import { $ } from '../helpers.ts';

const MAIN = `<aside><details id="menu"><summary>Menu</summary>m</details></aside>
<main>
<nav class="toc"><details id="toc"><summary>Contents</summary><ol><li>a</li></ol></details></nav>
<details id="raw"><summary>More</summary><details id="nested"><summary>Deeper</summary>x</details></details>
<details id="shown" open><summary>Open</summary>y</details>
</main>`;

type PrintListener = (event: { matches: boolean }) => void;

/** A `matchMedia` whose `print` query notifies the listeners it holds; each is removed when its signal aborts. */
function mockPrintMedia() {
  const listeners = new Set<PrintListener>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: false,
    addEventListener: (
      _type: string,
      listener: PrintListener,
      options?: { signal?: AbortSignal },
    ) => {
      listeners.add(listener);
      options?.signal?.addEventListener('abort', () => listeners.delete(listener));
    },
  }));
  return {
    fire: (matches: boolean) => {
      for (const listener of listeners) {
        listener({ matches });
      }
    },
    count: () => listeners.size,
  };
}

const print = (phase: 'beforeprint' | 'afterprint') => dispatchEvent(new Event(phase));
const states = () =>
  [...document.querySelectorAll<HTMLDetailsElement>('details')].map((d) => [d.id, d.open]);
const openIds = () =>
  states()
    .filter(([, open]) => open)
    .map(([id]) => id);

let media = mockPrintMedia();
const teardowns: (() => void)[] = [];
const start = () => {
  const teardown = initPrint();
  teardowns.push(teardown);
  return teardown;
};

beforeEach(() => {
  document.body.innerHTML = MAIN;
  media = mockPrintMedia();
});
afterEach(() => {
  for (const teardown of teardowns.splice(0)) {
    teardown();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('details', () => {
  it('opens every collapsed disclosure of the content on beforeprint and closes exactly those on afterprint', () => {
    start();
    print('beforeprint');
    expect(states()).toEqual([
      ['menu', false],
      ['toc', true],
      ['raw', true],
      ['nested', true],
      ['shown', true],
    ]);
    print('afterprint');
    expect(states()).toEqual([
      ['menu', false],
      ['toc', false],
      ['raw', false],
      ['nested', false],
      ['shown', true],
    ]);
  });

  it('leaves a disclosure that the reader had open open afterwards', () => {
    start();
    $<HTMLDetailsElement>(document, '#raw').open = true;
    print('beforeprint');
    print('afterprint');
    expect(openIds()).toEqual(['raw', 'shown']);
  });

  it('does nothing on afterprint without a beforeprint', () => {
    start();
    print('afterprint');
    expect(openIds()).toEqual(['shown']);
  });

  it('prepares once per print, and starts afresh for the next', () => {
    start();
    print('beforeprint');
    print('beforeprint');
    print('afterprint');
    expect(openIds()).toEqual(['shown']);
    print('beforeprint');
    expect(openIds()).toEqual(['toc', 'raw', 'nested', 'shown']);
    print('afterprint');
    expect(openIds()).toEqual(['shown']);
  });
});

describe('print media fallback', () => {
  it('opens and restores from the media query alone', () => {
    start();
    media.fire(true);
    expect(openIds()).toEqual(['toc', 'raw', 'nested', 'shown']);
    media.fire(false);
    expect(openIds()).toEqual(['shown']);
  });

  it.each([
    ['events then media', true],
    ['media then events', false],
  ])('restores the page when both sources fire (%s)', (_name, eventsFirst) => {
    start();
    const both = (phase: 'beforeprint' | 'afterprint', matches: boolean) => {
      if (eventsFirst) {
        print(phase);
        media.fire(matches);
      } else {
        media.fire(matches);
        print(phase);
      }
    };
    both('beforeprint', true);
    expect(openIds()).toEqual(['toc', 'raw', 'nested', 'shown']);
    both('afterprint', false);
    expect(openIds()).toEqual(['shown']);
  });
});

describe('teardown', () => {
  it('removes every listener', () => {
    const stop = start();
    expect(media.count()).toBe(1);
    stop();
    expect(media.count()).toBe(0);
    print('beforeprint');
    media.fire(true);
    expect(openIds()).toEqual(['shown']);
  });

  it('closes what a print in progress opened when it is stopped', () => {
    const stop = start();
    print('beforeprint');
    expect(openIds()).toEqual(['toc', 'raw', 'nested', 'shown']);
    stop();
    expect(openIds()).toEqual(['shown']);
    print('afterprint');
    expect(openIds()).toEqual(['shown']);
  });

  it('leaves the page as it was when started twice', () => {
    start();
    start();
    print('beforeprint');
    print('afterprint');
    expect(openIds()).toEqual(['shown']);
  });
});

describe('print button', () => {
  const button = () => {
    document.body.insertAdjacentHTML('afterbegin', '<button class="print-button"></button>');
    return $<HTMLButtonElement>(document, '.print-button');
  };

  it('opens the print dialog on each click', () => {
    const dialog = vi.fn();
    vi.stubGlobal('print', dialog);
    const b = button();
    start();
    b.click();
    b.click();
    expect(dialog).toHaveBeenCalledTimes(2);
  });

  it('stops reacting after teardown', () => {
    const dialog = vi.fn();
    vi.stubGlobal('print', dialog);
    const b = button();
    start()();
    b.click();
    expect(dialog).not.toHaveBeenCalled();
  });

  it('starts without a button', () => {
    expect(() => start()).not.toThrow();
  });
});

describe('failure', () => {
  it('reports a failing step, does not throw, and prints normally next time', () => {
    start();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const query = vi.spyOn(document, 'querySelectorAll').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => print('beforeprint')).not.toThrow();
    expect(log).toHaveBeenCalledWith('cannot switch print state', expect.any(Error));
    query.mockRestore();
    print('afterprint');
    print('beforeprint');
    expect(openIds()).toEqual(['toc', 'raw', 'nested', 'shown']);
    print('afterprint');
    expect(openIds()).toEqual(['shown']);
  });
});
