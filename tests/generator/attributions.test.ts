import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectAttributions,
  packageDirFromPath,
  packageDirsOf,
  readExtras,
  readOverrides,
  readPackage,
  repositoryUrl,
} from '../../src/generator/attributions.ts';
import { ROOT } from '../../src/lib/paths.ts';
import { makeTree, removeTree } from '../helpers.ts';

describe('packageDirFromPath', () => {
  it.each([
    ['/p/node_modules/foo/dist/x.js', '/p/node_modules/foo'],
    ['/p/node_modules/@scope/pkg/lib/a.js', '/p/node_modules/@scope/pkg'],
    ['/p/node_modules/a/node_modules/b/index.js', '/p/node_modules/a/node_modules/b'],
    ['/p/node_modules/foo', '/p/node_modules/foo'],
    ['/p/src/x.js', null],
    ['/p/node_modules', null],
    ['/p/node_modules/@scope', null],
  ])('%s -> %s', (file, expected) => {
    expect(packageDirFromPath(file)).toBe(expected);
  });
});

describe('packageDirsOf', () => {
  it('maps files to distinct, sorted package roots, resolving relative paths against the project', () => {
    const dirs = packageDirsOf([
      'node_modules/b/index.js',
      'node_modules/a/x.js',
      'node_modules/b/lib/y.js',
      'node_modules/@s/p/z.js',
      'src/own.ts',
    ]);
    expect(dirs.map((d) => path.relative(ROOT, d))).toEqual([
      path.join('node_modules', '@s', 'p'),
      path.join('node_modules', 'a'),
      path.join('node_modules', 'b'),
    ]);
  });

  it('is empty without node_modules files', () => {
    expect(packageDirsOf([])).toEqual([]);
    expect(packageDirsOf(['src/a.ts'])).toEqual([]);
  });
});

describe('repositoryUrl', () => {
  it.each([
    ['markdown-it/markdown-it', 'https://github.com/markdown-it/markdown-it'],
    ['github:user/repo', 'https://github.com/user/repo'],
    ['gitlab:user/repo', 'https://gitlab.com/user/repo'],
    ['bitbucket:user/repo', 'https://bitbucket.org/user/repo'],
    [{ type: 'git', url: 'git+https://github.com/u/r.git' }, 'https://github.com/u/r'],
    ['git://github.com/u/r.git', 'https://github.com/u/r'],
    ['git+ssh://git@github.com/u/r.git', 'https://github.com/u/r'],
    ['git@github.com:u/r.git', 'https://github.com/u/r'],
    ['https://example.com/repo', 'https://example.com/repo'],
    ['javascript:alert(1)', null],
    [{}, null],
    [{ url: 123 }, null],
    [42, null],
    ['ssh://git@github.com/u/r.git', 'https://github.com/u/r'],
    ['unknownhost:user/repo', null],
    ['', null],
    [undefined, null],
  ])('%j -> %j', (v, expected) => {
    expect(repositoryUrl(v)).toBe(expected);
  });
});

describe('npm packages and extras', () => {
  let root = '';
  const nm = (p: string) => path.join(root, 'node_modules', p);

  beforeAll(async () => {
    const pkg = (o: Record<string, unknown>) => JSON.stringify(o);
    root = await makeTree({
      'node_modules/alpha/package.json': pkg({
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT',
        author: 'Ann Author <ann@e.com> (https://ann.dev)',
        repository: 'github:ann/alpha',
      }),
      'node_modules/alpha/LICENSE': 'MIT text',
      'node_modules/@sc/beta/package.json': pkg({
        name: '@sc/beta',
        version: '2.0.0',
        license: 'BSD-3-Clause',
        author: { name: 'Bob', email: 'b@e.com' },
        homepage: 'https://beta.dev',
      }),
      'node_modules/@sc/beta/licence.md': 'BSD text',
      'node_modules/gamma/package.json': pkg({
        name: 'gamma',
        version: '0.1.0',
        licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }],
        homepage: 'javascript:alert(1)',
      }),
      'node_modules/gamma/COPYING': 'copying',
      'node_modules/delta/package.json': pkg({ name: 'delta', version: '3.0.0' }),
      'node_modules/broken/package.json': '{ not json',
      'node_modules/isnull/package.json': 'null',
      'node_modules/noname/package.json': pkg({ version: 7, license: 'MIT' }),
      'node_modules/noname/LICENSE': 'x',
      'node_modules/alpha2/package.json': pkg({ name: 'alpha', version: '0.9.0', license: 'MIT' }),
      'node_modules/alpha2/LICENSE': 'x',
      'nested/node_modules/alpha/package.json': pkg({
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT',
      }),
      'nested/node_modules/alpha/LICENSE': 'x',
      'node_modules/isarray/package.json': '[]',
      'node_modules/isstring/package.json': '"x"',
      'node_modules/objlicense/package.json': pkg({
        name: 'objlicense',
        version: '1.0.0',
        license: { type: 'ISC' },
        licenses: [{ type: 'ISC' }, { type: 'MIT' }, 'bogus'],
      }),
      'node_modules/objlicense/LICENSE-MIT': 'x',
      '_data/attributions.yaml': [
        '- name: "0xProto Nerd Font"',
        '  version: 2.300',
        '  author: "0xType"',
        '  url: https://github.com/0xType/0xProto',
        '  license: OFL-1.1',
        '  licenseFile: OFL.txt',
        '- name: Escaper',
        '  licenseFile: ../../etc/passwd',
        '- { version: 1 }',
      ].join('\n'),
      '_data/licenses/OFL.txt': 'OFL text',
      'bad.yaml': 'key: value',
      'empty.yaml': '',
      'strings.yaml': '- just a string',
      'broken.yaml': '- name: [unclosed',
      'blank-licence.yaml':
        '- { name: Blank, license: MIT, licenseFile: "" }\n- { name: Num, licenseFile: [a] }',
      'missing-licence.yaml': '- { name: Ghost, license: MIT, licenseFile: nope.txt }',
      'node_modules/nolicence/package.json': pkg({ name: 'nolicence', version: '1.0.0' }),
      'node_modules/nolicence/license': 'MIT text',
      'node_modules/nofile/package.json': pkg({ name: 'nofile', version: '1.0.0' }),
      'overrides.yaml': '# comment\nnolicence: MIT\nnofile: ISC\nalpha: BSD-2-Clause\nstale: MIT\n',
      'overrides-bad-values.yaml': 'a:\n  - x\nb: ""\nc: [1]\nok: MIT\n',
      'overrides-list.yaml': '- nolicence\n',
      'overrides-scalar.yaml': 'just text',
    });
  });
  afterAll(() => removeTree(root));

  it('reads string author, shorthand repository and LICENSE', async () => {
    const { entry, warnings } = await readPackage(nm('alpha'));
    expect(entry).toEqual({
      name: 'alpha',
      version: '1.0.0',
      author: 'Ann Author',
      url: 'https://github.com/ann/alpha',
      license: 'MIT',
      licenseFile: nm('alpha/LICENSE'),
    });
    expect(warnings).toEqual([]);
  });

  it('reads object author, homepage and licence.md for scoped packages', async () => {
    const { entry } = await readPackage(nm('@sc/beta'));
    expect(entry).toMatchObject({
      name: '@sc/beta',
      author: 'Bob',
      url: 'https://beta.dev/',
      licenseFile: nm('@sc/beta/licence.md'),
    });
  });

  it('handles legacy licenses arrays, COPYING and unsafe homepages', async () => {
    const { entry } = await readPackage(nm('gamma'));
    expect(entry).toMatchObject({
      license: 'MIT OR Apache-2.0',
      url: null,
      licenseFile: nm('gamma/COPYING'),
    });
  });

  it('warns about missing licence and licence file', async () => {
    const { entry, warnings } = await readPackage(nm('delta'));
    expect(entry).toMatchObject({ license: 'UNKNOWN', author: '', url: null, licenseFile: null });
    expect(warnings).toEqual([
      'attributions: delta declares no licence',
      'attributions: delta ships no licence file',
    ]);
  });

  it('warns instead of crashing on unreadable packages', async () => {
    for (const dir of [nm('broken'), nm('missing')]) {
      const { entry, warnings } = await readPackage(dir);
      expect(entry).toBeNull();
      expect(warnings[0]).toMatch(/^attributions: cannot read package at /);
    }
  });

  it('reads extras, rejecting licence paths that escape and nameless entries', async () => {
    const licenses = path.join(root, '_data/licenses');
    const { entries, warnings } = await readExtras(
      path.join(root, '_data/attributions.yaml'),
      licenses,
    );
    expect(entries).toEqual([
      {
        name: '0xProto Nerd Font',
        version: '2.300',
        author: '0xType',
        url: 'https://github.com/0xType/0xProto',
        license: 'OFL-1.1',
        licenseFile: path.join(licenses, 'OFL.txt'),
      },
      {
        name: 'Escaper',
        version: '',
        author: '',
        url: null,
        license: 'UNKNOWN',
        licenseFile: null,
      },
    ]);
    expect(warnings).toEqual([
      `attributions: Escaper: licenseFile escapes ${licenses}; ignored`,
      'attributions: Escaper has no licence file',
      'attributions: extra #2 has no name; ignored',
    ]);
  });

  it.each(['isnull', 'isarray', 'isstring'])(
    'warns instead of crashing when package.json is not an object (%s)',
    async (dir) => {
      const { entry, warnings } = await readPackage(nm(dir));
      expect(entry).toBeNull();
      expect(warnings).toEqual([`attributions: ${nm(dir)}/package.json is not an object`]);
    },
  );

  it('falls back to the directory name and an empty version', async () => {
    const { entry } = await readPackage(nm('noname'));
    expect(entry).toMatchObject({ name: 'noname', version: '' });
  });

  it('treats an empty extras file as no extras, and non-object entries as nameless', async () => {
    expect(await readExtras(path.join(root, 'empty.yaml'), root)).toEqual({
      entries: [],
      warnings: [],
    });
    expect((await readExtras(path.join(root, 'strings.yaml'), root)).warnings).toEqual([
      'attributions: extra #0 has no name; ignored',
    ]);
  });

  it('keeps one entry per name@version and orders versions of one name', async () => {
    const { distributed: entries, warnings } = await collectAttributions({
      distributedDirs: [
        nm('alpha'),
        path.join(root, 'nested/node_modules/alpha'),
        nm('alpha2'),
        nm('broken'),
      ],
      builtWithDirs: [],
      extrasFile: path.join(root, 'nope.yaml'),
      licensesDir: root,
      overridesFile: path.join(root, 'nope.yaml'),
    });
    expect(entries.map((e) => `${e.name}@${e.version}`)).toEqual(['alpha@0.9.0', 'alpha@1.0.0']);
    expect(entries[1]?.licenseFile).toBe(nm('alpha/LICENSE'));
    expect(warnings).toHaveLength(1);
  });

  it('reads a legacy object licence, de-duplicating with the licenses array', async () => {
    const { entry, warnings } = await readPackage(nm('objlicense'));
    expect(entry).toMatchObject({
      license: 'ISC OR MIT',
      licenseFile: nm('objlicense/LICENSE-MIT'),
    });
    expect(warnings).toEqual([]);
  });

  it('warns about malformed extras YAML instead of aborting', async () => {
    const r = await readExtras(path.join(root, 'broken.yaml'), root);
    expect(r.entries).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^attributions: .*broken\.yaml: .*; ignored$/);
  });

  it('treats an empty or non-string licenseFile as absent, without a lookup warning', async () => {
    const r = await readExtras(
      path.join(root, 'blank-licence.yaml'),
      path.join(root, '_data/licenses'),
    );
    expect(r.entries).toMatchObject([
      { name: 'Blank', licenseFile: null },
      { name: 'Num', licenseFile: null },
    ]);
    expect(r.warnings).toEqual([
      'attributions: Blank has no licence file',
      'attributions: Num has no licence file',
    ]);
  });

  it('drops an extras licence file that does not exist', async () => {
    const licenses = path.join(root, '_data/licenses');
    const r = await readExtras(path.join(root, 'missing-licence.yaml'), licenses);
    expect(r.entries).toMatchObject([{ name: 'Ghost', licenseFile: null }]);
    expect(r.warnings).toEqual([
      'attributions: Ghost: licence file not found: nope.txt',
      'attributions: Ghost has no licence file',
    ]);
  });

  it('treats a missing extras file as empty and a non-list as a warning', async () => {
    expect(await readExtras(path.join(root, 'nope.yaml'), root)).toEqual({
      entries: [],
      warnings: [],
    });
    const r = await readExtras(path.join(root, 'bad.yaml'), root);
    expect(r.entries).toEqual([]);
    expect(r.warnings[0]).toMatch(/must be a YAML list/);
  });

  it('propagates other read errors for the extras file', async () => {
    await expect(readExtras(root, root)).rejects.toThrow(/EISDIR/);
  });

  it('collects, de-duplicates and sorts everything', async () => {
    const { distributed: entries } = await collectAttributions({
      distributedDirs: [nm('gamma'), nm('alpha'), nm('alpha'), nm('@sc/beta')],
      builtWithDirs: [],
      extrasFile: path.join(root, '_data/attributions.yaml'),
      licensesDir: path.join(root, '_data/licenses'),
      overridesFile: path.join(root, 'nope.yaml'),
    });
    expect(entries.map((e) => e.name)).toEqual([
      '@sc/beta',
      '0xProto Nerd Font',
      'alpha',
      'Escaper',
      'gamma',
    ]);
  });

  describe('sections', () => {
    const collect = (distributedDirs: string[], builtWithDirs: string[], extras = 'nope.yaml') =>
      collectAttributions({
        distributedDirs,
        builtWithDirs,
        extrasFile: path.join(root, extras),
        licensesDir: path.join(root, '_data/licenses'),
        overridesFile: path.join(root, 'nope.yaml'),
      });
    const names = (entries: readonly { name: string; version: string }[]) =>
      entries.map((e) => `${e.name}@${e.version}`);

    it('lists build-time packages apart from the distributed ones, each sorted', async () => {
      const r = await collect(
        [nm('gamma'), nm('alpha')],
        [nm('@sc/beta'), nm('alpha2'), nm('gamma')],
      );
      expect(names(r.distributed)).toEqual(['alpha@1.0.0', 'gamma@0.1.0']);
      expect(names(r.builtWith)).toEqual(['@sc/beta@2.0.0', 'alpha@0.9.0']);
    });

    it('drops a build-time package that is distributed under another path, too', async () => {
      const copy = path.join(root, 'nested/node_modules/alpha');
      const r = await collect([nm('alpha')], [copy, nm('@sc/beta')]);
      expect(names(r.builtWith)).toEqual(['@sc/beta@2.0.0']);
    });

    it('keeps extras in the distributed section only', async () => {
      const r = await collect([nm('alpha')], [nm('@sc/beta')], '_data/attributions.yaml');
      expect(r.distributed.map((e) => e.name)).toContain('0xProto Nerd Font');
      expect(r.builtWith.map((e) => e.name)).toEqual(['@sc/beta']);
    });

    it('warns about the build-time packages too, once per package', async () => {
      const r = await collect([nm('alpha')], [nm('alpha'), nm('nofile'), nm('broken')]);
      expect(r.warnings).toEqual([
        'attributions: nofile declares no licence',
        'attributions: nofile ships no licence file',
        expect.stringMatching(/^attributions: cannot read package at .*broken/),
      ]);
    });

    it('takes the licence file of the package a platform package belongs to', async () => {
      const r = await collectAttributions({
        distributedDirs: [],
        builtWithDirs: [nm('nofile'), nm('alpha')],
        licenseSources: new Map([[nm('nofile'), nm('alpha')]]),
        extrasFile: path.join(root, 'nope.yaml'),
        licensesDir: root,
        overridesFile: path.join(root, 'nope.yaml'),
      });
      expect(r.builtWith.find((e) => e.name === 'nofile')?.licenseFile).toBe(nm('alpha/LICENSE'));
      expect(r.warnings).toEqual(['attributions: nofile declares no licence']);
    });

    it("prefers a package's own licence file, and warns if neither has one", async () => {
      const own = await readPackage(nm('alpha'), new Map(), nm('gamma'));
      expect(own.entry?.licenseFile).toBe(nm('alpha/LICENSE'));
      const none = await readPackage(nm('nofile'), new Map(), nm('nofile'));
      expect(none.warnings).toContain('attributions: nofile ships no licence file');
    });

    it('applies a licence override to a build-time package and counts it as used', async () => {
      const r = await collectAttributions({
        distributedDirs: [],
        builtWithDirs: [nm('nolicence')],
        extrasFile: path.join(root, 'nope.yaml'),
        licensesDir: root,
        overridesFile: path.join(root, 'overrides.yaml'),
      });
      expect(r.builtWith).toMatchObject([{ name: 'nolicence', license: 'MIT' }]);
      expect(r.warnings).not.toContain('attributions: licence override for "nolicence" unused');
    });
  });

  describe('licence overrides', () => {
    const overridesFile = (name: string) => path.join(root, name);

    it('supplies the licence of a package that declares none and ships a licence file', async () => {
      const { overrides } = await readOverrides(overridesFile('overrides.yaml'));
      const { entry, warnings, overridden } = await readPackage(nm('nolicence'), overrides);
      expect(entry).toMatchObject({ name: 'nolicence', license: 'MIT' });
      expect(warnings).toEqual([]);
      expect(overridden).toBe('nolicence');
    });

    it('is ignored when the package declares its own licence', async () => {
      const { overrides } = await readOverrides(overridesFile('overrides.yaml'));
      const { entry, overridden } = await readPackage(nm('alpha'), overrides);
      expect(entry?.license).toBe('MIT');
      expect(overridden).toBeUndefined();
    });

    it('is ignored when the package ships no licence file', async () => {
      const { overrides } = await readOverrides(overridesFile('overrides.yaml'));
      const { entry, warnings, overridden } = await readPackage(nm('nofile'), overrides);
      expect(entry?.license).toBe('UNKNOWN');
      expect(warnings).toEqual([
        'attributions: nofile declares no licence',
        'attributions: nofile ships no licence file',
      ]);
      expect(overridden).toBeUndefined();
    });

    it('warns about every override that matched nothing', async () => {
      const { distributed: entries, warnings } = await collectAttributions({
        distributedDirs: [nm('nolicence'), nm('alpha'), nm('nofile')],
        builtWithDirs: [],
        extrasFile: overridesFile('nope.yaml'),
        licensesDir: root,
        overridesFile: overridesFile('overrides.yaml'),
      });
      expect(entries.find((e) => e.name === 'nolicence')?.license).toBe('MIT');
      expect(warnings.filter((w) => w.includes('override'))).toEqual([
        'attributions: licence override for "nofile" unused',
        'attributions: licence override for "alpha" unused',
        'attributions: licence override for "stale" unused',
      ]);
    });

    it('treats a missing or empty file as no overrides', async () => {
      for (const name of ['nope.yaml', 'empty.yaml']) {
        const r = await readOverrides(overridesFile(name));
        expect(r.overrides.size).toBe(0);
        expect(r.warnings).toEqual([]);
      }
    });

    it('warns instead of crashing on malformed files', async () => {
      const broken = await readOverrides(overridesFile('broken.yaml'));
      expect(broken.overrides.size).toBe(0);
      expect(broken.warnings[0]).toMatch(/^attributions: .*broken\.yaml: .*; ignored$/);
      for (const name of ['overrides-list.yaml', 'overrides-scalar.yaml']) {
        const r = await readOverrides(overridesFile(name));
        expect(r.overrides.size).toBe(0);
        expect(r.warnings).toEqual([
          `attributions: ${overridesFile(name)} must be a YAML mapping; ignored`,
        ]);
      }
    });

    it('keeps valid entries next to invalid values', async () => {
      const r = await readOverrides(overridesFile('overrides-bad-values.yaml'));
      expect([...r.overrides]).toEqual([['ok', 'MIT']]);
      expect(r.warnings).toEqual([
        'attributions: licence override for "a" must be a licence id; ignored',
        'attributions: licence override for "b" must be a licence id; ignored',
        'attributions: licence override for "c" must be a licence id; ignored',
      ]);
    });

    it('propagates other read errors', async () => {
      await expect(readOverrides(root)).rejects.toThrow(/EISDIR/);
    });
  });
});
