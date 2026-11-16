import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { DATA } from '../../src/lib/paths.ts';
import { initSite } from '../../src/tools/init-site.ts';
import type { BuildResult } from '../../src/types.ts';
import { trackedTrees } from '../helpers.ts';

const { tree, outFor } = trackedTrees();

describe('the sample site, as init-site copies it', () => {
  let result: BuildResult;
  let manifest: { pages: { url: string; section: string | null; draft: boolean }[] };

  beforeAll(async () => {
    const siteDir = path.join(await tree(), 'site');
    await initSite(siteDir);
    const outDir = outFor(siteDir);
    result = await build({ siteDir, dataDir: DATA, outDir, now: new Date('2027-01-01') });
    manifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  }, 60_000);

  it('builds without warnings', () => {
    expect(result.warnings).toEqual([]);
  });

  it('publishes the home page, the page, the resume and one item per section', () => {
    expect(manifest.pages.map((p) => p.url).sort()).toEqual([
      '/',
      '/about/',
      '/blog/hello-world/',
      '/projects/sample-project/',
      '/resume/',
    ]);
    expect(manifest.pages.some((p) => p.draft)).toBe(false);
  });

  it('does not publish the files that belong to the site rather than to its content', () => {
    const published = result.files.filter((f) =>
      /site\.yaml|site\.schema|CLAUDE\.md|README|_templates/.test(f),
    );
    expect(published).toEqual([]);
  });
});
