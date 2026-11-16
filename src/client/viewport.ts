/** How long the window must stay unresized before observers are rebuilt. */
const RESIZE_DELAY_MS = 150;

/** True when the observed element has left the observed area upwards. */
export function isAbove({ boundingClientRect, rootBounds }: IntersectionObserverEntry): boolean {
  return boundingClientRect.top < (rootBounds?.top ?? 0);
}

/** Height of the sticky top bar in whole pixels; 0 without one. */
export function topbarHeight(): number {
  return Math.round(document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0);
}

/** Calls `callback` once the window has stopped resizing; stops when `signal` aborts. */
export function onResized(callback: () => void, signal: AbortSignal): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  addEventListener(
    'resize',
    () => {
      clearTimeout(timer);
      timer = setTimeout(callback, RESIZE_DELAY_MS);
    },
    { signal },
  );
  signal.addEventListener('abort', () => clearTimeout(timer));
}
