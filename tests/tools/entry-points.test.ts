import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../src/lib/paths.ts';

const run = promisify(execFile);

/** Entry points started directly with Node, as the Makefile does. gen-docs is left out: running it rewrites the tracked docs. */
const ENTRY_POINTS = [
  ['src/generator/cli.ts', 'usage: build'],
  ['src/generator/publish.ts', 'usage: publish'],
  ['src/server/cli.ts', 'usage: serve'],
  ['src/tools/init-site.ts', 'usage: init-site'],
  ['src/tools/mutate.ts', 'usage: mutate'],
] as const;

describe('entry points', { timeout: 20_000 }, () => {
  it.each(ENTRY_POINTS)('%s runs main when started directly', async (entry, usage) => {
    const result = await run(process.execPath, [path.join(ROOT, entry), '--no-such-flag']).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(result).toMatchObject({ code: 2, stderr: expect.stringContaining(usage) });
  });
});
