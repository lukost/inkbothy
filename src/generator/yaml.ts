import fs from 'node:fs/promises';
import { parse } from 'yaml';
import { isErrnoException } from '../lib/node-guards.ts';
import { errorMessage } from '../shared/guards.ts';

/** Parsed content of an optional hand-kept YAML file (failsafe schema: scalars stay strings); a missing file is `null`, invalid YAML a warning naming the file. */
export async function readOptionalYaml(
  file: string,
): Promise<{ data: unknown; warnings: readonly string[] }> {
  try {
    return { data: parse(await fs.readFile(file, 'utf8'), { schema: 'failsafe' }), warnings: [] };
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return { data: null, warnings: [] };
    }
    if (isErrnoException(err)) {
      throw err;
    }
    const reason = errorMessage(err).split('\n', 1)[0];
    return { data: null, warnings: [`${file}: ${reason}; ignored`] };
  }
}
