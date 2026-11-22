// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchDialog, type SearchDialog } from '../../../src/client/search/dialog.ts';
import type { LoadedIndex } from '../../../src/client/search/loader.ts';
import { $, $$, attrs, texts } from '../../helpers.ts';
import { bulk, type Fixture, loadedIndex } from './fixture.ts';

const loaded = loadedIndex();
let dialogs: SearchDialog[] = [];
let opener: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="opener" type="button">Search</button>';
  opener = $(document, '#opener');
  opener.focus();
});

afterEach(() => {
  for (const d of dialogs) {
    d.dispose();
  }
  dialogs = [];
  vi.useRealTimers();
});

function mount(load: () => Promise<LoadedIndex> = () => Promise.resolve(loaded)): SearchDialog {
  const dialog = createSearchDialog(load);
  dialogs.push(dialog);
  return dialog;
}

const flush = () => vi.advanceTimersByTimeAsync(0);
/** Waits out the trailing debounce of the status line. */
const settle = () => vi.advanceTimersByTimeAsync(400);
const input = () => $<HTMLInputElement>(document, 'input.search-input');
const dialogEl = () => $<HTMLDialogElement>(document, 'dialog.search-dialog');
const status = () => $(document, '[role="status"]').textContent;
const options = () => $$(document, '[role="option"]');
const resultTitles = () => texts(document, '[role="option"] .search-result-title');
const chip = (label: string) => {
  const found = $$(document, '.search-chip').find((c) => c.textContent === label);
  if (!found) {
    throw new Error(`no chip ${label}`);
  }
  return found;
};

async function open(dialog: SearchDialog): Promise<void> {
  dialog.open();
  await flush();
}

/** Types `text` into the input and waits for the debounce. */
async function type(text: string): Promise<void> {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(80);
}

/** Presses `key` in the input; true when the dialog took it (default prevented). */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  input().dispatchEvent(event);
  return event.defaultPrevented;
}

/** Records the links the page follows and stops it from following them. */
function captureNavigation(): string[] {
  const hrefs: string[] = [];
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (link) {
      event.preventDefault();
      hrefs.push(link.getAttribute('href') ?? '');
    }
  });
  return hrefs;
}

describe('structure', () => {
  it('adds one closed modal dialog with a combobox, two facet groups, a status and a listbox', async () => {
    const dialog = mount();
    expect($$(document, 'dialog')).toHaveLength(1);
    expect(dialogEl().open).toBe(false);
    expect(dialogEl().getAttribute('aria-label')).toBe('Search');
    await open(dialog);
    const box = input();
    expect(attrs(document, 'input', 'role')).toEqual(['combobox']);
    expect(box.getAttribute('aria-autocomplete')).toBe('list');
    expect(box.getAttribute('aria-controls')).toBe($(document, '[role="listbox"]').id);
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(box.getAttribute('aria-label')).toBe('Search');
    expect(box.spellcheck).toBe(false);
    expect($(document, '[role="listbox"]').getAttribute('aria-label')).toBe('Results');
    expect(box.hasAttribute('aria-activedescendant')).toBe(false);
    const groups = $$(document, '[role="group"]');
    expect(
      groups.map((g) => $(document, `#${g.getAttribute('aria-labelledby')}`).textContent),
    ).toEqual(['Categories', 'Tags']);
    expect(texts(groups[0] ?? document, '.search-chip')).toEqual([
      'Embedded',
      'Linux',
      'Zwierzęta',
    ]);
    expect(texts(groups[1] ?? document, '.search-chip')).toEqual([
      'bits',
      'dma',
      'kernel',
      'rt',
      'tooling',
    ]);
    expect(attrs(document, '.search-chip', 'aria-pressed').every((v) => v === 'false')).toBe(true);
  });

  it('leaves out a facet group that has no terms', async () => {
    const dialog = mount(() => Promise.resolve(loadedIndex(bulk(2))));
    await open(dialog);
    expect(texts(document, '[role="group"] .search-facet-label')).toEqual(['Tags']);
  });
});

describe('opening and closing', () => {
  it('shows the dialog modally and focuses the input', async () => {
    const dialog = mount();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    await open(dialog);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialogEl().open).toBe(true);
    expect(document.activeElement).toBe(input());
    showModal.mockRestore();
  });

  it('opens once however often it is asked', async () => {
    const dialog = mount();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    await open(dialog);
    await open(dialog);
    expect(showModal).toHaveBeenCalledTimes(1);
    showModal.mockRestore();
  });

  it('closes with the Close button and returns focus to where it came from', async () => {
    const dialog = mount();
    await open(dialog);
    $(document, '.search-close').click();
    expect(dialogEl().open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  /** A pointer press or release at (x, y) on `target`, as the browser reports it. */
  const pointer = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  const BACKDROP = [5, 5] as const;

  function boxAt(left: number, top: number, right: number, bottom: number): void {
    vi.spyOn(dialogEl(), 'getBoundingClientRect').mockReturnValue(
      new DOMRect(left, top, right - left, bottom - top),
    );
  }

  it('closes when both the press and the click are on the backdrop, not inside the panel', async () => {
    const dialog = mount();
    await open(dialog);
    boxAt(100, 100, 300, 300);
    pointer($(document, '.search-panel'), 'pointerdown', 150, 150);
    $(document, '.search-panel').click();
    expect(dialogEl().open).toBe(true);
    pointer(dialogEl(), 'pointerdown', ...BACKDROP);
    pointer(dialogEl(), 'click', ...BACKDROP);
    expect(dialogEl().open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('stays open when a drag from the input ends on the backdrop', async () => {
    const dialog = mount();
    await open(dialog);
    boxAt(100, 100, 300, 300);
    pointer(input(), 'pointerdown', 150, 120);
    pointer(dialogEl(), 'click', ...BACKDROP);
    expect(dialogEl().open).toBe(true);
  });

  it('stays open when only the click, not the press, is on the backdrop', async () => {
    const dialog = mount();
    await open(dialog);
    boxAt(100, 100, 300, 300);
    pointer(dialogEl(), 'click', ...BACKDROP);
    expect(dialogEl().open).toBe(true);
  });

  it('stays open for a click on the dialog’s own border', async () => {
    const dialog = mount();
    await open(dialog);
    boxAt(100, 100, 300, 300);
    pointer(dialogEl(), 'pointerdown', 100, 150);
    pointer(dialogEl(), 'click', 100, 150);
    pointer(dialogEl(), 'pointerdown', 300, 300);
    pointer(dialogEl(), 'click', 300, 300);
    pointer(dialogEl(), 'pointerdown', 150, 100);
    pointer(dialogEl(), 'click', 150, 100);
    expect(dialogEl().open).toBe(true);
  });

  it('does not close for a click without a press after it was closed from the backdrop', async () => {
    const dialog = mount();
    await open(dialog);
    boxAt(100, 100, 300, 300);
    pointer(dialogEl(), 'pointerdown', ...BACKDROP);
    pointer(dialogEl(), 'click', ...BACKDROP);
    expect(dialogEl().open).toBe(false);
    await open(dialog);
    pointer(dialogEl(), 'click', ...BACKDROP);
    expect(dialogEl().open).toBe(true);
  });

  it('forgets a press that did not end in a click', async () => {
    const dialog = mount();
    await open(dialog);
    boxAt(100, 100, 300, 300);
    pointer(dialogEl(), 'pointerdown', ...BACKDROP);
    pointer(input(), 'pointerdown', 150, 120);
    pointer(dialogEl(), 'click', ...BACKDROP);
    expect(dialogEl().open).toBe(true);
  });

  it('closes when the browser cancels it, returning focus', async () => {
    const dialog = mount();
    await open(dialog);
    dialogEl().close();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Escape from reaching handlers on the document', async () => {
    const dialog = mount();
    await open(dialog);
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    document.removeEventListener('keydown', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]).toMatchObject({ key: 'a' });
  });

  it('puts the Close button in the tab order after the input and before the chips; links stay out', async () => {
    const dialog = mount();
    await open(dialog);
    await type('kernel');
    const tabbable = $$(dialogEl(), 'input, button, a').filter((e) => e.tabIndex >= 0);
    expect(tabbable.slice(0, 3).map((e) => e.className)).toEqual([
      'search-input',
      'search-close',
      'search-chip',
    ]);
    expect($$(document, '[role="option"] a').every((a) => a.tabIndex === -1)).toBe(true);
  });

  it('closes when the page is hidden, so the bfcache never restores it open', async () => {
    const dialog = mount();
    await open(dialog);
    window.dispatchEvent(new Event('pagehide'));
    expect(dialogEl().open).toBe(false);
  });

  it('stops listening for pagehide once disposed', async () => {
    const dialog = mount();
    await open(dialog);
    const el = dialogEl();
    dialog.dispose();
    const close = vi.spyOn(el, 'close');
    window.dispatchEvent(new Event('pagehide'));
    expect(close).not.toHaveBeenCalled();
  });

  it('runs nothing after it closes: no pending search, no late status', async () => {
    const dialog = mount();
    await open(dialog);
    input().value = 'kernel';
    input().dispatchEvent(new Event('input'));
    dialogEl().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(options()).toHaveLength(0);
    expect(status()).toBe('');
  });

  it('never announces a count that was still pending when it closed', async () => {
    const dialog = mount();
    await open(dialog);
    await type('kernel');
    expect(options()).toHaveLength(4);
    dialogEl().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(status()).toBe('');
  });

  it('drops a search that was waiting for the index when it closes', async () => {
    let resolve: (index: LoadedIndex) => void = () => undefined;
    const dialog = mount(() => new Promise((r) => (resolve = r)));
    await open(dialog);
    await type('kernel');
    dialogEl().close();
    resolve(loaded);
    await vi.advanceTimersByTimeAsync(1000);
    expect(options()).toHaveLength(0);
  });

  it('does not return focus to an opener that is not an HTML element', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('tabindex', '0');
    document.body.append(svg);
    svg.focus();
    expect(document.activeElement).toBe(svg);
    const dialog = mount();
    await open(dialog);
    expect(document.activeElement).toBe(input());
    dialogEl().close();
    // Closing moves focus only to a valid opener; here it stays where the dialog put it.
    expect(document.activeElement).toBe(input());
  });

  it('does not refocus a stale opener on a later close event', async () => {
    const dialog = mount();
    await open(dialog);
    dialogEl().close();
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    dialogEl().dispatchEvent(new Event('close'));
    expect(document.activeElement).toBe(other);
  });

  it('renders nothing when disposed while the debounce is pending', async () => {
    const dialog = mount();
    await open(dialog);
    const list = $(document, '.search-results');
    const line = $(document, '[role="status"]');
    input().value = 'kernel';
    input().dispatchEvent(new Event('input'));
    dialog.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(list.children).toHaveLength(0);
    expect(line.textContent).toBe('');
  });

  it('fetches nothing when disposed while the debounce is pending', async () => {
    const load = vi.fn<() => Promise<LoadedIndex>>().mockRejectedValue(new Error('offline'));
    const dialog = mount(load);
    await open(dialog);
    input().value = 'kernel';
    input().dispatchEvent(new Event('input'));
    dialog.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('removes itself on dispose, and stops reacting', async () => {
    const dialog = mount();
    await open(dialog);
    const box = input();
    dialog.dispose();
    expect(document.querySelector('dialog')).toBeNull();
    box.value = 'kernel';
    box.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });
});

describe('status', () => {
  it('says Loading… until the index arrives, then nothing for an empty query', async () => {
    let resolve: (index: LoadedIndex) => void = () => undefined;
    const dialog = mount(() => new Promise((r) => (resolve = r)));
    await open(dialog);
    expect(status()).toBe('Loading…');
    resolve(loaded);
    await flush();
    expect(status()).toBe('');
    expect($$(document, '.search-chip').length).toBeGreaterThan(0);
  });

  it.each([
    ['kernel', '4 results'],
    ['sched', '1 result'],
    ['xyzzyplugh', 'No results'],
  ])('reports %j as %j', async (text, message) => {
    await open(mount());
    await type(text);
    await settle();
    expect(status()).toBe(message);
  });

  it('reports no results for a filter that matches nothing', async () => {
    await open(mount());
    chip('Embedded').click();
    chip('kernel').click();
    await flush();
    await settle();
    expect(status()).toBe('No results');
    expect(options()).toHaveLength(0);
  });

  it('expands the listbox for one hit and collapses it for none', async () => {
    await open(mount());
    await type('sched');
    expect(options()).toHaveLength(1);
    expect(input().getAttribute('aria-expanded')).toBe('true');
    await type('xyzzyplugh');
    expect(options()).toHaveLength(0);
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('goes quiet again when the query is cleared', async () => {
    await open(mount());
    await type('kernel');
    await type('  ');
    expect(status()).toBe('');
    expect(options()).toHaveLength(0);
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('says the search is unavailable, with a Retry that works once the index loads', async () => {
    const load = vi
      .fn<() => Promise<LoadedIndex>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValue(loaded);
    const dialog = mount(load);
    await open(dialog);
    expect(status()).toBe('Search is unavailable');
    expect($(document, '.search-retry').hidden).toBe(false);
    expect($$(document, '.search-chip')).toHaveLength(0);

    $(document, '.search-retry').click();
    await flush();
    expect(status()).toBe('Search is unavailable');

    await type('kernel');
    await settle();
    expect(status()).toBe('4 results');
    expect($(document, '.search-retry').hidden).toBe(true);
    expect($$(document, '.search-chip').length).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('status announcements', () => {
  it('announces the count once, after the last result, not on every keystroke', async () => {
    await open(mount());
    const seen: string[] = [];
    new MutationObserver(() => seen.push(status() ?? '')).observe($(document, '[role="status"]'), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    for (const text of ['k', 'ke', 'ker', 'kern', 'kernel']) {
      await type(text);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(options()).toHaveLength(4);
    expect(status()).toBe('');
    await settle();
    expect(status()).toBe('4 results');
    await flush();
    expect(seen).toEqual(['4 results']);
  });

  it('leaves the status alone when a new search yields the same count', async () => {
    await open(mount());
    await type('kernel');
    await settle();
    const seen = vi.fn();
    new MutationObserver(seen).observe($(document, '[role="status"]'), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    await type('kernel ');
    await settle();
    expect(status()).toBe('4 results');
    expect(seen).not.toHaveBeenCalled();
  });

  it('does not report a failed load after the dialog closed', async () => {
    let reject: (reason: Error) => void = () => undefined;
    const dialog = mount(() => new Promise((_, r) => (reject = r)));
    await open(dialog);
    dialogEl().close();
    reject(new Error('late'));
    await flush();
    expect(status()).toBe('Loading…');
  });

  it('does not let a pending count overwrite the status of a cleared query', async () => {
    await open(mount());
    await type('kernel');
    await type('');
    await settle();
    expect(status()).toBe('');
  });

  it('clears the status at once when the query is cleared', async () => {
    await open(mount());
    await type('kernel');
    await settle();
    await type('');
    expect(status()).toBe('');
  });
});

describe('placeholder', () => {
  it('is generic until the index is loaded, then names the sections by their labels', async () => {
    const dialog = mount();
    expect(input().placeholder).toBe('Search…');
    await open(dialog);
    expect(input().placeholder).toBe('Search scribings, projects and snippets…');
    expect(input().placeholder).not.toMatch(/posts?/i);
  });

  it.each([
    [{}, 'Search…'],
    [{ a: 'Only One' }, 'Search only one…'],
    [{ a: 'Alpha', b: 'Beta' }, 'Search alpha and beta…'],
    [{ a: 'Alpha', b: 'Beta', c: 'Gamma', d: 'Delta' }, 'Search alpha, beta, gamma and delta…'],
  ])('lists %j as %j', async (sections, expected) => {
    await open(mount(() => Promise.resolve({ ...loaded, sections })));
    expect(input().placeholder).toBe(expected);
  });
});

describe('results', () => {
  it('shows title, section, date and summary, with matched words marked', async () => {
    await open(mount());
    await type('tracer');
    const [first, second] = options();
    expect(first?.querySelector('.search-result-title')?.innerHTML).toBe('<mark>Tracer</mark>');
    const badge = first?.querySelector('.search-badge');
    expect(badge?.textContent).toBe('Section: Projects');
    expect(badge?.querySelector('.visually-hidden')?.textContent).toBe('Section: ');
    expect(first?.querySelector('time')?.getAttribute('datetime')).toBe('2025-12-01');
    expect(first?.querySelector('time')?.textContent).toBe('2025-12-01');
    expect(first?.querySelector('.search-result-summary')?.textContent).toBe('ftrace helper');
    expect(first?.querySelector('a')?.getAttribute('href')).toBe('/projects/tracer/');
    expect(second?.querySelector('.search-badge')?.textContent).toBe('Section: Scribings');
  });

  it('badges a page, which belongs to no section, as a page', async () => {
    await open(mount());
    await type('author');
    expect(texts(document, '[role="option"] .search-badge')).toEqual(['Section: Page']);
    expect(attrs(document, '[role="option"] a', 'href')).toEqual(['/about/']);
  });

  it('badges a document of a section the index does not label by the section key', async () => {
    await open(mount(() => Promise.resolve({ ...loaded, sections: {} })));
    await type('tracer');
    expect(texts(document, '[role="option"] .search-badge')[0]).toBe('Section: projects');
  });

  it('badges a document of a section named like an Object property by the key', async () => {
    await open(mount(() => Promise.resolve({ ...loaded, sections: {} })));
    await type('bitmask');
    expect(texts(document, '[role="option"] .search-badge')).toEqual(['Section: snippets']);
  });

  it('omits the date and summary a document does not have', async () => {
    await open(mount());
    await type('undated');
    const [only] = options();
    expect(only?.querySelector('time')).toBeNull();
    expect(only?.querySelector('.search-result-summary')).toBeNull();
  });

  it('marks words in the summary too, folding diacritics', async () => {
    await open(mount());
    await type('zolw');
    expect($(document, '.search-result-title mark').textContent).toBe('Żółw');
  });

  it('shows hostile titles as text', async () => {
    const hostile: Fixture = [
      [
        {
          url: '/blog/x/',
          title: '<img src=x onerror=alert(1)> kernel',
          summary: '<script>boom()</script> kernel',
          tags: ['k'],
        },
        '',
      ],
    ];
    await open(mount(() => Promise.resolve(loadedIndex(hostile))));
    await type('kernel');
    expect(options()).toHaveLength(1);
    expect(document.querySelector('.search-dialog img, .search-dialog script')).toBeNull();
    expect($(document, '.search-result-title').textContent).toBe(
      '<img src=x onerror=alert(1)> kernel',
    );
    expect($(document, '.search-result-summary').textContent).toBe(
      '<script>boom()</script> kernel',
    );
  });

  it('gives every option a distinct id', async () => {
    await open(mount());
    await type('kernel');
    const ids = options().map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(1);
  });

  it('lists at most 20', async () => {
    await open(mount(() => Promise.resolve(loadedIndex(bulk(30)))));
    await type('bulky');
    expect(options()).toHaveLength(20);
    await settle();
    expect(status()).toBe('20 results');
  });
});

describe('debounce', () => {
  it('searches 80 ms after the last keystroke, once', async () => {
    await open(mount());
    input().value = 'k';
    input().dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(79);
    input().value = 'kernel';
    input().dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(79);
    expect(options()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(options()).toHaveLength(4);
  });

  it('searches the text as it is when the timer fires', async () => {
    await open(mount());
    input().value = 'sched';
    input().dispatchEvent(new Event('input'));
    input().value = 'tracer';
    await vi.advanceTimersByTimeAsync(80);
    expect(resultTitles()).toEqual(['Tracer', 'Notes']);
  });
});

describe('keyboard', () => {
  async function withResults(): Promise<void> {
    await open(mount());
    await type('kernel');
  }

  it('moves the active option with the arrow keys, wrapping around', async () => {
    await withResults();
    const active = () => options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(active()).toBe(-1);
    expect(press('ArrowDown')).toBe(true);
    expect(active()).toBe(0);
    press('ArrowDown');
    expect(active()).toBe(1);
    press('ArrowUp');
    press('ArrowUp');
    expect(active()).toBe(options().length - 1);
    press('ArrowDown');
    expect(active()).toBe(0);
  });

  it('starts from the last option with ArrowUp', async () => {
    await withResults();
    press('ArrowUp');
    expect(options().at(-1)?.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps aria-activedescendant and aria-selected in step', async () => {
    await withResults();
    expect(input().getAttribute('aria-expanded')).toBe('true');
    press('ArrowDown');
    press('ArrowDown');
    const second = options()[1];
    expect(input().getAttribute('aria-activedescendant')).toBe(second?.id);
    expect(attrs(document, '[role="option"]', 'aria-selected')).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
  });

  it('leaves Home and End to the input, so they move the caret', async () => {
    await withResults();
    press('ArrowDown');
    expect(press('End')).toBe(false);
    expect(press('Home')).toBe(false);
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
  });

  it('opens the active option with Enter', async () => {
    const hrefs = captureNavigation();
    await withResults();
    press('ArrowDown');
    press('ArrowDown');
    expect(press('Enter')).toBe(true);
    expect(hrefs).toEqual([options()[1]?.querySelector('a')?.getAttribute('href')]);
  });

  it('opens the first option with Enter when none is active', async () => {
    const hrefs = captureNavigation();
    await withResults();
    press('Enter');
    expect(hrefs).toEqual([options()[0]?.querySelector('a')?.getAttribute('href')]);
  });

  it('searches the text as typed when Enter comes before the debounce fires', async () => {
    const hrefs = captureNavigation();
    await withResults();
    input().value = 'tracer';
    input().dispatchEvent(new Event('input'));
    expect(press('Enter')).toBe(true);
    expect(hrefs).toEqual(['/projects/tracer/']);
    await vi.advanceTimersByTimeAsync(500);
    expect(resultTitles()).toEqual(['Tracer', 'Notes']);
  });

  it('searches once when Enter comes before the debounce fires', async () => {
    captureNavigation();
    await withResults();
    const render = vi.spyOn(HTMLUListElement.prototype, 'replaceChildren');
    input().value = 'tracer';
    input().dispatchEvent(new Event('input'));
    press('Enter');
    await vi.advanceTimersByTimeAsync(500);
    expect(render).toHaveBeenCalledTimes(1);
    render.mockRestore();
  });

  it('forwards Ctrl, Meta and Shift to the link when Enter opens it', async () => {
    const seen: MouseEvent[] = [];
    document.addEventListener('click', (e) => {
      if (e instanceof MouseEvent) {
        e.preventDefault();
        seen.push(e);
      }
    });
    await withResults();
    press('Enter', { ctrlKey: true });
    press('Enter', { metaKey: true });
    press('Enter', { shiftKey: true });
    press('Enter');
    expect(seen.map((e) => [e.ctrlKey, e.metaKey, e.shiftKey])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [false, false, false],
    ]);
  });

  it('activates the link when an option outside the link is clicked, as screen readers do', async () => {
    const seen: MouseEvent[] = [];
    document.addEventListener('click', (e) => {
      if (e instanceof MouseEvent && e.target instanceof Element && e.target.closest('a')) {
        e.preventDefault();
        seen.push(e);
      }
    });
    await withResults();
    const second = options()[1];
    second?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.target).toBe(second?.querySelector('a'));
    expect(seen[0]?.ctrlKey).toBe(true);
  });

  it('leaves a click on the link itself alone, and clicks outside any option', async () => {
    const seen: Element[] = [];
    document.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.target instanceof Element) {
        seen.push(e.target);
      }
    });
    await withResults();
    const link = options()[0]?.querySelector('a');
    link?.click();
    expect(seen).toEqual([link]);
    seen.length = 0;
    $(document, '.search-results').click();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tagName).toBe('UL');
  });

  it('leaves the keys to the input when there is nothing to choose', async () => {
    const hrefs = captureNavigation();
    await open(mount());
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
      expect(press(key), key).toBe(false);
    }
    expect(hrefs).toEqual([]);
  });

  it('ignores keys while an input method is composing', async () => {
    const hrefs = captureNavigation();
    await withResults();
    expect(press('ArrowDown', { isComposing: true })).toBe(false);
    expect(press('Enter', { isComposing: true })).toBe(false);
    expect(hrefs).toEqual([]);
  });

  it('ignores other keys', async () => {
    await withResults();
    expect(press('a')).toBe(false);
    expect(press('Tab')).toBe(false);
  });

  it('drops the active option when the results change', async () => {
    await withResults();
    press('ArrowDown');
    await type('sched');
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
    expect(options().every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('scrolls the active option into view', async () => {
    await withResults();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    press('ArrowDown');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    scroll.mockRestore();
  });
});

describe('filters', () => {
  it('lists what a chip selects, even with no text, and again without it', async () => {
    await open(mount());
    chip('Linux').click();
    await flush();
    expect(chip('Linux').getAttribute('aria-pressed')).toBe('true');
    expect(resultTitles()).toEqual(['DMA on i.MX8', 'Realtime scheduling']);
    await settle();
    expect(status()).toBe('2 results');
    chip('Linux').click();
    await flush();
    expect(chip('Linux').getAttribute('aria-pressed')).toBe('false');
    expect(options()).toHaveLength(0);
    expect(status()).toBe('');
  });

  it('ORs within a group and ANDs across groups, together with the text', async () => {
    await open(mount());
    chip('Linux').click();
    chip('Embedded').click();
    await flush();
    expect(options()).toHaveLength(3);
    chip('rt').click();
    await flush();
    expect(resultTitles()).toEqual(['Realtime scheduling']);
    chip('rt').click();
    chip('kernel').click();
    await flush();
    expect(resultTitles()).toEqual(['DMA on i.MX8']);
    await type('descriptors');
    expect(resultTitles()).toEqual(['DMA on i.MX8']);
    await type('cyclictest');
    expect(options()).toHaveLength(0);
  });
});

describe('persistence', () => {
  it('keeps the query, filters and results when closed and reopened', async () => {
    const dialog = mount();
    await open(dialog);
    await type('kernel');
    chip('tooling').click();
    await flush();
    const before = resultTitles();
    expect(before).toEqual(['Tracer']);
    dialogEl().close();
    await open(dialog);
    expect(input().value).toBe('kernel');
    expect(chip('tooling').getAttribute('aria-pressed')).toBe('true');
    expect(resultTitles()).toEqual(before);
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe('kernel'.length);
  });

  it('loads the index once, not for every keystroke or filter', async () => {
    const load = vi.fn(() => Promise.resolve(loaded));
    await open(mount(load));
    await type('k');
    await type('ke');
    chip('Linux').click();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
