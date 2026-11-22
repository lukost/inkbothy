import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  dirFlag,
  type Env,
  type Output,
  parseOrUsage,
  resolveSettings,
  runIfMain,
} from '../lib/cli.ts';
import { isErrnoException } from '../lib/node-guards.ts';
import { SITE_SAMPLE } from '../lib/paths.ts';
import { errorMessage } from '../shared/guards.ts';

const USAGE = 'usage: init-site [--site <dir>]';
const SAMPLE_CONFIG = 'site.yaml.sample';
const CONFIG = 'site.yaml';

/**
 * Copy the sample site into `target`, with `site.yaml.sample` renamed to `site.yaml`.
 * @throws Error if `target` exists and is not an empty directory
 */
export async function initSite(target: string, sample = SITE_SAMPLE): Promise<void> {
  const present = await fs.readdir(target).catch((err: unknown) => {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  });
  if (present.length > 0) {
    throw new Error(`${target} is not empty; refusing to overwrite it`);
  }
  await fs.cp(sample, target, { recursive: true });
  await fs.rename(path.join(target, SAMPLE_CONFIG), path.join(target, CONFIG));
}

interface Io {
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly env?: Env;
  readonly sample?: string;
}

/**
 * `node src/tools/init-site.ts [--site <dir>]`
 * @returns exit code: 0 ok, 1 failed, 2 usage error
 */
export async function main(
  argv: readonly string[],
  {
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    sample = SITE_SAMPLE,
  }: Io = {},
): Promise<number> {
  const site = parseOrUsage(
    () => {
      const { values } = parseArgs({ args: [...argv], options: { site: { type: 'string' } } });
      return resolveSettings({ site: dirFlag('--site', values.site) }, env).site;
    },
    USAGE,
    stderr,
  );
  if (site === undefined) {
    return 2;
  }
  try {
    await initSite(site, sample);
    stdout.write(`created ${site}; edit ${CONFIG}, then run make serve SITE=${site}\n`);
    return 0;
  } catch (err) {
    stderr.write(`error: ${errorMessage(err)}\n`);
    return 1;
  }
}

await runIfMain(import.meta.url, () => main(process.argv.slice(2)));
