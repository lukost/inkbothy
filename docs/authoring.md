# Authoring

A inkbothy site is one directory, the site directory: `site.yaml` at its top and the content below. It is chosen with `--site <dir>`, `SITE_DIR` or `SITE=<dir>` for `make`, and is `./site` by default. [`make init-site`](cli.md#make-targets) creates one from `site.sample/`.

## Layout

```text
site/
  site.yaml            configuration, see site-yaml.md
  index.md             the home page
  about/index.md       a page: a top-level directory that is not a section
  resume/              a page with _resume.yaml: the resume
    index.md
    _resume.yaml
  blog/                a section declared in site.yaml
    index.md           optional introduction of the section
    first-post/        an item
      index.md
      diagram.png      assets of the item sit beside it
  _templates/          anything starting with _ is never published
```

- A **bundle** is a directory with `index.md`. Its path is its URL: `blog/first-post/` is `/blog/first-post/`. Use lower-kebab-case directory names; others still build but warn.
- A **section** is a top-level directory declared under `sections` in `site.yaml`. Its items are the bundles directly below it. Sections are one level deep.
- A **page** is a top-level directory with `index.md` that is not a section. List its name in `menu` to link it.
- Undeclared directories with bundles below the top level are an error, as are bundles deeper than `<section>/<item>/`.
- Any file or directory whose name starts with `_` is ignored, as are `site.yaml`, `site.schema.json`, `CLAUDE.md`, `README.md` and dot-entries (such as `.git`) at the top of the site directory.
- Every other file in a bundle, at any depth, is an asset and is copied to the same relative path. A file that is outside any bundle, or a second `.md` file in a bundle, is ignored with a warning.
- `index.md` of a section directory is its introduction: its title and summary head the section page and its body is shown above the items.
- The names `attributions` and `assets` are reserved at the top level; inside a section, `category` and `tag` (for the taxonomies it uses) are.

## Front matter

An `index.md` starts with YAML between `---` lines. YAML 1.2 core schema: dates stay text.

| Field | Applies to | Meaning |
| --- | --- | --- |
| `title` | all | Required in practice; without it the directory name is used and a warning is printed. |
| `summary` | all | Meta description, listing text and search. |
| `published` | all | `YYYY-MM-DD`; set it by hand on everything. Missing or invalid gives a warning and the item is undated. |
| `updates` | all | List of `{ date: YYYY-MM-DD, note: text }`. Shown as the update history; the newest date is the updated date. Invalid entries are dropped with a warning. |
| `categories`, `tags` | items of sections that list them in `taxonomies` | A list or a single string. Spelling variants of one label are merged; a warning names them. Elsewhere they are ignored with a warning. |
| `draft` | all | `true` keeps the item out of the published site. Any value that is not a yes/no word counts as a draft. |
| `toc` | all | `true` or `false` forces the table of contents on or off. Default: shown when there are three or more `##`/`###` headings. |
| `featured` | items | `true` makes the item eligible for `featured` home blocks; cards sections list featured items first. |
| `copyright` | all | Notice in the footer of the article, also when printed. |
| `status` | items | Free text, shown as a badge on cards. |
| `repo` | items | http(s) URL, shown on cards. |
| `links` | items | List of `{ label, url }` with http(s) URLs. |

Other keys are kept silently and have no effect. Booleans accept `true`, `false`, `yes` and `no`.

The templates in `site.sample/_templates/` have every field; copy one to start an item.

## Dates

Always write `published`. When you change something that matters to readers, add an `updates` entry with the date and a one-line note; do not edit `published`. Dates are real calendar days (`2026-02-30` is invalid).

## Drafts

Drafts are left out of `make build`, the sitemap, the search index and listings. `DRAFTS=1 make serve` (or `--drafts`) includes them, marked with a banner and `noindex`. A draft build must not be deployed: `publish` copies whatever was built.

## Markdown

CommonMark with:

- tables, strikethrough, footnotes and automatic links
- task lists (`- [ ]`, `- [x]`)
- GitHub alerts: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
- headings `##`-`####` get ids and a permalink; `[text](#heading-slug)` links work. Use `##` as the top level: the title is the page's `h1`.
- code fences with an info string: `` ```c title="dma.c" {3,5-7} showLineNumbers ``, or `showLineNumbers=42` to start counting at 42. Highlighted languages: c, cpp, rust, python, shellscript (`sh`, `bash`), shellsession (`console`), typescript, javascript, yaml, ini, makefile, cmake, diff, asm, dockerfile, lua, r, matlab, wolfram; `text` is plain. Another language is shown plain with a warning, and line numbers or highlights on a plain block are ignored with a warning.
- Mermaid diagrams: a fence tagged `mermaid`, optionally with `title="..."`
- raw HTML, for example `<details><summary>...</summary>...</details>` for a disclosure
- relative links and image paths, resolved against the page: `![x](diagram.png)`, `[y](../other-post/)`

There is no math typesetting.

Raw HTML is trusted, but the site's Content-Security-Policy blocks inline scripts, event-handler attributes, `javascript:` URLs and `<base>`; the build warns about each. Images and frames must come from the site itself (or `data:` images); remote ones are blocked in the browser without a warning.

## index.html pages

A top-level page may be written as hand-made HTML instead: `about/index.html` instead of `about/index.md`, never both. It needs an `<h1>`, which becomes the page title. It has no front matter, is not searched and is dated nowhere. The HTML is placed inside the site layout; relative URLs are resolved, nothing else is changed. It is allowed only for top-level pages, not for home, sections or items, and not for the resume.

## The resume

A top-level page whose directory also holds `_resume.yaml` is the resume. `index.md` supplies title, summary and an optional introduction; the structured parts come from the YAML, which is read leniently: a bad entry is dropped with a warning that starts with `resume:`. Scalars are text; quote values that YAML would reinterpret.

```yaml
headline: "Systems engineer"
contact:
  location: "City, Country"
  email: "name@example.com"
  links:
    - { label: "Website", url: "https://example.com" }
experience:               # also: teaching (same fields)
  - role: "Role"
    org: "Employer"
    location: "City"       # optional
    start: 2022-01         # YYYY-MM
    end: present           # YYYY-MM or present
    highlights: ["Inline **Markdown**."]
education:
  - { degree: "Degree", institution: "University", start: 2012-10, end: 2017-06, note: "optional" }
skills:
  - { group: "Group", items: ["One", "Two"] }
languages:
  - { name: "English", level: "native" }   # level optional
publications:
  - { title: "Title", venue: "Venue", year: 2020, url: "https://example.com/paper" }   # url optional
```

Every section is optional. `end` must not precede `start`; a start in the future warns.

## Taxonomies

A section lists `categories`, `tags` or both under `taxonomies`. Each label becomes a page at `/<section>/category/<slug>/` or `/<section>/tag/<slug>/`; the slug is the label folded to lower-kebab-case (`C++` is `cpp`, `C#` is `csharp`). The first listed taxonomy fills the section's menu group when `menu: taxonomy`.

## Icons

`favicon` and `appleTouchIcon` in `site.yaml` point to files in the site directory. They are copied under hashed names.
