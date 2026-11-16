import fs from 'node:fs/promises';
import path from 'node:path';
import { SRC } from '../../src/lib/paths.ts';

export const STYLES = path.join(SRC, 'styles');

export interface Rule {
  /** Enclosing at-rule preludes, outermost first (e.g. `@media (...)`). */
  readonly at: readonly string[];
  readonly selector: string;
  /** Declaration name to value. */
  readonly declarations: ReadonlyMap<string, string>;
}

/** Style rules of nesting-free CSS with their at-rule context; an at-rule holding declarations (`@page`, a margin box) is a rule named by it. */
export function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const at: string[] = [];
  let prelude = '';
  let body = '';
  let inBody = false;
  /** The innermost at-rule's own declarations, found before it nests another block or closes. */
  const atDeclarations = (text: string): void => {
    const name = at.at(-1);
    if (name && text.includes(':')) {
      rules.push({ at: at.slice(0, -1), selector: name, declarations: declarations(text) });
    }
  };
  for (const ch of text) {
    if (ch === '{' && !inBody) {
      const head = prelude.slice(prelude.lastIndexOf(';') + 1).trim();
      if (head.startsWith('@') && !head.startsWith('@font-face')) {
        atDeclarations(prelude.slice(0, prelude.lastIndexOf(';') + 1));
        at.push(head);
        prelude = '';
      } else {
        inBody = true;
      }
    } else if (ch === '}') {
      if (inBody) {
        rules.push({
          at: [...at],
          selector: prelude
            .slice(prelude.lastIndexOf(';') + 1)
            .trim()
            .replace(/\s+/g, ' '),
          declarations: declarations(body),
        });
        prelude = '';
        body = '';
        inBody = false;
      } else {
        atDeclarations(prelude);
        at.pop();
        prelude = '';
      }
    } else if (inBody) {
      body += ch;
    } else {
      prelude += ch;
    }
  }
  return rules;
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  // Semicolons inside parentheses (url(data:...)) do not occur in this code base.
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) {
      out.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
  }
  return out;
}

/** Names used as `var(--name)` in a declaration value. */
export function usedVariables(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] ?? '');
}

export async function styleFiles(): Promise<string[]> {
  return (await fs.readdir(STYLES)).filter((f) => f.endsWith('.css')).sort();
}

export const readStyle = (file: string): Promise<string> =>
  fs.readFile(path.join(STYLES, file), 'utf8');

/** Comma-separated parts of a selector list, ignoring commas inside parentheses. */
export function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    current += ch;
  }
  return [...parts, current.trim()].filter(Boolean);
}
