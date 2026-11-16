import { describe, expect, it } from 'vitest';
import { analyzeMarkdown } from './analyze.ts';

const warnings = (src: string) => analyzeMarkdown(src).warnings;

describe('analyzeMarkdown decorations and alerts', () => {
  it.each([
    ['text', '```text {1}\nx\n```'],
    ['an unknown language', '```pcap showLineNumbers\nx\n```'],
    ['no language', '```{2}\nx\n```'],
    ['mermaid', '```mermaid showLineNumbers=3\ng\n```'],
  ])('warns that line numbers and highlighting are ignored for %s', (_name, src) => {
    expect(warnings(src).some((w) => w.endsWith('need a highlighted language; ignored'))).toBe(
      true,
    );
  });

  it('does not warn about decorations on a highlighted language, aliases included', () => {
    expect(warnings('```c {1} showLineNumbers\nx\n```\n\n```sh {1}\nx\n```')).toEqual([]);
  });

  it('does not add that warning without decorations', () => {
    expect(warnings('```text\nx\n```')).toEqual([]);
  });

  it('warns about an unknown alert marker alone on its line', () => {
    expect(warnings('> [!FOO]\n> body')).toEqual([
      'unknown alert type "[!FOO]"; rendered as a blockquote',
    ]);
    expect(warnings('> [!foo]')).toHaveLength(1);
  });

  it.each([
    ['known types', '> [!NOTE]\n> x\n\n> [!warning]\n> y'],
    ['a marker followed by text', '> [!FOO] more\n> x'],
    ['a marker that is not first', '> intro\n> [!FOO]'],
    ['a plain blockquote', '> just text'],
  ])('does not warn about %s', (_name, src) => {
    expect(warnings(src)).toEqual([]);
  });
});
