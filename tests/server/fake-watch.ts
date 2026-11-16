import type { WatchFn } from '../../src/server/watch.ts';

export interface FakeWatcher {
  readonly target: string;
  readonly recursive: boolean;
  readonly listener: (event: string, filename: string | null) => void;
  readonly onError: ((err: Error) => void)[];
  closed: boolean;
}

/** `fs.watch` stand-in: records watchers and lets a test fire change and error events. */
export function fakeWatch() {
  const watchers: FakeWatcher[] = [];
  const watch: WatchFn = (target, options, listener) => {
    const w: FakeWatcher = {
      target,
      recursive: options.recursive,
      listener,
      onError: [],
      closed: false,
    };
    watchers.push(w);
    return {
      close() {
        w.closed = true;
      },
      on(_event, handler) {
        w.onError.push(handler);
      },
    };
  };
  return {
    watch,
    watchers,
    change: (i = 0, filename: string | null = 'x.md') => watchers[i]?.listener('change', filename),
    fail: (i: number, err: Error) => {
      for (const handler of watchers[i]?.onError ?? []) {
        handler(err);
      }
    },
  };
}
