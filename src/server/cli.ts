import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import { type AddressInfo, isIPv6 } from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  dirFlag,
  type Env,
  interruptSignal,
  type Output,
  parseOrUsage,
  resolveSettings,
  runIfMain,
} from '../lib/cli.ts';
import { CSP_FILE } from '../lib/http-policy.ts';
import { DATA, ROOT } from '../lib/paths.ts';
import { errorMessage } from '../shared/guards.ts';
import { createReloadChannel } from './reload.ts';
import { createHandler } from './serve.ts';
import { startWatch, type Watcher, type WatchFn, type WatchTarget } from './watch.ts';

const USAGE = `usage: serve [--port <n>] [--host <addr>] [--no-watch] [--drafts] [--site <dir>]
serve needs a successful publish first; rebuild failures keep the last good site.
With watching, each open page holds one event stream; browsers allow 6 connections per origin over HTTP/1.1, so keep at most 5 tabs open.`;
const GENERATOR = path.join(ROOT, 'src', 'generator');

/** Outcome of one child process. */
export interface StepResult {
  readonly code: number | null;
  readonly stderr: string;
}

/** Runs `node <args>` in the project root. */
export type RunStep = (args: readonly string[]) => Promise<StepResult>;

const runNode: RunStep = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });

export interface ServeOptions {
  readonly port: number;
  readonly host: string;
  readonly watch: boolean;
  readonly drafts: boolean;
  readonly siteDir: string;
  /** Directory the build step writes (`OUT_DIR`). */
  readonly buildDir: string;
  /** Directory that is published and served (`PUBLISH_DIR`). */
  readonly publishDir: string;
}

interface Io {
  readonly stdout?: Output;
  readonly stderr?: Output;
  /** Ends the server when aborted. */
  readonly signal?: AbortSignal;
  readonly env?: Env;
  /** Runs the build and publish processes. */
  readonly runStep?: RunStep;
  readonly watch?: WatchFn;
}

/** Server options from CLI arguments and environment. @throws on unknown or malformed flags or variables */
export function parseCli(argv: readonly string[], env: Env = process.env): ServeOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      port: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      'no-watch': { type: 'boolean', default: false },
      drafts: { type: 'boolean' },
      site: { type: 'string' },
    },
  });
  if (values.host === '') {
    throw new Error('--host needs an address');
  }
  const { site, out, publish, port, drafts } = resolveSettings(
    { port: values.port, drafts: values.drafts, site: dirFlag('--site', values.site) },
    env,
  );
  return {
    port,
    host: values.host,
    watch: !values['no-watch'],
    drafts,
    siteDir: site,
    buildDir: out,
    publishDir: publish,
  };
}

/** Start listening; resolves with the bound address. */
const listen = (server: http.Server, port: number, host: string): Promise<AddressInfo> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('server is not listening on a TCP address'));
      } else {
        resolve(address);
      }
    });
  });

const close = (server: http.Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

/** Policy read from the published `_csp.txt`. @throws Error if there is no published site */
async function readCsp(publishDir: string): Promise<string> {
  try {
    return (await fs.readFile(path.join(publishDir, CSP_FILE), 'utf8')).trim();
  } catch (err) {
    throw new Error(`no published site in ${publishDir} (${errorMessage(err)}); run make publish`);
  }
}

/**
 * `node src/server/cli.ts [--port <n>] [--host <addr>] [--no-watch] [--drafts] [--site <dir>]`
 *
 * Serves the publish directory and, unless `--no-watch`, rebuilds and republishes on source changes and
 * reloads open pages. Runs until `signal` aborts.
 * @returns exit code: 0 clean shutdown, 1 failed to start, 2 usage error
 */
export async function main(
  argv: readonly string[],
  {
    stdout = process.stdout,
    stderr = process.stderr,
    signal = new AbortController().signal,
    env = process.env,
    runStep = runNode,
    watch,
  }: Io = {},
): Promise<number> {
  const options = parseOrUsage(() => parseCli(argv, env), USAGE, stderr);
  if (options === undefined) {
    return 2;
  }
  const { buildDir, publishDir, siteDir } = options;
  const reload = options.watch ? createReloadChannel() : undefined;
  let csp = '';
  const server = http.createServer(
    createHandler({ root: publishDir, csp: () => csp, ...(reload ? { reload } : {}) }),
  );
  let watcher: Watcher | undefined;
  let bound: AddressInfo;
  try {
    csp = await readCsp(publishDir);
    bound = await listen(server, options.port, options.host);
    if (options.watch) {
      const steps = [
        [
          path.join(GENERATOR, 'cli.ts'),
          '--out',
          buildDir,
          ...(options.drafts ? ['--drafts'] : []),
          '--site',
          siteDir,
        ],
        [
          path.join(GENERATOR, 'publish.ts'),
          '--site',
          siteDir,
          '--build',
          buildDir,
          '--publish',
          publishDir,
        ],
      ];
      const targets: WatchTarget[] = [
        { path: siteDir, recursive: true },
        { path: path.join(ROOT, 'src'), recursive: true },
        { path: DATA, recursive: true },
      ];
      watcher = startWatch({
        targets,
        rebuild: async () => {
          try {
            for (const step of steps) {
              const { code, stderr: output } = await runStep(step);
              if (code !== 0) {
                throw new Error(output.trim() || `exit code ${code}`);
              }
              stderr.write(output);
            }
            csp = await readCsp(publishDir);
          } catch (err) {
            throw new Error(`rebuild failed, serving the previous build: ${errorMessage(err)}`);
          }
        },
        onBuilt: () => {
          stdout.write('rebuilt; reloading pages\n');
          reload?.notify();
        },
        onError: (err) => stderr.write(`error: ${errorMessage(err)}\n`),
        ...(watch ? { watch } : {}),
      });
    }
  } catch (err) {
    stderr.write(`error: ${errorMessage(err)}\n`);
    await close(server);
    return 1;
  }
  const host = isIPv6(bound.address) ? `[${bound.address}]` : bound.address;
  stdout.write(`serving ${path.relative(ROOT, publishDir)}/ at http://${host}:${bound.port}/\n`);
  if (!signal.aborted) {
    await once(signal, 'abort');
  }
  watcher?.close();
  reload?.close();
  await close(server);
  return 0;
}

await runIfMain(import.meta.url, () => main(process.argv.slice(2), { signal: interruptSignal() }));
