import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { publish } from '../../src/generator/publish.ts';
import { createHandler } from '../../src/server/serve.ts';
import { doc, siteConfig, trackedTrees } from '../helpers.ts';
import { type Listening, listening, request } from './http.ts';

const { tree, outFor } = trackedTrees();

/** Types a post may reference besides the generated ones. */
const POST_ASSETS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'pdf',
  'mp4',
  'webm',
  'mp3',
];

describe('media types of a published site', () => {
  let server: Listening;
  let files: readonly string[] = [];

  beforeAll(async () => {
    const content = await tree({
      'index.md': doc('title: Home\npublished: 2026-01-01'),
      'resume/index.md': doc('title: Resume\npublished: 2026-01-01'),
      'blog/p/index.md': doc('title: Post\npublished: 2026-01-01'),
      ...Object.fromEntries(POST_ASSETS.map((ext) => [`blog/p/asset.${ext}`, 'x'])),
    });
    const buildDir = outFor(content);
    const publishDir = outFor(content);
    await build({
      siteDir: content,
      dataDir: await tree(),
      outDir: buildDir,
      config: siteConfig({ menu: ['resume', 'blog'] }),
    });
    ({ files } = await publish({ buildDir, publishDir }));
    server = await listening(createHandler({ root: publishDir, csp: () => '' }));
  });
  afterAll(() => server.close());

  it('has an entry for every file extension of the site', async () => {
    const extensions = new Set(files.map((f) => path.extname(f).toLowerCase()));
    expect([...extensions]).toEqual(
      expect.arrayContaining(['.html', '.js', '.css', '.woff2', '.json']),
    );
    const unknown: string[] = [];
    for (const f of files) {
      const reply = await request(
        server.port,
        `/${f.split('/').map(encodeURIComponent).join('/')}`,
      );
      expect(reply.status, f).toBe(200);
      if (reply.headers['content-type'] === 'application/octet-stream') {
        unknown.push(f);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('serves the post assets with their own types', async () => {
    const types = await Promise.all(
      POST_ASSETS.map(
        async (ext) => (await request(server.port, `/blog/p/asset.${ext}`)).headers['content-type'],
      ),
    );
    expect(types.every((t) => t !== undefined && t !== 'application/octet-stream')).toBe(true);
  });
});
