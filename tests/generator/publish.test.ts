import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePublishManifest } from '../../src/generator/manifest.ts';
import { main, parseCli, publish } from '../../src/generator/publish.ts';
import { contentSecurityPolicy } from '../../src/lib/http-policy.ts';
import { BUILD, PUBLISH, ROOT, SITE_DEFAULT, SRC } from '../../src/lib/paths.ts';
import { createHandler } from '../../src/server/serve.ts';
import { trackedTrees } from '../helpers.ts';
import { listening, request } from '../server/http.ts';

const { tree, outFor } = trackedTrees();

const HASH = 'sha256-abc=';
const manifestOf = (files: readonly string[], csp: unknown = { scriptHashes: [HASH] }) =>
  JSON.stringify({ files, csp, pages: [] });

/** A build directory holding `files` and a manifest listing `listed` (default: all of them). */
async function buildDirWith(files: Record<string, string>, listed = Object.keys(files)) {
  const dir = await tree({ ...files, 'manifest.json': manifestOf(listed) });
  return { buildDir: dir, publishDir: outFor(dir) };
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

describe('publish', () => {
  it('copies exactly the listed files, plus the host configuration, and not the manifest', async () => {
    const dirs = await buildDirWith({
      'index.html': 'home',
      'blog/a/index.html': 'a',
      'assets/x.js': 'js',
    });
    const result = await publish(dirs);
    expect(result.files).toEqual(['assets/x.js', 'blog/a/index.html', 'index.html']);
    expect(await listFiles(dirs.publishDir)).toEqual([
      '.generated',
      '_csp.txt',
      '_headers.txt',
      'assets/x.js',
      'blog/a/index.html',
      'index.html',
    ]);
    expect(await fs.readFile(path.join(dirs.publishDir, 'blog/a/index.html'), 'utf8')).toBe('a');
    expect(result.warnings).toEqual([]);
  });

  it('writes the policy and the header rules from the manifest hashes', async () => {
    const dirs = await buildDirWith({ 'index.html': 'x' });
    const { csp } = await publish(dirs);
    const policy = contentSecurityPolicy({ scriptHashes: [HASH] });
    expect(csp).toBe(policy);
    expect(await fs.readFile(path.join(dirs.publishDir, '_csp.txt'), 'utf8')).toBe(`${policy}\n`);
    const headers = await fs.readFile(path.join(dirs.publishDir, '_headers.txt'), 'utf8');
    expect(headers).toContain(`Content-Security-Policy: ${policy}`);
    expect(headers).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000');
  });

  it('cleans the publish directory first', async () => {
    const dirs = await buildDirWith({ 'index.html': 'new' });
    await fs.mkdir(path.join(dirs.publishDir, 'old'), { recursive: true });
    await fs.writeFile(path.join(dirs.publishDir, '.generated'), '');
    await fs.writeFile(path.join(dirs.publishDir, 'old/stale.html'), 'old');
    await publish(dirs);
    expect(await exists(path.join(dirs.publishDir, 'old'))).toBe(false);
    expect(await exists(path.join(dirs.publishDir, 'index.html'))).toBe(true);
  });

  it('skips build files that are not in the manifest and warns about each', async () => {
    const dirs = await buildDirWith({ 'index.html': 'a', 'stray.txt': 's', 'd/other.html': 'o' }, [
      'index.html',
    ]);
    const result = await publish(dirs);
    expect(result.warnings).toEqual([
      'd/other.html is in the build but not in the manifest; not published',
      'stray.txt is in the build but not in the manifest; not published',
    ]);
    expect(await exists(path.join(dirs.publishDir, 'stray.txt'))).toBe(false);
  });

  it('fails when a listed file is missing or not a regular file, naming it, and keeps the old publish', async () => {
    const dirs = await buildDirWith({ 'index.html': 'a' }, ['index.html', 'gone.html', 'dir']);
    await fs.mkdir(path.join(dirs.buildDir, 'dir'));
    await fs.mkdir(dirs.publishDir, { recursive: true });
    await fs.writeFile(path.join(dirs.publishDir, '.generated'), '');
    await fs.writeFile(path.join(dirs.publishDir, 'previous.html'), 'p');
    await expect(publish(dirs)).rejects.toThrow(/missing or not regular files: dir, gone\.html/);
    expect(await exists(path.join(dirs.publishDir, 'previous.html'))).toBe(true);
  });

  it.each(['../escape.html', '/etc/passwd', 'a/../../escape.html'])(
    'rejects a manifest entry that leaves the directories: %s',
    async (entry) => {
      const dirs = await buildDirWith({ 'index.html': 'a' }, ['index.html', entry]);
      await expect(publish(dirs)).rejects.toThrow(RangeError);
      expect(await exists(dirs.publishDir)).toBe(false);
    },
  );

  it.each(['manifest.json', '_headers.txt', '_csp.txt', '.generated'])(
    'refuses a manifest that lists the reserved file %s',
    async (name) => {
      const dirs = await buildDirWith({ 'index.html': 'a', [name]: 'x' }, ['index.html', name]);
      await expect(publish(dirs)).rejects.toThrow(`reserved files: ${name}`);
    },
  );

  it('lists duplicate manifest entries once', async () => {
    const dirs = await buildDirWith({ 'a.html': 'a' }, ['a.html', 'a.html']);
    expect((await publish(dirs)).files).toEqual(['a.html']);
  });

  it('refuses a publish directory that is protected or overlaps the build directory', async () => {
    const dirs = await buildDirWith({ 'index.html': 'a' });
    for (const publishDir of [SRC, ROOT, dirs.buildDir, path.join(dirs.buildDir, 'out')]) {
      await expect(publish({ buildDir: dirs.buildDir, publishDir })).rejects.toThrow(RangeError);
    }
    const inside = await tree({ 'manifest.json': manifestOf([]) });
    await expect(publish({ buildDir: path.dirname(inside), publishDir: inside })).rejects.toThrow(
      RangeError,
    );
    expect(await exists(path.join(dirs.buildDir, 'index.html'))).toBe(true);
  });

  it('reports a missing manifest with the file it looked for', async () => {
    const dir = await tree({ 'index.html': 'a' });
    await expect(publish({ buildDir: dir, publishDir: outFor(dir) })).rejects.toThrow(
      /cannot use .*manifest\.json: ENOENT/,
    );
  });

  it.each([
    ['not JSON', '{oops', /cannot use .*manifest\.json: .*JSON/],
    ['not an object', '[]', /manifest is not an object/],
    ['no files', '{"csp":{"scriptHashes":[]}}', /manifest\.files must be an array of strings/],
    [
      'files with a non-string',
      '{"files":["a",1],"csp":{"scriptHashes":[]}}',
      /manifest\.files must be an array of strings/,
    ],
    ['no csp', '{"files":[]}', /manifest\.csp\.scriptHashes must be an array of strings/],
    [
      'bad hashes',
      '{"files":[],"csp":{"scriptHashes":"x"}}',
      /manifest\.csp\.scriptHashes must be an array of strings/,
    ],
  ])('rejects a malformed manifest: %s', async (_name, text, message) => {
    const dir = await tree({ 'manifest.json': text });
    await expect(publish({ buildDir: dir, publishDir: outFor(dir) })).rejects.toThrow(message);
  });
});

describe('publish atomicity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Directories next to `dir` that staging or swapping would leave behind. */
  async function leftovers(dir: string): Promise<string[]> {
    const base = path.basename(dir);
    return (await fs.readdir(path.dirname(dir))).filter(
      (n) => n.startsWith(`${base}.tmp-`) || n.startsWith(`${base}.old-`),
    );
  }

  /** A published site holding `index.html: old`. */
  async function published(files: Record<string, string>) {
    const dirs = await buildDirWith(files);
    await publish({ buildDir: dirs.buildDir, publishDir: dirs.publishDir });
    return dirs;
  }

  it('leaves the old publish untouched and no staging directory when a copy fails midway', async () => {
    const dirs = await published({ 'index.html': 'old', 'a.html': 'old a' });
    await fs.writeFile(path.join(dirs.buildDir, 'index.html'), 'new');
    await fs.writeFile(path.join(dirs.buildDir, 'a.html'), 'new a');
    const copy = fs.copyFile.bind(fs);
    let calls = 0;
    vi.spyOn(fs, 'copyFile').mockImplementation(async (from, to) => {
      calls++;
      if (calls === 2) {
        throw new Error('ENOSPC: no space left');
      }
      return copy(from, to);
    });
    await expect(publish(dirs)).rejects.toThrow('ENOSPC');
    expect(calls).toBe(2);
    expect(await fs.readFile(path.join(dirs.publishDir, 'index.html'), 'utf8')).toBe('old');
    expect(await fs.readFile(path.join(dirs.publishDir, 'a.html'), 'utf8')).toBe('old a');
    expect(await leftovers(dirs.publishDir)).toEqual([]);
  });

  it('restores the old publish when moving the new one into place fails', async () => {
    const dirs = await published({ 'index.html': 'old' });
    await fs.writeFile(path.join(dirs.buildDir, 'index.html'), 'new');
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === dirs.publishDir && String(from).includes('.tmp-')) {
        throw new Error('EXDEV: cross-device link');
      }
      return rename(from, to);
    });
    await expect(publish(dirs)).rejects.toThrow('EXDEV');
    expect(await fs.readFile(path.join(dirs.publishDir, 'index.html'), 'utf8')).toBe('old');
    expect(await leftovers(dirs.publishDir)).toEqual([]);
  });

  it('propagates a failure to set the old publish aside, leaving it in place', async () => {
    const dirs = await published({ 'index.html': 'old' });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from) === dirs.publishDir) {
        throw Object.assign(new Error('EBUSY: busy'), { code: 'EBUSY', syscall: 'rename' });
      }
      return rename(from, to);
    });
    await expect(publish(dirs)).rejects.toThrow('EBUSY');
    expect(await fs.readFile(path.join(dirs.publishDir, 'index.html'), 'utf8')).toBe('old');
    expect(await leftovers(dirs.publishDir)).toEqual([]);
  });

  it('serves complete old files throughout the copy and the new ones afterwards', async () => {
    const dirs = await published({ 'index.html': 'old', 'blog/index.html': 'old blog' });
    await fs.writeFile(path.join(dirs.buildDir, 'index.html'), 'new');
    await fs.writeFile(path.join(dirs.buildDir, 'blog/index.html'), 'new blog');
    const server = await listening(createHandler({ root: dirs.publishDir, csp: () => '' }));
    try {
      const seen: [number, string][] = [];
      const copy = fs.copyFile.bind(fs);
      vi.spyOn(fs, 'copyFile').mockImplementation(async (from, to) => {
        for (const url of ['/', '/blog/']) {
          const reply = await request(server.port, url);
          seen.push([reply.status, reply.text]);
        }
        return copy(from, to);
      });
      await publish(dirs);
      expect(seen).toHaveLength(4);
      expect(seen).toEqual([
        [200, 'old'],
        [200, 'old blog'],
        [200, 'old'],
        [200, 'old blog'],
      ]);
      expect((await request(server.port, '/')).text).toBe('new');
      expect((await request(server.port, '/blog/')).text).toBe('new blog');
    } finally {
      await server.close();
    }
  });

  it('refuses to replace a non-empty publish directory it did not generate', async () => {
    const dirs = await buildDirWith({ 'index.html': 'a' });
    await fs.mkdir(dirs.publishDir);
    await fs.writeFile(path.join(dirs.publishDir, 'precious.txt'), 'mine');
    await expect(publish(dirs)).rejects.toThrow(/refusing to replace .*\.generated/);
    expect(await fs.readFile(path.join(dirs.publishDir, 'precious.txt'), 'utf8')).toBe('mine');
    expect(await leftovers(dirs.publishDir)).toEqual([]);
  });

  it('replaces an empty publish directory, and sweeps a stale set-aside directory', async () => {
    const dirs = await buildDirWith({ 'index.html': 'a' });
    await fs.mkdir(dirs.publishDir);
    await fs.mkdir(`${dirs.publishDir}.old-${process.pid}`);
    await publish(dirs);
    expect(await fs.readFile(path.join(dirs.publishDir, 'index.html'), 'utf8')).toBe('a');
    expect(await leftovers(dirs.publishDir)).toEqual([]);
  });

  it('writes the generated marker, which neither the manifest nor stray warnings mention', async () => {
    const dirs = await buildDirWith({ 'index.html': 'a', '.generated': '' }, ['index.html']);
    const result = await publish(dirs);
    expect(result.warnings).toEqual([]);
    expect(await exists(path.join(dirs.publishDir, '.generated'))).toBe(true);
  });
});

describe('publish timestamps', () => {
  const OLD = new Date('2020-01-02T03:04:05Z');
  const mtime = async (dir: string, rel: string) =>
    Math.floor((await fs.stat(path.join(dir, rel))).mtimeMs);

  /** Publish once, then age every published file so a later copy cannot be mistaken for it. */
  async function publishedAndAged(files: Record<string, string>) {
    const dirs = await buildDirWith(files);
    await publish(dirs);
    for (const f of await listFiles(dirs.publishDir)) {
      await fs.utimes(path.join(dirs.publishDir, f), OLD, OLD);
    }
    return dirs;
  }

  it('keeps the modification time of identical files and stamps changed and new ones', async () => {
    const dirs = await publishedAndAged({ 'a.html': 'same', 'b.html': 'old', 'c/d.html': 'same' });
    await fs.writeFile(path.join(dirs.buildDir, 'b.html'), 'new');
    await fs.writeFile(path.join(dirs.buildDir, 'e.html'), 'added');
    await fs.writeFile(
      path.join(dirs.buildDir, 'manifest.json'),
      manifestOf(['a.html', 'b.html', 'c/d.html', 'e.html']),
    );
    const result = await publish(dirs);
    const old = Math.floor(OLD.getTime());
    expect(await mtime(dirs.publishDir, 'a.html')).toBe(old);
    expect(await mtime(dirs.publishDir, 'c/d.html')).toBe(old);
    expect(await mtime(dirs.publishDir, 'b.html')).toBeGreaterThan(old);
    expect(await mtime(dirs.publishDir, 'e.html')).toBeGreaterThan(old);
    expect(result).toMatchObject({ changed: 2, unchanged: 2 });
  });

  it('keeps the time of the host configuration and the marker while the policy is unchanged', async () => {
    const dirs = await publishedAndAged({ 'index.html': 'x' });
    await publish(dirs);
    for (const f of ['_csp.txt', '_headers.txt', '.generated']) {
      expect(await mtime(dirs.publishDir, f), f).toBe(OLD.getTime());
    }
  });

  it('stamps the host configuration when the policy changes', async () => {
    const dirs = await publishedAndAged({ 'index.html': 'x' });
    await fs.writeFile(
      path.join(dirs.buildDir, 'manifest.json'),
      manifestOf(['index.html'], { scriptHashes: ['sha256-other='] }),
    );
    await publish(dirs);
    expect(await mtime(dirs.publishDir, '_csp.txt')).toBeGreaterThan(OLD.getTime());
    expect(await mtime(dirs.publishDir, 'index.html')).toBe(OLD.getTime());
  });

  it('counts every file as changed on the first publish', async () => {
    const dirs = await buildDirWith({ 'a.html': 'a', 'b.html': 'b' });
    expect(await publish(dirs)).toMatchObject({ changed: 2, unchanged: 0 });
  });

  it('treats a directory in the old place of a file as changed', async () => {
    const dirs = await buildDirWith({ 'a.html': 'a' });
    await publish(dirs);
    await fs.rm(path.join(dirs.publishDir, 'a.html'));
    await fs.mkdir(path.join(dirs.publishDir, 'a.html'));
    expect(await publish(dirs)).toMatchObject({ changed: 1, unchanged: 0 });
  });

  it('does not take over the time of a file whose content differs only in size', async () => {
    const dirs = await publishedAndAged({ 'a.html': 'abc' });
    await fs.writeFile(path.join(dirs.buildDir, 'a.html'), 'abcd');
    await publish(dirs);
    expect(await mtime(dirs.publishDir, 'a.html')).toBeGreaterThan(OLD.getTime());
  });

  it('fails, keeping the previous publish, when a previous file cannot be inspected', async () => {
    const dirs = await publishedAndAged({ a: 'a file' });
    await fs.rm(path.join(dirs.buildDir, 'a'));
    await fs.mkdir(path.join(dirs.buildDir, 'a'));
    await fs.writeFile(path.join(dirs.buildDir, 'a/b.html'), 'b');
    await fs.writeFile(path.join(dirs.buildDir, 'manifest.json'), manifestOf(['a/b.html']));
    await expect(publish(dirs)).rejects.toThrow(/ENOTDIR/);
    expect(await fs.readFile(path.join(dirs.publishDir, 'a'), 'utf8')).toBe('a file');
    expect(await exists(`${dirs.publishDir}.tmp-${process.pid}`)).toBe(false);
  });

  it('leaves the previous publish untouched when the new one fails', async () => {
    const dirs = await publishedAndAged({ 'a.html': 'a' });
    await fs.writeFile(path.join(dirs.buildDir, 'manifest.json'), manifestOf(['gone.html']));
    await expect(publish(dirs)).rejects.toThrow(/missing/);
    expect(await mtime(dirs.publishDir, 'a.html')).toBe(OLD.getTime());
    expect(await fs.readFile(path.join(dirs.publishDir, 'a.html'), 'utf8')).toBe('a');
  });
});

describe('parsePublishManifest', () => {
  it('keeps only what publishing needs', () => {
    expect(
      parsePublishManifest('{"files":["a"],"csp":{"scriptHashes":["h"],"extra":1},"pages":[]}'),
    ).toEqual({ files: ['a'], csp: { scriptHashes: ['h'] } });
  });
});

describe('publish cli', () => {
  const sink = () => {
    const s = {
      text: '',
      write(t: string) {
        s.text += t;
      },
    };
    return s;
  };

  it('parses directory flags to absolute paths and defaults the rest', () => {
    expect(parseCli([], {})).toEqual({
      siteDir: SITE_DEFAULT,
      buildDir: BUILD,
      publishDir: PUBLISH,
    });
    expect(parseCli(['--site', 's', '--build', 'b', '--publish', 'p'], {})).toEqual({
      siteDir: path.resolve('s'),
      buildDir: path.resolve('b'),
      publishDir: path.resolve('p'),
    });
  });

  it('takes directories from SITE_DIR, OUT_DIR and PUBLISH_DIR, flags winning', () => {
    const env = { SITE_DIR: 'es', OUT_DIR: 'eo', PUBLISH_DIR: 'ep' };
    expect(parseCli([], env)).toEqual({
      siteDir: path.resolve('es'),
      buildDir: path.resolve('eo'),
      publishDir: path.resolve('ep'),
    });
    expect(parseCli(['--build', 'b'], env).buildDir).toBe(path.resolve('b'));
  });

  it('publishes, relays warnings and reports the count', async () => {
    const stdout = sink();
    const stderr = sink();
    const code = await main(['--publish', path.join(ROOT, 'pub')], {
      stdout,
      stderr,
      env: {},
      run: async () => ({ files: ['a', 'b'], changed: 1, unchanged: 1, csp: '', warnings: ['w'] }),
    });
    expect(code).toBe(0);
    expect(stderr.text).toBe('warning: w\n');
    expect(stdout.text).toBe('published 2 files into pub/ (1 changed, 1 unchanged)\n');
  });

  it('reports the default directory', async () => {
    const stdout = sink();
    await main([], {
      stdout,
      stderr: sink(),
      env: {},
      run: async () => ({ files: [], changed: 0, unchanged: 0, csp: '', warnings: [] }),
    });
    expect(stdout.text).toBe('published 0 files into publish/ (0 changed, 0 unchanged)\n');
  });

  it('returns 1 with the error when publishing fails', async () => {
    const stderr = sink();
    const code = await main([], {
      stdout: sink(),
      stderr,
      env: {},
      run: async () => {
        throw new Error('manifest lists files missing from the build: x');
      },
    });
    expect(code).toBe(1);
    expect(stderr.text).toBe('error: manifest lists files missing from the build: x\n');
  });

  it.each([['--bogus'], ['--build', ''], ['--publish']])(
    'returns 2 with usage for %s',
    async (...argv) => {
      const stderr = sink();
      const code = await main(argv, {
        stdout: sink(),
        stderr,
        env: {},
        run: async () => ({ files: [], changed: 0, unchanged: 0, csp: '', warnings: [] }),
      });
      expect(code).toBe(2);
      expect(stderr.text).toMatch(
        /^error: .*\nusage: publish \[--site <dir>\] \[--build <dir>\] \[--publish <dir>\]\n$/,
      );
    },
  );
});
