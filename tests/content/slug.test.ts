import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/content/slug.ts';

describe('slugify', () => {
  it.each([
    ['Linux', 'linux'],
    ['Embedded Systems', 'embedded-systems'],
    ['  padded  ', 'padded'],
    ['a -- b__c', 'a-b-c'],
    ['Łódź', 'lodz'],
    ['Zażółć gęślą jaźń', 'zazolc-gesla-jazn'],
    ['Straße', 'strasse'],
    ['Øresund Æther Œuvre', 'oresund-aether-oeuvre'],
    ['Crème brûlée', 'creme-brulee'],
    ['C++', 'cpp'],
    ['C#', 'csharp'],
    ['C', 'c'],
    ['Modern C++20', 'modern-cpp20'],
    ['abc++', 'abc'],
    ['abc#', 'abc'],
    ['i.MX8', 'i-mx8'],
    ['RTOS/Zephyr', 'rtos-zephyr'],
    ['2026', '2026'],
  ])('%j -> %j', (label, expected) => {
    expect(slugify(label)).toBe(expected);
  });

  it('keeps C, C++ and C# distinct', () => {
    const slugs = ['C', 'C++', 'C#'].map(slugify);
    expect(new Set(slugs).size).toBe(3);
  });

  it.each(['', '!!!', '---', '日本語'])('returns empty for %j', (label) => {
    expect(slugify(label)).toBe('');
  });

  it('is idempotent', () => {
    for (const label of ['Łódź Kernel C++', 'a--b', 'x']) {
      expect(slugify(slugify(label))).toBe(slugify(label));
    }
  });
});
