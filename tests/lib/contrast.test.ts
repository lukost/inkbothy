import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, relativeLuminance } from '../../src/lib/contrast.ts';
import { thrown } from '../helpers.ts';

describe('parseHex', () => {
  it('reads #rrggbb and #rgb, in any case', () => {
    expect(parseHex('#ff8000')).toEqual([255, 128, 0]);
    expect(parseHex('#F80')).toEqual([255, 136, 0]);
  });

  it.each(['', 'fff', '#ff', '#ffff', '#fffffff', '#ggg', '#12345678', 'red'])(
    'rejects %j',
    (value) => {
      expect(thrown(() => parseHex(value))).toBeInstanceOf(RangeError);
    },
  );
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for equal colours', () => {
    expect(contrastRatio('#000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#8a3f12', '#faf7f1')).toBe(contrastRatio('#faf7f1', '#8a3f12'));
  });

  it('matches known WCAG values around the 4.5 threshold', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('uses the linear segment for very dark channels', () => {
    expect(relativeLuminance('#010101')).toBeCloseTo(1 / 255 / 12.92, 6);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });
});
