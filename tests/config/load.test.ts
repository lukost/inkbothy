import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/load.ts';
import { SITE_SAMPLE } from '../../src/lib/paths.ts';
import { trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();

const VALID = `title: Site
baseUrl: https://example.com
copyright: { holder: Holder, rights: Rights }
sections:
  blog:
    label: Blog
    layout: stream
    noun: [post, posts]
    taxonomies: [categories, tags]
    stream: { initial: 2, batch: 2 }
    menu: taxonomy
menu: [blog]
home:
  - { latest: blog, count: 5 }
`;

/** Writes `text` as site.yaml in a fresh directory and loads it. */
async function load(text: string): Promise<unknown> {
  const dir = await tree({ 'site.yaml': text });
  return loadConfig(path.join(dir, 'site.yaml'));
}

/** The message of the ConfigError that loading `text` raises. */
async function failure(text: string): Promise<string> {
  const err = await load(text).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConfigError);
  return err instanceof Error ? err.message : '';
}

describe('loadConfig', () => {
  it('loads a valid file with numbers typed', async () => {
    expect(await load(VALID)).toMatchObject({
      title: 'Site',
      sections: { blog: { layout: 'stream', stream: { initial: 2, batch: 2 } } },
      home: [{ kind: 'latest', section: 'blog', count: 5 }],
    });
  });

  it('loads the commented sample configuration, which declares the blog and projects sections', async () => {
    const config = await loadConfig(path.join(SITE_SAMPLE, 'site.yaml.sample'));
    expect(Object.keys(config.sections)).toEqual(['blog', 'projects']);
    expect(config.menu).toEqual(['about', 'resume', 'blog', 'projects']);
    expect(config.home.map((b) => b.kind)).toEqual(['latest', 'featured']);
  });

  it('names a missing file', async () => {
    const dir = await tree();
    await expect(loadConfig(path.join(dir, 'site.yaml'))).rejects.toThrow(
      new ConfigError('site.yaml: file not found'),
    );
  });

  it('names a file that cannot be read', async () => {
    const dir = await tree({ 'site.yaml/inner': 'x' });
    expect(await loadConfig(path.join(dir, 'site.yaml')).catch((e: unknown) => String(e))).toMatch(
      /^ConfigError: site\.yaml: EISDIR/,
    );
  });

  it('gives line and column of a YAML syntax error', async () => {
    expect(await failure('title: Site\nbaseUrl: [unclosed\n')).toMatch(
      /^site\.yaml: .* at line \d+, column \d+$/,
    );
  });

  it('rejects duplicate keys', async () => {
    expect(await failure('title: A\ntitle: B\n')).toMatch(/^site\.yaml: Map keys must be unique/);
  });

  it.each([
    ['empty', '', 'site.yaml: Invalid input: expected object, received null'],
    ['a list', '- a\n- b\n', 'site.yaml: Invalid input: expected object, received array'],
    ['a scalar', 'text\n', 'site.yaml: Invalid input: expected object, received string'],
  ])('rejects a file that is %s', async (_, text, expected) => {
    expect(await failure(text)).toBe(expected);
  });

  it('types scalars by the YAML core schema', async () => {
    expect(await load(VALID.replace('title: Site', 'title: yes'))).toMatchObject({ title: 'yes' });
    expect(await failure(VALID.replace('count: 5', 'count: "5"'))).toBe(
      'site.yaml: home[0].count: Invalid input: expected number, received string',
    );
    expect(await failure(VALID.replace('title: Site', 'title: true'))).toBe(
      'site.yaml: title: Invalid input: expected string, received boolean',
    );
  });

  it('puts each problem on its own line with the file name and the path', async () => {
    const text = VALID.replace('layout: stream', 'layout: page').replace(
      'menu: [blog]',
      'menu: blog',
    );
    expect(await failure(text)).toBe(
      [
        'site.yaml: sections.blog.layout: expected one of stream|cards|list',
        'site.yaml: menu: Invalid input: expected array, received string',
      ].join('\n'),
    );
  });

  it('names each unknown key by its full path', async () => {
    const text = `${VALID}extra: 1\n`.replace('menu: taxonomy', 'menu: taxonomy\n    lable: x');
    expect(await failure(text)).toBe(
      ['site.yaml: sections.blog.lable: unknown key', 'site.yaml: extra: unknown key'].join('\n'),
    );
  });

  it('shows the problems of the closest home block form', async () => {
    expect(
      await failure(VALID.replace('{ latest: blog, count: 5 }', '{ latest: 3, count: -1 }')),
    ).toBe(
      [
        'site.yaml: home[0].latest: Invalid input: expected string, received number',
        'site.yaml: home[0].count: Too small: expected number to be >=0',
      ].join('\n'),
    );
  });

  it('takes the closest branch whichever form it is', async () => {
    expect(
      await failure(VALID.replace('{ latest: blog, count: 5 }', '{ featured: 3, count: 1 }')),
    ).toBe('site.yaml: home[0].featured: Invalid input: expected string, received number');
  });

  /** VALID with its one section renamed to `key`, and no references to it. */
  const keyed = (key: string) =>
    VALID.replace('  blog:', `  ${key}:`).replace(
      'menu: [blog]\nhome:\n  - { latest: blog, count: 5 }\n',
      'menu: []\nhome: []\n',
    );

  it('accepts a section key that names an Object property, and keeps it', async () => {
    expect(await load(keyed('prototype'))).toMatchObject({
      sections: { prototype: { label: 'Blog' } },
    });
  });

  it.each([
    ['__proto__', 'section key must be a clean slug (suggest "proto")'],
    ['hasOwnProperty', 'section key must be a clean slug (suggest "hasownproperty")'],
    ['2024', 'section key must contain a letter, or it loses its place in the order'],
  ])('rejects the section key %s, naming its path', async (key, message) => {
    expect(await failure(keyed(key))).toBe(`site.yaml: sections.${key}: ${message}`);
  });

  it('turns an excessive alias count into an error naming the file', async () => {
    const aliases = Array.from({ length: 150 }, () => '*a').join(', ');
    const text = `${VALID}x-big: &a [1, 2, 3]\nx-many: [${aliases}]\n`;
    expect(await failure(text)).toMatch(/^site\.yaml: Excessive alias count/);
  });

  it('treats YAML warnings as errors', async () => {
    expect(await failure(`${VALID.replace('title: Site', 'title: !nonsense Site')}`)).toMatch(
      /^site\.yaml: Unresolved tag: !nonsense/,
    );
  });

  it('reports a home block that is no block at all', async () => {
    expect(await failure(VALID.replace('{ latest: blog, count: 5 }', 'blog'))).toMatch(
      /^site\.yaml: home\[0\]: /,
    );
  });

  it('reports references to undeclared sections', async () => {
    expect(await failure(VALID.replace('latest: blog', 'latest: news'))).toBe(
      'site.yaml: home[0].latest: unknown section "news"',
    );
  });

  it('names the file by its own name', async () => {
    const dir = await tree({ 'other.yaml': 'x' });
    await expect(loadConfig(path.join(dir, 'other.yaml'))).rejects.toThrow(/^other\.yaml: /);
    await fs.rm(path.join(dir, 'other.yaml'));
  });
});
