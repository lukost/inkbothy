import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dirFlag, type Env, type Output, parseOrUsage, resolveSettings } from '../lib/cli.ts';
import { ROOT } from '../lib/paths.ts';
import { errorMessage } from '../shared/guards.ts';
import type { BuildOptions, BuildResult } from '../types.ts';
import { build } from './build.ts';

const USAGE = 'usage: build [--drafts] [--site <dir>] [--out <dir>]';

interface Io {
  readonly stdout?: Output;
  readonly stderr?: Output;
  readonly env?: Env;
  readonly run?: (options: BuildOptions) => Promise<BuildResult>;
}

/** Build options from CLI arguments and environment. @throws on unknown or malformed flags or variables */
export function parseCli(
  argv: readonly string[],
  env: Env = process.env,
): BuildOptions & { readonly outDir: string } {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      drafts: { type: 'boolean' },
      site: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const { site, out, drafts } = resolveSettings(
    {
      drafts: values.drafts,
      site: dirFlag('--site', values.site),
      out: dirFlag('--out', values.out),
    },
    env,
  );
  return { drafts, siteDir: site, outDir: out };
}

/**
 * `node src/generator/cli.ts [--drafts] [--site <dir>] [--out <dir>]`
 * @returns exit code: 0 ok, 1 build failed, 2 usage error
 */
export async function main(
  argv: readonly string[],
  { stdout = process.stdout, stderr = process.stderr, env = process.env, run = build }: Io = {},
): Promise<number> {
  const options = parseOrUsage(() => parseCli(argv, env), USAGE, stderr);
  if (options === undefined) {
    return 2;
  }
  try {
    const { files, warnings } = await run(options);
    for (const w of warnings) {
      stderr.write(`warning: ${w}\n`);
    }
    const note = options.drafts ? ' (drafts included)' : '';
    stdout.write(
      `built ${files.length} files into ${path.relative(ROOT, options.outDir)}/${note}\n`,
    );
    return 0;
  } catch (err) {
    stderr.write(`error: ${errorMessage(err)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
