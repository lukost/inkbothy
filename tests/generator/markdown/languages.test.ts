import { describe, expect, it } from 'vitest';
import {
  isKnownFenceLanguage,
  LANGUAGES,
  resolveLanguage,
} from '../../../src/generator/markdown/languages.ts';

describe('resolveLanguage', () => {
  it.each(LANGUAGES)('keeps the curated name %s', (name) => {
    expect(resolveLanguage(name)).toBe(name);
  });

  it.each([
    ['sh', 'shellscript'],
    ['Bash', 'shellscript'],
    ['shell', 'shellscript'],
    ['console', 'shellsession'],
    ['C++', 'cpp'],
    ['TS', 'typescript'],
    ['yml', 'yaml'],
    ['mathematica', 'wolfram'],
  ])('maps alias %s to %s', (alias, name) => {
    expect(resolveLanguage(alias)).toBe(name);
  });

  it.each(['devicetree', 'pcap', 'mermaid', 'text', '', 'constructor', '__proto__', 'toString'])(
    'has no grammar for %j',
    (tag) => {
      expect(resolveLanguage(tag)).toBeUndefined();
    },
  );

  it('only maps aliases to curated languages', () => {
    for (const alias of ['sh', 'c++', 'ts', 'js', 'py', 'rs', 'h', 'hpp', 'zsh', 'docker']) {
      const target = resolveLanguage(alias);
      expect(
        LANGUAGES.some((l) => l === target),
        alias,
      ).toBe(true);
    }
  });
});

describe('isKnownFenceLanguage', () => {
  it.each(['c', 'sh', 'mermaid', 'Text', 'plaintext', 'txt'])('accepts %s', (tag) => {
    expect(isKnownFenceLanguage(tag)).toBe(true);
  });

  it.each(['devicetree', 'pcap', 'klingon', 'constructor'])('rejects %s', (tag) => {
    expect(isKnownFenceLanguage(tag)).toBe(false);
  });
});
