// @vitest-environment happy-dom
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { $, $$, doc, parseHtml, siteConfig, texts, trackedTrees } from '../helpers.ts';

const config = siteConfig();

const { tree, outFor } = trackedTrees();

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

it('adds only the interactive parts to a built, already rendered listing page', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });
  const post = (n: string, date: string) =>
    doc(
      `title: Post ${n}\npublished: ${date}\ncategories: [c]`,
      `# Heading ${n}\n\n## A\n\nNote[^1]\n\n\`\`\`c\nint x;\n\`\`\`\n\n[^1]: Footnote ${n}.\n`,
    );
  const siteDir = await tree({
    'blog/one/index.md': post('one', '2026-01-01'),
    'blog/two/index.md': post('two', '2026-02-01'),
  });
  const outDir = outFor(siteDir);
  await build({ siteDir, outDir, config, now: new Date('2027-01-01T00:00:00Z') });

  const built = parseHtml(await fs.readFile(path.join(outDir, 'blog', 'index.html'), 'utf8'));
  document.body.innerHTML = built.body.innerHTML;
  expect(texts(document, '.md-content h1')).toEqual(['Heading two', 'Heading one']);
  expect(document.querySelector('button.copy-code')).toBeNull();
  const articles = $$(document, '.md-content').map((c) => c.querySelector('h1')?.outerHTML);

  await import('../../src/client/main.ts');

  expect($$(document, 'figure.code-block button.copy-code')).toHaveLength(2);
  expect($$(document, '.md-content').map((c) => c.querySelector('h1')?.outerHTML)).toEqual(
    articles,
  );
  expect($(document, '.md-content .footnotes').textContent).toContain('Footnote two.');
  expect(document.querySelector('pre.md-source')).toBeNull();
  expect($(document, '.search-trigger').hidden).toBe(false);
  expect($$(document, 'dialog.search-dialog')).toHaveLength(1);
});
