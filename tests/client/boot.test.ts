import { afterEach, describe, expect, it, vi } from 'vitest';
import { guarded } from '../../src/client/boot.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guarded', () => {
  it('runs the init', () => {
    const init = vi.fn();
    guarded('x', init);
    expect(init).toHaveBeenCalledOnce();
  });

  it('logs a throwing init with its name, and does not rethrow', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('boom');
    expect(() =>
      guarded('search', () => {
        throw failure;
      }),
    ).not.toThrow();
    expect(error).toHaveBeenCalledExactlyOnceWith('search failed to start', failure);
  });

  it('lets the next init run after a failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const next = vi.fn();
    guarded('a', () => {
      throw new Error('x');
    });
    guarded('b', next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('stays silent when the init succeeds', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    guarded('ok', () => 42);
    expect(error).not.toHaveBeenCalled();
  });
});
