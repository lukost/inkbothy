# Guide for AI agents writing content

You write content for an inkbothy site without reading its sources. Follow the rules here; run `make build` (or `make build SITE=<dir>`) after every change and fix everything it prints. A clean build prints no `warning:` lines.

## Where files go

The site directory is the one holding `site.yaml`. Never edit anything outside it unless asked.

```text
site.yaml                         configuration; change only when asked
index.md                          home page
<page>/index.md                   top-level page, URL /<page>/
<section>/index.md                optional introduction of a declared section
<section>/<item>/index.md         an item, URL /<section>/<item>/
<section>/<item>/<file>           assets of the item (images, downloads)
<page>/_resume.yaml               makes <page> the resume
_templates/                       templates to copy; never published
```

Rules:

- Directory names are lower-kebab-case ASCII (`my-first-post`). They are the URLs.
- A section is declared under `sections` in `site.yaml`; read it first to learn the section names, their layouts and which taxonomies (`categories`, `tags`) each uses. Do not create a directory for a section that is not declared there: a top-level directory is a page, and `x/y/index.md` under an undeclared `x` fails the build.
- Items sit directly under their section. Never nest deeper.
- Put images beside the `index.md` that uses them and refer to them relatively: `![Alt text](figure.png)`.
- Do not use names starting with `_` for anything meant to be published. Do not create `site.yaml`, `CLAUDE.md`, `README.md` or `.`-files expecting them to be published; they are never content.
- A page appears in the menu only when its directory name is listed in `menu` in `site.yaml`.

## Front matter

Every `index.md` starts with YAML front matter between `---` lines. Copy a template from `_templates/` and edit it.

Post (stream or list section with categories and tags):

```markdown
---
title: "Post title"
summary: "One or two sentences."
published: 2026-01-01
categories: [General]
tags: [example]
---

Body.
```

Project (cards section):

```markdown
---
title: "Project name"
summary: "One or two sentences."
published: 2026-01-01
tags: [example]
featured: false
status: active
repo: https://example.com/repo
links:
  - { label: "Docs", url: "https://example.com/docs" }
---

Description.
```

Page:

```markdown
---
title: "Page title"
summary: "One or two sentences."
published: 2026-01-01
---

Body.
```

Fields: `title`, `summary`, `published`, `updates`, `categories`, `tags`, `draft`, `toc`, `featured`, `copyright`, `status`, `repo`, `links`. Others are ignored silently, so a misspelt field has no effect and no warning: copy names exactly.

- `categories` only where the section lists `categories` in `taxonomies`; `tags` likewise. Otherwise they are dropped with a warning.
- `published` is mandatory in practice. Dates are `YYYY-MM-DD`, real calendar days, unquoted or quoted.
- To record a change to an existing item, add to `updates` `- { date: 2026-02-01, note: "One-line description" }`. Do not change `published`.
- `draft: true` keeps the item out of the published site. Use it for work in progress; remove it to publish. A `draft` value that is not true/false/yes/no is treated as a draft.
- `featured: true` is for items that should appear in a `featured` home block (see `home` in `site.yaml`).
- `repo` and every `links` URL must be http(s); entries without a label and a valid URL are dropped with a warning.
- Use labels consistently: `Linux` and `linux` merge into one term and warn about the variants. `C++` and `C#` are fine.

## Markdown you can use

CommonMark plus tables, strikethrough, footnotes, autolinks, task lists, heading permalinks and:

- GitHub alerts: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`. Another name warns and renders a plain quote.
- Code fences with a language: ` ```python title="hello.py" {2} showLineNumbers `. Highlighted languages: c, cpp, rust, python, shellscript (sh, bash, zsh), shellsession (console), typescript (ts), javascript (js), yaml (yml), ini (conf), makefile, cmake, diff (patch), asm, dockerfile, lua, r, matlab, wolfram. Use `text` for plain output. Any other language warns. `{3,5-7}` highlights lines and `showLineNumbers` (or `showLineNumbers=10`) numbers them; both warn on a block that is not highlighted.
- Mermaid diagrams: ` ```mermaid ` with optional `title="..."`.
- Raw HTML, for example `<details><summary>Title</summary>Text</details>`.

Rules:

- The title comes from front matter and is the page's `h1`. Start the body at `##` and keep levels in order (`##`, `###`, `####`). A table of contents appears automatically with three or more `##`/`###` headings; set `toc: false` to suppress it.
- There is no math typesetting. Do not write LaTeX.
- Never put scripts, event-handler attributes (`onclick=...`), `javascript:` URLs or `<base>` in content: the site's Content-Security-Policy blocks them and the build warns.
- Images and frames must come from the site (relative paths) or be `data:` images. A remote `<img src="https://...">` builds silently but the browser refuses to load it: download the file and put it beside the `index.md`.
- Link to other pages with root-relative or relative URLs (`/blog/other-post/`, `../other-post/`), and to a heading with `#heading-text-in-kebab-case`.

## index.html pages

A top-level page can be `<page>/index.html` instead of `index.md` (never both). It needs an `<h1>`, has no front matter, is not searched and sits inside the normal layout. Use it only for a page that Markdown cannot express. It is an error in sections, in the home page and in the resume.

## The resume

The page directory holds `index.md` (title, summary, optional intro) and `_resume.yaml`:

```yaml
headline: "Professional headline"
contact:
  location: "City, Country"
  email: "name@example.com"
  links:
    - { label: "Website", url: "https://example.com" }
experience:
  - role: "Role"
    org: "Employer"
    location: "City"
    start: 2022-01
    end: present
    highlights: ["Inline **Markdown** is allowed."]
education:
  - { degree: "Degree", institution: "University", start: 2012-10, end: 2017-06 }
skills:
  - { group: "Group", items: ["One", "Two"] }
languages:
  - { name: "English", level: "native" }
publications:
  - { title: "Title", venue: "Venue", year: 2020, url: "https://example.com/paper" }
teaching:
  - { role: "Lecturer", org: "University", start: 2015-10, end: 2019-06, highlights: ["Course."] }
```

Months are `YYYY-MM`; `end` is a month or `present` and not before `start`. Entries missing required fields or with bad months produce `resume:` warnings and are dropped; an unknown key produces a `resume:` warning and only that key is ignored. Optional parts may be left out.

## What fails the build and what only warns

The build **fails** (error, no output) on:

- a missing or invalid `site.yaml` (including unknown keys), or a `menu` entry that is neither a declared section nor a top-level page
- front matter that is not closed by a second `---`, is invalid YAML, or is not a key/value mapping
- a bundle below the top level whose first directory is not a declared section, or deeper than `<section>/<item>/`
- `index.html` anywhere but as the only index of a top-level page; an `index.html` without a non-empty `<h1>`; one beside an `index.md`; one in a resume directory
- an unreadable favicon or touch icon
- two sources producing the same output file

Everything else is a **warning** that the build prints as `warning: <file>: <message>` and carries on. Treat every warning as a mistake to fix: missing title or `published`, invalid dates, taxonomy fields the section does not use, unknown code languages or alerts, bad URLs, a directory name that is not a clean slug, a file outside any bundle, an extra `.md` file in a bundle, CSP-blocked markup, resume problems, spelling variants of a term.

## How to check

1. `make build SITE=<dir>` (default `./site`). Output ends with `built N files into build/`; each problem is a `warning:` or `error:` line naming the file.
2. `make serve SITE=<dir>` previews at `http://127.0.0.1:8000/`; add `DRAFTS=1` to see drafts, which are marked with a banner.
3. Do not deploy a build made with `DRAFTS=1`.

Typical fixes: `missing published date` add `published: YYYY-MM-DD`; `categories are not enabled for blog/` remove the field or ask for the taxonomy; `directory "My Post" is not a clean slug` rename it; `not inside a bundle (no index.md)` move the file beside an `index.md`.
