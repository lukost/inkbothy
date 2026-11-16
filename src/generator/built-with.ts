import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { ROOT, SRC } from '../lib/paths.ts';
import { errorMessage, isRecord } from '../shared/guards.ts';
import { packageDirsOf } from './attributions.ts';
import { warningLines } from './bundle.ts';

export interface BuiltWith {
  /** npm package roots whose code runs in the generator. */
  readonly packageDirs: readonly string[];
  /** Platform package roots to the package whose licence file covers them. */
  readonly licenseSources: ReadonlyMap<string, string>;
  /** One line per esbuild warning. */
  readonly warnings: readonly string[];
}

export const GENERATOR_ENTRY = path.join(SRC, 'generator', 'cli.ts');

/** Not bundled: esbuild is a native binary, with its platform package; listed regardless as the generator's own bundler. */
const EXTERNAL = ['esbuild'] as const;

/**
 * Installed platform binary packages of the npm package at `packageDir`: those of its
 * `optionalDependencies` that resolve from there (one per machine). Problems become warnings.
 */
export async function platformPackages(
  packageDir: string,
): Promise<{ dirs: readonly string[]; warnings: readonly string[] }> {
  const manifest = path.join(packageDir, 'package.json');
  const name = path.basename(packageDir);
  let optional: readonly string[];
  try {
    const pkg: unknown = JSON.parse(await fs.readFile(manifest, 'utf8'));
    optional =
      isRecord(pkg) && isRecord(pkg.optionalDependencies)
        ? Object.keys(pkg.optionalDependencies)
        : [];
  } catch (err) {
    return { dirs: [], warnings: [`attributions: cannot read ${manifest}: ${errorMessage(err)}`] };
  }
  const resolve = createRequire(manifest).resolve;
  const dirs = optional.flatMap((dep) => {
    try {
      return [path.dirname(resolve(`${dep}/package.json`))];
    } catch {
      return [];
    }
  });
  const warnings =
    optional.length > 0 && dirs.length === 0
      ? [`attributions: no platform package of ${name} is installed`]
      : [];
  return { dirs, warnings };
}

const analysed = new Map<string, Promise<BuiltWith>>();

async function analyse(entry: string): Promise<BuiltWith> {
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: ROOT,
    outfile: path.join(ROOT, 'generator.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: [...EXTERNAL],
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  const externals = EXTERNAL.map((name) => path.join(ROOT, 'node_modules', name));
  const platform = await Promise.all(
    externals.map(async (dir) => ({ dir, ...(await platformPackages(dir)) })),
  );
  const licenseSources = new Map(
    platform.flatMap(({ dir, dirs }) => dirs.map((platformDir) => [platformDir, dir] as const)),
  );
  return {
    packageDirs: [
      ...packageDirsOf(Object.keys(result.metafile.inputs)),
      ...externals,
      ...platform.flatMap((p) => p.dirs),
    ],
    licenseSources,
    warnings: [...(await warningLines(result.warnings)), ...platform.flatMap((p) => p.warnings)],
  };
}

/**
 * The npm packages the generator runs: those that esbuild reaches by following
 * the imports of `entry` (nothing is written), plus the externals. The sources do
 * not change within a process, so each entry is analysed once.
 */
export function builtWithPackages(entry: string = GENERATOR_ENTRY): Promise<BuiltWith> {
  let result = analysed.get(entry);
  if (!result) {
    result = analyse(entry);
    analysed.set(entry, result);
  }
  return result;
}
