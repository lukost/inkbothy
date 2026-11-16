/** Runs `init`; a failure is logged and leaves the inits after it to run. */
export function guarded(name: string, init: () => unknown): void {
  try {
    init();
  } catch (err) {
    console.error(`${name} failed to start`, err);
  }
}
