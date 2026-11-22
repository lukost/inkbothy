import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/lib/paths.ts';
import { TMP_VAR } from './tmp-root.ts';

let tmp = '';

/** Picks this run's temp root and hands it to the workers, which inherit the environment. */
export function setup(): void {
  tmp = path.join(ROOT, '.tmp', `run-${process.pid}`);
  process.env[TMP_VAR] = tmp;
}

/** Removes this run's temp root once all test files have finished; other runs keep theirs. */
export async function teardown(): Promise<void> {
  await fs.rm(tmp, { recursive: true, force: true });
}
