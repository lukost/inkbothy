import { isAbove, onResized, topbarHeight } from './viewport.ts';

/** Class of the top bar's title while the page heading is out of view. */
export const TITLE_SHOWN = 'topbar-title-shown';

/**
 * Shows the article title in the top bar once the page `h1` has scrolled up past it. The observer
 * is rebuilt after a resize, which can change the bar's height.
 *
 * @returns a function that stops watching and hides the title
 */
export function initTopbarTitle(): () => void {
  const title = document.querySelector('.topbar .topbar-title');
  const heading = document.querySelector('main h1');
  if (!title || !heading || typeof IntersectionObserver === 'undefined') {
    return () => undefined;
  }
  const lifetime = new AbortController();
  let observer: IntersectionObserver | undefined;
  const watch = (): void => {
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) {
          title.classList.toggle(TITLE_SHOWN, !entry.isIntersecting && isAbove(entry));
        }
      },
      { rootMargin: `-${topbarHeight()}px 0px 0px 0px` },
    );
    observer.observe(heading);
  };
  watch();
  onResized(watch, lifetime.signal);
  return () => {
    lifetime.abort();
    observer?.disconnect();
    title.classList.remove(TITLE_SHOWN);
  };
}
