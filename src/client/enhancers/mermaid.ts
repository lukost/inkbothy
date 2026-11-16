import type { Mermaid } from 'mermaid';
import type { Enhancer } from '../enhance.ts';

let counter = 0;
let loaded: Promise<Mermaid> | undefined;
/** Everything that draws runs here, one task at a time: Mermaid's configuration is global. */
let work: Promise<void> = Promise.resolve();

/** Run `task` after the queued work; its result and failure reach the caller, the queue carries on. */
function enqueue(task: () => Promise<void>): Promise<void> {
  const result = work.then(task);
  work = result.catch(() => undefined);
  return result;
}

/** Mermaid's theme names, by the class of the copy drawn in them. */
const DRAWINGS = [
  { className: 'mermaid-light', theme: 'default' },
  { className: 'mermaid-dark', theme: 'dark' },
] as const;

/** Mermaid, imported once; a failed import can be retried. */
function loadMermaid(): Promise<Mermaid> {
  loaded ??= import('mermaid')
    .then(({ default: mermaid }) => mermaid)
    .catch((err: unknown) => {
      loaded = undefined;
      throw err;
    });
  return loaded;
}

interface Drawing {
  readonly className: string;
  readonly svg: string;
}

/** One SVG per theme, drawn one after the other. */
async function draw(mermaid: Mermaid, source: string): Promise<Drawing[]> {
  const drawings: Drawing[] = [];
  for (const { className, theme } of DRAWINGS) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme,
    });
    drawings.push({ className, svg: (await mermaid.render(`mermaid-${counter++}`, source)).svg });
  }
  return drawings;
}

/** Focusable and named, so a wide diagram can be scrolled by keyboard; stylesheets show the copy that fits the theme. */
function diagramFigure(drawings: readonly Drawing[], title: string | undefined): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'mermaid';
  figure.tabIndex = 0;
  figure.setAttribute('role', 'region');
  figure.setAttribute('aria-label', title ?? 'Diagram');
  for (const { className, svg } of drawings) {
    const copy = document.createElement('div');
    copy.className = className;
    copy.innerHTML = svg;
    figure.append(copy);
  }
  if (title) {
    const caption = document.createElement('figcaption');
    caption.textContent = title;
    figure.append(caption);
  }
  return figure;
}

async function renderDiagram(mermaid: Mermaid, source: HTMLElement): Promise<void> {
  try {
    const drawings = await draw(mermaid, source.textContent);
    source.replaceWith(diagramFigure(drawings, source.dataset.title));
  } catch (err) {
    const message = document.createElement('p');
    message.className = 'mermaid-error-message';
    message.textContent = 'Diagram could not be rendered';
    source.classList.add('mermaid-error');
    source.before(message);
    console.error('cannot render diagram', err);
  }
}

/** Mermaid diagrams, drawn in both themes; loaded only when the page has some. */
export const mermaidDiagrams: Enhancer = {
  name: 'mermaid',
  async run(root) {
    const sources = [
      ...root.querySelectorAll<HTMLElement>('pre.mermaid-source:not(.mermaid-error)'),
    ];
    if (sources.length === 0) {
      return;
    }
    await enqueue(async () => {
      const mermaid = await loadMermaid();
      for (const source of sources) {
        await renderDiagram(mermaid, source);
      }
    });
  },
};
