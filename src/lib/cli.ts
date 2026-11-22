import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../shared/guards.ts';
import { BUILD, PUBLISH, SITE_DEFAULT } from './paths.ts';

/** Anything with a `write(text)`: a stream, or a test sink. */
export interface Output {
  write(text: string): unknown;
}

/**
 * Parse CLI arguments; a failure is reported on `stderr` with `usage`.
 * @returns the parsed options, or undefined after a usage error (exit code 2)
 */
export function parseOrUsage<T>(parse: () => T, usage: string, stderr: Output): T | undefined {
  try {
    return parse();
  } catch (err) {
    stderr.write(`error: ${errorMessage(err)}\n${usage}\n`);
    return undefined;
  }
}

/** Runs `run` and sets `process.exitCode` when `moduleUrl` is the script Node was started with. */
export async function runIfMain(
  moduleUrl: string,
  run: () => Promise<number>,
  argv1 = process.argv[1],
): Promise<void> {
  if (argv1 && moduleUrl === pathToFileURL(argv1).href) {
    process.exitCode = await run();
  }
}

/** A signal that aborts on SIGINT or SIGTERM, so a CLI can shut down in an orderly way. */
export function interruptSignal(): AbortSignal {
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  return stop.signal;
}

/** Absolute path of a directory flag, or undefined when the flag is absent. @throws if `value` is empty */
export function dirFlag(flag: string, value: string | undefined): string | undefined {
  if (value === '') {
    throw new Error(`${flag} needs a directory`);
  }
  return value === undefined ? undefined : path.resolve(value);
}

/** The part of `process.env` the settings come from. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Command-line values of the shared settings; an absent flag is undefined. Directories are absolute (see `dirFlag`). */
export interface SettingFlags {
  readonly site?: string | undefined;
  readonly out?: string | undefined;
  readonly publish?: string | undefined;
  readonly port?: string | undefined;
  /** True when `--drafts` was given; it cannot be negated. */
  readonly drafts?: boolean | undefined;
}

export interface Settings {
  /** Site directory: content and `site.yaml`. */
  readonly site: string;
  /** Build output directory. */
  readonly out: string;
  /** Publish output directory. */
  readonly publish: string;
  readonly port: number;
  readonly drafts: boolean;
}

export const DEFAULT_PORT = 8000;

/** The environment variable `name`; an empty one counts as unset. */
const envValue = (env: Env, name: string): string | undefined =>
  env[name] === '' ? undefined : env[name];

/** Absolute directory from the flag (see `dirFlag`), else the variable, else `fallback`. */
const directory = (flag: string | undefined, env: Env, name: string, fallback: string): string =>
  flag ?? path.resolve(envValue(env, name) ?? fallback);

/** A TCP port from the flag, else `PORT`, else the default. @throws unless an integer from 0 to 65535 */
function port(flagValue: string | undefined, env: Env): number {
  const text = flagValue ?? envValue(env, 'PORT');
  const value = text === undefined ? DEFAULT_PORT : Number(text);
  if (text !== undefined && (!/^\d+$/.test(text) || value > 65535)) {
    const source = flagValue === undefined ? 'PORT' : '--port';
    throw new Error(`${source} must be an integer from 0 to 65535: ${text}`);
  }
  return value;
}

/** Whether drafts are included: `--drafts`, else `DRAFTS` (1|true|0|false). @throws on any other `DRAFTS` */
function drafts(flagValue: boolean | undefined, env: Env): boolean {
  if (flagValue === true) {
    return true;
  }
  const text = envValue(env, 'DRAFTS');
  switch (text) {
    case undefined:
    case '0':
    case 'false':
      return false;
    case '1':
    case 'true':
      return true;
    default:
      throw new Error(`DRAFTS must be 1, true, 0 or false: ${text}`);
  }
}

/**
 * The settings shared by the CLIs. Precedence: flag, then environment (`SITE_DIR`, `OUT_DIR`,
 * `PUBLISH_DIR`, `PORT`, `DRAFTS`; an empty variable counts as unset), then the default.
 * Relative directories resolve against the working directory.
 * @throws Error naming the offending flag or variable
 */
export function resolveSettings(flags: SettingFlags, env: Env = process.env): Settings {
  return {
    site: directory(flags.site, env, 'SITE_DIR', SITE_DEFAULT),
    out: directory(flags.out, env, 'OUT_DIR', BUILD),
    publish: directory(flags.publish, env, 'PUBLISH_DIR', PUBLISH),
    port: port(flags.port, env),
    drafts: drafts(flags.drafts, env),
  };
}
