import { writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD, DATA, PUBLISH, ROOT, SITE_DEFAULT } from '../../src/lib/paths.ts';
import { main, parseCli, type StepResult } from '../../src/server/cli.ts';
import { doc, sink, trackedTrees } from '../helpers.ts';
import { fakeWatch } from './fake-watch.ts';
import { listening, request } from './http.ts';

const { tree } = trackedTrees();

/** Environment that points the serve process at the given publish (and build) directory. */
const dirsEnv = (publishDir: string, buildDir?: string) => ({
  PUBLISH_DIR: publishDir,
  ...(buildDir === undefined ? {} : { OUT_DIR: buildDir }),
});

const hasIpv6Loopback = await new Promise<boolean>((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.listen(0, '::1', () => probe.close(() => resolve(true)));
});

describe('parseCli', () => {
  it('defaults to port 8000 on loopback with watching, the default site and the default directories', () => {
    expect(parseCli([], {})).toEqual({
      port: 8000,
      host: '127.0.0.1',
      watch: true,
      drafts: false,
      siteDir: SITE_DEFAULT,
      buildDir: BUILD,
      publishDir: PUBLISH,
    });
  });

  it('reads every flag', () => {
    expect(
      parseCli(['--port', '0', '--host', '0.0.0.0', '--no-watch', '--drafts', '--site', 's'], {}),
    ).toEqual({
      port: 0,
      host: '0.0.0.0',
      watch: false,
      drafts: true,
      siteDir: path.resolve('s'),
      buildDir: BUILD,
      publishDir: PUBLISH,
    });
  });

  it('takes the settings the flags leave open from the environment', () => {
    expect(
      parseCli([], {
        PORT: '9000',
        DRAFTS: 'true',
        SITE_DIR: 'env-site',
        OUT_DIR: 'env-out',
        PUBLISH_DIR: 'env-pub',
      }),
    ).toMatchObject({
      port: 9000,
      drafts: true,
      siteDir: path.resolve('env-site'),
      buildDir: path.resolve('env-out'),
      publishDir: path.resolve('env-pub'),
    });
    expect(parseCli(['--port', '1', '--site', 'f'], { PORT: '9000', SITE_DIR: 'e' })).toMatchObject(
      { port: 1, siteDir: path.resolve('f') },
    );
  });

  it.each([
    [['--port', 'abc'], /--port must be an integer/],
    [['--port', ''], /--port must be an integer/],
    [['--port=-1'], /--port must be an integer/],
    [['--port', '1.5'], /--port must be an integer/],
    [['--port', '65536'], /--port must be an integer/],
    [['--host', ''], /--host needs an address/],
    [['--site', ''], /--site needs a directory/],
    [['--bogus'], /bogus/],
    [['--port'], /argument missing/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCli(argv, {})).toThrow(message);
  });

  it('rejects a bad PORT or DRAFTS from the environment', () => {
    expect(() => parseCli([], { PORT: 'x' })).toThrow(/PORT must be an integer/);
    expect(() => parseCli([], { DRAFTS: 'yes' })).toThrow(/DRAFTS must be/);
  });

  it('accepts the largest port', () => {
    expect(parseCli(['--port', '65535'], {}).port).toBe(65535);
  });
});

describe('serve main', () => {
  const running: (() => Promise<number>)[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(running.splice(0).map((stop) => stop()));
  });

  /** Start `main` and wait until it reports its URL. */
  async function start(
    argv: string[],
    {
      buildDir,
      publishDir: given,
      ...io
    }: Parameters<typeof main>[1] & { buildDir?: string; publishDir?: string } = {},
  ) {
    const publishDir =
      given ??
      (await tree({
        'index.html': '<html><head></head><body>hi</body></html>',
        '_csp.txt': "default-src 'self'\n",
      }));
    const stdout = sink();
    const stderr = sink();
    const abort = new AbortController();
    const done = main(['--port', '0', ...argv], {
      stdout,
      stderr,
      signal: abort.signal,
      ...io,
      env: dirsEnv(publishDir, buildDir),
    });
    running.push(async () => {
      abort.abort();
      return done;
    });
    await vi.waitFor(() => expect(stdout.text).toMatch(/at http:\/\/\S+:\d+\/\n/));
    const port = Number(/:(\d+)\/\n/.exec(stdout.text)?.[1]);
    return { port, stdout, stderr, abort, done, publishDir };
  }

  it('serves the publish directory with the published policy, prints its URL and stops on abort', async () => {
    const s = await start(['--no-watch']);
    expect(s.stdout.text).toBe(
      `serving ${path.relative(ROOT, s.publishDir)}/ at http://127.0.0.1:${s.port}/\n`,
    );
    const reply = await request(s.port, '/');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-security-policy']).toBe("default-src 'self'");
    expect(reply.text).not.toContain('reload.js');
    s.abort.abort();
    expect(await s.done).toBe(0);
    await expect(request(s.port, '/')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('binds to the address given by --host', async () => {
    const s = await start(['--no-watch', '--host', '127.0.0.1']);
    expect(s.stdout.text).toMatch(new RegExp(`at http://127\\.0\\.0\\.1:${s.port}/\\n$`));
    expect((await request(s.port, '/')).status).toBe(200);
  });

  it.skipIf(!hasIpv6Loopback)('prints an IPv6 address in brackets and listens on it', async () => {
    const s = await start(['--no-watch', '--host', '::1']);
    expect(s.stdout.text).toMatch(new RegExp(`at http://\\[::1\\]:${s.port}/\\n$`));
    expect((await fetch(`http://[::1]:${s.port}/`)).status).toBe(200);
  });

  it('returns 0 immediately when already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const publishDir = await tree({ '_csp.txt': 'x' });
    expect(
      await main(['--port', '0', '--no-watch'], {
        stdout: sink(),
        stderr: sink(),
        signal: abort.signal,
        env: dirsEnv(publishDir),
      }),
    ).toBe(0);
  });

  it('does not watch with --no-watch', async () => {
    const fake = fakeWatch();
    const s = await start(['--no-watch'], { watch: fake.watch });
    expect(fake.watchers).toEqual([]);
    expect((await request(s.port, '/__preview/reload.js')).status).toBe(404);
  });

  it('watches the site, sources and data, and enables reload', async () => {
    const fake = fakeWatch();
    const s = await start([], { watch: fake.watch });
    expect(fake.watchers.map((w) => [w.target, w.recursive])).toEqual([
      [SITE_DEFAULT, true],
      [path.join(ROOT, 'src'), true],
      [DATA, true],
    ]);
    expect((await request(s.port, '/')).text).toContain('reload.js');
    s.abort.abort();
    await s.done;
    expect(fake.watchers.every((w) => w.closed)).toBe(true);
  });

  /** A step runner that records calls and returns `results` in order (success when exhausted). */
  function steps(results: Partial<StepResult>[] = [], onRun?: (args: readonly string[]) => void) {
    const calls: (readonly string[])[] = [];
    const runStep = async (args: readonly string[]): Promise<StepResult> => {
      calls.push(args);
      onRun?.(args);
      return { code: 0, stderr: '', ...results[calls.length - 1] };
    };
    return { calls, runStep };
  }

  const nodeFile = (rel: string) => path.join(ROOT, rel);

  it('rebuilds in child processes, forwards the flags, reloads pages and reads the new policy', async () => {
    const fake = fakeWatch();
    const publishDir = await tree({ 'index.html': '<head></head>', '_csp.txt': 'old\n' });
    const { calls, runStep } = steps(
      [{ stderr: 'warning: b-warn\n' }, { stderr: 'warning: p-warn\n' }],
      (args) => {
        if (args[0]?.endsWith('publish.ts')) {
          // Synchronous, like a real child process that has exited before the server reads the policy.
          writeFileSync(path.join(publishDir, '_csp.txt'), 'new\n');
        }
      },
    );
    const s = await start(['--drafts', '--site', 'other'], {
      watch: fake.watch,
      publishDir,
      buildDir: '/build/dir',
      runStep,
    });
    expect(fake.watchers[0]?.target).toBe(path.resolve('other'));
    const events = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: s.port, path: '/__reload' }, (res) => {
        res.setEncoding('utf8');
        let text = '';
        res.on('data', (c: string) => {
          text += c;
          if (text.includes('retry')) {
            fake.change();
          }
          if (text.includes('event: build\ndata: 1\n\n')) {
            req.destroy();
            resolve(text);
          }
        });
      });
      req.on('error', reject);
    });
    expect(events).toContain('event: build\ndata: 0\n\n');
    expect(calls).toEqual([
      [
        nodeFile('src/generator/cli.ts'),
        '--out',
        '/build/dir',
        '--drafts',
        '--site',
        path.resolve('other'),
      ],
      [
        nodeFile('src/generator/publish.ts'),
        '--site',
        path.resolve('other'),
        '--build',
        '/build/dir',
        '--publish',
        publishDir,
      ],
    ]);
    expect(s.stderr.text).toBe('warning: b-warn\nwarning: p-warn\n');
    expect(s.stdout.text).toContain('rebuilt; reloading pages\n');
    expect((await request(s.port, '/')).headers['content-security-policy']).toBe('new');
  });

  it('rebuilds when site.yaml changes in the site directory', async () => {
    const fake = fakeWatch();
    const { calls, runStep } = steps();
    const s = await start([], { watch: fake.watch, runStep, buildDir: '/b' });
    fake.change(0, 'site.yaml');
    await vi.waitFor(() => expect(s.stdout.text).toContain('rebuilt'));
    expect(calls).toHaveLength(2);
  });

  it('omits --drafts when not given and always names the site', async () => {
    const fake = fakeWatch();
    const { calls, runStep } = steps();
    const s = await start([], { watch: fake.watch, runStep, buildDir: '/b' });
    fake.change();
    await vi.waitFor(() => expect(s.stdout.text).toContain('rebuilt'));
    expect(calls[0]).toEqual([
      nodeFile('src/generator/cli.ts'),
      '--out',
      '/b',
      '--site',
      SITE_DEFAULT,
    ]);
  });

  it.each([
    ['build', 0, 'error: blog/x/index.md: bad front matter\n'],
    ['publish', 1, 'error: manifest lists files missing\n'],
  ])(
    'keeps the previous site and policy and does not reload when the %s step fails',
    async (_name, failing, output) => {
      const fake = fakeWatch();
      const publishDir = await tree({
        'index.html': '<head></head>',
        '_csp.txt': "default-src 'self'\n",
      });
      const results: Partial<StepResult>[] = [];
      results[failing] = { code: 1, stderr: output };
      // Each step leaves a new policy behind, as a half-finished publish would.
      const { calls, runStep } = steps(results, () =>
        writeFileSync(path.join(publishDir, '_csp.txt'), "default-src 'none'\n"),
      );
      const s = await start([], { watch: fake.watch, runStep, publishDir });
      fake.change();
      await vi.waitFor(() => expect(s.stderr.text).toContain('rebuild failed'));
      expect(s.stderr.text).toBe(
        `error: rebuild failed, serving the previous build: ${output.trim()}\n`,
      );
      expect(calls).toHaveLength(failing + 1);
      expect(s.stdout.text).not.toContain('rebuilt');
      const reply = await request(s.port, '/');
      expect(reply.status).toBe(200);
      expect(reply.headers['content-security-policy']).toBe("default-src 'self'");
    },
  );

  it('reports the exit code when a failing step printed nothing', async () => {
    const fake = fakeWatch();
    const s = await start([], { watch: fake.watch, runStep: steps([{ code: 3 }]).runStep });
    fake.change();
    await vi.waitFor(() => expect(s.stderr.text).toContain('exit code 3'));
  });

  it('reports a step that cannot be started and keeps serving', async () => {
    const fake = fakeWatch();
    const s = await start([], {
      watch: fake.watch,
      runStep: async () => {
        throw new Error('spawn ENOMEM');
      },
    });
    fake.change();
    await vi.waitFor(() => expect(s.stderr.text).toContain('spawn ENOMEM'));
    expect((await request(s.port, '/')).status).toBe(200);
  });

  it('never runs two steps at once and follows changes made during a rebuild with one more', async () => {
    const fake = fakeWatch();
    let active = 0;
    let peak = 0;
    let started = 0;
    const gate: (() => void)[] = [];
    const runStep = async (): Promise<StepResult> => {
      started++;
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => gate.push(resolve));
      active--;
      return { code: 0, stderr: '' };
    };
    const s = await start([], { watch: fake.watch, runStep });
    const release = async () => {
      await vi.waitFor(() => expect(gate.length).toBeGreaterThan(0));
      gate.shift()?.();
    };
    fake.change();
    await vi.waitFor(() => expect(started).toBe(1));
    fake.change();
    fake.change();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(started).toBe(1);
    await release();
    await release();
    await release();
    await release();
    await vi.waitFor(() => expect(s.stdout.text.match(/rebuilt/g)).toHaveLength(2));
    expect(started).toBe(4);
    expect(peak).toBe(1);
  });

  it('logs watcher errors and keeps serving', async () => {
    const fake = fakeWatch();
    const s = await start([], { watch: fake.watch });
    fake.fail(1, new Error('EACCES: watch'));
    expect(s.stderr.text).toBe('error: EACCES: watch\n');
    expect((await request(s.port, '/')).status).toBe(200);
  });

  it('ends open event streams on shutdown', async () => {
    const fake = fakeWatch();
    const s = await start([], { watch: fake.watch });
    let opened = () => {};
    const isOpen = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const ended = new Promise<void>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: s.port, path: '/__reload' }, (res) => {
        res.once('data', opened);
        res.on('data', () => undefined);
        res.on('end', resolve);
      });
      req.on('error', reject);
    });
    await isOpen;
    s.abort.abort();
    await ended;
    expect(await s.done).toBe(0);
  });

  it('rebuilds with the real generator processes: new content is published and served', async () => {
    const fake = fakeWatch();
    const content = await tree({
      'site.yaml':
        'title: Site\nbaseUrl: https://example.com\ncopyright: { holder: H, rights: R }\nsections: {}\nmenu: []\nhome: []\n',
      'index.md': doc('title: Welcome\npublished: 2026-01-01', 'First.\n'),
      'resume/index.md': doc('title: Resume\npublished: 2026-01-01'),
    });
    const buildDir = await tree();
    const publishDir = await tree({ '.generated': '', 'index.html': 'seed', '_csp.txt': 'old\n' });
    const s = await start(['--site', content], { watch: fake.watch, buildDir, publishDir });
    expect((await request(s.port, '/')).text).toBe('seed');
    fake.change();
    await vi.waitFor(() => expect(s.stdout.text).toContain('rebuilt'), { timeout: 90_000 });
    expect(s.stderr.text).not.toContain('error');
    const page = await request(s.port, '/');
    expect(page.text).toContain('First.');
    expect(page.text).toContain('/__preview/reload.js');
    expect(page.headers['content-security-policy']).toMatch(/script-src 'self' 'sha256-[\w+/=]+'/);
    expect(await fs.readFile(path.join(publishDir, '_csp.txt'), 'utf8')).toContain('sha256-');
    await fs.writeFile(path.join(content, 'index.md'), '---\ntitle: Broken\n');
    fake.change();
    await vi.waitFor(() => expect(s.stderr.text).toContain('rebuild failed'), { timeout: 90_000 });
    expect((await request(s.port, '/')).text).toContain('First.');
  }, 200_000);

  it('returns 2 with usage on a bad flag', async () => {
    const stderr = sink();
    expect(await main(['--port', 'x'], { stdout: sink(), stderr, env: {} })).toBe(2);
    expect(stderr.text).toMatch(/^error: --port must be .*\nusage: serve \[--port <n>\]/);
  });

  it('returns 1 telling to publish first when there is no published site', async () => {
    const stderr = sink();
    const empty = await tree({});
    expect(await main(['--port', '0'], { stdout: sink(), stderr, env: dirsEnv(empty) })).toBe(1);
    expect(stderr.text).toMatch(/^error: no published site in .*ENOENT.*; run make publish\n$/s);
  });

  it('returns 1 when the port is taken, and does not start watching', async () => {
    const blocker = await listening(() => undefined);
    const fake = fakeWatch();
    const stderr = sink();
    const publishDir = await tree({ '_csp.txt': 'x' });
    const code = await main(['--port', String(blocker.port)], {
      stdout: sink(),
      stderr,
      env: dirsEnv(publishDir),
      watch: fake.watch,
    });
    await blocker.close();
    expect(code).toBe(1);
    expect(stderr.text).toMatch(/EADDRINUSE/);
    expect(fake.watchers).toEqual([]);
  });

  it('returns 1 when the server does not report a TCP address, and closes it', async () => {
    vi.spyOn(http.Server.prototype, 'address').mockReturnValue('/run/serve.sock');
    const close = vi.spyOn(http.Server.prototype, 'close');
    const fake = fakeWatch();
    const stderr = sink();
    const publishDir = await tree({ '_csp.txt': 'x' });
    const code = await main(['--port', '0'], {
      stdout: sink(),
      stderr,
      env: dirsEnv(publishDir),
      watch: fake.watch,
    });
    expect(code).toBe(1);
    expect(stderr.text).toBe('error: server is not listening on a TCP address\n');
    expect(close).toHaveBeenCalledTimes(1);
    expect(fake.watchers).toEqual([]);
  });

  it('returns 1 and closes the server when a path cannot be watched', async () => {
    const close = vi.spyOn(http.Server.prototype, 'close');
    const stderr = sink();
    const publishDir = await tree({ '_csp.txt': 'x' });
    const code = await main(['--port', '0'], {
      stdout: sink(),
      stderr,
      env: dirsEnv(publishDir),
      watch: () => {
        throw new Error('ENOENT: no such directory');
      },
    });
    expect(code).toBe(1);
    expect(stderr.text).toBe('error: ENOENT: no such directory\n');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
