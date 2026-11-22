// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { $, $$, attrs } from '../helpers.ts';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));
const mockMermaid = () =>
  vi.doMock('mermaid', () => ({
    default: { initialize: mermaid.initialize, render: mermaid.render },
  }));

/** A fresh module instance, so its once-only state starts clean. */
async function load() {
  vi.resetModules();
  const { mermaidDiagrams } = await import('../../src/client/enhancers/mermaid.ts');
  return mermaidDiagrams;
}

const page = (...sources: string[]) => {
  const root = document.createElement('div');
  root.innerHTML = sources.map((s) => `<pre class="mermaid-source">${s}</pre>`).join('\n');
  return root;
};

const themes = () => mermaid.initialize.mock.calls.map((c) => c[0].theme);

/** Make the next `render` call wait; the returned function lets it finish. */
function holdNextRender(): () => void {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  mermaid.render.mockImplementationOnce(async (id: string) => {
    await gate;
    return { svg: `<svg id="${id}"></svg>` };
  });
  return release;
}

beforeEach(() => {
  mockMermaid();
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"></svg>` }));
});
afterEach(() => {
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe('mermaid', () => {
  it('does not load Mermaid without diagrams', async () => {
    let imports = 0;
    vi.doMock('mermaid', () => {
      imports++;
      return { default: { initialize: mermaid.initialize, render: mermaid.render } };
    });
    const enhancer = await load();
    const root = document.createElement('div');
    root.innerHTML = '<pre>graph TD</pre><figure class="code-block"></figure>';
    await enhancer.run(root);
    expect(imports).toBe(0);
    expect(mermaid.initialize).not.toHaveBeenCalled();
  });

  it('draws each diagram twice, light then dark, with the source text and unique ids', async () => {
    const enhancer = await load();
    const root = page('graph TD; A--&gt;B', 'pie title X');
    await enhancer.run(root);
    expect(root.querySelector('pre')).toBeNull();
    expect($$(root, 'figure.mermaid')).toHaveLength(2);
    expect(themes()).toEqual(['default', 'dark', 'default', 'dark']);
    expect(mermaid.render.mock.calls.map((c) => c[1])).toEqual([
      'graph TD; A-->B',
      'graph TD; A-->B',
      'pie title X',
      'pie title X',
    ]);
    const ids = mermaid.render.mock.calls.map((c) => c[0]);
    expect(new Set(ids).size).toBe(4);
    expect(attrs(root, '.mermaid-light > svg', 'id')).toEqual([ids[0], ids[2]]);
    expect(attrs(root, '.mermaid-dark > svg', 'id')).toEqual([ids[1], ids[3]]);
    expect(root.querySelector('figcaption')).toBeNull();
  });

  it('puts the light copy before the dark one inside the figure', async () => {
    const enhancer = await load();
    const root = page('graph');
    await enhancer.run(root);
    expect([...$(root, 'figure.mermaid').children].map((c) => c.className)).toEqual([
      'mermaid-light',
      'mermaid-dark',
    ]);
  });

  it('configures Mermaid for each drawing before it renders, strictly and without error graphics', async () => {
    const log: string[] = [];
    mermaid.initialize.mockImplementation((config: { theme: string }) => {
      log.push(`init ${config.theme}`);
    });
    mermaid.render.mockImplementation(async (id: string) => {
      log.push('render');
      return { svg: `<svg id="${id}"></svg>` };
    });
    const enhancer = await load();
    await enhancer.run(page('graph'));
    expect(log).toEqual(['init default', 'render', 'init dark', 'render']);
    for (const [config] of mermaid.initialize.mock.calls) {
      expect(config).toMatchObject({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
      });
    }
  });

  it('draws the same whatever the theme in force: the stylesheet picks the copy', async () => {
    document.documentElement.dataset.theme = 'dark';
    const enhancer = await load();
    await enhancer.run(page('graph'));
    expect(themes()).toEqual(['default', 'dark']);
  });

  it('makes the figure, and only the figure, a keyboard-scrollable, named region', async () => {
    const enhancer = await load();
    const root = page('graph', 'pie');
    $$(root, 'pre')[1]?.setAttribute('data-title', 'Pie');
    await enhancer.run(root);
    const [plain, titled] = $$(root, 'figure.mermaid');
    expect([
      plain?.tabIndex,
      plain?.getAttribute('role'),
      plain?.getAttribute('aria-label'),
    ]).toEqual([0, 'region', 'Diagram']);
    expect([
      titled?.tabIndex,
      titled?.getAttribute('role'),
      titled?.getAttribute('aria-label'),
    ]).toEqual([0, 'region', 'Pie']);
    for (const copy of $$(root, '.mermaid-light, .mermaid-dark')) {
      expect(copy.hasAttribute('role') || copy.hasAttribute('tabindex')).toBe(false);
      expect(copy.hasAttribute('aria-label')).toBe(false);
    }
  });

  it('adds one caption after both copies, and an accessible name, for a titled diagram', async () => {
    const enhancer = await load();
    const root = page('graph');
    $(root, 'pre').dataset.title = 'Boot <flow>';
    await enhancer.run(root);
    const figure = $(root, 'figure.mermaid');
    expect($$(figure, 'figcaption')).toHaveLength(1);
    expect($(figure, 'figcaption').textContent).toBe('Boot <flow>');
    expect(figure.lastElementChild?.tagName).toBe('FIGCAPTION');
    expect(figure.getAttribute('aria-label')).toBe('Boot <flow>');
    expect(figure.querySelector('figcaption *')).toBeNull();
  });

  it('keeps ids unique across runs', async () => {
    const enhancer = await load();
    await enhancer.run(page('a'));
    await enhancer.run(page('b'));
    const ids = mermaid.render.mock.calls.map((c) => c[0]);
    expect(new Set(ids).size).toBe(4);
  });

  it('draws nothing again on a second run, or when the theme changes', async () => {
    const enhancer = await load();
    const root = page('graph');
    document.body.append(root);
    await enhancer.run(root);
    await enhancer.run(root);
    document.documentElement.dataset.theme = 'dark';
    document.dispatchEvent(new CustomEvent('themechange'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect($$(root, 'figure.mermaid')).toHaveLength(1);
  });

  it('draws one diagram at a time, since Mermaid is configured globally', async () => {
    const enhancer = await load();
    const root = page('a', 'b');
    const release = holdNextRender();
    const running = enhancer.run(root);
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(themes()).toEqual(['default']);
    release();
    await running;
    expect(themes()).toEqual(['default', 'dark', 'default', 'dark']);
  });

  it('lets a later run wait for the run in progress instead of interleaving', async () => {
    const enhancer = await load();
    const first = page('a');
    const second = page('b');
    const release = holdNextRender();
    const running = enhancer.run(first);
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const waiting = enhancer.run(second);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([running, waiting]);
    expect(mermaid.render.mock.calls.map((c) => c[1])).toEqual(['a', 'a', 'b', 'b']);
  });

  describe('failure', () => {
    it('keeps a failing diagram visible with a message, and renders the others', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const cause = new Error('Parse error on line 1');
      mermaid.render.mockImplementation(async (id: string, text: string) => {
        if (text === 'broken') {
          throw cause;
        }
        return { svg: `<svg id="${id}"></svg>` };
      });
      const enhancer = await load();
      const root = page('broken', 'good');
      await enhancer.run(root);
      const failed = $(root, 'pre.mermaid-source');
      expect(failed.classList.contains('mermaid-error')).toBe(true);
      expect(failed.textContent).toBe('broken');
      expect(failed.previousElementSibling?.textContent).toBe('Diagram could not be rendered');
      expect($$(root, 'figure.mermaid')).toHaveLength(1);
      expect(error).toHaveBeenCalledWith('cannot render diagram', cause);
    });

    it('keeps the source, not a half-drawn figure, when only the dark drawing fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mermaid.render.mockImplementation(async (id: string) => {
        if (themes().at(-1) === 'dark') {
          throw new Error('dark failed');
        }
        return { svg: `<svg id="${id}"></svg>` };
      });
      const enhancer = await load();
      const root = page('graph');
      await enhancer.run(root);
      expect(root.querySelector('figure')).toBeNull();
      expect($(root, 'pre.mermaid-source').classList.contains('mermaid-error')).toBe(true);
      expect($$(root, '.mermaid-error-message')).toHaveLength(1);
    });

    it('does not retry or re-announce a failed diagram on a second run', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mermaid.render.mockRejectedValue(new Error('bad'));
      const enhancer = await load();
      const root = page('broken');
      await enhancer.run(root);
      await enhancer.run(root);
      expect(mermaid.render).toHaveBeenCalledTimes(1);
      expect($$(root, '.mermaid-error-message')).toHaveLength(1);
    });

    it('can retry loading after a failed import, and keeps the queue going', async () => {
      vi.doMock('mermaid', () => {
        throw new Error('network');
      });
      const enhancer = await load();
      await expect(enhancer.run(page('graph'))).rejects.toMatchObject({
        cause: { message: 'network' },
      });
      mockMermaid();
      const root = page('graph');
      await enhancer.run(root);
      expect($$(root, 'figure.mermaid')).toHaveLength(1);
    });
  });
});
