import fs from 'node:fs';

/** The part of `fs.watch` used here. */
export type WatchFn = (
  target: string,
  options: { readonly recursive: boolean },
  listener: (event: string, filename: string | null) => void,
) => {
  close(): void;
  on(event: 'error', listener: (err: Error) => void): unknown;
};

/** A path to watch. */
export interface WatchTarget {
  readonly path: string;
  readonly recursive: boolean;
}

export interface WatchOptions {
  /** Directories whose changes trigger a rebuild. */
  readonly targets: readonly WatchTarget[];
  /** Runs one build; a rejection is reported to `onError`. */
  readonly rebuild: () => Promise<void>;
  /** Called after each successful rebuild. */
  readonly onBuilt: () => void;
  readonly onError: (err: unknown) => void;
  /** Quiet time after the last change before rebuilding. */
  readonly debounceMs?: number;
  readonly watch?: WatchFn;
}

export interface Watcher {
  /** Stop watching; a running rebuild finishes silently. */
  close(): void;
}

/**
 * Rebuild when anything below `targets` changes. Changes are coalesced by a debounce; rebuilds never
 * overlap, and changes arriving during one trigger a single follow-up.
 *
 * Watcher errors, such as a watched directory disappearing, go to `onError`.
 *
 * @throws if a path cannot be watched
 */
export function startWatch({
  targets,
  rebuild,
  onBuilt,
  onError,
  debounceMs = 150,
  watch = fs.watch,
}: WatchOptions): Watcher {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let queued = false;
  let closed = false;

  async function run(): Promise<void> {
    running = true;
    try {
      await rebuild();
      if (!closed) {
        onBuilt();
      }
    } catch (err) {
      fail(err);
    }
    running = false;
    if (queued && !closed) {
      queued = false;
      await run();
    }
  }

  function fire(): void {
    timer = undefined;
    if (running) {
      queued = true;
    } else {
      void run();
    }
  }

  const watchers: { close(): void }[] = [];
  const fail = (err: unknown) => {
    if (!closed) {
      onError(err);
    }
  };
  try {
    for (const { path: target, recursive } of targets) {
      const watcher = watch(target, { recursive }, () => {
        clearTimeout(timer);
        timer = setTimeout(fire, debounceMs);
      });
      watcher.on('error', fail);
      watchers.push(watcher);
    }
  } catch (err) {
    for (const w of watchers) {
      w.close();
    }
    throw err;
  }
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      for (const w of watchers) {
        w.close();
      }
    },
  };
}
