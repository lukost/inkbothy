import { createHash } from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';
import { SRC } from '../lib/paths.ts';

const CLIENT = path.join(SRC, 'client');

export interface HeadScript {
  /** Script text exactly as inlined. */
  readonly source: string;
  /** CSP source expression for the inline script: `sha256-<base64>`. */
  readonly hash: string;
}

/** The inline `<head>` script: `client/head.ts` bundled and minified into one self-contained statement, with its CSP hash. */
export async function buildHeadScript(): Promise<HeadScript> {
  const { outputFiles } = await build({
    stdin: {
      contents: "import { applyHead } from './head.ts'; applyHead(document.documentElement);",
      resolveDir: CLIENT,
      loader: 'ts',
    },
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const script = (outputFiles[0]?.text ?? '').trim();
  if (!script || /<\/script|<!--/i.test(script)) {
    throw new Error('head script is empty or cannot be inlined');
  }
  return { source: script, hash: `sha256-${createHash('sha256').update(script).digest('base64')}` };
}
