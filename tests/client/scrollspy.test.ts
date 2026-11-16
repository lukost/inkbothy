// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { initScrollSpy } from '../../src/client/scrollspy.ts';
import { required } from '../../src/shared/guards.ts';
import { RAIL_QUERY } from '../../src/shared/ui-state.ts';
import { $, $$ } from '../helpers.ts';
import { entry, FakeObserver } from './observer.ts';

/** A matchMedia whose rail query can be switched on and off. */
function mockRail(initial: boolean, reducedMotion = false) {
  const queries: string[] = [];
  const listeners = new Set<() => void>();
  let matches = initial;
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query);
    return {
      media: query,
      get matches() {
        return query === RAIL_QUERY ? matches : reducedMotion;
      },
      addEventListener(_type: string, listener: () => void, options?: { signal?: AbortSignal }) {
        listeners.add(listener);
        options?.signal?.addEventListener('abort', () => listeners.delete(listener));
      },
    };
  });
  return {
    queries,
    listenerCount: () => listeners.size,
    set(value: boolean) {
      matches = value;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

const IDS = ['intro', 'setup', 'caf%C3%A9'] as const;

/** An article with a contents list in the rail position and one heading per entry. */
function mount(): void {
  document.body.innerHTML = `<header class="topbar"></header>
<main><article class="article article-single">
<nav class="toc"><ol>${IDS.map((id) => `<li><a href="#${id}">${id}</a></li>`).join('')}</ol></nav>
<div class="md-content">${IDS.map((id) => `<h2 id="${decodeURIComponent(id)}">${id}</h2>`).join('')}</div>
</article></main>`;
  vi.spyOn($(document, '.topbar'), 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 44),
  );
}

const links = () => $$(document, '.toc a');
const heading = (i: number) => $(document, `h2:nth-of-type(${i + 1})`);
const current = () => links().flatMap((a, i) => (a.hasAttribute('aria-current') ? [i] : []));

let teardown: () => void = () => undefined;

beforeEach(() => {
  FakeObserver.install();
  mount();
});
afterEach(() => {
  teardown();
  teardown = () => undefined;
  vi.unstubAllGlobals();
});

describe('on the rail', () => {
  let media: ReturnType<typeof mockRail>;
  beforeEach(() => {
    media = mockRail(true);
    teardown = initScrollSpy();
  });

  it('asks for exactly the shared rail query', () => {
    expect(media.queries).toEqual([RAIL_QUERY]);
  });

  it('observes every heading the contents list links to, including percent-encoded ids', () => {
    expect([...FakeObserver.only().observed]).toEqual([heading(0), heading(1), heading(2)]);
  });

  it('observes the area below the top bar and above the lower part of the viewport', () => {
    expect(FakeObserver.only().rootMargin).toBe('-44px 0px -70% 0px');
  });

  it('marks nothing before any heading has been reported', () => {
    expect(current()).toEqual([]);
  });

  it('marks nothing while every heading is still below the reading zone', () => {
    FakeObserver.only().deliver(
      entry(heading(0), false, 900),
      entry(heading(1), false, 1500),
      entry(heading(2), false, 2200),
    );
    expect(current()).toEqual([]);
  });

  it('marks the heading inside the reading zone as the current location', () => {
    FakeObserver.only().deliver(entry(heading(0), true, 100), entry(heading(1), false, 1500));
    expect(current()).toEqual([0]);
    expect(links()[0]?.getAttribute('aria-current')).toBe('location');
  });

  it('gives a tie to the first heading in document order, however the entries arrive', () => {
    FakeObserver.only().deliver(entry(heading(2), true, 300), entry(heading(1), true, 200));
    expect(current()).toEqual([1]);
  });

  it('moves on when the next heading enters and the first leaves upwards', () => {
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(0), true, 100));
    observer.deliver(entry(heading(1), true, 400), entry(heading(0), false, -300));
    expect(current()).toEqual([1]);
  });

  it('keeps the last heading passed while none is inside the zone', () => {
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(0), true, 100), entry(heading(1), false, 1500));
    observer.deliver(entry(heading(0), false, -400));
    expect(current()).toEqual([0]);
  });

  it('goes back to the previous section when the current heading leaves downwards', () => {
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(0), false, -400), entry(heading(1), true, 100));
    expect(current()).toEqual([1]);
    observer.deliver(entry(heading(1), false, 1200));
    expect(current()).toEqual([0]);
  });

  it('takes the viewport top as 0 when an entry has no root bounds', () => {
    const observer = FakeObserver.only();
    observer.deliver({ ...entry(heading(0), false, -20), rootBounds: null });
    expect(current()).toEqual([0]);
    observer.deliver({ ...entry(heading(0), false, 20), rootBounds: null });
    expect(current()).toEqual([]);
  });

  it('marks nothing again when scrolled back above the first heading', () => {
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(0), true, 100));
    observer.deliver(entry(heading(0), false, 1200));
    expect(current()).toEqual([]);
  });

  it('marks exactly one entry at a time', () => {
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(0), true, 100));
    observer.deliver(entry(heading(1), true, 300));
    observer.deliver(entry(heading(2), true, 500));
    observer.deliver(entry(heading(0), false, -100));
    observer.deliver(entry(heading(1), false, -50));
    expect(current()).toEqual([2]);
  });

  it('is idempotent: repeating the same report changes nothing', () => {
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(1), true, 100));
    observer.deliver(entry(heading(1), true, 100));
    expect(current()).toEqual([1]);
  });

  it('does not touch the links in any other way', () => {
    FakeObserver.only().deliver(entry(heading(1), true, 100));
    expect(links().map((a) => a.className)).toEqual(['', '', '']);
    expect(links().map((a) => a.getAttribute('href'))).toEqual(IDS.map((id) => `#${id}`));
  });

  it('stops observing and clears the mark when torn down', () => {
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(1), true, 100));
    teardown();
    expect(observer.disconnected).toBe(true);
    expect(current()).toEqual([]);
    expect(media.listenerCount()).toBe(0);
  });

  it('leaves the owner of each returned function in charge: another wiring is untouched', () => {
    const second = initScrollSpy();
    expect(FakeObserver.instances).toHaveLength(2);
    teardown();
    expect(FakeObserver.instances[0]?.disconnected).toBe(true);
    expect(FakeObserver.instances[1]?.disconnected).toBe(false);
    teardown = second;
  });
});

describe('page bottom', () => {
  const footer = () => $(document, '.site-footer');
  beforeEach(() => {
    document.body.insertAdjacentHTML('beforeend', '<footer class="site-footer">f</footer>');
    mockRail(true);
    teardown = initScrollSpy();
  });
  const headings = () => required(FakeObserver.instances[0], 'heading observer');
  const bottom = () => required(FakeObserver.instances[1], 'footer observer');

  it('watches the footer besides the headings', () => {
    expect(FakeObserver.instances).toHaveLength(2);
    expect([...bottom().observed]).toEqual([footer()]);
  });

  it('marks the last entry once the footer is in view, though no heading is in the zone', () => {
    headings().deliver(
      entry(heading(0), false, -900),
      entry(heading(1), false, -500),
      entry(heading(2), false, 900),
    );
    expect(current()).toEqual([1]);
    bottom().deliver(entry(footer(), true, 500));
    expect(current()).toEqual([2]);
  });

  it('takes precedence over a heading inside the zone, then gives way again', () => {
    headings().deliver(entry(heading(0), true, 100));
    bottom().deliver(entry(footer(), true, 500));
    expect(current()).toEqual([2]);
    bottom().deliver(entry(footer(), false, 2000));
    expect(current()).toEqual([0]);
  });

  it('disconnects both observers when torn down', () => {
    teardown();
    expect(FakeObserver.instances.map((o) => o.disconnected)).toEqual([true, true]);
  });
});

describe('keeping the active entry in view', () => {
  let scrolled: Mock<(arg?: boolean | ScrollIntoViewOptions) => void>;
  beforeEach(() => {
    scrolled = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    for (const link of links()) {
      link.scrollIntoView = scrolled;
    }
  });

  it('scrolls the rail to the entry that becomes active, smoothly and only as far as needed', () => {
    mockRail(true);
    teardown = initScrollSpy();
    FakeObserver.only().deliver(entry(heading(1), true, 100));
    expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', behavior: 'smooth' });
    expect(scrolled.mock.contexts[0]).toBe(links()[1]);
  });

  it('does not animate for people who ask for reduced motion', () => {
    mockRail(true, true);
    teardown = initScrollSpy();
    FakeObserver.only().deliver(entry(heading(0), true, 100));
    expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', behavior: 'auto' });
  });

  it('scrolls once per change, not on every report', () => {
    mockRail(true);
    teardown = initScrollSpy();
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(1), true, 100));
    observer.deliver(entry(heading(1), true, 120));
    observer.deliver(entry(heading(2), true, 400));
    expect(scrolled).toHaveBeenCalledTimes(1);
    observer.deliver(entry(heading(1), false, -50));
    expect(scrolled).toHaveBeenCalledTimes(2);
  });

  it('does not scroll when nothing becomes active', () => {
    mockRail(true);
    teardown = initScrollSpy();
    FakeObserver.only().deliver(entry(heading(0), false, 900));
    expect(scrolled).not.toHaveBeenCalled();
  });
});

describe('resize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rebuilds the observers once the window stops resizing, with the new bar height', () => {
    mockRail(true);
    teardown = initScrollSpy();
    const bar = $(document, '.topbar');
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 60));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(FakeObserver.instances).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeObserver.instances).toHaveLength(2);
    expect(FakeObserver.instances[0]?.disconnected).toBe(true);
    expect(FakeObserver.instances[1]?.rootMargin).toBe('-60px 0px -70% 0px');
  });

  it('stops listening when torn down', () => {
    mockRail(true);
    teardown = initScrollSpy();
    teardown();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(500);
    expect(FakeObserver.instances).toHaveLength(1);
  });

  it('builds nothing for a rail that is not displayed', () => {
    mockRail(false);
    teardown = initScrollSpy();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(500);
    expect(FakeObserver.instances).toHaveLength(0);
  });
});

describe('below the breakpoint', () => {
  it('observes nothing and marks nothing', () => {
    mockRail(false);
    teardown = initScrollSpy();
    expect(FakeObserver.instances).toHaveLength(0);
    expect(current()).toEqual([]);
  });

  it('starts tracking when the rail appears, and stops when it goes', () => {
    const media = mockRail(false);
    teardown = initScrollSpy();
    media.set(true);
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(1), true, 100));
    expect(current()).toEqual([1]);
    media.set(false);
    expect(observer.disconnected).toBe(true);
    expect(current()).toEqual([]);
  });

  it('tracks afresh each time the rail comes back', () => {
    const media = mockRail(true);
    teardown = initScrollSpy();
    media.set(false);
    media.set(true);
    expect(FakeObserver.instances).toHaveLength(2);
    expect(FakeObserver.instances[1]?.observed.size).toBe(3);
  });
});

describe('pages it leaves alone', () => {
  it('does nothing without a contents list', () => {
    mockRail(true);
    $(document, '.toc').remove();
    teardown = initScrollSpy();
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('does nothing for a contents list that is not in a single article', () => {
    mockRail(true);
    $(document, '.article-single').className = 'article';
    teardown = initScrollSpy();
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('skips entries whose heading is missing and keeps the others', () => {
    mockRail(true);
    heading(0).removeAttribute('id');
    teardown = initScrollSpy();
    expect([...FakeObserver.only().observed]).toEqual([heading(1), heading(2)]);
  });

  it('does nothing in a browser without IntersectionObserver', () => {
    mockRail(true);
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(() => {
      teardown = initScrollSpy();
    }).not.toThrow();
    expect(current()).toEqual([]);
  });

  it('ignores links without an address', () => {
    mockRail(true);
    links()[0]?.removeAttribute('href');
    teardown = initScrollSpy();
    expect(FakeObserver.only().observed.size).toBe(2);
  });

  it('measures the top bar as 0 when the page has none', () => {
    mockRail(true);
    $(document, '.topbar').remove();
    teardown = initScrollSpy();
    expect(FakeObserver.only().rootMargin).toBe('-0px 0px -70% 0px');
  });
});
