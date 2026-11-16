import { vi } from 'vitest';

/** A controllable IntersectionObserver: tests deliver the entries themselves. */
export class FakeObserver implements IntersectionObserver {
  static instances: FakeObserver[] = [];

  readonly root = null;
  readonly thresholds = [0];
  readonly scrollMargin = '0px';
  readonly observed = new Set<Element>();
  disconnected = false;
  readonly #callback: IntersectionObserverCallback;
  readonly #options: IntersectionObserverInit;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.#callback = callback;
    this.#options = options;
    FakeObserver.instances.push(this);
  }

  get rootMargin(): string {
    return this.#options.rootMargin ?? '0px';
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Delivers `entries` to the observer's callback. */
  deliver(...entries: IntersectionObserverEntry[]): void {
    this.#callback(entries, this);
  }

  /** Installs the fake as the global IntersectionObserver and forgets earlier instances. */
  static install(): void {
    FakeObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  }

  /** The only observer created since `install`. */
  static only(): FakeObserver {
    const [first, ...rest] = FakeObserver.instances;
    if (!first || rest.length > 0) {
      throw new Error(`expected exactly one observer, found ${FakeObserver.instances.length}`);
    }
    return first;
  }
}

/** Top edge of the observed root in `entry`: the area below the top bar. */
const ROOT_TOP = 44;

/** An entry for `target`; `top` is the target's top edge in the viewport. */
export function entry(
  target: Element,
  isIntersecting: boolean,
  top: number,
): IntersectionObserverEntry {
  const box = new DOMRect(0, top, 600, 30);
  return {
    target,
    isIntersecting,
    time: 0,
    intersectionRatio: isIntersecting ? 1 : 0,
    boundingClientRect: box,
    intersectionRect: isIntersecting ? box : new DOMRect(),
    rootBounds: new DOMRect(0, ROOT_TOP, 1000, 800),
  };
}
