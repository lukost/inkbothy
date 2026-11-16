import path from 'node:path';
import { build, formatMessages, type Message, type Metafile } from 'esbuild';
import { compareStrings } from '../lib/compare.ts';
import { ROOT, SRC, toPosix } from '../lib/paths.ts';
import type { Assets } from '../types.ts';
import { packageDirsOf } from './attributions.ts';

export interface BundleEntries {
  /** Absolute path of the client entry point. */
  readonly js: string;
  /** Absolute path of the stylesheet. */
  readonly css: string;
  /** Absolute paths of font files to preload; each must be bundled. */
  readonly preload?: readonly string[];
}

export interface BundleFile {
  /** Site-relative output path. */
  readonly path: string;
  readonly contents: Uint8Array;
}

export interface Bundle {
  /** Root-relative URLs of the entry assets. */
  readonly assets: Assets;
  readonly files: readonly BundleFile[];
  /** Source files (relative to the project root) whose code ships in the bundle. */
  readonly inputs: readonly string[];
  /** npm package roots whose code ships in the bundle. */
  readonly packageDirs: readonly string[];
  /** One line per esbuild warning. */
  readonly warnings: readonly string[];
}

const fontsource = (family: string, file: string): string =>
  path.join(ROOT, 'node_modules', '@fontsource-variable', family, 'files', file);

export const DEFAULT_ENTRIES: BundleEntries = {
  js: path.join(SRC, 'client', 'main.ts'),
  css: path.join(SRC, 'styles', 'site.css'),
  preload: [
    fontsource('literata', 'literata-latin-opsz-normal.woff2'),
    fontsource('ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2'),
  ],
};

/**
 * Output path (relative to ROOT) of the `extension` file built from `entry`.
 * Matching the extension separates the script from a CSS file it imports.
 */
function outputFor(outputs: Metafile['outputs'], entry: string, extension: string): string {
  const found = Object.entries(outputs).find(
    ([file, o]) =>
      file.endsWith(extension) &&
      o.entryPoint !== undefined &&
      path.resolve(ROOT, o.entryPoint) === entry,
  );
  if (!found) {
    throw new Error(`bundle produced no ${extension} output for ${entry}`);
  }
  return found[0];
}

/** Output path (relative to ROOT) of the file built from the single input `source`. */
function outputOf(outputs: Metafile['outputs'], source: string): string {
  const found = Object.entries(outputs).find(([, o]) =>
    Object.keys(o.inputs).some((input) => path.resolve(ROOT, input) === source),
  );
  if (!found) {
    throw new Error(`bundle produced no output for ${source}`);
  }
  return found[0];
}

/** Inputs that contribute code to some output (tree-shaken ones do not). */
function shippedInputs(metafile: Metafile): string[] {
  return Object.values(metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs).flatMap(([input, { bytesInOutput }]) =>
      bytesInOutput > 0 ? [input] : [],
    ),
  );
}

/** One line per esbuild warning. */
export async function warningLines(messages: readonly Message[]): Promise<string[]> {
  const formatted = await formatMessages([...messages], { kind: 'warning', color: false });
  return formatted.map((w) => (w.split('\n', 1)[0] ?? '').trim());
}

/** Bundle the client script and stylesheet into content-hashed files under `assets/`. */
export async function bundle(entries: BundleEntries = DEFAULT_ENTRIES): Promise<Bundle> {
  const result = await build({
    entryPoints: [entries.js, entries.css],
    absWorkingDir: ROOT,
    outdir: ROOT,
    bundle: true,
    format: 'esm',
    splitting: true,
    minify: true,
    target: 'es2022',
    platform: 'browser',
    entryNames: 'assets/[name]-[hash]',
    chunkNames: 'assets/chunks/[name]-[hash]',
    assetNames: 'assets/fonts/[name]-[hash]',
    loader: { '.woff2': 'file' },
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  const { outputs } = result.metafile;
  const css = outputFor(outputs, entries.css, '.css');
  const stray = Object.keys(outputs).filter((file) => file.endsWith('.css') && file !== css);
  if (stray.length > 0) {
    throw new Error(
      `client scripts must not import CSS (emitted ${stray.join(', ')}); put styles in the stylesheet entry`,
    );
  }
  const inputs = [...new Set(shippedInputs(result.metafile))].sort(compareStrings);
  return {
    assets: {
      js: `/${outputFor(outputs, entries.js, '.js')}`,
      css: `/${css}`,
      preload: (entries.preload ?? []).map((source) => `/${outputOf(outputs, source)}`),
    },
    files: result.outputFiles.map((f) => ({
      path: toPosix(path.relative(ROOT, f.path)),
      contents: f.contents,
    })),
    inputs,
    packageDirs: packageDirsOf(inputs),
    warnings: await warningLines(result.warnings),
  };
}
