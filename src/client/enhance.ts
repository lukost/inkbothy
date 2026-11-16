import { copy } from './enhancers/copy.ts';
import { mermaidDiagrams } from './enhancers/mermaid.ts';

/** A step applied to the page after it loaded. */
export interface Enhancer {
  readonly name: string;
  run(root: HTMLElement): void | Promise<void>;
}

export const ENHANCERS: readonly Enhancer[] = [copy, mermaidDiagrams];

/** Run `enhancers` in order; a failing one is logged and skipped. */
export async function runEnhancers(
  root: HTMLElement,
  enhancers: readonly Enhancer[],
): Promise<void> {
  for (const enhancer of enhancers) {
    try {
      await enhancer.run(root);
    } catch (err) {
      console.error(`enhancer "${enhancer.name}" failed`, err);
    }
  }
}
