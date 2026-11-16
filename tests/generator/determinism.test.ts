import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { SEARCH_INDEX_FILE } from '../../src/generator/search.ts';
import { doc, siteConfig, trackedTrees } from '../helpers.ts';

const { tree, outFor } = trackedTrees();
const now = new Date('2027-06-01T00:00:00Z');
const config = siteConfig({
  home: [
    { kind: 'latest', section: 'blog', count: 3 },
    { kind: 'featured', section: 'projects', count: 3 },
  ],
});

const post = (title: string, published: string, category: string, body = 'Body.\n') =>
  doc(
    `title: ${title}\npublished: ${published}\ncategories: [${category}]\nsummary: About ${title}`,
    body,
  );

const SITE = {
  'index.md': doc('title: Home\npublished: 2026-01-01'),
  'about/index.md': doc('title: About\npublished: 2026-01-01'),
  'blog/a/index.md': post('Alpha', '2026-03-01', 'Linux'),
  'blog/b/index.md': post('Beta', '2026-02-01', 'Linux'),
  'blog/c/index.md': post('Gamma', '2026-01-15', 'Rust'),
  'blog/c/pic.png': 'png-bytes',
  'projects/p/index.md': doc('title: Proj\npublished: 2026-01-01\nfeatured: true'),
};

/** Builds `files` and returns the content of every output file by relative path. */
async function built(files: Record<string, string>): Promise<Map<string, string>> {
  const siteDir = await tree(files);
  const outDir = outFor(siteDir);
  await build({ siteDir, dataDir: await tree(), outDir, config, now });
  const entries = await fs.readdir(outDir, { recursive: true, withFileTypes: true });
  const out = new Map<string, string>();
  for (const e of entries.filter((f) => f.isFile())) {
    const abs = path.join(e.parentPath, e.name);
    out.set(path.relative(outDir, abs), await fs.readFile(abs, 'latin1'));
  }
  return out;
}

/** Files present in only one tree, or with different content. */
function difference(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])].filter((f) => a.get(f) !== b.get(f)).sort();
}

describe('build determinism', () => {
  it('produces byte-identical trees, names included, from the same site and clock', async () => {
    const first = await built(SITE);
    expect(first.size).toBeGreaterThan(20);
    expect(difference(first, await built(SITE))).toEqual([]);
  }, 60_000);

  it('changes only the pages that show an edited post, and the search index', {
    timeout: 60_000,
  }, async () => {
    const before = await built(SITE);
    const after = await built({
      ...SITE,
      'blog/b/index.md': post('Beta', '2026-02-01', 'Linux', 'A changed body.\n'),
    });
    // The index has a fixed name, so pages that link it keep their bytes when it changes.
    expect(difference(before, after)).toEqual([
      'blog/b/fragment.html',
      'blog/b/index.html',
      'blog/category/linux/index.html',
      'blog/index.html',
      SEARCH_INDEX_FILE,
    ]);
  });
});
