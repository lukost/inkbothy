import { RAIL_QUERY } from '../shared/ui-state.ts';
import { isAbove, onResized, topbarHeight } from './viewport.ts';

/** Entries of the table of contents in the rail; inline on narrower screens, where nothing is tracked. */
const RAIL_LINKS = '.article-single > .toc a[href^="#"]';

/** Share of the viewport, below the top bar, in which a heading counts as the one being read. */
const READING_ZONE = 0.3;

interface Section {
  readonly link: HTMLAnchorElement;
  readonly heading: Element;
}

type Position = 'above' | 'inside' | 'below';

function sections(): readonly Section[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(RAIL_LINKS)].flatMap((link) => {
    const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    return heading ? [{ link, heading }] : [];
  });
}

function mark(current: Section | undefined, all: readonly Section[]): void {
  for (const { link } of all) {
    if (current?.link === link) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

function positionOf(entry: IntersectionObserverEntry): Position {
  if (entry.isIntersecting) {
    return 'inside';
  }
  return isAbove(entry) ? 'above' : 'below';
}

/** Keeps the active entry in view when the rail scrolls; without animation if the reader asks. */
function reveal({ link }: Section): void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  link.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}

/**
 * Observes the headings: the first one inside the reading zone is current, else the last one
 * passed. While the page footer is in view the last entry is current, since the final headings
 * may never reach the zone.
 */
function track(all: readonly Section[]): () => void {
  const positions = new Map<Element, Position>();
  let atBottom = false;
  let shown: Section | undefined;
  const update = (): void => {
    const at = (wanted: Position) => all.filter(({ heading }) => positions.get(heading) === wanted);
    const current = atBottom ? all.at(-1) : (at('inside')[0] ?? at('above').at(-1));
    if (current !== shown) {
      shown = current;
      mark(current, all);
      if (current) {
        reveal(current);
      }
    }
  };
  const headings = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        positions.set(entry.target, positionOf(entry));
      }
      update();
    },
    { rootMargin: `-${topbarHeight()}px 0px -${Math.round((1 - READING_ZONE) * 100)}% 0px` },
  );
  for (const { heading } of all) {
    headings.observe(heading);
  }
  const footer = document.querySelector('.site-footer');
  let bottom: IntersectionObserver | undefined;
  if (footer) {
    bottom = new IntersectionObserver((entries) => {
      atBottom = entries.at(-1)?.isIntersecting ?? false;
      update();
    });
    bottom.observe(footer);
  }
  return () => {
    headings.disconnect();
    bottom?.disconnect();
    mark(undefined, all);
  };
}

/**
 * Marks the table-of-contents entry of the section being read with `aria-current="location"`,
 * while the rail is displayed. The observers are rebuilt after a resize, which can change the
 * top bar's height.
 *
 * @returns a function that undoes the wiring
 */
export function initScrollSpy(): () => void {
  const all = sections();
  if (all.length === 0 || typeof IntersectionObserver === 'undefined') {
    return () => undefined;
  }
  const lifetime = new AbortController();
  const rail = matchMedia(RAIL_QUERY);
  let stop = (): void => undefined;
  const sync = (): void => {
    stop();
    stop = rail.matches ? track(all) : () => undefined;
  };
  rail.addEventListener('change', sync, { signal: lifetime.signal });
  onResized(sync, lifetime.signal);
  sync();
  return () => {
    lifetime.abort();
    stop();
  };
}
