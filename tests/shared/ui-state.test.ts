import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXT_SIZE,
  isTextSize,
  isTheme,
  RAIL_QUERY,
  STORAGE_KEYS,
  TEXT_SIZES,
  WIDE_QUERY,
} from '../../src/shared/ui-state.ts';

describe('isTextSize', () => {
  it.each(TEXT_SIZES)('accepts the step %s', (size) => {
    expect(isTextSize(size)).toBe(true);
  });

  it.each([
    '',
    '80',
    '100%',
    ' 100',
    '100 ',
    '0',
    '075',
    '1e2',
    '112.0',
    'NaN',
    'large',
    null,
    undefined,
    100,
    112,
    [],
    {},
  ])('rejects %j', (value) => {
    expect(isTextSize(value)).toBe(false);
  });

  it('has a default among the steps, strictly between the smallest and the largest', () => {
    const index = TEXT_SIZES.indexOf(DEFAULT_TEXT_SIZE);
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(TEXT_SIZES.length - 1);
  });

  it('lists the steps in increasing order, without repeats', () => {
    const numbers = TEXT_SIZES.map(Number);
    expect(numbers).toEqual([...new Set(numbers)].sort((a, b) => a - b));
  });
});

describe('isTheme', () => {
  it('accepts exactly light and dark', () => {
    expect(['light', 'dark', 'Light', '', 'system', null].map(isTheme)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('storage keys', () => {
  it('are distinct', () => {
    const values = Object.values(STORAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('breakpoints', () => {
  const em = (query: string) => Number(/min-width: ([\d.]+)em/.exec(query)?.[1]);

  it('put the rail well above the sidebar, both in em', () => {
    expect(RAIL_QUERY).toMatch(/^\(min-width: [\d.]+em\)$/);
    expect(WIDE_QUERY).toMatch(/^\(min-width: [\d.]+em\)$/);
    expect(em(RAIL_QUERY)).toBeGreaterThan(em(WIDE_QUERY));
  });
});
