/** Collapsed disclosures of the page content; engines without `::details-content` hide their content on paper. */
const CLOSED_DETAILS = 'main details:not([open])';

/** Runs `step`, reporting a failure instead of throwing into the event loop. */
function run(step: () => void): void {
  try {
    step();
  } catch (err) {
    console.error('cannot switch print state', err);
  }
}

/**
 * Wires the print button (`.print-button`). Opens every collapsed disclosure
 * while printing and closes them afterwards. The `print` media query covers browsers that report printing only through
 * it; the two sources never open the page twice.
 *
 * @returns a function that removes the listeners and closes what a print in progress opened
 */
export function initPrint(): () => void {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let opened: readonly HTMLDetailsElement[] | undefined;
  const begin = (): void => {
    if (opened) {
      return;
    }
    opened = [...document.querySelectorAll<HTMLDetailsElement>(CLOSED_DETAILS)];
    for (const details of opened) {
      details.open = true;
    }
  };
  const end = (): void => {
    for (const details of opened ?? []) {
      details.open = false;
    }
    opened = undefined;
  };
  document.querySelector('.print-button')?.addEventListener('click', () => print(), { signal });
  addEventListener('beforeprint', () => run(begin), { signal });
  addEventListener('afterprint', () => run(end), { signal });
  matchMedia('print').addEventListener('change', ({ matches }) => run(matches ? begin : end), {
    signal,
  });
  return () => {
    lifetime.abort();
    run(end);
  };
}
