// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAbove, onResized, topbarHeight } from '../../src/client/viewport.ts';
import { $, parseHtml, renderPage } from '../helpers.ts';
import { entry } from './observer.ts';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('isAbove', () => {
  const target = document.createElement('div');

  it('is true when the target’s top edge is above the observed area', () => {
    expect(isAbove(entry(target, false, 10))).toBe(true);
    expect(isAbove(entry(target, false, -400))).toBe(true);
  });

  it('is false at the area’s top edge and below it', () => {
    expect(isAbove(entry(target, false, 44))).toBe(false);
    expect(isAbove(entry(target, false, 900))).toBe(false);
  });

  it('measures against the viewport top when there are no root bounds', () => {
    expect(isAbove({ ...entry(target, false, -1), rootBounds: null })).toBe(true);
    expect(isAbove({ ...entry(target, false, 0), rootBounds: null })).toBe(false);
  });
});

describe('topbarHeight', () => {
  it('is the bar’s height in whole pixels', () => {
    document.body.innerHTML = parseHtml(renderPage()).body.innerHTML;
    const bar = $(document, '.topbar');
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 44.6));
    expect(topbarHeight()).toBe(45);
  });

  it('is 0 without a bar', () => {
    expect(topbarHeight()).toBe(0);
  });
});

describe('onResized', () => {
  let lifetime: AbortController;
  beforeEach(() => {
    vi.useFakeTimers();
    lifetime = new AbortController();
  });
  afterEach(() => {
    lifetime.abort();
  });

  it('waits until resizing has stopped, then calls once', () => {
    const callback = vi.fn();
    onResized(callback, lifetime.signal);
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(100);
    }
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('calls again for a later resize', () => {
    const callback = vi.fn();
    onResized(callback, lifetime.signal);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a resize', () => {
    const callback = vi.fn();
    onResized(callback, lifetime.signal);
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('cancels a pending call and stops listening once aborted', () => {
    const callback = vi.fn();
    onResized(callback, lifetime.signal);
    window.dispatchEvent(new Event('resize'));
    lifetime.abort();
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
  });
});
