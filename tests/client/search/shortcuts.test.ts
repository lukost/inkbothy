// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerShortcuts } from '../../../src/client/search/shortcuts.ts';
import { $ } from '../../helpers.ts';

let lifetime = new AbortController();
const open = vi.fn();

beforeEach(() => {
  lifetime = new AbortController();
  open.mockClear();
  document.body.innerHTML =
    '<p id="p">text</p><input id="in"><textarea id="ta"></textarea><select id="sel"><option>a</option></select>' +
    '<div id="ce" contenteditable="true"><span id="inner">x</span></div>' +
    '<div id="no-ce" contenteditable="false"><span id="no-inner">x</span></div>';
  registerShortcuts(open, lifetime.signal);
});
afterEach(() => lifetime.abort());

/** Dispatches a keydown at `target` and reports whether the page prevented its default. */
function press(init: KeyboardEventInit, target: EventTarget = document.body): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('/', () => {
  it('opens the search and suppresses the character', () => {
    expect(press({ key: '/' })).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens from non-editable elements, including a contenteditable="false" one', () => {
    press({ key: '/' }, $(document, '#p'));
    press({ key: '/' }, $(document, '#no-inner'));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it.each(['#in', '#ta', '#sel', '#ce', '#inner'])('is typed text in %s', (selector) => {
    expect(press({ key: '/' }, $(document, selector))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens with Shift, which some layouts need to type it', () => {
    press({ key: '/', shiftKey: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])(
    'does nothing with %o',
    (modifier) => {
      expect(press({ key: '/', ...modifier })).toBe(false);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('does nothing while composing text or after another handler took the key', () => {
    press({ key: '/', isComposing: true });
    const claimed = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    document.addEventListener('keydown', (e) => e.preventDefault(), { once: true, capture: true });
    document.body.dispatchEvent(claimed);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('/ and the kind of element', () => {
  const field = (attributes: string): HTMLElement => {
    document.body.insertAdjacentHTML('beforeend', `<input id="f" ${attributes}>`);
    return $(document, '#f');
  };

  it.each(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'])(
    'opens from an input of type %s, which takes no text',
    (type) => {
      expect(press({ key: '/' }, field(`type="${type}"`))).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date'])(
    'is typed text in an input of type %s',
    (type) => {
      expect(press({ key: '/' }, field(`type="${type}"`))).toBe(false);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('opens from a button', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="b">b</button>');
    expect(press({ key: '/' }, $(document, '#b'))).toBe(true);
  });

  it('is typed text in an editable inside a shadow root, though the page sees its host', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="host"></div>');
    const host = $(document, '#host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input id="inside"><button id="plain">b</button>';
    const dispatchRetargeted = (inner: Element): boolean => {
      const event = new KeyboardEvent('keydown', {
        key: '/',
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      // Browsers report the host as the target of events that cross a shadow boundary.
      Object.defineProperty(event, 'target', { get: () => host });
      inner.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(dispatchRetargeted(shadow.querySelector('#inside') ?? host)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(dispatchRetargeted(shadow.querySelector('#plain') ?? host)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('events not aimed at an element', () => {
  it('opens for a key pressed on the document itself', () => {
    expect(press({ key: '/' }, document)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('key repeat', () => {
  it.each([
    ['/', { key: '/' }],
    ['Ctrl+K', { key: 'k', ctrlKey: true }],
    ['⌘+K', { key: 'k', metaKey: true }],
  ])('ignores a held %s', (_name, init) => {
    expect(press({ ...init, repeat: true })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    press(init);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('Ctrl+K and ⌘+K', () => {
  it.each([
    ['Ctrl+K', { ctrlKey: true, key: 'k' }],
    ['⌘+K', { metaKey: true, key: 'k' }],
    ['Ctrl+K with caps lock', { ctrlKey: true, key: 'K' }],
  ])('%s opens the search and suppresses the browser’s own', (_name, init) => {
    expect(press(init)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('works while typing in a field', () => {
    expect(press({ ctrlKey: true, key: 'k' }, $(document, '#in'))).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['k alone', { key: 'k' }],
    ['Ctrl+Shift+K', { ctrlKey: true, shiftKey: true, key: 'K' }],
    ['Ctrl+Alt+K', { ctrlKey: true, altKey: true, key: 'k' }],
    ['Ctrl+J', { ctrlKey: true, key: 'j' }],
    ['Ctrl+/', { ctrlKey: true, key: '/' }],
    ['⌘+/', { metaKey: true, key: '/' }],
  ])('ignores %s', (_name, init) => {
    expect(press(init)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('registration', () => {
  it('calls open once per key press', () => {
    press({ key: '/' });
    press({ key: '/' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('stops when its signal aborts', () => {
    lifetime.abort();
    expect(press({ key: '/' })).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
