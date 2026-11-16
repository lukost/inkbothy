import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  main,
  REFERENCE_FILE,
  referenceMarkdown,
  referenceRows,
  SCHEMA_FILE,
  schemaJson,
} from '../../src/tools/gen-docs.ts';
import { trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();

describe('generated site.yaml documentation', () => {
  it('has the committed site.schema.json equal to the one the schema produces (run make docs)', async () => {
    expect(await fs.readFile(SCHEMA_FILE, 'utf8')).toBe(schemaJson());
  });

  it('has the committed docs/site-yaml.md equal to the one the schema produces (run make docs)', async () => {
    expect(await fs.readFile(REFERENCE_FILE, 'utf8')).toBe(referenceMarkdown());
  });

  it('describes every key of the schema', () => {
    expect(referenceRows().filter((r) => r.description.trim() === '')).toEqual([]);
  });

  it('lists every key in order, nested keys after their parent', () => {
    expect(referenceRows().map((r) => r.path)).toEqual([
      'title',
      'baseUrl',
      'favicon',
      'appleTouchIcon',
      'copyright',
      'copyright.holder',
      'copyright.rights',
      'sections',
      'sections.<key>.label',
      'sections.<key>.noun',
      'sections.<key>.taxonomies',
      'sections.<key>.menu',
      'sections.<key>.layout',
      'sections.<key>.stream',
      'sections.<key>.stream.initial',
      'sections.<key>.stream.batch',
      'menu',
      'home',
      'home[].latest',
      'home[].count',
      'home[].featured',
    ]);
  });

  it('marks optional keys and keys of only some alternatives as not required', () => {
    const required = Object.fromEntries(referenceRows().map((r) => [r.path, r.required]));
    expect(required).toMatchObject({
      title: true,
      'copyright.holder': true,
      favicon: false,
      appleTouchIcon: false,
      'sections.<key>.layout': true,
      'sections.<key>.stream': false,
      'sections.<key>.stream.batch': true,
      'home[].latest': false,
      'home[].featured': false,
      'home[].count': true,
    });
  });

  it('renders types a reader can act on', () => {
    const types = Object.fromEntries(referenceRows().map((r) => [r.path, r.type]));
    expect(types).toMatchObject({
      'sections.<key>.layout': '`"stream"` \\| `"cards"` \\| `"list"`',
      'sections.<key>.menu': '`taxonomy` \\| `items` \\| `none`',
      'sections.<key>.noun': '[string, string]',
      'sections.<key>.taxonomies': 'list of `categories` \\| `tags`',
      'sections.<key>.stream.batch': 'integer ≥ 1',
      menu: 'list of string',
      home: 'list of mapping',
    });
  });

  it('is a valid JSON Schema that forbids unknown keys', async () => {
    const schema = JSON.parse(await fs.readFile(SCHEMA_FILE, 'utf8'));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['title', 'baseUrl', 'copyright', 'sections', 'menu', 'home']);
  });

  it('writes both files', async () => {
    const dir = await tree();
    await main(path.join(dir, 's.json'), path.join(dir, 'r.md'));
    expect(await fs.readFile(path.join(dir, 's.json'), 'utf8')).toBe(schemaJson());
    expect(await fs.readFile(path.join(dir, 'r.md'), 'utf8')).toBe(referenceMarkdown());
  });
});
