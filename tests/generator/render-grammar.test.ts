import { expect, it, vi } from 'vitest';
import { getRenderer } from '../../src/generator/render.ts';
import { fullHtml } from '../helpers.ts';

vi.mock('@shikijs/langs/rust', () => {
  throw new Error('grammar chunk missing');
});

const ctx = { baseUrl: '/x/', docId: 'x', title: 'T' };

it('warns about a grammar that cannot load, leaves its block plain and highlights the rest', async () => {
  const out = await getRenderer('markdown').render(
    '```rust\nfn main() {}\n```\n\n```c\nint a;\n```',
    ctx,
  );
  expect(out.warnings).toEqual([expect.stringMatching(/^cannot load the "rust" grammar: ./)]);
  expect(fullHtml(out)).toContain('<pre><code class="language-rust">fn main() {}\n</code></pre>');
  expect(fullHtml(out).match(/<pre class="shiki/g)).toHaveLength(1);
});

it('warns once per build: a later document with the same language is plain, without a repeat', async () => {
  const again = await getRenderer('markdown').render('```rust\nlet x = 1;\n```', ctx);
  expect(again.warnings).toEqual([]);
  expect(fullHtml(again)).not.toContain('shiki');
});
