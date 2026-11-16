# Architecture

inkbothy is a pipeline of small TypeScript modules run by Node 24 without a compile step. Only the browser code is bundled, by esbuild.

## Pipeline

```text
site dir ─ scan ─ normalize ─ render ─ templates ─ bundle ─ write + manifest ─ publish ─ serve
```

1. **Configuration** (`src/config/`): `site.yaml` is parsed as YAML 1.2 and validated by a strict Zod schema (`schema.ts`), whose descriptions are the source of the generated [reference](site-yaml.md) and `site.schema.json`. Errors name the file and the key path.
2. **Scan** (`src/generator/scan.ts`): walks the site directory, finds bundles (`index.md`, or `index.html` for top-level pages), collects their assets and skips `_`-prefixed names and the site's own top-level files. Structural mistakes (a bundle outside a declared section, `index.html` in the wrong place) throw.
3. **Normalize** (`src/content/model.ts`): front matter becomes a typed `Meta`. It is lenient: problems become warnings with the source file named, never failures. The kind of each bundle (home, intro, member, page, resume) follows from its place.
4. **Render** (`src/generator/render.ts`, `markdown/`): one markdown-it parse per article feeds the HTML, the table of contents, the search text and the warnings. Plugins: footnotes, fence info, task lists, heading ids, alerts, autolink marking, URL rebasing. Code is highlighted at build time by Shiki with grammars loaded on demand. Hand-written `index.html` pages only get their URLs rebased.
5. **Templates** (`src/templates/`): plain functions returning escaped-by-default markup (`html` tagged template). Layouts: stream, cards, list; pages for articles, home, resume, taxonomy terms, attributions and the 404.
6. **Bundle** (`src/generator/bundle.ts`): esbuild builds the client script and the CSS with content-hashed names; fonts are copied hashed. The inline head script (theme and text size before first paint) and the speculation rules are hashed for the CSP.
7. **Write** (`src/generator/build.ts`): everything goes through a writer confined to the output directory that refuses two sources for one file. The search index (MiniSearch), sitemap, `robots.txt` and `manifest.json` are written last. The manifest lists the deployable files and the script hashes.
8. **Publish** (`src/generator/publish.ts`): stages the listed files plus `_headers.txt` and `_csp.txt`, preserves the times of unchanged files and swaps the staging directory in.
9. **Serve** (`src/server/`): a static file server over the publish directory with the same headers, compression and range support, an event stream for live reload and a watcher that runs the build and publish commands as child processes.

## Modules

| Directory | Role |
| --- | --- |
| `src/lib/` | paths, CLI settings, HTTP policy (CSP, headers), small helpers |
| `src/config/` | site configuration schema and loader |
| `src/content/` | front matter, item model, taxonomies, slugs, resume parsing |
| `src/generator/` | scan, render, build, publish, search, sitemap, icons, attributions |
| `src/templates/` | HTML for every page type |
| `src/styles/` | the CSS, bundled into one hashed file |
| `src/client/` | browser modules: theme, text size, sidebar, scroll spy, stream loading, search dialog, code copy buttons, Mermaid, print |
| `src/server/` | preview server, reload channel, watcher |
| `src/tools/` | `init-site` and the documentation generator |
| `data/` | fonts, licence texts and attribution extras; stays with the generator |
| `site.sample/` | the starter site that `init-site` copies |

## Client

Progressive enhancement: every page is complete HTML, the menu is `<details>`, and the stream's later items are headers with a `data-fragment` URL that the script loads on demand. The client modules are idempotent and guard against unsupported APIs. Mermaid is loaded only on pages that contain a diagram.

## Security model

Content is trusted: the site's owner writes it, and raw HTML in Markdown is passed through. The defence is the Content-Security-Policy, `default-src 'self'`; scripts only from the site and from the hashed inline scripts; images from the site and `data:`; no objects, no `<base>`, no framing. Styles allow inline because highlighted code and diagrams need it. The policy is sent as a header from `_headers.txt` or `_csp.txt`, not as a meta tag.

The build therefore warns about content the policy would block, and the output paths are guarded: build and publish directories must lie inside the project, outside the protected directories, and may only replace directories that carry the `.generated` marker.

### Limits of the CSP check

`cspIssues` (`src/generator/csp-check.ts`) looks for inline `<script>`, `on*` attributes, `javascript:` URLs and `<base>`. It does not check where images, frames, stylesheets or `<script src>` point. A page with a remote `<img>`, `<iframe>` or `<link rel=stylesheet>` therefore builds without a warning and the browser blocks the request at run time. This applies to `index.html` pages in the same way, as to everything else: the check exists to catch accidents in content the author controls, not to sandbox it.

## Determinism and differential deploys

Output is a pure function of the site, the sources and the build time: bundles, fonts and icons are named by content hash, and the search index has the fixed name `search-index.json` (served `no-cache`), so pages that link it do not change with it; the clock enters only the copyright year. Tests build twice and compare the trees byte for byte, and check that a content edit changes only the edited page, the listings and term pages that show it, and the search index.
