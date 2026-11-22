import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load.ts';
import { SITE_SAMPLE } from '../../src/lib/paths.ts';
import { initSite, main } from '../../src/tools/init-site.ts';
import { sink, trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();

const listing = async (dir: string) =>
  (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();

describe('initSite', () => {
  it('copies the sample, naming the configuration site.yaml, into a new directory', async () => {
    const target = path.join(await tree(), 'nested', 'mysite');
    await initSite(target);
    const files = await listing(target);
    expect(files).toContain('site.yaml');
    expect(files).not.toContain('site.yaml.sample');
    expect(files).toEqual(
      (await listing(SITE_SAMPLE)).map((f) => (f === 'site.yaml.sample' ? 'site.yaml' : f)).sort(),
    );
    expect((await loadConfig(path.join(target, 'site.yaml'))).title).toBe('My site');
  });

  it('accepts an existing empty directory', async () => {
    const target = await tree();
    await initSite(target);
    expect(await listing(target)).toContain('index.md');
  });

  it('refuses a non-empty directory and leaves it alone', async () => {
    const target = await tree({ 'mine.txt': 'precious' });
    await expect(initSite(target)).rejects.toThrow(/is not empty/);
    expect(await listing(target)).toEqual(['mine.txt']);
  });

  it('refuses a file in place of the directory', async () => {
    const dir = await tree({ file: 'x' });
    await expect(initSite(path.join(dir, 'file'))).rejects.toThrow(/ENOTDIR/);
  });
});

describe('init-site cli', () => {
  it('creates the site named by --site and says what to do next', async () => {
    const target = path.join(await tree(), 'new-site');
    const stdout = sink();
    expect(await main(['--site', target], { stdout, stderr: sink(), env: {} })).toBe(0);
    expect(await listing(target)).toContain('site.yaml');
    expect(stdout.text).toBe(
      `created ${target}; edit site.yaml, then run make serve SITE=${target}\n`,
    );
  });

  it('takes the target from SITE_DIR', async () => {
    const target = path.join(await tree(), 'env-site');
    expect(await main([], { stdout: sink(), stderr: sink(), env: { SITE_DIR: target } })).toBe(0);
    expect(await listing(target)).toContain('site.yaml');
  });

  it('returns 1 with the reason for a non-empty target', async () => {
    const target = await tree({ a: 'x' });
    const stderr = sink();
    expect(await main(['--site', target], { stdout: sink(), stderr, env: {} })).toBe(1);
    expect(stderr.text).toBe(`error: ${target} is not empty; refusing to overwrite it\n`);
  });

  it('returns 2 with usage for a bad flag or an empty --site', async () => {
    for (const argv of [['--bogus'], ['--site', '']]) {
      const stderr = sink();
      expect(await main(argv, { stdout: sink(), stderr, env: {} })).toBe(2);
      expect(stderr.text).toMatch(/^error: .*\nusage: init-site \[--site <dir>\]\n$/);
    }
  });
});
