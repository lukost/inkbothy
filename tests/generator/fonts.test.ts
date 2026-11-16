// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../src/generator/build.ts';
import { DATA } from '../../src/lib/paths.ts';
import { $$, doc, parseHtml, siteConfig, texts, trackedTrees } from '../helpers.ts';

const FONT_DIR = path.join(DATA, 'fonts', '0xproto');
const { tree, outFor } = trackedTrees();

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('0xProto files', () => {
  it('match SHA256SUMS exactly, and SHA256SUMS lists every file', async () => {
    const sums = (await fs.readFile(path.join(FONT_DIR, 'SHA256SUMS'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
        if (!match) {
          throw new Error(`malformed SHA256SUMS line: ${line}`);
        }
        return [match[2] ?? '', match[1] ?? ''] as const;
      });
    const files = (await fs.readdir(FONT_DIR)).filter((f) => f !== 'SHA256SUMS').sort();
    expect(sums.map(([file]) => file).sort()).toEqual(files);
    expect(files).toEqual([
      '0xProto-Bold.woff2',
      '0xProto-Italic.woff2',
      '0xProto-Regular.woff2',
      'LICENSE',
    ]);
    for (const [file, hash] of sums) {
      expect(sha256(await fs.readFile(path.join(FONT_DIR, file))), file).toBe(hash);
    }
  });

  it('are real woff2 fonts and the licence is the OFL', async () => {
    for (const file of ['0xProto-Regular', '0xProto-Italic', '0xProto-Bold']) {
      const data = await fs.readFile(path.join(FONT_DIR, `${file}.woff2`));
      expect(data.subarray(0, 4).toString('latin1'), file).toBe('wOF2');
      expect(data.length, file).toBeGreaterThan(10_000);
    }
    const licence = await fs.readFile(path.join(FONT_DIR, 'LICENSE'), 'utf8');
    expect(licence).toContain('SIL Open Font License, Version 1.1');
    expect(await fs.readFile(path.join(DATA, 'licenses', '0xProto-OFL.txt'), 'utf8')).toBe(licence);
  });
});

describe('fonts in the build', () => {
  let out = '';
  let files: readonly string[] = [];
  let warnings: readonly string[] = [];

  beforeAll(async () => {
    const siteDir = await tree({
      'resume/index.md': doc('title: Resume\npublished: 2026-01-01'),
    });
    out = outFor(siteDir);
    ({ files, warnings } = await build({
      siteDir,
      outDir: out,
      config: siteConfig({ menu: ['resume'] }),
      now: new Date('2027-01-01'),
    }));
  });

  const fonts = (prefix: string) =>
    files.filter((f) => f.startsWith(`assets/fonts/${prefix}`) && f.endsWith('.woff2'));

  it('ships Literata (Latin and Latin Extended, upright and italic) as woff2', async () => {
    expect(fonts('literata').map((f) => f.replace(/-[A-Z0-9]{8}\.woff2$/, ''))).toEqual([
      'assets/fonts/literata-latin-ext-opsz-italic',
      'assets/fonts/literata-latin-ext-opsz-normal',
      'assets/fonts/literata-latin-opsz-italic',
      'assets/fonts/literata-latin-opsz-normal',
    ]);
    for (const f of fonts('literata')) {
      expect((await fs.readFile(path.join(out, f))).subarray(0, 4).toString('latin1'), f).toBe(
        'wOF2',
      );
    }
  });

  it('ships IBM Plex Sans (Latin and Latin Extended, upright and italic) as woff2', async () => {
    expect(fonts('ibm-plex-sans').map((f) => f.replace(/-[A-Z0-9]{8}\.woff2$/, ''))).toEqual([
      'assets/fonts/ibm-plex-sans-latin-ext-wght-italic',
      'assets/fonts/ibm-plex-sans-latin-ext-wght-normal',
      'assets/fonts/ibm-plex-sans-latin-wght-italic',
      'assets/fonts/ibm-plex-sans-latin-wght-normal',
    ]);
    for (const f of fonts('ibm-plex-sans')) {
      expect((await fs.readFile(path.join(out, f))).subarray(0, 4).toString('latin1'), f).toBe(
        'wOF2',
      );
    }
  });

  it('ships the three 0xProto faces byte for byte', async () => {
    const shipped = fonts('0xProto');
    expect(shipped).toHaveLength(3);
    for (const name of ['Regular', 'Italic', 'Bold']) {
      const file = shipped.find((f) => f.includes(`0xProto-${name}-`));
      expect(file, name).toBeDefined();
      expect(await fs.readFile(path.join(out, file ?? ''))).toEqual(
        await fs.readFile(path.join(FONT_DIR, `0xProto-${name}.woff2`)),
      );
    }
  });

  it('references every shipped font from the stylesheet', async () => {
    const css = files.find((f) => /^assets\/site-[A-Z0-9]{8}\.css$/.test(f)) ?? '';
    const text = await fs.readFile(path.join(out, css), 'utf8');
    for (const f of [...fonts('literata'), ...fonts('ibm-plex-sans'), ...fonts('0xProto')]) {
      expect(text, f).toContain(f.slice('assets'.length));
    }
    expect(text).toContain('font-display:swap');
    expect(text).toContain('font-variant-ligatures:none');
  });

  it('credits IBM Plex Sans from the bundle with its licence', async () => {
    const doc = parseHtml(await fs.readFile(path.join(out, 'attributions/index.html'), 'utf8'));
    const entry = $$(doc, '.attribution-list li').find(
      (li) => li.querySelector('strong')?.textContent === '@fontsource-variable/ibm-plex-sans',
    );
    expect(entry?.textContent).toContain('OFL-1.1');
    const licences = files.filter((f) => f.startsWith('attributions/licenses/'));
    expect(licences.some((f) => f.includes('ibm-plex-sans'))).toBe(true);
    expect(warnings.filter((w) => /plex/i.test(w))).toEqual([]);
  });

  it('credits Literata (from the bundle) and 0xProto (from the extras) with their licences', async () => {
    const doc = parseHtml(await fs.readFile(path.join(out, 'attributions/index.html'), 'utf8'));
    expect(texts(doc, '.attribution-list strong')).toEqual(
      expect.arrayContaining(['@fontsource-variable/literata', '0xProto']),
    );
    const entry = (name: string) =>
      $$(doc, '.attribution-list li').find(
        (li) => li.querySelector('strong')?.textContent === name,
      );
    expect(entry('@fontsource-variable/literata')?.textContent).toContain('OFL-1.1');
    expect(entry('0xProto')?.textContent).toContain('2.502');
    expect(entry('0xProto')?.textContent).toContain('0xType');
    expect(entry('0xProto')?.textContent).toContain('OFL-1.1');
    const licence = files.filter((f) => f.startsWith('attributions/licenses/'));
    expect(licence.some((f) => f.includes('0xProto'))).toBe(true);
    expect(licence.some((f) => f.includes('literata'))).toBe(true);
    expect(warnings.filter((w) => /0xProto|literata/i.test(w))).toEqual([]);
  });
});
