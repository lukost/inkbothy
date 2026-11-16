// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSearch } from '../../../src/client/search/init.ts';
import { $, $$, parseHtml, renderPage } from '../../helpers.ts';
import { indexJson } from './fixture.ts';

let counter = 0;
const fetchMock = vi.fn<typeof fetch>();
let teardown: () => void = () => undefined;

/** The real page shell, so the script is tested against the markup the layout emits. */
function mountPage(searchIndex: string): void {
  document.body.innerHTML = parseHtml(renderPage({ searchIndex })).body.innerHTML;
}

const key = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );

beforeEach(() => {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(indexJson())));
  vi.stubGlobal('fetch', fetchMock);
  mountPage(`/search-index-init-${counter++}.json`);
});

afterEach(() => {
  teardown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
  document.body.innerHTML = '';
});

describe('initSearch', () => {
  it('keeps the search button visible when search can work', () => {
    teardown = initSearch();
    expect($(document, '.search-trigger').hidden).toBe(false);
  });

  it('opens one dialog from every search button and loads the index named by the page', async () => {
    $(document, '.topbar-tools').append($(document, '.search-trigger').cloneNode(true));
    teardown = initSearch();
    const url = $(document, '.search-trigger').dataset.index;
    expect(url).toMatch(/^\/search-index-init-\d+\.json$/);
    expect(fetchMock).not.toHaveBeenCalled();
    $(document, '.search-trigger').click();
    expect($<HTMLDialogElement>(document, 'dialog').open).toBe(true);
    await vi.waitFor(() => expect($$(document, '.search-chip').length).toBeGreaterThan(0));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url);
    $<HTMLDialogElement>(document, 'dialog').close();
    $$(document, '.search-trigger')[1]?.click();
    expect($<HTMLDialogElement>(document, 'dialog').open).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens on / and Ctrl+K', () => {
    teardown = initSearch();
    key({ key: '/' });
    expect($<HTMLDialogElement>(document, 'dialog').open).toBe(true);
    $<HTMLDialogElement>(document, 'dialog').close();
    key({ key: 'k', ctrlKey: true });
    expect($<HTMLDialogElement>(document, 'dialog').open).toBe(true);
  });

  it('returns focus to the trigger that opened the dialog', () => {
    teardown = initSearch();
    const trigger = $(document, '.search-trigger');
    trigger.focus();
    trigger.click();
    $<HTMLDialogElement>(document, 'dialog').close();
    expect(document.activeElement).toBe(trigger);
  });

  it('builds one dialog and one set of listeners however often it runs', () => {
    initSearch();
    initSearch();
    teardown = initSearch();
    expect($$(document, 'dialog')).toHaveLength(1);
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    $(document, '.search-trigger').click();
    expect(showModal).toHaveBeenCalledTimes(1);
    $<HTMLDialogElement>(document, 'dialog').close();
    key({ key: '/' });
    expect(showModal).toHaveBeenCalledTimes(2);
  });

  it('undoes everything when torn down', () => {
    const undo = initSearch();
    undo();
    expect($$(document, 'dialog')).toHaveLength(0);
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    $(document, '.search-trigger').click();
    key({ key: '/' });
    expect(showModal).not.toHaveBeenCalled();
  });

  it('does nothing on a page without a search button', () => {
    document.body.innerHTML = '<p>no search</p>';
    teardown = initSearch();
    expect($$(document, 'dialog')).toHaveLength(0);
    key({ key: '/' });
    expect($$(document, 'dialog')).toHaveLength(0);
  });

  it('does nothing when the buttons name no index', () => {
    for (const trigger of $$(document, '.search-trigger')) {
      delete trigger.dataset.index;
    }
    teardown = initSearch();
    expect($(document, '.search-trigger').hidden).toBe(true);
  });

  it('hides the buttons where <dialog> cannot be shown modally', () => {
    vi.stubGlobal('HTMLDialogElement', class {});
    teardown = initSearch();
    expect($(document, '.search-trigger').hidden).toBe(true);
    expect($$(document, 'dialog')).toHaveLength(0);
  });

  it('reports a failure to start and hides the buttons', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(document.body, 'append').mockImplementation(() => {
      throw new Error('no body');
    });
    teardown = initSearch();
    expect(error).toHaveBeenCalledWith('search failed to start', expect.any(Error));
    expect($(document, '.search-trigger').hidden).toBe(true);
  });

  it('shows the search as unavailable when the index cannot be fetched, and recovers on Retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    teardown = initSearch();
    $(document, '.search-trigger').click();
    await vi.waitFor(() =>
      expect($(document, '[role="status"]').textContent).toBe('Search is unavailable'),
    );
    $(document, '.search-retry').click();
    await vi.waitFor(() => expect($(document, '[role="status"]').textContent).toBe(''));
    expect($$(document, '.search-chip').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
