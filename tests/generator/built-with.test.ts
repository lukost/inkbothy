import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  builtWithPackages,
  GENERATOR_ENTRY,
  platformPackages,
} from '../../src/generator/built-with.ts';
import { ROOT } from '../../src/lib/paths.ts';
import { trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();
const names = (dirs: readonly string[]) => dirs.map((d) => path.relative(ROOT, d));

describe('builtWithPackages (the real generator)', () => {
  it('lists what the generator runs on, with the transitive packages', async () => {
    const { packageDirs, warnings } = await builtWithPackages();
    expect(warnings).toEqual([]);
    expect(names(packageDirs)).toEqual(
      expect.arrayContaining([
        'node_modules/markdown-it',
        'node_modules/markdown-it-footnote',
        'node_modules/linkify-it',
        'node_modules/mdurl',
        'node_modules/shiki',
        'node_modules/@shikijs/core',
        'node_modules/@shikijs/langs',
        'node_modules/@shikijs/themes',
        'node_modules/@shikijs/engine-javascript',
        'node_modules/@shikijs/vscode-textmate',
        'node_modules/htmlparser2',
        'node_modules/domhandler',
        'node_modules/yaml',
        'node_modules/minisearch',
        'node_modules/zod',
        'node_modules/esbuild',
      ]),
    );
  });

  it('leaves out dev-only tools, the client-only libraries and everything it does not import', async () => {
    const dirs = names((await builtWithPackages()).packageDirs).join('\n');
    for (const tool of ['vitest', '@biomejs', 'typescript', 'happy-dom', '@vitest', 'mermaid']) {
      expect(dirs, tool).not.toContain(tool);
    }
  });

  it('lists each package once, bundled ones sorted, then the esbuild packages', async () => {
    const { packageDirs, licenseSources } = await builtWithPackages();
    const dirs = names(packageDirs);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(dirs.every((d) => d.startsWith('node_modules'))).toBe(true);
    const bundled = dirs.filter((d) => !/node_modules\/(@esbuild\/.*|esbuild)$/.test(d));
    expect(bundled).toEqual([...bundled].sort());
    expect(dirs.slice(bundled.length)).toEqual([
      'node_modules/esbuild',
      expect.stringMatching(/^node_modules\/@esbuild\//),
    ]);
    expect(
      [...licenseSources].map(([from, to]) => [path.relative(ROOT, from), path.relative(ROOT, to)]),
    ).toEqual([[dirs.at(-1), 'node_modules/esbuild']]);
  });

  it('analyses the generator once per process', async () => {
    expect(builtWithPackages()).toBe(builtWithPackages(GENERATOR_ENTRY));
    expect(await builtWithPackages()).toBe(await builtWithPackages());
  });
});

describe('builtWithPackages (other entries)', () => {
  const pkg = (name: string, body: string) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, main: 'index.js' }),
    [`node_modules/${name}/index.js`]: body,
  });

  it('follows imports through TypeScript, import attributes and dynamic imports, for Node', async () => {
    const dir = await tree({
      'entry.ts': [
        'import data from "./data.json" with { type: "json" };',
        'import { a } from "dep-a";',
        'import fs from "node:fs";',
        'const lazy = await import("dep-lazy");',
        'console.log(data, a, fs, lazy, import.meta.dirname);',
        'export type T = number;',
      ].join('\n'),
      'data.json': '{"x":1}',
      ...pkg('dep-a', 'import "dep-b"; export const a = 1;'),
      ...pkg('dep-b', 'globalThis.b = 1;'),
      ...pkg('dep-lazy', 'export default 1;'),
      ...pkg('unused', 'export default 2;'),
    });
    const { packageDirs, warnings } = await builtWithPackages(path.join(dir, 'entry.ts'));
    expect(warnings).toEqual([]);
    const found = packageDirs.map((d) => path.basename(d));
    expect(found).toEqual(expect.arrayContaining(['dep-a', 'dep-b', 'dep-lazy', 'esbuild']));
    expect(found).not.toContain('unused');
  });

  it('keeps esbuild itself out of the bundle, listing it by name', async () => {
    const dir = await tree({ 'entry.ts': 'import { build } from "esbuild"; console.log(build);' });
    const { packageDirs } = await builtWithPackages(path.join(dir, 'entry.ts'));
    expect(names(packageDirs)).toEqual([
      'node_modules/esbuild',
      expect.stringMatching(/^node_modules\/@esbuild\//),
    ]);
  });

  it('keeps bundled packages below the project when node_modules is a symlink', async () => {
    const store = await tree({
      'dep-a/package.json': JSON.stringify({ name: 'dep-a', main: 'index.js' }),
      'dep-a/index.js': 'export const a = 1;',
    });
    const dir = await tree({ 'entry.ts': 'import { a } from "dep-a"; export { a };' });
    await fs.symlink(store, path.join(dir, 'node_modules'));
    const { packageDirs } = await builtWithPackages(path.join(dir, 'entry.ts'));
    expect(packageDirs.map((d) => path.relative(dir, d))).toContain(
      path.join('node_modules', 'dep-a'),
    );
  });

  it('reports esbuild warnings as single lines', async () => {
    const dir = await tree({ 'entry.ts': 'console.log({ a: 1, a: 2 });' });
    const { warnings } = await builtWithPackages(path.join(dir, 'entry.ts'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^▲ \[WARNING\] Duplicate key "a"/);
  });

  it('rejects, naming the module, when an import cannot be resolved', async () => {
    const dir = await tree({ 'entry.ts': 'import "no-such-package-xyz";' });
    await expect(builtWithPackages(path.join(dir, 'entry.ts'))).rejects.toThrow(
      /no-such-package-xyz/,
    );
  });
});

describe('platformPackages', () => {
  const pkg = (name: string, optional: Record<string, string>) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: '1.0.0',
      optionalDependencies: optional,
    }),
  });
  const installed = (name: string) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0' }),
  });

  it('finds the installed platform package of the real esbuild, resolved rather than named', async () => {
    const { dirs, warnings } = await platformPackages(path.join(ROOT, 'node_modules', 'esbuild'));
    expect(warnings).toEqual([]);
    expect(dirs).toHaveLength(1);
    expect(names(dirs)[0]).toMatch(/^node_modules\/@esbuild\/[a-z0-9-]+$/);
    expect(names((await builtWithPackages()).packageDirs)).toEqual(
      expect.arrayContaining(names(dirs)),
    );
  });

  it('keeps only the optional dependencies that are installed', async () => {
    const dir = await tree({
      ...pkg('tool', { '@t/linux': '1', '@t/win': '1', '@t/mac': '1' }),
      ...installed('@t/mac'),
    });
    const { dirs, warnings } = await platformPackages(path.join(dir, 'node_modules', 'tool'));
    expect(dirs.map((d) => path.relative(dir, d))).toEqual([
      path.join('node_modules', '@t', 'mac'),
    ]);
    expect(warnings).toEqual([]);
  });

  it('keeps platform packages below the package when node_modules is a symlink', async () => {
    const store = await tree({
      ...pkg('tool', { '@t/mac': '1' }),
      ...installed('@t/mac'),
    });
    const dir = await tree();
    await fs.symlink(path.join(store, 'node_modules'), path.join(dir, 'node_modules'));
    const { dirs } = await platformPackages(path.join(dir, 'node_modules', 'tool'));
    expect(dirs.map((d) => path.relative(dir, d))).toEqual([
      path.join('node_modules', '@t', 'mac'),
    ]);
  });

  it('looks for platform packages in the parent directories too', async () => {
    const dir = await tree({
      ...pkg('tool', { '@t/mac': '1' }),
      ...installed('@t/mac'),
    });
    const nested = path.join(dir, 'node_modules', 'tool', 'node_modules', 'inner');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(nested, 'package.json'),
      JSON.stringify({ optionalDependencies: { '@t/mac': '1' } }),
    );
    expect((await platformPackages(nested)).dirs).toEqual([
      path.join(dir, 'node_modules', '@t', 'mac'),
    ]);
  });

  it('warns, without failing, when none is installed', async () => {
    const dir = await tree(pkg('tool', { '@t/linux': '1' }));
    expect(await platformPackages(path.join(dir, 'node_modules', 'tool'))).toEqual({
      dirs: [],
      warnings: ['attributions: no platform package of tool is installed'],
    });
  });

  it('is silent for a package without optional dependencies', async () => {
    const dir = await tree(pkg('plain', {}));
    expect(await platformPackages(path.join(dir, 'node_modules', 'plain'))).toEqual({
      dirs: [],
      warnings: [],
    });
    const none = await tree({
      'node_modules/p/package.json': '{"name":"p"}',
      'node_modules/q/package.json': '[]',
    });
    for (const name of ['p', 'q']) {
      expect(await platformPackages(path.join(none, 'node_modules', name))).toEqual({
        dirs: [],
        warnings: [],
      });
    }
  });

  it('warns when the package cannot be read', async () => {
    const dir = await tree({ 'node_modules/bad/package.json': '{ nope' });
    const missing = await platformPackages(path.join(dir, 'node_modules', 'absent'));
    expect(missing.dirs).toEqual([]);
    expect(missing.warnings).toEqual([
      expect.stringMatching(/^attributions: cannot read .*absent/),
    ]);
    const bad = await platformPackages(path.join(dir, 'node_modules', 'bad'));
    expect(bad.warnings).toEqual([expect.stringMatching(/^attributions: cannot read .*bad/)]);
  });
});
