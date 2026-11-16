import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWatch, type Watcher } from '../../src/server/watch.ts';
import { trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();

const SETTLE_MS = 250;
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

describe('startWatch with the real fs.watch', () => {
  let watcher: Watcher | undefined;
  afterEach(() => watcher?.close());

  /** A project-like tree watched the way the preview watches the real one. */
  async function watched() {
    const root = await tree({
      'site/site.yaml': 'one',
      'src/a.ts': 'a',
      'site/index.md': 'm',
      'build/old.html': '',
      'publish/old.html': '',
    });
    let builds = 0;
    watcher = startWatch({
      targets: [
        { path: path.join(root, 'site'), recursive: true },
        { path: path.join(root, 'src'), recursive: true },
      ],
      rebuild: async () => {
        builds++;
      },
      onBuilt: () => {},
      onError: () => {},
      debounceMs: 20,
    });
    await settle();
    return { root, builds: () => builds };
  }

  it('rebuilds on create, modify and delete below a recursive target', async () => {
    const { root, builds } = await watched();
    await fs.mkdir(path.join(root, 'src/deep'));
    await fs.writeFile(path.join(root, 'src/deep/new.ts'), 'x');
    await vi.waitFor(() => expect(builds()).toBe(1));
    await fs.appendFile(path.join(root, 'src/a.ts'), 'more');
    await vi.waitFor(() => expect(builds()).toBe(2));
    await fs.rm(path.join(root, 'src/a.ts'));
    await vi.waitFor(() => expect(builds()).toBe(3));
  });

  it('rebuilds when an editor saves the site config by renaming a temp file over it', async () => {
    const { root, builds } = await watched();
    for (const n of [1, 2]) {
      await fs.writeFile(path.join(root, 'site/.site.yaml.swp'), `v${n}`);
      await fs.rename(path.join(root, 'site/.site.yaml.swp'), path.join(root, 'site/site.yaml'));
      await vi.waitFor(() => expect(builds()).toBe(n));
      await settle();
    }
  });

  it('rebuilds when the site config is deleted and when it is created again', async () => {
    const { root, builds } = await watched();
    await fs.rm(path.join(root, 'site/site.yaml'));
    await vi.waitFor(() => expect(builds()).toBe(1));
    await settle();
    await fs.writeFile(path.join(root, 'site/site.yaml'), 'again');
    await vi.waitFor(() => expect(builds()).toBe(2));
  });

  it('is not triggered by writes next to the site, such as build, publish, their staging directories or .tmp', async () => {
    const { root, builds } = await watched();
    for (const dir of ['build', 'publish', `publish.tmp-${process.pid}`, `publish.old-1`, '.tmp']) {
      await fs.mkdir(path.join(root, dir), { recursive: true });
      await fs.writeFile(path.join(root, dir, 'f.html'), 'x');
    }
    await fs.rename(path.join(root, 'publish'), path.join(root, 'publish.old-2'));
    await fs.rename(path.join(root, `publish.tmp-${process.pid}`), path.join(root, 'publish'));
    await settle();
    expect(builds()).toBe(0);
  });

  it('keeps watching the other targets after a watched directory disappears', async () => {
    const { root, builds } = await watched();
    await fs.rm(path.join(root, 'site'), { recursive: true });
    await settle();
    await fs.appendFile(path.join(root, 'src/a.ts'), 'x');
    await vi.waitFor(() => expect(builds()).toBeGreaterThan(0));
  });
});
