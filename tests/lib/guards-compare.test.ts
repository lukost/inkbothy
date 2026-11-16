import { describe, expect, it } from 'vitest';
import { compareLabels, compareStrings } from '../../src/lib/compare.ts';
import { isErrnoException } from '../../src/lib/node-guards.ts';
import {
  errorMessage,
  isRecord,
  isStringArray,
  ownValue,
  required,
} from '../../src/shared/guards.ts';
import { thrown } from '../helpers.ts';

describe('isRecord', () => {
  it.each([[{}], [{ a: 1 }], [Object.create(null)]])('accepts %j', (v) => {
    expect(isRecord(v)).toBe(true);
  });

  it.each([[null], [undefined], [[]], [[1]], ['x'], [1], [true]])('rejects %j', (v) => {
    expect(isRecord(v)).toBe(false);
  });
});

describe('isStringArray', () => {
  it.each([[[]], [['a', 'b']]])('accepts %j', (v) => {
    expect(isStringArray(v)).toBe(true);
  });

  it.each([[null], ['a'], [['a', 1]], [[null]], [{ 0: 'a' }]])('rejects %j', (v) => {
    expect(isStringArray(v)).toBe(false);
  });
});

describe('isErrnoException', () => {
  it('accepts real fs errors', async () => {
    const err = await import('node:fs/promises').then((fs) =>
      fs.readFile('/nonexistent').catch((e: unknown) => e),
    );
    expect(isErrnoException(err)).toBe(true);
  });

  it.each([
    ['plain Error', new Error('x')],
    ['library error with only a code', Object.assign(new Error('x'), { code: 'BAD_INDENT' })],
    ['non-string code', Object.assign(new Error('x'), { code: 1, syscall: 'open' })],
    ['error-like object', { code: 'ENOENT', syscall: 'open' }],
    ['string', 'ENOENT'],
    ['null', null],
  ])('rejects %s', (_desc, v) => {
    expect(isErrnoException(v)).toBe(false);
  });
});

describe('errorMessage', () => {
  it.each([
    [new Error('boom'), 'boom'],
    [new TypeError('typed'), 'typed'],
    ['plain', 'plain'],
    [42, '42'],
    [null, 'null'],
  ])('%j -> %s', (err, expected) => {
    expect(errorMessage(err)).toBe(expected);
  });
});

describe('compareStrings', () => {
  it('orders by code unit, independent of locale', () => {
    expect(['b', 'B', 'a', 'A', '_x', '10', '9'].sort(compareStrings)).toEqual([
      '10',
      '9',
      'A',
      'B',
      '_x',
      'a',
      'b',
    ]);
  });

  it('orders ISO dates chronologically', () => {
    expect(['2026-01-10', '2025-12-31', '2026-01-09'].sort(compareStrings)).toEqual([
      '2025-12-31',
      '2026-01-09',
      '2026-01-10',
    ]);
  });

  it('returns 0 only for equal strings', () => {
    expect(compareStrings('a', 'a')).toBe(0);
    expect(compareStrings('a', 'A')).not.toBe(0);
  });
});

describe('compareLabels', () => {
  it('ignores case and accents', () => {
    expect(compareLabels('linux', 'Linux')).toBe(0);
    expect(compareLabels('Lodz', 'Łódź')).toBe(0);
    expect(['zeta', 'Alpha', 'beta'].sort(compareLabels)).toEqual(['Alpha', 'beta', 'zeta']);
  });
});

describe('required', () => {
  it('returns present values, falsy ones included', () => {
    expect(required('x', 'thing')).toBe('x');
    expect(required(0, 'thing')).toBe(0);
    expect(required('', 'thing')).toBe('');
    expect(required(false, 'thing')).toBe(false);
  });

  it('names what is missing', () => {
    expect(thrown(() => required(undefined, 'rendered a.md')).message).toBe(
      'missing rendered a.md',
    );
    expect(thrown(() => required(null, 'match')).message).toBe('missing match');
  });
});

describe('ownValue', () => {
  const record = { a: 1, falsy: 0, constructor: 3 };

  it('returns own values, falsy ones included', () => {
    expect(ownValue(record, 'a')).toBe(1);
    expect(ownValue(record, 'falsy')).toBe(0);
    expect(ownValue(record, 'constructor')).toBe(3);
  });

  it.each(['missing', 'toString', 'hasOwnProperty', '__proto__', ''])(
    'ignores %j, which the record does not own',
    (key) => {
      expect(ownValue(record, key)).toBeUndefined();
    },
  );
});
