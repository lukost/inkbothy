import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Bundle, bundle } from '../../src/generator/bundle.ts';
import { ROOT } from '../../src/lib/paths.ts';
import { trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();

const names = (dirs: readonly string[]) => dirs.map((d) => path.relative(ROOT, d));

/** Entries for a throwaway client script and stylesheet (inputs of the same directory hash alike). */
async function entries(
  script: string,
  css = 'a { color: red }',
  extra: Record<string, string> = {},
  dir?: string,
) {
  const root = dir ?? (await tree());
  for (const [name, text] of Object.entries({ 'entry.ts': script, 'entry.css': css, ...extra })) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), text);
  }
  return { js: path.join(root, 'entry.ts'), css: path.join(root, 'entry.css') };
}

let cached: Promise<Bundle> | undefined;
/** The real client bundle, built once for the tests that only inspect it. */
const realBundle = () => {
  cached ??= bundle();
  return cached;
};

describe('bundle (real client)', () => {
  it('emits hashed JS and CSS under assets/ and reports root-relative URLs', async () => {
    const b = await bundle();
    expect(b.assets.js).toMatch(/^\/assets\/main-[A-Z0-9]{8}\.js$/);
    expect(b.assets.css).toMatch(/^\/assets\/site-[A-Z0-9]{8}\.css$/);
    const paths = b.files.map((f) => f.path);
    expect(paths).toContain(b.assets.js.slice(1));
    expect(paths).toContain(b.assets.css.slice(1));
    expect(paths.every((p) => p.startsWith('assets/') && !p.includes('\\'))).toBe(true);
    expect(b.files.every((f) => f.contents.length > 0)).toBe(true);
  });

  it('keeps the cascade layers of site.css: order first, screen sheets then print, fonts outside', async () => {
    const b = await realBundle();
    const file = b.files.find((f) => f.path === b.assets.css.slice(1));
    const css = new TextDecoder().decode(file?.contents);
    expect(css.startsWith('@layer screen,print;')).toBe(true);
    const layers = [...css.matchAll(/@layer (screen|print)\s*\{/g)].map((m) => m[1]);
    expect(layers.filter((l) => l === 'screen').length).toBeGreaterThan(5);
    expect(layers.filter((l) => l === 'print')).toEqual(['print']);
    expect(layers.at(-1)).toBe('print');
    // Every @font-face sits at the top level, outside any layer.
    const depthAt = (index: number): number =>
      [...css.slice(0, index)].reduce((d, ch) => d + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0);
    const faces = [...css.matchAll(/@font-face\s*\{/g)].map((m) => depthAt(m.index));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((d) => d === 0)).toBe(true);
    // The print rules are inside the print layer, after every screen rule.
    expect(css.lastIndexOf('@layer screen')).toBeLessThan(css.indexOf('@layer print{'));
    expect(css.slice(css.indexOf('@layer print{'))).toContain('@media print{@page{');
  });

  it('is deterministic down to the bytes', async () => {
    const [a, b] = [await bundle(), await bundle()];
    expect(a.assets).toEqual(b.assets);
    expect(a.files).toEqual(b.files);
  });

  it('lists the npm packages that ship, transitive ones included', async () => {
    const shipped = names((await realBundle()).packageDirs);
    expect(shipped).toEqual(
      expect.arrayContaining([
        'node_modules/mermaid',
        'node_modules/@fontsource-variable/ibm-plex-sans',
        'node_modules/@fontsource-variable/literata',
        'node_modules/dompurify',
      ]),
    );
  });

  it('ships no Markdown, Shiki or build-time code', async () => {
    const { inputs, packageDirs } = await realBundle();
    const forbidden = /markdown-it|shiki|textmate|htmlparser2|node_modules\/yaml\/|esbuild/;
    expect(inputs.filter((input) => forbidden.test(input))).toEqual([]);
    expect(names(packageDirs).filter((dir) => forbidden.test(dir))).toEqual([]);
    expect(inputs.filter((input) => input.startsWith('src/'))).toEqual(
      expect.arrayContaining(['src/client/main.ts', 'src/client/theme.ts']),
    );
    expect(inputs.some((input) => input.startsWith('src/generator/'))).toBe(false);
  });

  it('draws only on client code, shared state and npm packages', async () => {
    const code = (await realBundle()).inputs.filter((input) => /\.(ts|js|mjs|cjs)$/.test(input));
    const allowed = /^(src\/client\/|src\/shared\/|src\/lib\/|src\/types\.ts$|node_modules\/)/;
    expect(code.filter((input) => !allowed.test(input))).toEqual([]);
    expect(
      code.filter((input) => /^(src\/(generator|content|templates)\/|node:)/.test(input)),
    ).toEqual([]);
    expect(code.some((input) => input.startsWith('src/client/'))).toBe(true);
  });

  it('keeps Mermaid out of the entry output, in lazy chunks, and the entry small', async () => {
    const b = await realBundle();
    const main = b.files.find((f) => f.path === b.assets.js.slice(1));
    const mainText = new TextDecoder().decode(main?.contents);
    expect(mainText).not.toContain('mermaidAPI');
    // Measured 21.7 kB, plus about 10%. Largest parts (minified bytes): search dialog 5.1 kB, stream
    // 3.4 kB, scroll-spy 1.4 kB, sidebar 1.4 kB, mermaid loader 1.4 kB, theme 0.9 kB, text size 0.7 kB,
    // top-bar title 0.5 kB, viewport helpers 0.3 kB; the rest is search, print and small helpers.
    expect(main?.contents.length).toBeLessThan(23_900);
    const chunks = b.files.filter((f) => f.path.startsWith('assets/chunks/'));
    const chunkText = chunks.map((f) => new TextDecoder().decode(f.contents)).join('\n');
    expect(chunkText).toContain('mermaidAPI');
    expect(chunkText).not.toMatch(/createHighlighterCore|footnote-ref/);
  });

  it('keeps MiniSearch out of the entry output and in a lazy chunk of its own', async () => {
    const b = await realBundle();
    const decode = (contents: Uint8Array) => new TextDecoder().decode(contents);
    const main = b.files.find((f) => f.path === b.assets.js.slice(1));
    expect(decode(main?.contents ?? new Uint8Array())).not.toContain('MiniSearch:');
    const holders = b.files.filter((f) => decode(f.contents).includes('MiniSearch:'));
    expect(holders.map((f) => f.path)).toHaveLength(1);
    expect(holders[0]?.path).toMatch(/^assets\/chunks\/[\w-]+-[A-Z0-9]{8}\.js$/);
    expect(holders[0]?.contents.length).toBeLessThan(40_000);
    expect(b.inputs.filter((input) => input.includes('node_modules/minisearch/'))).toHaveLength(1);
    expect(names(b.packageDirs)).toContain('node_modules/minisearch');
  });

  it('builds without warnings', async () => {
    expect((await realBundle()).warnings).toEqual([]);
  });
});

describe('bundle (fonts)', () => {
  it('emits woff2 files under assets/fonts, named by content hash', async () => {
    const fonts = (await realBundle()).files.filter((f) => f.path.endsWith('.woff2'));
    expect(fonts.length).toBe(11);
    expect(fonts.every((f) => /^assets\/fonts\/[\w-]+-[A-Z0-9]{8}\.woff2$/.test(f.path))).toBe(
      true,
    );
  });

  it('reports the Literata and IBM Plex Sans Latin upright faces for preloading, and only those', async () => {
    const b = await realBundle();
    expect(b.assets.preload).toHaveLength(2);
    expect(b.assets.preload[0]).toMatch(
      /^\/assets\/fonts\/literata-latin-opsz-normal-[A-Z0-9]{8}\.woff2$/,
    );
    expect(b.assets.preload[1]).toMatch(
      /^\/assets\/fonts\/ibm-plex-sans-latin-wght-normal-[A-Z0-9]{8}\.woff2$/,
    );
    for (const href of b.assets.preload) {
      expect(b.files.map((f) => `/${f.path}`)).toContain(href);
    }
  });

  it('maps a preload source to its hashed output, and rejects one that is not bundled', async () => {
    const root = await tree({ 'f.woff2': 'wOF2 a', 'unused.woff2': 'wOF2 b' });
    const e = await entries('export {};', '@font-face { src: url(f.woff2) }', {}, root);
    const b = await bundle({ ...e, preload: [path.join(root, 'f.woff2')] });
    expect(b.assets.preload).toHaveLength(1);
    expect(b.assets.preload[0]).toMatch(/^\/assets\/fonts\/f-[A-Z0-9]{8}\.woff2$/);
    await expect(bundle({ ...e, preload: [path.join(root, 'unused.woff2')] })).rejects.toThrow(
      'bundle produced no output for',
    );
  });

  it('maps entries and fonts reached through a symlinked directory, as with a symlinked node_modules', async () => {
    const real = await tree({ 'f.woff2': 'wOF2 a' });
    await entries('export {};', '@font-face { src: url(f.woff2) }', {}, real);
    const link = path.join(await tree(), 'linked');
    await fs.symlink(real, link);
    const b = await bundle({
      js: path.join(link, 'entry.ts'),
      css: path.join(link, 'entry.css'),
      preload: [path.join(link, 'f.woff2')],
    });
    expect(b.assets.js).toMatch(/^\/assets\/entry-[A-Z0-9]{8}\.js$/);
    expect(b.assets.preload[0]).toMatch(/^\/assets\/fonts\/f-[A-Z0-9]{8}\.woff2$/);
  });

  it('lists the packages of a symlinked node_modules below the project, not at their real location', async () => {
    const store = await tree({
      'kept/package.json': JSON.stringify({ name: 'kept', main: 'index.js' }),
      'kept/index.js': 'export const used = () => globalThis.name;',
    });
    const dir = await tree();
    await fs.symlink(store, path.join(dir, 'node_modules'));
    const b = await bundle(
      await entries('import { used } from "kept"; console.log(used());', 'a{}', {}, dir),
    );
    expect(b.packageDirs.map((d) => path.relative(dir, d))).toEqual([
      path.join('node_modules', 'kept'),
    ]);
    expect(b.inputs.some((input) => input.endsWith('node_modules/kept/index.js'))).toBe(true);
    expect(b.inputs.every((input) => !input.startsWith('..'))).toBe(true);
  });

  it('rejects a preload source that does not exist by its resolved path', async () => {
    const e = await entries('export {};');
    const missing = path.join(path.dirname(e.js), 'missing.woff2');
    await expect(bundle({ ...e, preload: [missing] })).rejects.toThrow(
      `bundle produced no output for ${missing}`,
    );
  });

  it('has no preload without a request', async () => {
    const e = await entries('export {};');
    expect((await bundle(e)).assets.preload).toEqual([]);
  });

  it('loads a woff2 referenced by a custom stylesheet as a hashed file', async () => {
    const root = await tree({ 'f.woff2': 'wOF2 not really' });
    const e = await entries('export {};', '@font-face { src: url(f.woff2) }', {}, root);
    const b = await bundle(e);
    const font = b.files.find((f) => f.path.endsWith('.woff2'));
    expect(font?.path).toMatch(/^assets\/fonts\/f-[A-Z0-9]{8}\.woff2$/);
    expect(new TextDecoder().decode(font?.contents)).toBe('wOF2 not really');
    expect(b.files.find((f) => f.path === b.assets.css.slice(1))).toBeDefined();
  });
});

describe('bundle (custom entries)', () => {
  it('changes the hash when the input changes, and only then', async () => {
    const dir = await tree();
    const one = await bundle(await entries('console.log(1);', undefined, {}, dir));
    const same = await bundle(await entries('console.log(1);', undefined, {}, dir));
    const other = await bundle(await entries('console.log(2);', undefined, {}, dir));
    expect(one.assets.js).toMatch(/^\/assets\/entry-[A-Z0-9]{8}\.js$/);
    expect(one.assets.js).toBe(same.assets.js);
    expect(one.assets.js).not.toBe(other.assets.js);
    expect(one.assets.css).toBe(other.assets.css);
  });

  it('changes the CSS hash with the stylesheet', async () => {
    const dir = await tree();
    const a = await bundle(await entries('export {};', 'a{color:red}', {}, dir));
    const b = await bundle(await entries('export {};', 'a{color:blue}', {}, dir));
    expect(a.assets.css).not.toBe(b.assets.css);
    expect(a.assets.js).toBe(b.assets.js);
  });

  it('puts dynamically imported code into hashed chunks', async () => {
    const b = await bundle(
      await entries('const m = await import("./lazy.ts"); console.log(m.x);', 'a{}', {
        'lazy.ts': 'export const x = Math.random();',
      }),
    );
    const chunk = /^assets\/chunks\/[^/]+-[A-Z0-9]{8}\.js$/;
    expect(b.files.some((f) => chunk.test(f.path))).toBe(true);
  });

  it('reports no packages for self-contained entries', async () => {
    expect((await bundle(await entries('console.log(1);'))).packageDirs).toEqual([]);
  });

  it('reports a package only when its code ends up in the output', async () => {
    const pkg = (name: string, body: string) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({
        name,
        main: 'index.js',
        sideEffects: false,
      }),
      [`node_modules/${name}/index.js`]: body,
    });
    const b = await bundle(
      await entries(
        'import { used } from "kept"; import { unused } from "dropped"; console.log(used());',
        'a{}',
        {
          ...pkg('kept', 'export const used = () => globalThis.name;'),
          ...pkg('dropped', 'export const unused = () => globalThis.length;'),
        },
      ),
    );
    expect(names(b.packageDirs).map((d) => path.basename(d))).toEqual(['kept']);
  });

  it('rejects with the compiler message when the entry does not build', async () => {
    await expect(bundle(await entries('import "no-such-package-xyz";'))).rejects.toThrow(
      /no-such-package-xyz/,
    );
  });

  it('fails when an entry yields no output of its kind', async () => {
    const e = await entries('console.log(1);');
    await expect(bundle({ js: e.js, css: e.js })).rejects.toThrow(
      `bundle produced no .css output for ${e.js}`,
    );
  });

  it('fails when the script imports CSS', async () => {
    const e = await entries('import "./extra.css"; console.log(1);', 'a{color:red}', {
      'extra.css': 'b{color:blue}',
    });
    await expect(bundle(e)).rejects.toThrow(
      /must not import CSS \(emitted assets\/entry-\w+\.css\)/,
    );
  });

  it('reports esbuild warnings as single lines', async () => {
    const b = await bundle(await entries('console.log({ a: 1, a: 2 });'));
    expect(b.warnings).toHaveLength(1);
    expect(b.warnings[0]).toMatch(/^▲ \[WARNING\] Duplicate key "a"/);
    expect(b.warnings[0]).not.toContain('\n');
  });
});
