// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENHANCERS, type Enhancer, runEnhancers } from '../../src/client/enhance.ts';

afterEach(() => vi.restoreAllMocks());

describe('ENHANCERS', () => {
  it('keeps only the interactive parts: copy buttons, then diagrams', () => {
    expect(ENHANCERS.map((e) => e.name)).toEqual(['copy', 'mermaid']);
  });
});

describe('runEnhancers', () => {
  it('runs in order, waiting for async enhancers, and passes the root', async () => {
    const log: string[] = [];
    const root = document.createElement('div');
    const list: Enhancer[] = [
      {
        name: 'slow',
        async run(r) {
          log.push(`slow start ${r === root}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
          log.push('slow end');
        },
      },
      { name: 'fast', run: () => void log.push('fast') },
    ];
    await runEnhancers(root, list);
    expect(log).toEqual(['slow start true', 'slow end', 'fast']);
  });

  it('logs a throwing or rejecting enhancer and still runs the rest', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ran: string[] = [];
    await runEnhancers(document.body, [
      {
        name: 'sync-bad',
        run() {
          throw new Error('boom');
        },
      },
      { name: 'async-bad', run: () => Promise.reject(new Error('later')) },
      { name: 'good', run: () => void ran.push('good') },
    ]);
    expect(ran).toEqual(['good']);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.map((c) => c[0])).toEqual([
      'enhancer "sync-bad" failed',
      'enhancer "async-bad" failed',
    ]);
  });
});
