import { describe, expect, it } from 'vitest';
import { splitFrontMatter } from '../../src/content/frontmatter.ts';
import { thrown } from '../helpers.ts';

describe('splitFrontMatter', () => {
  it('splits front-matter and body', () => {
    const { data, body } = splitFrontMatter('---\ntitle: Hello\n---\n# Body\n');
    expect(data).toEqual({ title: 'Hello' });
    expect(body).toBe('# Body\n');
  });

  it('keeps dates as strings (YAML 1.2 core schema)', () => {
    const { data } = splitFrontMatter(
      '---\npublished: 2026-11-13\nupdates:\n  - { date: 2026-11-20, note: x }\n---\n',
    );
    expect(data).toEqual({
      published: '2026-11-13',
      updates: [{ date: '2026-11-20', note: 'x' }],
    });
  });

  it('strips a BOM and normalises CRLF and lone CR', () => {
    const { data, body } = splitFrontMatter('\uFEFF---\r\ntitle: T\r\n---\r\na\rb\r\n');
    expect(data).toEqual({ title: 'T' });
    expect(body).toBe('a\nb\n');
  });

  it('accepts trailing whitespace on fences', () => {
    expect(splitFrontMatter('--- \ntitle: T\n---\t\nx').data).toEqual({ title: 'T' });
  });

  it('returns empty data when there is no front-matter', () => {
    expect(splitFrontMatter('# Just markdown\n')).toEqual({ data: {}, body: '# Just markdown\n' });
    expect(splitFrontMatter('')).toEqual({ data: {}, body: '' });
  });

  it('does not treat a fence that is not on the first line as front-matter', () => {
    const text = '\n---\ntitle: T\n---\n';
    expect(splitFrontMatter(text)).toEqual({ data: {}, body: text });
  });

  it('treats a later --- (thematic break) as body text', () => {
    const { body } = splitFrontMatter('---\ntitle: T\n---\nabove\n---\nbelow\n');
    expect(body).toBe('above\n---\nbelow\n');
  });

  it('does not accept ---- or ---x as fences', () => {
    expect(splitFrontMatter('----\ntitle: T\n----\n').data).toEqual({});
    expect(() => splitFrontMatter('---\ntitle: T\n---x\n')).toThrow(/unterminated/);
  });

  it('returns empty data for an empty or comment-only block', () => {
    expect(splitFrontMatter('---\n---\nbody').data).toEqual({});
    expect(splitFrontMatter('---\n# only a comment\n---\nbody').data).toEqual({});
  });

  it('throws on an unterminated block, naming the file', () => {
    expect(() => splitFrontMatter('---\ntitle: T\nbody', 'blog/x/index.md')).toThrow(
      /^blog\/x\/index\.md: unterminated/,
    );
  });

  it('throws on invalid YAML and keeps the cause', () => {
    const err = thrown(() => splitFrontMatter('---\ntitle: [unclosed\n---\n', 'f.md'));
    expect(err.message).toMatch(/^f\.md: invalid YAML/);
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('throws on duplicate keys', () => {
    expect(() => splitFrontMatter('---\ntitle: a\ntitle: b\n---\n')).toThrow(/invalid YAML/);
  });

  it.each([
    ['a list', '- a\n- b'],
    ['a scalar', 'just text'],
  ])('throws when front-matter is %s', (_desc, yaml) => {
    expect(() => splitFrontMatter(`---\n${yaml}\n---\n`)).toThrow(/mapping/);
  });
});
