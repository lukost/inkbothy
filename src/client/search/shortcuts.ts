/** Elements that take typed text whatever their type. */
const EDITABLE = 'textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Input types that take no typed text. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** True when `/` typed at the event's real target, even inside a shadow root, is text input. */
function isEditing(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)) {
    return true;
  }
  return target.closest(EDITABLE) !== null;
}

/** `/` outside editable elements, or Ctrl/⌘+K anywhere; never a held key. */
function wantsSearch(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) {
    return false;
  }
  if (event.key === '/') {
    return !event.ctrlKey && !event.metaKey && !isEditing(event);
  }
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k';
}

/** Calls `open` on the search shortcuts and suppresses their default action; the listener is removed when `signal` aborts. */
export function registerShortcuts(open: () => void, signal: AbortSignal): void {
  document.addEventListener(
    'keydown',
    (event) => {
      if (wantsSearch(event)) {
        event.preventDefault();
        open();
      }
    },
    { signal },
  );
}
