// @vitest-environment happy-dom
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/config/load.ts';
import type { SiteConfig } from '../../src/config/schema.ts';
import { build } from '../../src/generator/build.ts';
import { loadIcons } from '../../src/generator/icons.ts';
import { publish } from '../../src/generator/publish.ts';
import { createHandler } from '../../src/server/serve.ts';
import { $$, attrs, doc, parseHtml, renderPage, siteConfig, trackedTrees } from '../helpers.ts';
import { listening, request } from '../server/http.ts';

const { tree, outFor } = trackedTrees();

const HOME = doc('title: Home\npublished: 2026-01-01');

async function buildSite(content: Record<string, string>, config: SiteConfig) {
  const siteDir = await tree({ 'index.md': HOME, ...content });
  const outDir = outFor(siteDir);
  const result = await build({ siteDir, dataDir: await tree(), outDir, config });
  return { siteDir, outDir, result, read: (rel: string) => fs.readFile(path.join(outDir, rel)) };
}

const links = (html: string) =>
  $$(parseHtml(html).head, 'link[rel="icon"], link[rel="apple-touch-icon"]').map((l) => [
    l.getAttribute('rel'),
    l.getAttribute('href'),
    l.getAttribute('type'),
  ]);

describe('icons in the build', () => {
  it.each([
    ['icons/site.svg', 'image/svg+xml', '.svg'],
    ['site.PNG', 'image/png', '.png'],
    ['a/favicon.ico', 'image/x-icon', '.ico'],
  ])('links %s on every page with its media type', async (source, type, ext) => {
    const site = await buildSite(
      { [source]: 'ICON', 'about/index.md': HOME },
      siteConfig({ favicon: source, menu: [] }),
    );
    for (const page of ['index.html', 'about/index.html', '404.html', 'attributions/index.html']) {
      const found = links((await site.read(page)).toString());
      expect(found, page).toHaveLength(1);
      const [rel, href, mediaType] = found[0] ?? [];
      expect([rel, mediaType]).toEqual(['icon', type]);
      expect(href).toMatch(new RegExp(`^/assets/favicon-[0-9a-f]{10}\\${ext}$`));
      expect((await site.read(String(href).slice(1))).toString()).toBe('ICON');
    }
  });

  it('links the Apple touch icon without a type, after the icon', async () => {
    const site = await buildSite(
      { 'i/fav.svg': 'F', 'i/touch.png': 'T' },
      siteConfig({ favicon: 'i/fav.svg', appleTouchIcon: 'i/touch.png', menu: [] }),
    );
    const found = links((await site.read('index.html')).toString());
    expect(found.map(([rel, , type]) => [rel, type])).toEqual([
      ['icon', 'image/svg+xml'],
      ['apple-touch-icon', null],
    ]);
    expect(found[1]?.[1]).toMatch(/^\/assets\/apple-touch-icon-[0-9a-f]{10}\.png$/);
  });

  it('can set the Apple touch icon alone', async () => {
    const site = await buildSite(
      { 't.png': 'T' },
      siteConfig({ appleTouchIcon: 't.png', menu: [] }),
    );
    expect(links((await site.read('index.html')).toString()).map(([rel]) => rel)).toEqual([
      'apple-touch-icon',
    ]);
  });

  it('emits nothing when no icon is set', async () => {
    const site = await buildSite({}, siteConfig({ menu: [] }));
    expect(links((await site.read('index.html')).toString())).toEqual([]);
    expect(site.result.files.filter((f) => /favicon|apple-touch/.test(f))).toEqual([]);
  });

  it('names the file by its content, so a change of content changes the name', async () => {
    const name = async (data: string) => {
      const site = await buildSite({ 'f.svg': data }, siteConfig({ favicon: 'f.svg', menu: [] }));
      return site.result.files.find((f) => f.startsWith('assets/favicon-'));
    };
    const [a, a2, b] = [await name('one'), await name('one'), await name('two')];
    expect(a).toBeDefined();
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });

  it('copies the icon independently of a bundle that holds the same file', async () => {
    const site = await buildSite(
      { 'about/index.md': HOME, 'about/icon.svg': 'S' },
      siteConfig({ favicon: 'about/icon.svg', menu: [] }),
    );
    expect(site.result.files).toContain('about/icon.svg');
    expect(site.result.files.filter((f) => f.startsWith('assets/favicon-'))).toHaveLength(1);
  });

  it.each([
    [{ favicon: 'nope.svg' }, 'site.yaml: favicon: nope.svg: file not found in the site directory'],
    [{ appleTouchIcon: 'x/nope.png' }, 'site.yaml: appleTouchIcon: x/nope.png: file not found'],
  ])('stops with the setting and file when %j is missing', async (extra, message) => {
    await expect(buildSite({}, siteConfig({ ...extra, menu: [] }))).rejects.toThrow(message);
  });

  it('stops when the configured path is a directory', async () => {
    await expect(
      buildSite({ 'd.svg/x': 'x' }, siteConfig({ favicon: 'd.svg', menu: [] })),
    ).rejects.toThrow(/^site\.yaml: favicon: d\.svg: EISDIR/);
  });

  it('is a ConfigError, raised before anything is written', async () => {
    const siteDir = await tree({ 'index.md': HOME });
    const outDir = outFor(siteDir);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'keep.txt'), 'k');
    await expect(
      build({
        siteDir,
        dataDir: await tree(),
        outDir,
        config: siteConfig({ favicon: 'no.svg', menu: [] }),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
    expect(await fs.readFile(path.join(outDir, 'keep.txt'), 'utf8')).toBe('k');
  });

  it('has nothing to read without settings', async () => {
    expect(await loadIcons({}, '/nonexistent')).toEqual({ links: [], files: [] });
  });

  it('publishes the icons and serves them with their types, cached for good', async () => {
    const site = await buildSite(
      { 'f.ico': 'ICO', 't.png': 'PNG' },
      siteConfig({ favicon: 'f.ico', appleTouchIcon: 't.png', menu: [] }),
    );
    const publishDir = outFor(site.siteDir);
    const { files } = await publish({ buildDir: site.outDir, publishDir });
    const icons = files.filter((f) => /^assets\/(favicon|apple-touch-icon)-/.test(f));
    expect(icons).toHaveLength(2);
    const server = await listening(createHandler({ root: publishDir, csp: () => '' }));
    try {
      const replies = await Promise.all(icons.map((f) => request(server.port, `/${f}`)));
      expect(replies.map((r) => r.headers['content-type']).sort()).toEqual([
        'image/png',
        'image/x-icon',
      ]);
      expect(replies.every((r) => String(r.headers['cache-control']).includes('immutable'))).toBe(
        true,
      );
    } finally {
      await server.close();
    }
  });
});

describe('head links of the layout', () => {
  it('escapes what it is given', () => {
    const html = renderPage({ icons: [{ rel: 'icon', href: '/a"b.svg', type: 'x"y' }] });
    expect(attrs(parseHtml(html).head, 'link[rel="icon"]', 'href')).toEqual(['/a"b.svg']);
    expect(html).toContain('href="/a&quot;b.svg" type="x&quot;y"');
  });
});
