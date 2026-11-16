// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSidebar } from '../../src/client/sidebar.ts';
import { renderMenu } from '../../src/generator/menu.ts';
import { SIDEBAR_COLLAPSED, STORAGE_KEYS, WIDE_QUERY } from '../../src/shared/ui-state.ts';
import { $, $$, item, menuOf, parseHtml, renderPage } from '../helpers.ts';

const root = () => document.documentElement;

const posts = [item({ url: '/blog/a/', categories: ['Linux'] })];
const menu = renderMenu(menuOf(posts), '/');

/** The real page shell, so the script is tested against the markup the layout emits. */
function mountPage(): void {
  document.body.innerHTML = parseHtml(renderPage({ menu })).body.innerHTML;
}

/** Controllable wide-viewport query, narrow at first; any other query is a bug in the code under test. */
function mockViewport() {
  const queries: string[] = [];
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const list = { matches: false };
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query);
    return {
      media: query,
      get matches() {
        return list.matches;
      },
      addEventListener: (_t: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
    };
  });
  return {
    queries,
    widen(matches: boolean) {
      list.matches = matches;
      for (const listener of listeners) {
        listener({ matches });
      }
    },
  };
}

const documentListeners: EventListenerOrEventListenerObject[] = [];

function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.activeElement?.dispatchEvent(event);
  return event;
}

const menuButton = () => $(document, '.menu-button');
const expanded = () => menuButton().getAttribute('aria-expanded');
const links = () => $$(document, '#sidebar-body a');
const isOpen = () => root().classList.contains('drawer-open');
const behind = () => $$(document, '.content, .skip-link');

beforeEach(() => {
  localStorage.clear();
  root().classList.add('js');
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener) {
      documentListeners.push(listener);
    }
    add(type, listener, options);
  });
  mountPage();
});
afterEach(() => {
  for (const listener of documentListeners.splice(0)) {
    document.removeEventListener('keydown', listener);
  }
  root().removeAttribute('class');
  delete root().dataset.sidebar;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('without the js class', () => {
  it('adds no behaviour at all and does not mark the page ready', () => {
    root().classList.remove('js');
    mockViewport();
    initSidebar();
    menuButton().click();
    expect(isOpen()).toBe(false);
    expect(expanded()).toBe('false');
    expect(root().dataset.sidebar).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.sidebar)).toBeNull();
  });
});

describe('wiring', () => {
  it('leaves the page class list to the head script and the drawer', () => {
    mockViewport();
    initSidebar();
    expect([...root().classList]).toEqual(['js']);
  });

  it.each([
    ['menu button', '.menu-button'],
    ['sidebar body', '#sidebar-body'],
  ])('adds no behaviour when the %s is missing', (_name, selector) => {
    mockViewport();
    $(document, selector).removeAttribute(selector.startsWith('#') ? 'id' : 'class');
    const button = $(document, '.menu-button, .site-title');
    initSidebar();
    button.click();
    expect(isOpen()).toBe(false);
    expect(root().dataset.sidebar).toBeUndefined();
  });
});

describe('wide viewport', () => {
  let viewport: ReturnType<typeof mockViewport>;
  beforeEach(() => {
    viewport = mockViewport();
    viewport.widen(true);
  });

  it('starts with the sidebar shown: expanded, and no state kept', () => {
    initSidebar();
    expect(expanded()).toBe('true');
    expect(menuButton().getAttribute('aria-controls')).toBe('sidebar');
    expect(menuButton().getAttribute('aria-label')).toBe('Menu');
  });

  it('hides the sidebar and remembers, keeping aria-expanded in sync and the drawer untouched', () => {
    initSidebar();
    menuButton().click();
    expect(root().dataset.sidebar).toBe(SIDEBAR_COLLAPSED);
    expect(localStorage.getItem(STORAGE_KEYS.sidebar)).toBe(SIDEBAR_COLLAPSED);
    expect(expanded()).toBe('false');
    expect(isOpen()).toBe(false);
    expect(behind().some((el) => el.hasAttribute('inert'))).toBe(false);
    expect(document.activeElement).not.toBe(links()[0]);
  });

  it('shows it again and forgets the state', () => {
    initSidebar();
    menuButton().click();
    menuButton().click();
    expect(root().dataset.sidebar).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.sidebar)).toBeNull();
    expect(expanded()).toBe('true');
  });

  it('shows the state the head script restored', () => {
    root().dataset.sidebar = SIDEBAR_COLLAPSED;
    initSidebar();
    expect(expanded()).toBe('false');
    menuButton().click();
    expect(root().dataset.sidebar).toBeUndefined();
    expect(expanded()).toBe('true');
  });

  it('hides for this page even when storage throws', () => {
    vi.stubGlobal('localStorage', {
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    });
    initSidebar();
    expect(() => menuButton().click()).not.toThrow();
    expect(root().dataset.sidebar).toBe(SIDEBAR_COLLAPSED);
    expect(expanded()).toBe('false');
    expect(() => menuButton().click()).not.toThrow();
    expect(root().dataset.sidebar).toBeUndefined();
  });

  it('ignores Escape, the backdrop and link clicks: there is no drawer', () => {
    initSidebar();
    key('Escape');
    $(document, '.backdrop').click();
    const link = $(document, '#sidebar-body a');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(root().dataset.sidebar).toBeUndefined();
    expect(expanded()).toBe('true');
  });

  it('keeps focus on the button', () => {
    initSidebar();
    menuButton().focus();
    menuButton().click();
    expect(document.activeElement).toBe(menuButton());
  });

  it('copes with a page that lacks the controls', () => {
    document.body.innerHTML = '<main>x</main>';
    expect(() => initSidebar()).not.toThrow();
  });
});

describe('viewport changes', () => {
  let viewport: ReturnType<typeof mockViewport>;
  beforeEach(() => {
    viewport = mockViewport();
    initSidebar();
  });

  it('re-syncs aria-expanded to the new width when the sidebar is hidden on wide screens', () => {
    root().dataset.sidebar = SIDEBAR_COLLAPSED;
    expect(expanded()).toBe('false');
    viewport.widen(true);
    expect(expanded()).toBe('false');
    viewport.widen(false);
    expect(expanded()).toBe('false');
    menuButton().click();
    expect(expanded()).toBe('true');
    viewport.widen(true);
    expect(expanded()).toBe('false');
  });

  it('reports a closed drawer as not expanded after widening and narrowing, whatever was stored', () => {
    viewport.widen(true);
    expect(expanded()).toBe('true');
    viewport.widen(false);
    expect(expanded()).toBe('false');
  });

  it('applies the hidden state of a wide page to the next narrow visit without opening the drawer', () => {
    viewport.widen(true);
    menuButton().click();
    viewport.widen(false);
    expect(isOpen()).toBe(false);
    menuButton().click();
    expect(isOpen()).toBe(true);
    expect(expanded()).toBe('true');
    expect(root().dataset.sidebar).toBe(SIDEBAR_COLLAPSED);
  });
});

describe('drawer', () => {
  let viewport: ReturnType<typeof mockViewport>;
  beforeEach(() => {
    viewport = mockViewport();
    initSidebar();
  });

  it('asks for exactly the shared wide-viewport query', () => {
    expect(viewport.queries).toEqual([WIDE_QUERY]);
  });

  it('opens from the menu button, moving focus to the first link', () => {
    menuButton().click();
    expect(isOpen()).toBe(true);
    expect(expanded()).toBe('true');
    expect(document.activeElement).toBe(links()[0]);
  });

  it('makes the content and the skip link inert while open, and only then', () => {
    expect(behind().map((el) => el.hasAttribute('inert'))).toEqual([false, false]);
    expect(behind()).toHaveLength(2);
    menuButton().click();
    expect(behind().map((el) => el.hasAttribute('inert'))).toEqual([true, true]);
    expect($(document, '.topbar').hasAttribute('inert')).toBe(false);
    expect($(document, '.sidebar').hasAttribute('inert')).toBe(false);
    menuButton().click();
    expect(behind().map((el) => el.hasAttribute('inert'))).toEqual([false, false]);
  });

  it('closes from the menu button and returns focus to it', () => {
    menuButton().click();
    menuButton().click();
    expect(isOpen()).toBe(false);
    expect(expanded()).toBe('false');
    expect(document.activeElement).toBe(menuButton());
  });

  it('closes on Escape, undoing inert, with focus back on the button', () => {
    menuButton().click();
    const event = key('Escape');
    expect(isOpen()).toBe(false);
    expect(expanded()).toBe('false');
    expect(document.activeElement).toBe(menuButton());
    expect(behind().some((el) => el.hasAttribute('inert'))).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores Escape while closed', () => {
    const outside = $(document, 'main');
    outside.tabIndex = 0;
    outside.focus();
    key('Escape');
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it('leaves Tab to the browser: inert already confines it', () => {
    menuButton().click();
    expect(key('Tab').defaultPrevented).toBe(false);
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(isOpen()).toBe(true);
  });

  it('ignores other keys while open', () => {
    menuButton().click();
    key('a');
    key('Enter');
    expect(isOpen()).toBe(true);
  });

  it('closes on a backdrop click', () => {
    menuButton().click();
    $(document, '.backdrop').click();
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(menuButton());
    expect(behind().some((el) => el.hasAttribute('inert'))).toBe(false);
  });

  it('closes when a menu link is clicked, but not for other clicks inside', () => {
    menuButton().click();
    $(document, '#sidebar-body summary').click();
    $(document, '#sidebar-body').click();
    expect(isOpen()).toBe(true);
    const link = $(document, '#sidebar-body a');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(isOpen()).toBe(false);
  });

  it('does not react to link clicks while closed', () => {
    const link = $(document, '#sidebar-body a');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(document.activeElement).not.toBe(menuButton());
  });

  it('closes without moving focus when the viewport becomes wide, and releases the page', () => {
    menuButton().click();
    const focused = document.activeElement;
    viewport.widen(true);
    expect(isOpen()).toBe(false);
    expect(expanded()).toBe('true');
    expect(document.activeElement).toBe(focused);
    expect(behind().some((el) => el.hasAttribute('inert'))).toBe(false);
  });

  it('ignores a viewport change that stays narrow while open, and widening while closed', () => {
    viewport.widen(true);
    expect(isOpen()).toBe(false);
    viewport.widen(false);
    menuButton().click();
    viewport.widen(false);
    expect(isOpen()).toBe(true);
    expect(expanded()).toBe('true');
  });

  it('works without a backdrop', () => {
    document.body.innerHTML = document.body.innerHTML.replace(
      /<div class="backdrop[^>]*><\/div>/,
      '',
    );
    expect(document.querySelector('.backdrop')).toBeNull();
    initSidebar();
    expect(() => menuButton().click()).not.toThrow();
    expect(isOpen()).toBe(true);
  });
});
