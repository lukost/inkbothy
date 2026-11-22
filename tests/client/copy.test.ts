// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/client/enhancers/copy.ts';
import { createMarkdown } from '../../src/generator/markdown/markdown.ts';
import { $, $$ } from '../helpers.ts';

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

const page = () => {
  const root = document.createElement('div');
  root.innerHTML = `<figure class="code-block"><figcaption>x.c</figcaption>
<pre class="shiki"><code><span class="line">int a;</span>
<span class="line">int b;</span></code></pre></figure>
<figure class="code-block"><pre><code>second</code></pre></figure><figure><pre>other</pre></figure>`;
  return root;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('copy', () => {
  it('adds one non-printing button and one status region per code block', () => {
    setClipboard({ writeText: vi.fn() });
    const root = page();
    copy.run(root);
    const buttons = $$(root, 'button.copy-code');
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.classList.contains('no-print'))).toBe(true);
    expect(buttons.map((b) => b.getAttribute('type'))).toEqual(['button', 'button']);
    expect($$(root, 'span.visually-hidden[role="status"]')).toHaveLength(2);
    expect(root.querySelector('figure:not(.code-block) button')).toBeNull();
  });

  it('puts the button in the header bar, never over the code', () => {
    setClipboard({ writeText: vi.fn() });
    const root = createMarkdown().render('```c title="a.c"\nint a;\n```\n\n```\nplain\n```', {
      docId: 'd',
    });
    const el = document.createElement('div');
    el.innerHTML = root;
    copy.run(el);
    const bars = $$(el, 'figure.code-block > figcaption');
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar.querySelectorAll(':scope > button.copy-code')).toHaveLength(1);
      expect(bar.querySelectorAll(':scope > [role="status"]')).toHaveLength(1);
    }
    expect(el.querySelector('pre button, figure > button')).toBeNull();
    // The untagged block's bar holds the button only, no label text.
    expect($$(bars[1] ?? el, 'span:not([role])')).toHaveLength(0);
  });

  it('falls back to the figure when a hand-written block has no header bar', () => {
    setClipboard({ writeText: vi.fn() });
    const el = document.createElement('div');
    el.innerHTML = '<figure class="code-block"><pre><code>a</code></pre></figure>';
    copy.run(el);
    expect($(el, 'figure > button.copy-code')).toBeTruthy();
  });

  it('does nothing when the code is removed after the button was added', async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    const el = document.createElement('div');
    el.innerHTML = '<figure class="code-block"><pre><code>a</code></pre></figure>';
    copy.run(el);
    el.querySelector('pre')?.remove();
    const button = $(el, 'button.copy-code');
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Copy');
    expect($(el, '[role="status"]').textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('names the button after the block title, language or nothing', () => {
    setClipboard({ writeText: vi.fn() });
    const root = document.createElement('div');
    root.innerHTML = `<figure class="code-block" data-lang="c"><figcaption><span class="code-title">dma.c</span></figcaption><pre><code>a</code></pre></figure>
<figure class="code-block" data-lang="rust"><pre><code>b</code></pre></figure>
<figure class="code-block"><pre><code>c</code></pre></figure>`;
    copy.run(root);
    expect($$(root, 'button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Copy code: dma.c',
      'Copy code: rust',
      'Copy code',
    ]);
  });

  it('skips a code figure that has no pre', () => {
    setClipboard({ writeText: vi.fn() });
    const root = document.createElement('div');
    root.innerHTML = '<figure class="code-block"><figcaption>only a caption</figcaption></figure>';
    copy.run(root);
    expect(root.querySelector('button')).toBeNull();
  });

  it('adds no button without a Clipboard API', () => {
    setClipboard(undefined);
    const root = page();
    copy.run(root);
    expect(root.querySelector('button')).toBeNull();
  });

  it('does not add buttons twice', () => {
    setClipboard({ writeText: vi.fn() });
    const root = page();
    copy.run(root);
    copy.run(root);
    expect($$(root, 'button.copy-code')).toHaveLength(2);
    expect($$(root, '[role="status"]')).toHaveLength(2);
  });

  it('copies the code text only, announces it, then reverts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const root = page();
    copy.run(root);
    const button = $(root, 'button.copy-code');
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith('int a;\nint b;');
    expect(button.textContent).toBe('Copied');
    expect($(root, '[role="status"]').textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1999);
    expect(button.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1);
    expect(button.textContent).toBe('Copy');
    expect($(root, '[role="status"]').textContent).toBe('');
  });

  it('does not copy the caption or the button label', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const root = page();
    copy.run(root);
    $$(root, 'button.copy-code')[1]?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith('second');
  });

  it('copies the block as it is at click time, after the pre was replaced', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const root = page();
    copy.run(root);
    const replacement = document.createElement('pre');
    replacement.textContent = 'highlighted';
    $(root, 'figure pre').replaceWith(replacement);
    $(root, 'button.copy-code').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith('highlighted');
  });

  it('keeps the label for its full time after a rapid second click', async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const root = page();
    copy.run(root);
    const button = $(root, 'button.copy-code');
    button.click();
    await vi.advanceTimersByTimeAsync(1500);
    button.click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(button.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1000);
    expect(button.textContent).toBe('Copy');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a rejected write and reverts', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const root = page();
    copy.run(root);
    const button = $(root, 'button.copy-code');
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe('Copy failed');
    expect($(root, '[role="status"]').textContent).toBe('Copy failed');
    await vi.advanceTimersByTimeAsync(2000);
    expect(button.textContent).toBe('Copy');
  });

  it('reports a synchronous failure of the Clipboard API', async () => {
    setClipboard({
      writeText: () => {
        throw new Error('insecure context');
      },
    });
    const root = page();
    copy.run(root);
    const button = $(root, 'button.copy-code');
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe('Copy failed');
  });

  it('works on figures rendered from Markdown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const root = document.createElement('div');
    root.innerHTML = createMarkdown().render('```c title="a.c"\nint x = 1 < 2;\n```', {
      docId: 'd',
    });
    copy.run(root);
    const button = $(root, 'button.copy-code');
    expect(button.getAttribute('aria-label')).toBe('Copy code: a.c');
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith('int x = 1 < 2;\n');
  });
});
