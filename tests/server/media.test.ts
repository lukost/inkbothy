import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { publish } from '../../src/generator/publish.ts';
import { createHandler } from '../../src/server/serve.ts';
import { doc, siteConfig, trackedTrees } from '../helpers.ts';
import { type Listening, listening, request } from './http.ts';

const { tree, outFor } = trackedTrees();

/** Types a post may reference besides the generated ones. */
const POST_ASSETS = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml; charset=utf-8',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
};

describe('media types of a published site', () => {
  let server: Listening;
  let files: readonly string[] = [];

  beforeAll(async () => {
    const content = await tree({
      'index.md': doc('title: Home\npublished: 2026-01-01'),
      'resume/index.md': doc('title: Resume\npublished: 2026-01-01'),
      'blog/p/index.md': doc('title: Post\npublished: 2026-01-01'),
      ...Object.fromEntries(Object.keys(POST_ASSETS).map((ext) => [`blog/p/asset.${ext}`, 'x'])),
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

  it('publishes and serves the post assets with their own types', async () => {
    for (const [ext, type] of Object.entries(POST_ASSETS)) {
      const reply = await request(server.port, `/blog/p/asset.${ext}`);
      expect(reply.status, ext).toBe(200);
      expect(reply.headers['content-type'], ext).toBe(type);
    }
  });
});
