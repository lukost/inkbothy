import fs from 'node:fs/promises';
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
 * Where `dep` is installed as seen from `from`: the nearest `node_modules/<dep>` along the parent
 * directories, as Node looks it up, but without resolving symlinks (so the path stays below
 * `from`'s own `node_modules`, even when that one is a symlink). Null when not installed.
 */
async function installedDir(from: string, dep: string): Promise<string | null> {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', dep);
    try {
      await fs.access(path.join(candidate, 'package.json'));
      return candidate;
    } catch {
      // not here; try the parent directory
    }
    if (path.dirname(dir) === dir) {
      return null;
    }
  }
}

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
  const dirs = (await Promise.all(optional.map((dep) => installedDir(packageDir, dep)))).flatMap(
    (dir) => (dir === null ? [] : [dir]),
  );
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
    // Keep paths as imported, so a symlinked node_modules stays under ROOT (see bundle.ts).
    preserveSymlinks: true,
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
