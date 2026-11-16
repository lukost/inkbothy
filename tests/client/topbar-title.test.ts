// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTopbarTitle, TITLE_SHOWN } from '../../src/client/topbar-title.ts';
import { html } from '../../src/templates/html.ts';
import { $, parseHtml, renderPage } from '../helpers.ts';
import { entry, FakeObserver } from './observer.ts';

let teardown: () => void = () => undefined;

function mount(article: boolean, main = html`<h1>The post</h1><p>text</p>`): void {
  document.body.innerHTML = parseHtml(
    renderPage({ main, ...(article ? { article: { title: 'The post', published: null } } : {}) }),
  ).body.innerHTML;
}

const title = () => $(document, '.topbar-title');
const heading = () => $(document, 'main h1');
const shown = () => title().classList.contains(TITLE_SHOWN);

beforeEach(() => {
  FakeObserver.install();
});
afterEach(() => {
  teardown();
  teardown = () => undefined;
  vi.unstubAllGlobals();
});

describe('initTopbarTitle', () => {
  it('watches the page heading only', () => {
    mount(true);
    teardown = initTopbarTitle();
    expect([...FakeObserver.only().observed]).toEqual([heading()]);
  });

  it('starts hidden, so nothing flashes before the heading has been measured', () => {
    mount(true);
    teardown = initTopbarTitle();
    expect(shown()).toBe(false);
  });

  it('shows the title once the heading has left the top of the screen', () => {
    mount(true);
    teardown = initTopbarTitle();
    FakeObserver.only().deliver(entry(heading(), false, -80));
    expect(shown()).toBe(true);
  });

  it('hides it again when the heading comes back', () => {
    mount(true);
    teardown = initTopbarTitle();
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(), false, -80));
    observer.deliver(entry(heading(), true, 100));
    expect(shown()).toBe(false);
  });

  it('keeps it hidden while the heading is below the viewport, not above it', () => {
    mount(true);
    teardown = initTopbarTitle();
    FakeObserver.only().deliver(entry(heading(), false, 2000));
    expect(shown()).toBe(false);
  });

  it('treats a heading just under the bar, still above the observed area, as gone', () => {
    mount(true);
    teardown = initTopbarTitle();
    FakeObserver.only().deliver(entry(heading(), false, 10));
    expect(shown()).toBe(true);
  });

  it('follows the latest entry of a batch', () => {
    mount(true);
    teardown = initTopbarTitle();
    FakeObserver.only().deliver(entry(heading(), false, -80), entry(heading(), true, 60));
    expect(shown()).toBe(false);
  });

  it('keeps the title a plain text element, whatever its state', () => {
    mount(true);
    teardown = initTopbarTitle();
    FakeObserver.only().deliver(entry(heading(), false, -80));
    expect(title().textContent).toBe('The post');
    expect(title().querySelector('a, button')).toBeNull();
  });

  it('measures the observed area below the top bar', () => {
    mount(true);
    vi.spyOn($(document, '.topbar'), 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 44.4),
    );
    teardown = initTopbarTitle();
    expect(FakeObserver.only().rootMargin).toBe('-44px 0px 0px 0px');
  });

  it('stops watching and hides the title when torn down', () => {
    mount(true);
    teardown = initTopbarTitle();
    const observer = FakeObserver.only();
    observer.deliver(entry(heading(), false, -80));
    teardown();
    expect(observer.disconnected).toBe(true);
    expect(shown()).toBe(false);
  });

  it('ignores an empty batch', () => {
    mount(true);
    teardown = initTopbarTitle();
    expect(() => FakeObserver.only().deliver()).not.toThrow();
    expect(shown()).toBe(false);
  });

  it('copes with an entry that has no root bounds, taking the viewport top as 0', () => {
    mount(true);
    teardown = initTopbarTitle();
    const bare = { ...entry(heading(), false, -5), rootBounds: null };
    FakeObserver.only().deliver(bare);
    expect(shown()).toBe(true);
    FakeObserver.only().deliver({ ...bare, boundingClientRect: new DOMRect(0, 5, 1, 1) });
    expect(shown()).toBe(false);
  });
});

describe('resize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rebuilds the observer once the window stops resizing, with the new bar height', () => {
    mount(true);
    teardown = initTopbarTitle();
    vi.spyOn($(document, '.topbar'), 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 52),
    );
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new Event('resize'));
    expect(FakeObserver.instances).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeObserver.instances).toHaveLength(2);
    expect(FakeObserver.instances[0]?.disconnected).toBe(true);
    expect(FakeObserver.instances[1]?.rootMargin).toBe('-52px 0px 0px 0px');
    expect([...(FakeObserver.instances[1]?.observed ?? [])]).toEqual([heading()]);
  });

  it('keeps working with the new observer', () => {
    mount(true);
    teardown = initTopbarTitle();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(500);
    FakeObserver.instances[1]?.deliver(entry(heading(), false, -80));
    expect(shown()).toBe(true);
  });

  it('stops listening when torn down', () => {
    mount(true);
    teardown = initTopbarTitle();
    teardown();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(500);
    expect(FakeObserver.instances).toHaveLength(1);
  });
});

describe('pages it leaves alone', () => {
  it('has no title in the bar on a listing page, and observes nothing', () => {
    mount(false);
    teardown = initTopbarTitle();
    expect(FakeObserver.instances).toHaveLength(0);
    expect(document.querySelector('.topbar-title')).toBeNull();
  });

  it('observes nothing without a page heading', () => {
    mount(true, html`<p>no heading</p>`);
    teardown = initTopbarTitle();
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('observes nothing without a top bar', () => {
    mount(true);
    $(document, '.topbar').remove();
    teardown = initTopbarTitle();
    expect(FakeObserver.instances).toHaveLength(0);
  });

  it('does nothing in a browser without IntersectionObserver', () => {
    mount(true);
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(() => {
      teardown = initTopbarTitle();
    }).not.toThrow();
    expect(shown()).toBe(false);
  });
});
