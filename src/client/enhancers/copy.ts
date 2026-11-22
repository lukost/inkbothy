import { createStatus } from '../announce.ts';
import type { Enhancer } from '../enhance.ts';
import { isEnhanced, markEnhanced } from './enhanced.ts';

const NAME = 'copy';
const LABEL = 'Copy';
const RESET_MS = 2000;

/** Accessible name: "Copy code", plus the block's title or language. */
function buttonName(figure: Element): string {
  const what =
    figure.querySelector('.code-title')?.textContent ?? figure.getAttribute('data-lang') ?? '';
  return what ? `Copy code: ${what}` : 'Copy code';
}

/**
 * Adds a copy button and its status message to the caption of `figure` (to the figure itself when it
 * has none). A click writes the text of the figure's `pre` to `clipboard` and shows `Copied` or
 * `Copy failed` on both for `RESET_MS`.
 */
function addButton(figure: Element, clipboard: Clipboard): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code no-print';
  button.textContent = LABEL;
  button.setAttribute('aria-label', buttonName(figure));
  const status = createStatus();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flash = (text: string): void => {
    button.textContent = text;
    status.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.textContent = LABEL;
      status.textContent = '';
    }, RESET_MS);
  };
  button.addEventListener('click', async () => {
    const pre = figure.querySelector('pre');
    if (!pre) {
      return;
    }
    try {
      await clipboard.writeText(pre.textContent);
      flash('Copied');
    } catch {
      flash('Copy failed');
    }
  });
  (figure.querySelector(':scope > figcaption') ?? figure).append(button, status);
}

/** A copy button on every code block, when the Clipboard API exists. */
export const copy: Enhancer = {
  name: NAME,
  run(root) {
    const { clipboard } = navigator;
    if (!clipboard) {
      return;
    }
    for (const figure of root.querySelectorAll('figure.code-block')) {
      if (figure.querySelector('pre') && !isEnhanced(figure, NAME)) {
        addButton(figure, clipboard);
        markEnhanced(figure, NAME);
      }
    }
  },
};
