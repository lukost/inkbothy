import {
  DEFAULT_TEXT_SIZE,
  isTextSize,
  STORAGE_KEYS,
  TEXT_SIZES,
  type TextSize,
} from '../shared/ui-state.ts';
import { createStatus } from './announce.ts';
import { remember } from './storage.ts';

/** The size on screen: the head script's override, else the default. */
export function currentTextSize(): TextSize {
  const { textSize } = document.documentElement.dataset;
  return isTextSize(textSize) ? textSize : DEFAULT_TEXT_SIZE;
}

/** Show `size`, and remember it unless it is the default. */
export function setTextSize(size: TextSize): void {
  const { dataset } = document.documentElement;
  if (size === DEFAULT_TEXT_SIZE) {
    delete dataset.textSize;
    remember(STORAGE_KEYS.textSize, null);
  } else {
    dataset.textSize = size;
    remember(STORAGE_KEYS.textSize, size);
  }
}

/** The step `direction` away from the current one, or undefined at the bound. */
function neighbour(direction: -1 | 1): TextSize | undefined {
  return TEXT_SIZES[TEXT_SIZES.indexOf(currentTextSize()) + direction];
}

/**
 * Wires the smaller and larger buttons (`.text-smaller`, `.text-larger`). At a bound the button
 * is `aria-disabled` rather than `disabled`, so it keeps focus. Each change is announced.
 *
 * @returns a function that undoes the wiring
 */
export function initTextSize(): () => void {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const steps = [
    { button: document.querySelector('.text-smaller'), direction: -1 },
    { button: document.querySelector('.text-larger'), direction: 1 },
  ] as const;
  const status = createStatus();
  document.body.append(status);
  const sync = (): void => {
    for (const { button, direction } of steps) {
      button?.setAttribute('aria-disabled', String(neighbour(direction) === undefined));
    }
  };
  for (const { button, direction } of steps) {
    button?.addEventListener(
      'click',
      () => {
        const size = neighbour(direction);
        if (size) {
          setTextSize(size);
          sync();
          status.textContent = `Text size ${size}%`;
        }
      },
      { signal },
    );
  }
  sync();
  return () => {
    lifetime.abort();
    status.remove();
  };
}
