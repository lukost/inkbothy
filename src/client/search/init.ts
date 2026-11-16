import { createSearchDialog } from './dialog.ts';
import { loadIndex } from './loader.ts';
import { registerShortcuts } from './shortcuts.ts';

function wire(triggers: readonly HTMLElement[], url: string): () => void {
  const lifetime = new AbortController();
  const dialog = createSearchDialog(() => loadIndex(url));
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => dialog.open(), { signal: lifetime.signal });
  }
  registerShortcuts(() => dialog.open(), lifetime.signal);
  return () => {
    lifetime.abort();
    dialog.dispose();
  };
}

/** Search is unavailable here, so its buttons are hidden. */
function hide(triggers: readonly HTMLElement[]): () => void {
  for (const trigger of triggers) {
    trigger.hidden = true;
  }
  return () => undefined;
}

let teardown: (() => void) | undefined;

/**
 * Wires the search buttons and shortcuts to a search dialog that loads its
 * index on first use. Repeated calls replace the wiring; without `<dialog>`
 * support, or on failure, the buttons are hidden.
 *
 * @returns a function that undoes the wiring
 */
export function initSearch(): () => void {
  teardown?.();
  teardown = undefined;
  const triggers = [...document.querySelectorAll<HTMLElement>('.search-trigger')];
  const url = triggers.map((t) => t.dataset.index).find((u) => u !== undefined);
  if (url === undefined || typeof HTMLDialogElement.prototype.showModal !== 'function') {
    return hide(triggers);
  }
  try {
    teardown = wire(triggers, url);
  } catch (err) {
    console.error('search failed to start', err);
    return hide(triggers);
  }
  return teardown;
}
