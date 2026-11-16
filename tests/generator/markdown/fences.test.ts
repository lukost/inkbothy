import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { fenceMeta } from '../../../src/generator/markdown/fences.ts';
import { createMarkdown } from '../../../src/generator/markdown/markdown.ts';
import { thrown } from '../../helpers.ts';

const fences = (source: string) =>
  createMarkdown()
    .parse(source, {})
    .filter((t) => t.type === 'fence');

describe('fence info', () => {
  it('is parsed once per fence into the token, with the language resolved', () => {
    const [sh, cpp, pcap, none] = fences(
      '```SH {1}\na\n```\n\n```C++ title="x"\nb\n```\n\n```pcap\nc\n```\n\n```\nd\n```',
    );
    expect(sh && fenceMeta(sh)).toMatchObject({ lang: 'sh', language: 'shellscript' });
    expect(sh && fenceMeta(sh).info.highlight).toEqual(new Set([1]));
    expect(cpp && fenceMeta(cpp)).toMatchObject({ lang: 'c++', language: 'cpp' });
    expect(cpp && fenceMeta(cpp).info.title).toBe('x');
    expect(pcap && fenceMeta(pcap)).toMatchObject({ lang: 'pcap', language: undefined });
    expect(none && fenceMeta(none)).toMatchObject({ lang: '', language: undefined });
  });

  it('keeps the language as written for messages, lower-cased for markup', () => {
    const [token] = fences('```PCAP\nx\n```');
    expect(token && fenceMeta(token).info.lang).toBe('PCAP');
    expect(token && fenceMeta(token).lang).toBe('pcap');
  });

  it('covers fences nested in lists and quotes', () => {
    const tokens = fences('- item\n\n  ```c\n  a\n  ```\n\n> ```py\n> b\n> ```');
    expect(tokens.map((t) => fenceMeta(t).language)).toEqual(['c', 'python']);
  });

  it('is not set on indented code, which is no fence', () => {
    const tokens = createMarkdown().parse('    indented', {});
    expect(tokens.some((t) => t.type === 'fence')).toBe(false);
  });

  it('is reported when a fence was parsed without the plugin', () => {
    const [token] = new MarkdownIt().parse('```c\nx\n```', {});
    expect(token && thrown(() => fenceMeta(token)).message).toMatch(/fences plugin is missing/);
  });
});
