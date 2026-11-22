import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanContent } from '../../src/generator/scan.ts';
import { doc, LIST, SECTIONS, trackedTrees } from '../helpers.ts';

const { tree } = trackedTrees();

afterEach(() => vi.restoreAllMocks());

const ok = (title = 'T') => doc(`title: ${title}\npublished: 2026-01-01`);
const scan = (dir: string, drafts = false) => scanContent(dir, { sections: SECTIONS, drafts });

describe('scanContent', () => {
  it.each(['blog/locked', 'blog/b/img'])(
    'propagates a directory that cannot be read: %s',
    async (locked) => {
      const dir = await tree({
        'blog/b/index.md': ok('B'),
        'blog/b/img/x.png': 'p',
        'blog/locked/index.md': ok('L'),
      });
      const readdir = fs.readdir.bind(fs);
      vi.spyOn(fs, 'readdir').mockImplementation(async (target, ...rest) => {
        if (String(target) === path.join(dir, locked)) {
          throw Object.assign(new Error(`EACCES: permission denied, scandir '${target}'`), {
            code: 'EACCES',
          });
        }
        return readdir(target, ...rest);
      });
      await expect(scan(dir)).rejects.toThrow('EACCES');
    },
  );

  it('loads bundles at every level with url/section/slug and sorted assets', async () => {
    const dir = await tree({
      'index.md': ok('Home'),
      'resume/index.md': ok('Resume'),
      'blog/b-post/index.md': ok('B'),
      'blog/b-post/z.png': 'z',
      'blog/b-post/a.svg': 'a',
      'blog/b-post/img/deep.jpg': 'd',
      'projects/tool/index.md': ok('Tool'),
    });
    const { items, warnings } = await scan(dir);
    expect(warnings).toEqual([]);
    expect(items.map((i) => [i.url, i.section, i.slug, i.meta.title])).toEqual([
      ['/blog/b-post/', 'blog', 'b-post', 'B'],
      ['/projects/tool/', 'projects', 'tool', 'Tool'],
      ['/resume/', null, 'resume', 'Resume'],
      ['/', null, '', 'Home'],
    ]);
    const post = items[0];
    expect(post?.assets).toEqual([
      'blog/b-post/a.svg',
      'blog/b-post/img/deep.jpg',
      'blog/b-post/z.png',
    ]);
    expect(post?.source).toBe('blog/b-post/index.md');
    expect(post?.body).toBe('Body.\n');
  });

  it('skips _-prefixed files and directories entirely', async () => {
    const dir = await tree({
      '_templates/post.md': 'not even front-matter ---',
      '_data/attributions.yaml': '[]',
      'blog/_wip/index.md': '---\nbroken: [\n---\n',
      'blog/x/index.md': ok(),
      'blog/x/_notes.txt': 'private',
    });
    const { items, warnings } = await scan(dir);
    expect(warnings).toEqual([]);
    expect(items.map((i) => i.url)).toEqual(['/blog/x/']);
    expect(items[0]?.assets).toEqual([]);
  });

  it('warns about stray files outside bundles and extra Markdown inside bundles', async () => {
    const dir = await tree({
      'README.txt': 'x',
      'blog/loose.md': 'x',
      'blog/x/index.md': ok(),
      'blog/x/notes.md': 'x',
    });
    const { warnings } = await scan(dir);
    // Code-unit order: "README.txt" < "blog".
    expect(warnings).toEqual([
      'README.txt: not inside a bundle (no index.md); ignored',
      'blog/loose.md: not inside a bundle (no index.md); ignored',
      'blog/x/notes.md: extra Markdown file in bundle; ignored',
    ]);
  });

  it('warns about non-regular entries (symlinks)', async () => {
    const dir = await tree({ 'blog/x/index.md': ok(), 'target.txt': 't' });
    await fs.symlink(path.join(dir, 'target.txt'), path.join(dir, 'blog/x/link.txt'));
    const { items, warnings } = await scan(dir);
    expect(items[0]?.assets).toEqual([]);
    expect(warnings).toContain('blog/x/link.txt: not a regular file or directory; ignored');
  });

  it('prefixes model warnings with the source file', async () => {
    const dir = await tree({ 'blog/x/index.md': doc('title: T') });
    const { warnings } = await scan(dir);
    expect(warnings).toEqual(['blog/x/index.md: missing published date']);
  });

  it('aborts on a broken file, naming it', async () => {
    const dir = await tree({ 'blog/x/index.md': '---\ntitle: T\n' });
    await expect(scan(dir)).rejects.toThrow(/^blog\/x\/index\.md: unterminated/);
  });

  describe('drafts', () => {
    const files = {
      'blog/pub/index.md': ok('Pub'),
      'blog/wip/index.md': doc('title: Wip\ndraft: true'),
      'blog/wip/pic.png': 'p',
    };

    it('excludes drafts and their warnings by default', async () => {
      const { items, warnings } = await scan(await tree(files));
      expect(items.map((i) => i.meta.title)).toEqual(['Pub']);
      expect(warnings).toEqual([]);
    });

    it('includes drafts with their assets and warnings on request', async () => {
      const { items, warnings } = await scan(await tree(files), true);
      expect(items.map((i) => [i.meta.title, i.meta.draft])).toEqual([
        ['Pub', false],
        ['Wip', true],
      ]);
      expect(items[1]?.assets).toEqual(['blog/wip/pic.png']);
      expect(warnings).toEqual(['blog/wip/index.md: missing published date']);
    });
  });

  it('returns nothing for an empty tree', async () => {
    expect(await scan(await tree())).toEqual({ items: [], warnings: [], pages: new Set() });
  });

  it('ignores the files and entries of the site itself at the top of the site directory', async () => {
    const dir = await tree({
      'index.md': ok('Home'),
      'site.yaml': 'title: x',
      'site.schema.json': '{}',
      'CLAUDE.md': '# rules',
      'README.md': '# readme',
      '.git': 'gitdir: ../.git/modules/site',
      '.gitignore': 'x',
      '_templates/post.md': ok('Template'),
      'logo.png': 'l',
    });
    const { items, warnings } = await scan(dir);
    expect(warnings).toEqual([]);
    expect(items.map((i) => [i.url, i.assets])).toEqual([['/', ['logo.png']]]);
  });

  it('keeps such names as ordinary assets and files one level down', async () => {
    const dir = await tree({
      'index.md': ok('Home'),
      'about/index.md': ok('About'),
      'about/site.yaml': 'a',
      'about/README.md': 'r',
      'about/.hidden': 'h',
    });
    const { items, warnings } = await scan(dir);
    expect(items.find((i) => i.url === '/about/')?.assets).toEqual([
      'about/.hidden',
      'about/site.yaml',
    ]);
    expect(warnings).toEqual(['about/README.md: extra Markdown file in bundle; ignored']);
  });

  it('still rejects an undeclared nested bundle next to the ignored files', async () => {
    const dir = await tree({
      'index.md': ok('Home'),
      'site.yaml': 'title: x',
      'notes/a/index.md': ok('A'),
    });
    await expect(scan(dir)).rejects.toThrow(/notes\/ is not a declared section/);
  });

  it('rejects a missing site directory', async () => {
    await expect(scan('/nonexistent/content/dir')).rejects.toThrow(/ENOENT/);
  });

  it('records the top-level pages, drafts included, and nothing else', async () => {
    const dir = await tree({
      'index.md': ok('Home'),
      'about/index.md': ok('About'),
      'secret/index.md': doc('title: S\ndraft: true'),
      'html/index.html': '<h1>H</h1>',
      'blog/index.md': ok('Blog'),
      'blog/x/index.md': ok(),
    });
    const { pages } = await scan(dir);
    expect([...pages].sort()).toEqual(['about', 'html', 'secret']);
  });

  describe('sections', () => {
    it('treats a declared section without a directory as empty', async () => {
      const { items } = await scanContent(await tree({ 'index.md': ok('Home') }), {
        sections: { ...SECTIONS, notes: LIST },
      });
      expect(items.map((i) => i.url)).toEqual(['/']);
    });

    it('loads the section directory itself as a page, and every declared section alike', async () => {
      const dir = await tree({ 'blog/index.md': ok('Blog'), 'notes/n/index.md': ok('N') });
      const { items } = await scanContent(dir, { sections: { ...SECTIONS, notes: LIST } });
      expect(items.map((i) => [i.url, i.section])).toEqual([
        ['/blog/', null],
        ['/notes/n/', 'notes'],
      ]);
    });

    it.each([
      ['an undeclared directory', 'notes/n'],
      ['a page', 'about/team'],
    ])('rejects a nested bundle in %s', async (_, rel) => {
      const dir = await tree({ 'about/index.md': ok('About'), [`${rel}/index.md`]: ok() });
      await expect(scan(dir)).rejects.toThrow(
        `${rel}: ${rel.split('/')[0]}/ is not a declared section; declare it in site.yaml or remove the nested bundle`,
      );
    });

    it('rejects a bundle two levels below a section', async () => {
      const dir = await tree({ 'blog/a/b/index.md': ok() });
      await expect(scan(dir)).rejects.toThrow(
        'blog/a/b: sections have one level; items sit directly under blog/',
      );
    });

    it('rejects a misplaced draft all the same', async () => {
      const dir = await tree({ 'notes/n/index.md': doc('title: N\ndraft: true') });
      await expect(scan(dir)).rejects.toThrow('notes/n: notes/ is not a declared section');
    });
  });

  describe('HTML pages', () => {
    it('loads index.html as a page titled by its first <h1>, without dates', async () => {
      const dir = await tree({
        'about/index.html':
          '<p>x</p>\n<h1> The <em>About</em>\n page &amp; more</h1><h1>Other</h1>',
        'about/team.png': 'png',
      });
      const { items, warnings } = await scan(dir);
      expect(warnings).toEqual([]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        rel: 'about',
        source: 'about/index.html',
        format: 'html',
        url: '/about/',
        section: null,
        slug: 'about',
        kind: 'page',
        assets: ['about/team.png'],
        meta: { title: 'The About page & more', published: null, summary: '', draft: false },
      });
      expect(items[0]?.body).toContain('<p>x</p>');
    });

    it('warns about a slug that is no clean slug, naming the file', async () => {
      const dir = await tree({ 'About Us/index.html': '<h1>A</h1>' });
      expect((await scan(dir)).warnings).toEqual([
        'About Us/index.html: directory "About Us" is not a clean slug (suggest "about-us")',
      ]);
    });

    it.each(['<p>no heading</p>', '<h2>not a title</h2>', ''])(
      'rejects a page without a usable <h1>: %j',
      async (html) => {
        const dir = await tree({ 'about/index.html': html });
        await expect(scan(dir)).rejects.toThrow(
          'about/index.html: needs an <h1>, which is the page title',
        );
      },
    );

    it.each([
      '<h1></h1>',
      '<h1>  \n </h1>',
      '<h1><img src="x"></h1>',
      '<h2>x</h2><h1><i></i></h1>',
    ])('says an <h1> without text has none: %j', async (html) => {
      const dir = await tree({ 'about/index.html': html });
      await expect(scan(dir)).rejects.toThrow('about/index.html: the first <h1> has no text');
    });

    it('rejects a page with both index.md and index.html', async () => {
      const dir = await tree({ 'about/index.md': ok(), 'about/index.html': '<h1>A</h1>' });
      await expect(scan(dir)).rejects.toThrow('about: has both index.md and index.html; keep one');
    });

    it.each([
      ['a section item', { 'blog/x/index.md': ok() }, 'blog/x/index.html'],
      ['a section item alone', {}, 'blog/x/index.html'],
      ['the home page', { 'index.md': ok() }, 'index.html'],
      ['the content root alone', {}, 'index.html'],
      ['a section directory', { 'blog/index.md': ok() }, 'blog/index.html'],
      ['a section directory alone', {}, 'blog/index.html'],
    ])(
      'rejects index.html in %s: it is only allowed in a top-level page',
      async (_, others, html) => {
        const dir = await tree({ ...others, [html]: '<h1>A</h1>' });
        await expect(scan(dir)).rejects.toThrow(
          `${html}: only allowed as the sole index of a top-level page`,
        );
      },
    );

    it('leaves index.html in directories that are no bundles alone', async () => {
      const dir = await tree({
        'blog/x/index.md': ok(),
        'blog/x/demo/index.html': '<h1>A</h1>',
        'about/index.md': ok(),
        'about/demo/index.html': '<h1>A</h1>',
      });
      const { items, warnings } = await scan(dir);
      expect(items.map((i) => i.url)).toEqual(['/about/', '/blog/x/']);
      expect(warnings).toEqual([
        'about/demo/index.html: not inside a bundle (no index.md); ignored',
        'blog/x/demo/index.html: not inside a bundle (no index.md); ignored',
      ]);
    });

    it('rejects _resume.yaml beside index.html, naming it', async () => {
      const dir = await tree({ 'cv/index.html': '<h1>CV</h1>', 'cv/_resume.yaml': 'headline: x' });
      await expect(scan(dir)).rejects.toThrow(
        'cv/_resume.yaml: a resume needs index.md, not index.html',
      );
    });
  });

  describe('resume', () => {
    it('marks a top-level Markdown page that holds _resume.yaml, and no other', async () => {
      const dir = await tree({
        'cv/index.md': ok('CV'),
        'cv/_resume.yaml': 'headline: x',
        'about/index.md': ok('About'),
        'html/index.html': '<h1>H</h1>',
        'blog/x/index.md': ok(),
        'blog/x/_resume.yaml': 'headline: x',
      });
      const { items, warnings } = await scan(dir);
      expect(warnings).toEqual([]);
      expect(items.map((i) => [i.url, i.kind])).toEqual([
        ['/about/', 'page'],
        ['/blog/x/', 'member'],
        ['/cv/', 'resume'],
        ['/html/', 'page'],
      ]);
    });
  });

  describe('asset directories', () => {
    it.each([
      ['the home page', { 'index.md': ok() }, '', 'img/a/b/c/x.png'],
      ['a page', { 'about/index.md': ok() }, 'about', 'about/img/a/b/c/x.png'],
      ['an HTML page', { 'about/index.html': '<h1>A</h1>' }, 'about', 'about/img/a/b/c/x.png'],
      ['a resume', { 'cv/index.md': ok(), 'cv/_resume.yaml': 'a: 1' }, 'cv', 'cv/img/a/b/c/x.png'],
      ['a section intro', { 'blog/index.md': ok() }, 'blog', 'blog/img/a/b/c/x.png'],
      ['a section item', { 'blog/x/index.md': ok() }, 'blog/x', 'blog/x/img/a/b/c/x.png'],
    ])('belong to %s, at any depth', async (_, bundle, owner, asset) => {
      const dir = await tree({ ...bundle, [asset]: 'png' });
      const { items, warnings } = await scan(dir);
      expect(warnings).toEqual([]);
      expect(items.find((i) => i.rel === owner)?.assets).toEqual([asset]);
    });

    it('skip _-prefixed directories and files, and warn about non-regular files and Markdown', async () => {
      const dir = await tree({
        'about/index.md': ok(),
        'about/img/ok.png': 'p',
        'about/img/_private/secret.png': 's',
        'about/img/_note.txt': 'n',
        'about/img/readme.md': 'm',
        'about/target.txt': 't',
      });
      await fs.symlink(path.join(dir, 'about/target.txt'), path.join(dir, 'about/img/link.png'));
      const { items, warnings } = await scan(dir);
      expect(items[0]?.assets).toEqual(['about/img/ok.png', 'about/target.txt']);
      expect(warnings).toEqual([
        'about/img/link.png: not a regular file or directory; ignored',
        'about/img/readme.md: extra Markdown file in bundle; ignored',
      ]);
    });

    it('are not directories that hold a bundle: a page still cannot nest one', async () => {
      const dir = await tree({
        'about/index.md': ok(),
        'about/img/x.png': 'p',
        'about/team/deep/index.md': ok(),
      });
      await expect(scan(dir)).rejects.toThrow('about/team/deep: about/ is not a declared section');
    });

    it('are not directories that hold an index.html either', async () => {
      const dir = await tree({
        'about/index.md': ok(),
        'about/demo/deep/index.html': '<h1>A</h1>',
      });
      const { items, warnings } = await scan(dir);
      expect(items[0]?.assets).toEqual([]);
      expect(warnings).toEqual([
        'about/demo/deep/index.html: not inside a bundle (no index.md); ignored',
      ]);
    });

    it('never make a section directory an asset directory of the home page', async () => {
      const dir = await tree({ 'index.md': ok(), 'blog/hero.png': 'p', 'img/x.png': 'p' });
      const { items, warnings } = await scan(dir);
      expect(items[0]?.assets).toEqual(['img/x.png']);
      expect(warnings).toEqual(['blog/hero.png: not inside a bundle (no index.md); ignored']);
    });

    it('stay unclaimed where no bundle owns them', async () => {
      const dir = await tree({ 'loose/img/x.png': 'p' });
      const { items, warnings } = await scan(dir);
      expect(items).toEqual([]);
      expect(warnings).toEqual(['loose/img/x.png: not inside a bundle (no index.md); ignored']);
    });
  });
});
