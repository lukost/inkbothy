import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHeadScript } from '../../src/generator/head-script.ts';

const esbuild = vi.hoisted((): { text: string | undefined } => ({ text: '' }));
vi.mock('esbuild', () => ({
  build: async () => ({ outputFiles: esbuild.text === undefined ? [] : [{ text: esbuild.text }] }),
}));

beforeEach(() => {
  esbuild.text = '(()=>{})();\n';
});

describe('buildHeadScript failure paths', () => {
  it('trims the bundler output', async () => {
    const { source, hash } = await buildHeadScript();
    expect(source).toBe('(()=>{})();');
    expect(hash).toBe(`sha256-${createHash('sha256').update('(()=>{})();').digest('base64')}`);
  });

  it.each([
    ['no output', undefined],
    ['blank output', ' \n'],
    ['a closing script tag', 'x="</script>"'],
    ['an uppercase closing script tag', 'x="</SCRIPT>"'],
    ['an HTML comment opener', 'x="<!--"'],
  ])('refuses %s', async (_name, text) => {
    esbuild.text = text;
    await expect(buildHeadScript()).rejects.toThrow('head script is empty or cannot be inlined');
  });
});
