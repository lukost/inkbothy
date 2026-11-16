import type { ItemNoun } from '../types.ts';
import { createStatus } from './announce.ts';
import { ENHANCERS, runEnhancers } from './enhance.ts';

const LISTS = 'ol.stream-rest[data-batch]';
const PENDING = ':scope > li[data-fragment]';
/** Posts that failed to load are not retried automatically. */
const UNTRIED = `${PENDING}:not([data-failed])`;
const FAILED = 'data-failed';
const NOTE = 'stream-note';

/** How a load began: the reader asked for it, or the end of the list came near. */
type Trigger = 'button' | 'scroll';

/** A post known by its header only. */
interface Slot {
  readonly item: HTMLElement;
  /** Root-relative URL of the post's content and footer. */
  readonly fragment: string;
}

/** The noun in the number that goes with `n`. */
const form = (n: number, { singular, plural }: ItemNoun): string => (n === 1 ? singular : plural);

function slots(list: Element, selector: string, limit: number): Slot[] {
  return [...list.querySelectorAll<HTMLElement>(selector)]
    .flatMap((item) => {
      const { fragment } = item.dataset;
      return fragment ? [{ item, fragment }] : [];
    })
    .slice(0, limit);
}

/** A fragment that takes longer than this counts as failed. */
const FETCH_TIMEOUT_MS = 15_000;
const LABEL_BUSY = 'Loading…';

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const limit = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
  const response = await fetch(url, { signal: limit });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/** Parsed in an inert `<template>`: nothing runs or loads before the nodes join the page. */
function parse(markup: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}

/** The header becomes the top of a full article. */
function expand({ item }: Slot, content: DocumentFragment): HTMLElement {
  const article = document.createElement('article');
  article.className = 'article';
  article.append(...item.childNodes, content);
  item.append(article);
  item.removeAttribute('data-fragment');
  item.removeAttribute(FAILED);
  return article;
}

/** The slot keeps its header and says where the post can be read. */
function markFailed({ item, fragment }: Slot, noun: ItemNoun): void {
  item.setAttribute(FAILED, '');
  const link = document.createElement('a');
  link.href = fragment.slice(0, fragment.lastIndexOf('/') + 1);
  link.textContent = `open the ${noun.singular}`;
  const note = document.createElement('p');
  note.className = NOTE;
  note.append('Couldn’t load — ', link);
  item.append(note);
}

const clearNote = ({ item }: Slot): void => item.querySelector(`:scope > .${NOTE}`)?.remove();

/** What the live region says; `focused` means focus already announced the new posts. */
function announcement(loaded: number, failed: number, focused: boolean, noun: ItemNoun): string {
  const parts = [
    loaded > 0 && !focused ? `${loaded} more ${form(loaded, noun)} loaded` : '',
    failed > 0 ? `${failed} ${form(failed, noun)} could not be loaded` : '',
  ];
  return parts.filter(Boolean).join(', ');
}

/** Gives the heading focus until it loses it. */
function focusHeading(heading: HTMLElement): void {
  heading.tabIndex = -1;
  heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
  heading.focus();
}

/** `idle`: ready for a load; `loading`: a batch is on its way; `done`: nothing left to load, or torn down. */
type State = 'idle' | 'loading' | 'done';

function wire(list: HTMLElement, batch: number, noun: ItemNoun): () => void {
  const label = `Load more ${noun.plural}`;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const status = createStatus();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'stream-load';
  button.textContent = label;
  const controls = document.createElement('div');
  controls.className = 'stream-more no-print';
  controls.append(button);
  list.after(status, controls);
  let observer: IntersectionObserver | undefined;
  let state: State = 'idle';
  /** A press arrived while a batch was loading: focus moves when it arrives. */
  let pressed = false;
  let frame: number | undefined;

  /** Clearing first makes a repeated message count as a change. */
  const announce = (message: string): void => {
    status.textContent = '';
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
    if (message) {
      frame = requestAnimationFrame(() => {
        status.textContent = message;
      });
    }
  };

  const busy = (on: boolean): void => {
    for (const [element, name] of [
      [list, 'aria-busy'],
      [button, 'aria-disabled'],
    ] as const) {
      if (on) {
        element.setAttribute(name, 'true');
      } else {
        element.removeAttribute(name);
      }
    }
    button.textContent = on ? LABEL_BUSY : label;
  };

  /** Fetches the next `batch` posts at once and inserts them in order. */
  async function step(trigger: Trigger): Promise<readonly HTMLElement[]> {
    const next = slots(list, trigger === 'button' ? PENDING : UNTRIED, batch);
    for (const slot of next) {
      clearNote(slot);
    }
    const fetched = await Promise.all(
      next.map(async (slot) => ({
        slot,
        text: await fetchText(slot.fragment, signal).catch(() => null),
      })),
    );
    if (signal.aborted) {
      return [];
    }
    const articles: HTMLElement[] = [];
    let failed = 0;
    for (const { slot, text } of fetched) {
      if (text === null) {
        markFailed(slot, noun);
        failed++;
      } else {
        articles.push(expand(slot, parse(text)));
      }
    }
    const heading = articles[0]?.querySelector<HTMLElement>('h2');
    const focused = (trigger === 'button' || pressed) && heading != null;
    if (focused) {
      focusHeading(heading);
    }
    announce(announcement(articles.length, failed, focused, noun));
    return articles;
  }

  async function load(trigger: Trigger): Promise<void> {
    if (state === 'loading') {
      pressed ||= trigger === 'button';
      return;
    }
    if (state === 'done' || (trigger === 'scroll' && !list.querySelector(UNTRIED))) {
      return;
    }
    state = 'loading';
    pressed = false;
    busy(true);
    try {
      const articles = await step(trigger);
      await Promise.all(articles.map((article) => runEnhancers(article, ENHANCERS)));
    } finally {
      busy(false);
      state = signal.aborted || !list.querySelector(PENDING) ? 'done' : 'idle';
    }
    if (state === 'done') {
      observer?.disconnect();
      controls.remove();
    } else if (list.querySelector(UNTRIED)) {
      // Re-observing reports whether the end of the list is still in view.
      observer?.unobserve(controls);
      observer?.observe(controls);
    }
  }

  const start = (trigger: Trigger): void => {
    load(trigger).catch((err: unknown) => console.error('cannot load more posts', err));
  };
  button.addEventListener('click', () => start('button'), { signal });
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((o) => o.isIntersecting)) {
          start('scroll');
        }
      },
      { rootMargin: '0px 0px 100% 0px' },
    );
    observer.observe(controls);
  }
  return () => {
    lifetime.abort();
    state = 'done';
    observer?.disconnect();
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
    }
    status.remove();
    controls.remove();
    list.removeAttribute('aria-busy');
  };
}

let teardown: (() => void) | undefined;

/**
 * Wires the "Load more" button and end-of-list scrolling to stream
 * listings. Each step fetches the next batch in parallel and expands the
 * headers into full articles. Repeated calls replace the wiring.
 *
 * @returns a function that undoes the wiring (loaded posts stay)
 */
export function initStream(): () => void {
  teardown?.();
  teardown = undefined;
  const undo: (() => void)[] = [];
  for (const list of document.querySelectorAll<HTMLElement>(LISTS)) {
    const batch = Number(list.dataset.batch);
    if (!Number.isInteger(batch) || batch < 1) {
      continue;
    }
    const { noun: singular, nounPlural: plural } = list.dataset;
    if (!singular || !plural) {
      continue;
    }
    try {
      undo.push(wire(list, batch, { singular, plural }));
    } catch (err) {
      console.error('post stream failed to start', err);
    }
  }
  teardown = () => {
    for (const fn of undo) {
      fn();
    }
  };
  return teardown;
}
