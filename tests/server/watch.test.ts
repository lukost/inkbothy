import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWatch, type WatchFn } from '../../src/server/watch.ts';
import { fakeWatch } from './fake-watch.ts';

interface Deferred {
  resolve(): void;
  reject(err: Error): void;
}

/** A rebuild whose completion the test controls. */
function controlledRebuild() {
  const pending: Deferred[] = [];
  const rebuild = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { rebuild, pending };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('startWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (overrides: Partial<Parameters<typeof startWatch>[0]> = {}) => {
    const fake = fakeWatch();
    const { rebuild, pending } = controlledRebuild();
    const onBuilt = vi.fn();
    const onError = vi.fn();
    const watcher = startWatch({
      targets: [
        { path: 'site', recursive: true },
        { path: 'src', recursive: true },
        { path: 'data', recursive: false },
      ],
      rebuild,
      onBuilt,
      onError,
      watch: fake.watch,
      ...overrides,
    });
    return { ...fake, rebuild, pending, onBuilt, onError, watcher };
  };

  it('watches every target with its own recursion', () => {
    const { watchers } = setup();
    expect(watchers.map((w) => [w.target, w.recursive])).toEqual([
      ['site', true],
      ['src', true],
      ['data', false],
    ]);
  });

  it('counts any change of any target, whatever the file name', async () => {
    const s = setup();
    for (const [i, name] of [null, 'site.yaml', '.hidden'].entries()) {
      s.change(i, name);
      await vi.advanceTimersByTimeAsync(150);
      expect(s.rebuild).toHaveBeenCalledTimes(i + 1);
      s.pending.shift()?.resolve();
      await flush();
    }
  });

  it('routes watcher errors to onError without rebuilding, until closed', async () => {
    const s = setup();
    const err = new Error('EPERM: watch');
    s.fail(1, err);
    expect(s.onError).toHaveBeenCalledWith(err);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.rebuild).not.toHaveBeenCalled();
    s.watcher.close();
    s.fail(0, new Error('late'));
    expect(s.onError).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of changes into one rebuild after the debounce', async () => {
    const s = setup({ debounceMs: 150 });
    s.change(0);
    await vi.advanceTimersByTimeAsync(100);
    s.change(1);
    await vi.advanceTimersByTimeAsync(100);
    s.change(2, 'x.md');
    await vi.advanceTimersByTimeAsync(149);
    expect(s.rebuild).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.rebuild).toHaveBeenCalledTimes(1);
  });

  it('defaults the debounce to 150 ms', async () => {
    const s = setup();
    s.change();
    await vi.advanceTimersByTimeAsync(149);
    expect(s.rebuild).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.rebuild).toHaveBeenCalledTimes(1);
  });

  it('reports success only after the rebuild resolves', async () => {
    const s = setup();
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    expect(s.onBuilt).not.toHaveBeenCalled();
    s.pending[0]?.resolve();
    await flush();
    expect(s.onBuilt).toHaveBeenCalledTimes(1);
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('reports a failed rebuild without a success, and keeps watching', async () => {
    const s = setup();
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    const failure = new Error('syntax error');
    s.pending[0]?.reject(failure);
    await flush();
    expect(s.onError).toHaveBeenCalledWith(failure);
    expect(s.onBuilt).not.toHaveBeenCalled();
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    expect(s.rebuild).toHaveBeenCalledTimes(2);
    s.pending[1]?.resolve();
    await flush();
    expect(s.onBuilt).toHaveBeenCalledTimes(1);
  });

  it('never overlaps rebuilds and runs at most one follow-up for changes during a build', async () => {
    const s = setup();
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    expect(s.rebuild).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      s.change();
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(s.rebuild).toHaveBeenCalledTimes(1);
    s.pending[0]?.resolve();
    await flush();
    expect(s.rebuild).toHaveBeenCalledTimes(2);
    expect(s.onBuilt).toHaveBeenCalledTimes(1);
    s.pending[1]?.resolve();
    await flush();
    expect(s.rebuild).toHaveBeenCalledTimes(2);
    expect(s.onBuilt).toHaveBeenCalledTimes(2);
  });

  it('runs the follow-up after a failed build too', async () => {
    const s = setup();
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    s.pending[0]?.reject(new Error('x'));
    await flush();
    expect(s.rebuild).toHaveBeenCalledTimes(2);
    expect(s.onError).toHaveBeenCalledTimes(1);
  });

  it('does not rebuild without changes', async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.rebuild).not.toHaveBeenCalled();
  });

  it('close() closes every watcher and cancels a pending rebuild', async () => {
    const s = setup();
    s.change();
    s.watcher.close();
    expect(s.watchers.every((w) => w.closed)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.rebuild).not.toHaveBeenCalled();
  });

  it('close() during a rebuild suppresses its result and the queued follow-up', async () => {
    const s = setup();
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    s.watcher.close();
    s.pending[0]?.resolve();
    await flush();
    expect(s.onBuilt).not.toHaveBeenCalled();
    expect(s.rebuild).toHaveBeenCalledTimes(1);
  });

  it('close() during a failing rebuild reports nothing', async () => {
    const s = setup();
    s.change();
    await vi.advanceTimersByTimeAsync(150);
    s.watcher.close();
    s.pending[0]?.reject(new Error('late'));
    await flush();
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('closes the watchers already opened when a later path cannot be watched', () => {
    const opened: { closed: boolean }[] = [];
    const watch: WatchFn = (target) => {
      if (target === 'missing') {
        throw new Error('ENOENT: missing');
      }
      const w = { closed: false };
      opened.push(w);
      return {
        close() {
          w.closed = true;
        },
        on() {},
      };
    };
    expect(() =>
      startWatch({
        targets: ['a', 'b', 'missing'].map((path) => ({ path, recursive: true })),
        rebuild: async () => {},
        onBuilt: () => {},
        onError: () => {},
        watch,
      }),
    ).toThrow('ENOENT');
    expect(opened.map((w) => w.closed)).toEqual([true, true]);
  });
});
