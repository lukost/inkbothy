// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentTextSize, initTextSize, setTextSize } from '../../src/client/text-size.ts';
import { STORAGE_KEYS, TEXT_SIZES } from '../../src/shared/ui-state.ts';
import { $, $$, parseHtml, renderPage } from '../helpers.ts';

const root = () => document.documentElement;
const stored = () => localStorage.getItem(STORAGE_KEYS.textSize);
const smaller = () => $(document, '.text-smaller');
const larger = () => $(document, '.text-larger');
const said = () => $(document, '[role="status"]').textContent;
const disabled = () => [smaller(), larger()].map((b) => b.getAttribute('aria-disabled'));

let teardown: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = parseHtml(renderPage()).body.innerHTML;
});
afterEach(() => {
  teardown();
  teardown = () => undefined;
  delete root().dataset.textSize;
  vi.unstubAllGlobals();
});

const start = () => {
  teardown = initTextSize();
};

describe('currentTextSize and setTextSize', () => {
  it('start at the default', () => {
    expect(currentTextSize()).toBe('100');
  });

  it.each(TEXT_SIZES)('round-trip %s%%', (size) => {
    setTextSize(size);
    expect(currentTextSize()).toBe(size);
  });

  it('treat an unknown attribute value as the default', () => {
    root().dataset.textSize = '101';
    expect(currentTextSize()).toBe('100');
  });

  it('store a size that differs from the default, under the shared key', () => {
    setTextSize('125');
    expect([root().dataset.textSize, stored()]).toEqual(['125', '125']);
  });

  it('forget the override on the default size, attribute and storage alike', () => {
    setTextSize('75');
    setTextSize('100');
    expect([root().dataset.textSize, stored()]).toEqual([undefined, null]);
  });

  it('still apply the size when storage throws', () => {
    vi.stubGlobal('localStorage', {
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('denied');
      },
    });
    expect(() => setTextSize('112')).not.toThrow();
    expect(root().dataset.textSize).toBe('112');
    expect(() => setTextSize('100')).not.toThrow();
    expect(root().dataset.textSize).toBeUndefined();
  });
});

describe('buttons', () => {
  it('start enabled at the default size, and are never really disabled', () => {
    start();
    expect(disabled()).toEqual(['false', 'false']);
    expect([smaller().hasAttribute('disabled'), larger().hasAttribute('disabled')]).toEqual([
      false,
      false,
    ]);
  });

  it('step upwards, announcing each size', () => {
    start();
    const seen: (string | null)[] = [];
    for (let i = 0; i < 2; i++) {
      larger().click();
      seen.push(root().dataset.textSize ?? null, said());
    }
    expect(seen).toEqual(['112', 'Text size 112%', '125', 'Text size 125%']);
  });

  it('step downwards, announcing each size', () => {
    start();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      smaller().click();
      seen.push(said() ?? '');
    }
    expect(seen).toEqual(['Text size 90%', 'Text size 82%', 'Text size 75%']);
  });

  it('announce the default size in the same form when returning to it', () => {
    start();
    larger().click();
    smaller().click();
    expect(said()).toBe('Text size 100%');
    expect(root().dataset.textSize).toBeUndefined();
    expect(stored()).toBeNull();
  });

  it('remember each step', () => {
    start();
    smaller().click();
    expect(stored()).toBe('90');
    smaller().click();
    expect(stored()).toBe('82');
  });

  it('disable the larger button at the top, keep focus on it, and change nothing when clicked', () => {
    start();
    larger().click();
    larger().click();
    expect(disabled()).toEqual(['false', 'true']);
    larger().focus();
    larger().click();
    expect(document.activeElement).toBe(larger());
    expect([root().dataset.textSize, stored(), said()]).toEqual(['125', '125', 'Text size 125%']);
  });

  it('disable the smaller button at the bottom, keep focus on it, and change nothing when clicked', () => {
    start();
    for (let i = 0; i < 3; i++) {
      smaller().click();
    }
    expect(disabled()).toEqual(['true', 'false']);
    smaller().focus();
    smaller().click();
    expect(document.activeElement).toBe(smaller());
    expect([root().dataset.textSize, stored(), said()]).toEqual(['75', '75', 'Text size 75%']);
  });

  it('re-enable a button once the size leaves its bound', () => {
    start();
    larger().click();
    larger().click();
    smaller().click();
    expect(disabled()).toEqual(['false', 'false']);
  });

  it('visit every size exactly once going up from the bottom', () => {
    setTextSize('75');
    start();
    const sizes = [currentTextSize()];
    while (larger().getAttribute('aria-disabled') === 'false') {
      larger().click();
      sizes.push(currentTextSize());
    }
    expect(sizes).toEqual([...TEXT_SIZES]);
  });

  it.each([
    ['75', ['true', 'false']],
    ['125', ['false', 'true']],
    ['100', ['false', 'false']],
  ])('show the size the head script restored (%s%%) in the bounds', (size, expected) => {
    root().dataset.textSize = size;
    start();
    expect(disabled()).toEqual(expected);
  });

  it('start from the default when the restored value is garbage', () => {
    root().dataset.textSize = 'huge';
    start();
    larger().click();
    expect(root().dataset.textSize).toBe('112');
  });

  it('change by one step per click, with one handler per button', () => {
    start();
    smaller().click();
    expect(root().dataset.textSize).toBe('90');
  });

  it('still change the size for this page when storage throws', () => {
    vi.stubGlobal('localStorage', {
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    });
    start();
    expect(() => larger().click()).not.toThrow();
    expect(root().dataset.textSize).toBe('112');
  });
});

describe('live region', () => {
  it('is one visually hidden status, silent until the first change', () => {
    start();
    const regions = $$(document, '[role="status"]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.className).toBe('visually-hidden');
    expect(regions[0]?.textContent).toBe('');
  });
});

describe('teardown and missing buttons', () => {
  it('removes the status and the handlers', () => {
    start();
    teardown();
    expect($$(document, '[role="status"]')).toHaveLength(0);
    larger().click();
    expect(root().dataset.textSize).toBeUndefined();
  });

  it('works on a page without the buttons', () => {
    document.body.innerHTML = '';
    expect(() => start()).not.toThrow();
  });

  it('works with only one of the buttons', () => {
    larger().remove();
    start();
    smaller().click();
    expect(root().dataset.textSize).toBe('90');
  });
});
