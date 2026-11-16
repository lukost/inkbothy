// @vitest-environment happy-dom
import fs from 'node:fs/promises';
import path from 'node:path';
import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { required } from '../../src/shared/guards.ts';
import { CARDS, doc, parseHtml, STREAM, siteConfig, trackedTrees } from '../helpers.ts';

const SITE = 'Lighthouse Hub';
const config = siteConfig({
  title: SITE,
  copyright: { holder: 'Ada Holder', rights: 'Some rights reserved.' },
  sections: {
    blog: { ...STREAM, label: 'Scribings' },
    projects: { ...CARDS, label: 'Works' },
  },
});

const TITLE = 'Reading the registers of a sleepy peripheral';
const PARAGRAPHS = [
  'A peripheral that sleeps between transfers keeps its configuration in a register file that the kernel driver must restore after every wake-up, and the order of those writes matters more than the values.',
  'The first symptom is rarely a crash: a transfer completes with the wrong clock divider, the logic analyser shows a bit time that is a few percent off, and the receiver on the other side silently drops frames that it cannot resynchronise to.',
  'Stepping through the resume sequence showed that the divider was written before the controller left reset, so the write landed in a shadow register that the reset sequence then overwrote with the power-on default of the silicon vendor.',
  'The fix is to restore state in the order the reference manual lists, to read back each register that has side effects, and to keep one test per quirk so that the next silicon revision cannot reintroduce the bug unnoticed.',
];
const HEADINGS = ['Symptoms on the wire', 'Bisecting the resume path', 'Restoring state in order'];
const CODE = 'writel(div, base + REG_DIV);';

const body = [
  PARAGRAPHS[0],
  `## ${HEADINGS[0]}`,
  PARAGRAPHS[1],
  `## ${HEADINGS[1]}`,
  PARAGRAPHS[2],
  `\`\`\`c\n${CODE}\n\`\`\``,
  `## ${HEADINGS[2]}`,
  PARAGRAPHS[3],
].join('\n\n');

const { tree, outFor } = trackedTrees();
let out = '';

beforeAll(async () => {
  const siteDir = await tree({
    'index.md': doc('title: Welcome\npublished: 2025-03-01', 'Home text.\n'),
    'blog/registers/index.md': doc(
      `title: ${TITLE}\npublished: 2026-03-04\ncategories: [Kernel]\ntags: [drivers]\nsummary: Restoring registers.`,
      body,
    ),
    'blog/other/index.md': doc('title: Another entry\npublished: 2026-01-01\ncategories: [Kernel]'),
  });
  out = outFor(siteDir);
  await build({
    siteDir,
    dataDir: await tree({}),
    outDir: out,
    config,
    now: new Date('2027-01-01T00:00:00Z'),
  });
});

const page = async (rel: string) => parseHtml(await fs.readFile(path.join(out, rel), 'utf8'));

describe('a built article page, read by Readability', () => {
  const extract = async () => {
    const article = new Readability(await page('blog/registers/index.html')).parse();
    return required(article, 'extracted article');
  };

  it('is judged worth reading', async () => {
    expect(isProbablyReaderable(await page('blog/registers/index.html'))).toBe(true);
  });

  it('extracts the article title, without the site name', async () => {
    expect((await extract()).title).toBe(TITLE);
  });

  it('names the copyright holder as the author, and gives the publication date', async () => {
    const article = await extract();
    expect(article.byline).toBe('Ada Holder');
    expect(article.publishedTime).toBe('2026-03-04');
    expect(article.siteName).toBe(SITE);
  });

  it('keeps the whole body: every paragraph, every heading and the code', async () => {
    const text = (await extract()).textContent ?? '';
    for (const paragraph of PARAGRAPHS) {
      expect(text).toContain(paragraph);
    }
    for (const heading of HEADINGS) {
      expect(text).toContain(heading);
    }
    expect(text).toContain(CODE);
  });

  it('keeps the body in order', async () => {
    const text = (await extract()).textContent ?? '';
    const positions = [...PARAGRAPHS, ...HEADINGS].map((s) => text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(text.indexOf(PARAGRAPHS[0] ?? '')).toBeLessThan(text.indexOf(PARAGRAPHS[3] ?? ''));
    expect(text.indexOf(HEADINGS[0] ?? '')).toBeLessThan(text.indexOf(HEADINGS[2] ?? ''));
  });

  it('leaves out the menu, the top bar, the footer and the contents list', async () => {
    const text = (await extract()).textContent ?? '';
    for (const chrome of [
      SITE,
      'Scribings',
      'Works',
      'All posts',
      'Another entry',
      'Menu',
      'Page tools',
      'Skip to content',
      'Attributions',
      'Some rights reserved',
      'Contents',
    ]) {
      expect(text, chrome).not.toContain(chrome);
    }
  });

  it('shows each heading once: the contents rail adds no second copy', async () => {
    const text = (await extract()).textContent ?? '';
    for (const heading of HEADINGS) {
      expect(text.split(heading).length - 1, heading).toBe(1);
    }
  });

  it('hands the title over once, as the title: neither the heading nor the top bar repeats it in the text', async () => {
    const article = await extract();
    expect(article.title).toBe(TITLE);
    expect((article.textContent ?? '').split(TITLE).length - 1).toBe(0);
    expect(article.length).toBeGreaterThan(PARAGRAPHS.join('').length);
  });
});

describe('the page that the reader mode is given', () => {
  it('has the contents list in the page, where the rail is built from it', async () => {
    const d = await page('blog/registers/index.html');
    expect(d.querySelectorAll('.article-single > nav.toc a')).toHaveLength(HEADINGS.length);
  });

  it('carries the metadata that reader modes read', async () => {
    const d = await page('blog/registers/index.html');
    expect(d.querySelector('meta[name="author"]')?.getAttribute('content')).toBe('Ada Holder');
    expect(
      d.querySelector('meta[property="article:published_time"]')?.getAttribute('content'),
    ).toBe('2026-03-04');
    expect(d.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(TITLE);
    expect(d.querySelector('time[datetime="2026-03-04"]')).not.toBeNull();
  });

  it('gives a listing page no article metadata', async () => {
    const d = await page('blog/index.html');
    expect(d.querySelector('meta[name="author"]')).toBeNull();
    expect(d.querySelector('meta[property="article:published_time"]')).toBeNull();
  });
});
