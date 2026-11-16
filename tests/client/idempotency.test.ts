// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENHANCERS, runEnhancers } from '../../src/client/enhance.ts';
import { getRenderer } from '../../src/generator/render.ts';
import { $, $$, fullHtml, texts } from '../helpers.ts';

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

const context = { baseUrl: '/x/', docId: 'd', title: 'T' };

describe('ENHANCERS on build-rendered markup', () => {
  it('leave it exactly as after the first run when run twice', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
    const html = fullHtml(
      await getRenderer('markdown').render(
        '## A\n\n## B\n\n## C\n\n```c {1}\nint a;\n```\n\n```text\nplain\n```',
        context,
      ),
    );
    const root = document.createElement('div');
    root.innerHTML = `<div class="md-content">${html}</div>`;
    const rendered = root.innerHTML;

    await runEnhancers(root, ENHANCERS);
    const once = root.innerHTML;
    expect(once).not.toBe(rendered);
    expect($$(root, 'nav.toc')).toHaveLength(1);
    expect($$(root, 'pre.shiki')).toHaveLength(1);
    expect($$(root, 'button.copy-code')).toHaveLength(2);

    await runEnhancers(root, ENHANCERS);
    expect(root.innerHTML).toBe(once);
  });

  it('copy the code of a Shiki block as plain text, line by line', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const html = fullHtml(
      await getRenderer('markdown').render('```c\nint a;\nint b;\n```', context),
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    await runEnhancers(root, ENHANCERS);
    $(root, 'figcaption button.copy-code').click();
    expect(writeText).toHaveBeenCalledWith('int a;\nint b;');
    expect(texts(root, 'figcaption .code-lang')).toEqual(['c']);
  });

  it('leave a Mermaid source for the diagram enhancer to find', async () => {
    const html = fullHtml(
      await getRenderer('markdown').render(
        '```mermaid title="Flow"\ngraph TD; A-->B\n```',
        context,
      ),
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    const source = $(root, 'pre.mermaid-source');
    expect(source.dataset.title).toBe('Flow');
    expect(source.textContent).toBe('graph TD; A-->B\n');
    expect(root.querySelector('figure.code-block')).toBeNull();
  });
});
