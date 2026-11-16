import { ownValue } from '../../shared/guards.ts';
import { PAGE_BADGE, type SearchSections } from '../../shared/search-config.ts';
import type { Term } from '../../types.ts';
import { highlight } from './highlight.ts';
import type { LoadedIndex } from './loader.ts';
import { type Filters, type Hit, search } from './query.ts';

/** Pause after the last keystroke before searching. */
const DEBOUNCE_MS = 80;

/** Pause after the last result before its count is announced. */
const STATUS_MS = 400;

const RESULTS_ID = 'search-results';
const optionId = (n: number): string => `search-option-${n}`;

export interface SearchDialog {
  /** Show the dialog, focusing its input. */
  open(): void;
  /** Remove the dialog and its listeners. */
  dispose(): void;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

function resultCount(count: number): string {
  if (count === 0) {
    return 'No results';
  }
  return count === 1 ? '1 result' : `${count} results`;
}

/** Display name of the hit's section; pages have none. */
function badgeOf({ section }: Hit, sections: SearchSections): string {
  return section === null ? PAGE_BADGE : (ownValue(sections, section) ?? section);
}

/** `a`, `a and b`, `a, b and c`. */
function enumerate(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function optionOf(hit: Hit, n: number, sections: SearchSections): HTMLLIElement {
  const option = make('li', 'search-result');
  option.id = optionId(n);
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', 'false');
  const link = make('a', 'search-result-link');
  link.href = hit.url;
  link.tabIndex = -1;
  const title = make('span', 'search-result-title');
  title.append(highlight(hit.title, hit.terms));
  const meta = make('span', 'search-result-meta');
  const badge = make('span', 'search-badge');
  badge.append(make('span', 'visually-hidden', 'Section: '), badgeOf(hit, sections));
  meta.append(badge);
  if (hit.published) {
    const time = make('time', 'search-result-date', hit.published);
    time.dateTime = hit.published;
    meta.append(time);
  }
  link.append(title, meta);
  if (hit.summary) {
    const summary = make('span', 'search-result-summary');
    summary.append(highlight(hit.summary, hit.terms));
    link.append(summary);
  }
  option.append(link);
  return option;
}

/** Adds a closed modal search dialog to `<body>`; `load` supplies the index on first use. The query and filters persist across openings. */
export function createSearchDialog(load: () => Promise<LoadedIndex>): SearchDialog {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const filters = { categories: new Set<string>(), tags: new Set<string>() } satisfies Filters;
  let loaded: LoadedIndex | undefined;
  let hits: readonly Hit[] = [];
  let active = -1;
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let pressedOutside = false;
  let opener: HTMLElement | null = null;

  const dialog = make('dialog', 'search-dialog');
  dialog.setAttribute('aria-label', 'Search');
  const panel = make('div', 'search-panel');
  const head = make('div', 'search-head');
  const input = make('input', 'search-input');
  input.type = 'text';
  input.placeholder = 'Search…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'go';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Search');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', RESULTS_ID);
  input.setAttribute('aria-expanded', 'false');
  const close = make('button', 'search-close', 'Close');
  close.type = 'button';
  head.append(input, close);
  const facetsEl = make('div', 'search-facets');
  const statusLine = make('div', 'search-status-line');
  const status = make('p', 'search-status');
  status.setAttribute('role', 'status');
  const retry = make('button', 'search-retry', 'Retry');
  retry.type = 'button';
  retry.hidden = true;
  statusLine.append(status, retry);
  const list = make('ul', 'search-results');
  list.id = RESULTS_ID;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');
  panel.append(head, facetsEl, statusLine, list);
  dialog.append(panel);
  document.body.append(dialog);

  const setStatus = (message: string, canRetry = false): void => {
    clearTimeout(statusTimer);
    status.textContent = message;
    retry.hidden = !canRetry;
  };

  /** Sets the status once results stop changing, and only if the text differs. */
  const announce = (message: string): void => {
    clearTimeout(statusTimer);
    if (message !== status.textContent) {
      statusTimer = setTimeout(() => setStatus(message), STATUS_MS);
    }
  };

  const cancelPending = (): void => {
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(statusTimer);
    latest++;
  };

  const setActive = (n: number): void => {
    active = n;
    for (const [i, option] of [...list.children].entries()) {
      option.setAttribute('aria-selected', String(i === n));
    }
    const option = list.children[n];
    if (option) {
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const show = (found: readonly Hit[], sections: SearchSections): void => {
    hits = found;
    list.replaceChildren(...found.map((hit, n) => optionOf(hit, n, sections)));
    input.setAttribute('aria-expanded', String(found.length > 0));
    setActive(-1);
    const idle = input.value.trim() === '' && filters.categories.size + filters.tags.size === 0;
    retry.hidden = true;
    if (idle) {
      setStatus('');
    } else {
      announce(resultCount(found.length));
    }
  };

  const chip = (set: Set<string>, term: Term): HTMLButtonElement => {
    const button = make('button', 'search-chip', term.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(set.has(term.label)));
    button.addEventListener(
      'click',
      () => {
        if (!set.delete(term.label)) {
          set.add(term.label);
        }
        button.setAttribute('aria-pressed', String(set.has(term.label)));
        void refresh();
      },
      { signal },
    );
    return button;
  };

  const group = (
    id: string,
    name: string,
    set: Set<string>,
    terms: readonly Term[],
  ): HTMLElement | null => {
    if (terms.length === 0) {
      return null;
    }
    const wrapper = make('div', 'search-facet');
    wrapper.setAttribute('role', 'group');
    const label = make('span', 'search-facet-label', name);
    label.id = id;
    wrapper.setAttribute('aria-labelledby', id);
    wrapper.append(label, ...terms.map((t) => chip(set, t)));
    return wrapper;
  };

  async function refresh(): Promise<void> {
    const mine = ++latest;
    if (!loaded) {
      setStatus('Loading…');
      try {
        loaded = await load();
      } catch {
        if (mine === latest) {
          setStatus('Search is unavailable', true);
        }
        return;
      }
      const names = enumerate(Object.values(loaded.sections).map((l) => l.toLowerCase()));
      input.placeholder = `Search${names && ` ${names}`}…`;
      facetsEl.replaceChildren(
        ...[
          group(
            'search-facet-categories',
            'Categories',
            filters.categories,
            loaded.facets.categories,
          ),
          group('search-facet-tags', 'Tags', filters.tags, loaded.facets.tags),
        ].flatMap((g) => g ?? []),
      );
    }
    if (mine === latest) {
      show(search(loaded, input.value, filters), loaded.sections);
    }
  }

  const step = (delta: number): boolean => {
    if (hits.length === 0) {
      return false;
    }
    const first = delta > 0 ? 0 : hits.length - 1;
    setActive(active < 0 ? first : (active + delta + hits.length) % hits.length);
    return true;
  };

  /** Clicks `link` as the user did, keeping the modifiers that open it in a new tab or window. */
  const activate = (
    link: HTMLAnchorElement,
    { ctrlKey, metaKey, shiftKey }: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ): void => {
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey, metaKey, shiftKey }),
    );
  };

  /** Opens the active result, or the first one when none is active, for the text as typed. */
  const choose = (modifiers: KeyboardEvent): boolean => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      void refresh();
    }
    const link = list.children[Math.max(active, 0)]?.querySelector('a');
    if (!link) {
      return false;
    }
    activate(link, modifiers);
    return true;
  };

  const handleKey = (event: KeyboardEvent): boolean => {
    switch (event.key) {
      case 'ArrowDown':
        return step(1);
      case 'ArrowUp':
        return step(-1);
      case 'Enter':
        return choose(event);
      default:
        return false;
    }
  };

  input.addEventListener(
    'keydown',
    (event) => {
      if (!event.isComposing && handleKey(event)) {
        event.preventDefault();
      }
    },
    { signal },
  );
  input.addEventListener(
    'input',
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, DEBOUNCE_MS);
    },
    { signal },
  );
  retry.addEventListener('click', () => void refresh(), { signal });
  close.addEventListener('click', () => dialog.close(), { signal });
  /** A press or click on the backdrop: on the dialog itself and outside its box, border included. */
  const onBackdrop = (event: MouseEvent): boolean => {
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= left &&
      event.clientX <= right &&
      event.clientY >= top &&
      event.clientY <= bottom;
    return event.target === dialog && !inside;
  };
  dialog.addEventListener('pointerdown', (event) => (pressedOutside = onBackdrop(event)), {
    signal,
  });
  dialog.addEventListener(
    'click',
    (event) => {
      const closing = pressedOutside && onBackdrop(event);
      pressedOutside = false;
      if (closing) {
        dialog.close();
      }
    },
    { signal },
  );
  list.addEventListener(
    'click',
    (event) => {
      // Assistive technology clicks the option, not the link inside it.
      if (event.target instanceof Element && !event.target.closest('a')) {
        const link = event.target.closest('li[role="option"]')?.querySelector('a');
        if (link) {
          activate(link, event);
        }
      }
    },
    { signal },
  );
  window.addEventListener('pagehide', () => dialog.close(), { signal });
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        // The dialog's own cancel closes it; the drawer's Escape handler must not also fire.
        event.stopPropagation();
      }
    },
    { signal },
  );
  dialog.addEventListener(
    'close',
    () => {
      cancelPending();
      opener?.focus();
      opener = null;
    },
    { signal },
  );

  return {
    open() {
      if (!dialog.open) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
        void refresh();
      }
      input.focus();
      input.select();
    },
    dispose() {
      lifetime.abort();
      cancelPending();
      dialog.remove();
    },
  };
}
