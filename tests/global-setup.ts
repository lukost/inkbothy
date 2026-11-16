import fs from 'node:fs/promises';
import { TMP } from './helpers.ts';

/** Removes the shared temp root once all test files have finished. */
export async function teardown(): Promise<void> {
  await fs.rm(TMP, { recursive: true, force: true });
}
