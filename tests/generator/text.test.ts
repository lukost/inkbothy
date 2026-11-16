import { describe, expect, it } from 'vitest';
import { analyzeMarkdown, markdownToText } from './analyze.ts';

describe('markdownToText', () => {
  it('keeps prose and inline code, drops emphasis markers', () => {
    expect(markdownToText('# Title\n\nSome **bold** and `ioctl()` text.')).toBe(
      'Title Some bold and ioctl() text.',
    );
  });

  it('does not split words around inline markup', () => {
    expect(markdownToText('foo**bar**baz')).toBe('foobarbaz');
  });

  it('drops fenced code, Mermaid and indented code', () => {
    const src = [
      'before',
      '',
      '```c',
      'int secret_code;',
      '```',
      '',
      '```mermaid',
      'graph TD; SECRETMERMAID-->B',
      '```',
      '',
      '    indented_secret();',
      '',
      'after',
    ].join('\n');
    expect(markdownToText(src)).toBe('before after');
  });

  it('drops raw HTML blocks and inline HTML', () => {
    expect(markdownToText('<div>hidden block</div>\n\ntext <span>x</span>')).toBe('text x');
  });

  it('keeps image alt text and link text, not URLs', () => {
    expect(markdownToText('![Board photo](img.png) see [docs](https://e.com)')).toBe(
      'Board photo see docs',
    );
  });

  it('handles nested lists, tables, quotes and line breaks', () => {
    const src = '- a\n  - b\n\n> quote\nnext\n\n| h1 | h2 |\n|----|----|\n| c1 | c2 |\n';
    expect(markdownToText(src)).toBe('a b quote next h1 h2 c1 c2');
  });

  it('returns empty for empty or code-only input', () => {
    expect(markdownToText('')).toBe('');
    expect(markdownToText('```\nx\n```')).toBe('');
  });
});

describe('analyzeMarkdown', () => {
  const warnings = (src: string) => analyzeMarkdown(src).warnings;

  it('warns about languages that are not highlighted', () => {
    expect(warnings('```pcap\nx\n```\n\n```devicetree\n&a {};\n```')).toEqual([
      'code block language "pcap" is not highlighted',
      'code block language "devicetree" is not highlighted',
    ]);
  });

  it('warns for each such block, also inside lists and quotes', () => {
    expect(warnings('- ```foo\n  x\n  ```\n\n> ```bar\n> y\n> ```')).toHaveLength(2);
  });

  it.each([
    'c',
    'C',
    'cpp',
    'c++',
    'sh',
    'bash',
    'console',
    'mathematica',
    'yml',
    'mermaid',
    'text',
  ])('does not warn about known language %s', (lang) => {
    expect(warnings(`\`\`\`${lang}\nx\n\`\`\``)).toEqual([]);
  });

  it('does not warn about fences without a language, but flags decorations on them', () => {
    expect(warnings('```\nx\n```')).toEqual([]);
    expect(warnings('```{1}\nx\n```')).toEqual([
      'code block "{1}": line numbers and highlighting need a highlighted language; ignored',
    ]);
    expect(warnings('~~~\nx\n~~~')).toEqual([]);
  });

  it('does not warn about indented code or inline code', () => {
    expect(warnings('    indented\n\n`pcap`')).toEqual([]);
  });

  it('warns about malformed fence info', () => {
    expect(warnings('```c {5-3} bogus=1\nx\n```')).toEqual([
      'code block "c {5-3} bogus=1": invalid line range "5-3"',
      'code block "c {5-3} bogus=1": unknown option "bogus"',
    ]);
  });

  it('reports an unknown language and a malformed option of one block separately', () => {
    expect(warnings('```pcap title="x\nx\n```')).toEqual([
      'code block language "pcap" is not highlighted',
      'code block "pcap title="x": unterminated quote in "title"',
    ]);
  });
});

describe('markdownToText dialect', () => {
  it('indexes footnote text but not reference markers', () => {
    expect(markdownToText('Claim[^1].\n\n[^1]: Footnoted evidence.')).toBe(
      'Claim. Footnoted evidence.',
    );
  });

  it('drops task markers but keeps the item text', () => {
    expect(markdownToText('- [ ] write tests\n- [x] ship')).toBe('write tests ship');
  });

  it('keeps strikethrough text', () => {
    expect(markdownToText('~~old~~ new')).toBe('old new');
  });
});
