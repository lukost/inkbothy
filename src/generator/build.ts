import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config/load.ts';
import { type Resume, resumeText } from '../content/resume.ts';
import { NO_TERMS } from '../content/taxonomy.ts';
import { compareStrings } from '../lib/compare.ts';
import { NOT_FOUND_FILE } from '../lib/http-policy.ts';
import { assertInside, BUILD, DATA, SITE_DEFAULT, siteConfigFile } from '../lib/paths.ts';
import { ownValue, required } from '../shared/guards.ts';
import {
  articleContent,
  articleFragment,
  articleFull,
  FRAGMENT_FILE,
} from '../templates/article.ts';
import { licensePath, renderAttributions } from '../templates/attributions.ts';
import { renderHome } from '../templates/home.ts';
import { html } from '../templates/html.ts';
import { copyrightLine, type LayoutOptions, pageStyle, renderLayout } from '../templates/layout.ts';
import { renderNotFound } from '../templates/not-found.ts';
import { renderResume } from '../templates/resume.ts';
import type { BuildOptions, BuildResult, Item, TermLookup } from '../types.ts';
import { collectAttributions } from './attributions.ts';
import { builtWithPackages } from './built-with.ts';
import { bundle } from './bundle.ts';
import { cspIssues } from './csp-check.ts';
import { buildHeadScript } from './head-script.ts';
import { loadIcons } from './icons.ts';
import { MANIFEST_FILE } from './manifest.ts';
import { checkMenu, menuSite, renderMenu } from './menu.ts';
import { checkOutDir, resetOutDir } from './out-dir.ts';
import { getRenderer, type Rendered, renderInline } from './render.ts';
import { RESUME_FILE, readResume } from './resume.ts';
import { renderRobots } from './robots.ts';
import { scanContent } from './scan.ts';
import { buildSearchIndex, SEARCH_INDEX_FILE } from './search.ts';
import {
  headingOf,
  homeBlocks,
  renderMembers,
  sectionLastmod,
  sectionPages,
  termPages,
} from './sections.ts';
import { renderSitemap } from './sitemap.ts';
import { buildSpeculationRules } from './speculation.ts';

/** Root-relative URL the not-found page is given in the layout. */
const NOT_FOUND_URL = `/${NOT_FOUND_FILE}`;

/** Writes below `outDir` only, recording every deployable file. */
function createWriter(outDir: string) {
  const files = new Set<string>();
  async function place(rel: string): Promise<string> {
    const abs = assertInside(outDir, rel);
    if (files.has(rel)) {
      throw new Error(`two sources produce the same output file: ${rel}`);
    }
    files.add(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    return abs;
  }
  return {
    files,
    write: async (rel: string, data: string | Uint8Array) => fs.writeFile(await place(rel), data),
    copy: async (src: string, rel: string) => fs.copyFile(src, await place(rel)),
  };
}

const pageFile = (url: string) => `${url.slice(1)}index.html`;

type PageFields = Omit<
  LayoutOptions,
  | 'config'
  | 'assets'
  | 'icons'
  | 'headScript'
  | 'speculationRules'
  | 'pageStyle'
  | 'url'
  | 'copyright'
  | 'menu'
  | 'searchIndex'
>;

/** Build the site into `outDir` (wiped first). The configuration is the `site.yaml` of the site directory unless `config` is given. */
export async function build({
  siteDir = SITE_DEFAULT,
  dataDir = DATA,
  outDir = BUILD,
  config: given,
  drafts = false,
  now = new Date(),
}: BuildOptions = {}): Promise<BuildResult> {
  const out = checkOutDir(outDir, siteDir, dataDir);
  const config = given ?? (await loadConfig(siteConfigFile(siteDir)));
  const scanned = await scanContent(siteDir, { sections: config.sections, drafts });
  checkMenu(config, scanned.pages);
  const icons = await loadIcons(config, siteDir);
  const { items } = scanned;
  const warnings = [...scanned.warnings];

  const { pages: sections, warnings: taxonomyWarnings } = sectionPages(items, config);
  warnings.push(...taxonomyWarnings);
  const termsOf = (item: Item): TermLookup =>
    sections.find((s) => s.key === item.section)?.lookup ?? NO_TERMS;

  const site = menuSite(config.menu, items, sections);
  const published = items.filter((i) => !i.meta.draft);
  const years = published
    .map((i) => i.meta.published?.slice(0, 4))
    .filter((y): y is string => y !== undefined)
    .map(Number);
  const copyright = copyrightLine(
    config.copyright,
    years.length ? Math.min(...years) : null,
    now.getUTCFullYear(),
  );

  // Each article is rendered once; its page, listings, fragment and search entry share the result.
  const rendered = new Map<Item, Rendered>();
  for (const i of items) {
    const result = await getRenderer(i.format).render(i.body, {
      baseUrl: i.url,
      docId: i.slug,
      title: i.meta.title,
      toc: i.meta.toc,
    });
    rendered.set(i, result);
    warnings.push(
      ...[...result.warnings, ...cspIssues(result.toc + result.body)].map(
        (msg) => `${i.source}: ${msg}`,
      ),
    );
  }
  const renderedOf = (i: Item): Rendered => required(rendered.get(i), `rendered ${i.source}`);
  const contentOf = (i: Item): string => {
    const { toc, body } = renderedOf(i);
    return toc + body;
  };
  const resumes = new Map<Item, Resume>();
  for (const i of items.filter((item) => item.kind === 'resume')) {
    const data = await readResume(path.join(siteDir, i.rel, RESUME_FILE), now);
    warnings.push(...data.warnings);
    if (data.resume) {
      resumes.set(i, data.resume);
    }
  }
  // The home page and hand-written HTML pages are not searched.
  const searched = items.filter((i) => i.kind !== 'home' && i.format === 'markdown');
  const searchJson = buildSearchIndex(
    searched.map((item) => {
      const resume = resumes.get(item);
      const { text } = renderedOf(item);
      return { item, text: resume ? `${text} ${resumeText(resume)}` : text, terms: termsOf(item) };
    }),
    Object.fromEntries(Object.entries(config.sections).map(([key, { label }]) => [key, label])),
  );
  const client = await bundle();
  const head = await buildHeadScript();
  const speculation = buildSpeculationRules();
  warnings.push(...client.warnings);
  await resetOutDir(out);
  const w = createWriter(out);
  for (const file of client.files) {
    await w.write(file.path, file.contents);
  }
  for (const file of icons.files) {
    await w.write(file.path, file.contents);
  }
  const page = (url: string, fields: PageFields, file = pageFile(url)) =>
    w.write(
      file,
      renderLayout({
        config,
        assets: client.assets,
        icons: icons.links,
        headScript: head.source,
        speculationRules: speculation.source,
        pageStyle: pageStyle(config, fields.title),
        url,
        copyright,
        searchIndex: `/${SEARCH_INDEX_FILE}`,
        menu: renderMenu(site, url),
        ...fields,
      }),
    );

  /** The page's `<main>`, plus the article metadata of pages that are one article. */
  const pageOf = (item: Item): Pick<PageFields, 'main' | 'article'> => {
    if (item.format === 'html') {
      return {
        main: html`<article class="article">${articleContent(renderedOf(item).body)}</article>`,
      };
    }
    const article = { title: item.meta.title, published: item.meta.published };
    const resume = resumes.get(item);
    if (item.kind === 'home') {
      return {
        main: renderHome({
          item,
          content: contentOf(item),
          terms: NO_TERMS,
          blocks: homeBlocks(config.home, sections),
        }),
      };
    }
    if (resume) {
      return {
        article,
        main: renderResume({
          item,
          intro: contentOf(item),
          resume,
          inline: (source) => renderInline(source, item.url),
        }),
      };
    }
    const { toc, body } = renderedOf(item);
    return { article, main: articleFull(item, termsOf(item), body, { toc }) };
  };

  for (const item of items) {
    // A section's introduction is part of its index page.
    if (item.kind !== 'intro') {
      await page(item.url, {
        title: item.kind === 'home' ? '' : item.meta.title,
        description: item.meta.summary,
        type: item.section ? 'article' : 'website',
        noindex: item.meta.draft,
        ...pageOf(item),
      });
    }
    if (item.section !== null && ownValue(config.sections, item.section)?.layout === 'stream') {
      await w.write(
        `${item.url.slice(1)}${FRAGMENT_FILE}`,
        String(articleFragment(item, contentOf(item))),
      );
    }
    for (const asset of item.assets) {
      await w.copy(path.join(siteDir, asset), asset);
    }
  }

  for (const s of sections) {
    const heading = headingOf(s);
    await page(s.url, {
      title: heading,
      description: s.intro?.meta.summary ?? '',
      noindex: s.intro?.meta.draft ?? false,
      main: renderMembers(s, { heading, intro: s.intro, members: s.members }, contentOf),
    });
    for (const term of termPages(s)) {
      await page(term.url, {
        title: term.heading,
        main: renderMembers(s, term, contentOf),
      });
    }
  }

  const builtWith = await builtWithPackages();
  warnings.push(...builtWith.warnings);
  const attributions = await collectAttributions({
    distributedDirs: client.packageDirs,
    builtWithDirs: builtWith.packageDirs,
    licenseSources: builtWith.licenseSources,
    extrasFile: path.join(dataDir, 'attributions.yaml'),
    overridesFile: path.join(dataDir, 'license-overrides.yaml'),
    licensesDir: path.join(dataDir, 'licenses'),
  });
  warnings.push(...attributions.warnings);
  for (const entry of [...attributions.distributed, ...attributions.builtWith]) {
    if (entry.licenseFile) {
      await w.copy(entry.licenseFile, licensePath(entry));
    }
  }
  await page('/attributions/', {
    title: 'Attributions',
    main: renderAttributions(attributions.distributed, attributions.builtWith),
  });

  await page(
    NOT_FOUND_URL,
    { title: 'Page not found', noindex: true, main: renderNotFound() },
    NOT_FOUND_FILE,
  );

  await w.write(SEARCH_INDEX_FILE, searchJson);

  await w.write('robots.txt', renderRobots(config.baseUrl, config.sections));

  const lastmod = (i: Item) => i.meta.updated ?? i.meta.published;
  await w.write(
    'sitemap.xml',
    renderSitemap(
      config.baseUrl,
      [
        ...published
          .filter((i) => i.kind !== 'intro')
          .map((i) => ({ url: i.url, lastmod: lastmod(i) })),
        ...sections.map((s) => ({ url: s.url, lastmod: sectionLastmod(s, published) })),
      ].sort((a, b) => compareStrings(a.url, b.url)),
    ),
  );

  // The manifest lists deployable files and is not one itself.
  const files = [...w.files].sort(compareStrings);
  const manifest = {
    generated: now.toISOString(),
    drafts,
    csp: { scriptHashes: [head.hash, speculation.hash] },
    files,
    pages: items.map((i) => ({
      url: i.url,
      title: i.meta.title,
      section: i.section,
      published: i.meta.published,
      updated: i.meta.updated,
      draft: i.meta.draft,
    })),
  };
  await w.write(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, warnings };
}
