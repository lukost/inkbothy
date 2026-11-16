# Writing content for this inkbothy site

Read `docs/agent-guide.md` in the inkbothy repository before writing; it has the complete rules, templates and examples. The essentials:

- This directory is the site: `site.yaml`, then content. Learn the sections from `site.yaml` first.
- An item is `<section>/<lower-kebab-name>/index.md` with YAML front matter; copy a template from `_templates/`.
- Always set `title`, `summary` and `published` (`YYYY-MM-DD`). Record later changes in `updates`, never by editing `published`.
- Use `draft: true` for unfinished work.
- Put images beside the `index.md` and refer to them relatively. No scripts, event handlers or remote images.
- Start the body at `##`; the title is the page's `h1`.
- Never create undeclared section directories or nest deeper than `<section>/<item>/`.
- Check every change with `make build SITE=<this directory>` from the inkbothy repository. The build must print no `warning:` or `error:` lines.
