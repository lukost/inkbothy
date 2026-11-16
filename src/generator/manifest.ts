import type { CspHashes } from '../lib/http-policy.ts';
import { isRecord, isStringArray } from '../shared/guards.ts';

export const MANIFEST_FILE = 'manifest.json';

/** The part of `manifest.json` that publishing depends on. */
export interface PublishManifest {
  /** Deployable files, relative to the build directory. */
  readonly files: readonly string[];
  readonly csp: CspHashes;
}

/** @throws Error naming the first field of `text` that is not a valid manifest */
export function parsePublishManifest(text: string): PublishManifest {
  const manifest: unknown = JSON.parse(text);
  if (!isRecord(manifest)) {
    throw new Error('manifest is not an object');
  }
  const { files, csp } = manifest;
  if (!isStringArray(files)) {
    throw new Error('manifest.files must be an array of strings');
  }
  if (!isRecord(csp) || !isStringArray(csp.scriptHashes)) {
    throw new Error('manifest.csp.scriptHashes must be an array of strings');
  }
  return { files, csp: { scriptHashes: csp.scriptHashes } };
}
