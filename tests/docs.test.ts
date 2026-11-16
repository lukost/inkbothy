import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS, ROOT } from '../src/lib/paths.ts';

const documents = async (): Promise<string[]> => [
  path.join(ROOT, 'README.md'),
  ...(await fs.readdir(DOCS))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(DOCS, f)),
];

/** Targets of Markdown links and images, and of `src`/`srcset` attributes, outside code blocks. */
function targets(text: string): string[] {
  const prose = text.replaceAll(/```[\s\S]*?```/g, '').replaceAll(/`[^`\n]*`/g, '');
  return [
    ...[...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? ''),
    ...[...prose.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((m) => m[1] ?? ''),
  ];
}

const local = (target: string): boolean => !/^([a-z][a-z0-9+.-]*:|#)/i.test(target);

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

describe('the documentation', () => {
  it('links only to files that exist, images included', async () => {
    const missing: string[] = [];
    for (const doc of await documents()) {
      for (const target of targets(await fs.readFile(doc, 'utf8')).filter(local)) {
        const file = path.resolve(path.dirname(doc), decodeURI(target.split('#')[0] ?? ''));
        if (!(await exists(file))) {
          missing.push(`${path.relative(ROOT, doc)}: ${target}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('finds the links it is meant to check', async () => {
    const readme = targets(await fs.readFile(path.join(ROOT, 'README.md'), 'utf8'));
    expect(readme).toEqual(
      expect.arrayContaining(['docs/cli.md#deploy', 'docs/images/welcome_dark.png', 'LICENSE']),
    );
  });

  it('points links with a fragment at a heading that exists', async () => {
    const slug = (heading: string) =>
      heading
        .toLowerCase()
        .replaceAll(/[^a-z0-9 -]/g, '')
        .trim()
        .replaceAll(' ', '-');
    const broken: string[] = [];
    for (const doc of await documents()) {
      for (const target of targets(await fs.readFile(doc, 'utf8')).filter(local)) {
        const [file = '', fragment] = target.split('#');
        if (!file.endsWith('.md') || fragment === undefined) {
          continue;
        }
        const text = await fs.readFile(path.resolve(path.dirname(doc), file), 'utf8');
        const headings = [...text.matchAll(/^#+ (.+)$/gm)].map((m) => slug(m[1] ?? ''));
        if (!headings.includes(fragment)) {
          broken.push(`${path.relative(ROOT, doc)}: ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('names no personal details beyond the licence line', async () => {
    for (const doc of await documents()) {
      expect(await fs.readFile(doc, 'utf8'), doc).not.toMatch(
        /@(?!example\.com)[\w-]+\.\w+|lukasz@|\/home\//i,
      );
    }
  });
});
