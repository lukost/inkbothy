import { describe, expect, it } from 'vitest';
import { SEARCH_OPTIONS } from '../../src/shared/search-config.ts';

describe('SEARCH_OPTIONS.stringifyField', () => {
  const stringify = SEARCH_OPTIONS.stringifyField;

  it('indexes a string as it is and joins a list with spaces', () => {
    expect(stringify('hello world')).toBe('hello world');
    expect(stringify(['kernel', 'real time'])).toBe('kernel real time');
  });

  it.each([undefined, null, 42, true, { a: 1 }])('indexes %j as nothing', (value) => {
    expect(stringify(value)).toBe('');
  });
});
