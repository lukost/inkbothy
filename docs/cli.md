# CLI reference

inkbothy has four commands. Each is a Node script run directly (Node 24 strips the types); `make` wraps them.

## Settings

A setting comes from, in order of precedence, a flag, an environment variable, a default. An empty variable counts as unset. Relative directories resolve against the working directory.

| Setting | Flag | Variable | Default |
| --- | --- | --- | --- |
| Site directory | `--site <dir>` | `SITE_DIR` | `./site` |
| Build directory | `--out <dir>` (`--build <dir>` for `publish`) | `OUT_DIR` | `./build` |
| Publish directory | `--publish <dir>` | `PUBLISH_DIR` | `./publish` |
| Preview port | `--port <n>` | `PORT` | `8000` |
| Include drafts | `--drafts` | `DRAFTS` (`1`, `true`, `0`, `false`) | off |

An invalid value, such as `DRAFTS=maybe` or `PORT=70000`, is a usage error (exit code 2) that names the flag or variable. The build and publish directories must lie inside the inkbothy directory and must not be the site directory, `src/`, `data/`, `docs/`, `site.sample/`, `tests/`, `node_modules/` or `.git/`. A directory is replaced only when it is empty or carries the `.generated` marker of an earlier run.

## Commands

All commands exit with 0 on success, 1 on failure and 2 on a usage error.

### Build

```text
node src/generator/cli.ts [--drafts] [--site <dir>] [--out <dir>]
```

Reads `<site>/site.yaml` and the content, and writes the site and `manifest.json` to the build directory. Warnings go to standard error and do not fail the build; errors do (invalid configuration, broken front matter, a bundle in the wrong place, an unreadable icon).

### Publish

```text
node src/generator/publish.ts [--site <dir>] [--build <dir>] [--publish <dir>]
```

Copies the files listed in the build's manifest into a staging directory, adds `_headers.txt` and `_csp.txt`, and swaps it in for the publish directory; on failure the previous publish stays. A file identical to the one in the previous publish keeps that file's modification time, and the command prints how many files changed.

### Serve

```text
node src/server/cli.ts [--port <n>] [--host <addr>] [--no-watch] [--drafts] [--site <dir>]
```

Serves the publish directory with the site's real headers, on `127.0.0.1` unless `--host` says otherwise. It needs a successful publish first. Unless `--no-watch`, it rebuilds and republishes when the site directory, `src/` or `data/` change, and reloads open pages; a failed rebuild keeps the last good site and reports the error. Each open page holds one event stream and browsers allow six connections per origin over HTTP/1.1, so keep at most five tabs open.

### Init site

```text
node src/tools/init-site.ts [--site <dir>]
```

Copies `site.sample/` to the site directory, naming `site.yaml.sample` `site.yaml`. It refuses a directory that is not empty.

## Make targets

| Target | Does |
| --- | --- |
| `make install` | `npm ci` |
| `make build` | build |
| `make publish` | build, then publish |
| `make serve` | build, publish, then serve |
| `make init-site` | create the site directory from the sample |
| `make docs` | regenerate `site.schema.json` and `docs/site-yaml.md` from the configuration schema |
| `make test`, `make coverage` | the test suite, with or without coverage |
| `make typecheck`, `make lint`, `make format` | the TypeScript checks, Biome lint, Biome format |
| `make check` | lint, type checks and tests with coverage; what CI runs |
| `make clean` | remove `build/`, `publish/`, `coverage/`, `.tmp/` |

Variables: `SITE=<dir>`, `OUT=<dir>`, `PUBLISH=<dir>`; `DRAFTS=1` and `PORT=<n>` reach the commands through the environment, as do `SITE_DIR`, `OUT_DIR` and `PUBLISH_DIR`.

```sh
make serve SITE=~/websites/mine PORT=9000
DRAFTS=1 make serve
SITE_DIR=~/websites/mine make publish
```

`make serve DRAFTS=1` publishes the drafts into the publish directory: do not deploy it.

## Deploy

The publish directory is the whole site plus three files for the host:

- `_headers.txt` holds the security and cache headers per path pattern, with the Content-Security-Policy. Rename it to `_headers` for Netlify or Cloudflare Pages.
- `_csp.txt` holds the policy alone, for a server you configure yourself. It contains hashes of the inline scripts, so it changes whenever those do.
- `.generated` marks the directory as inkbothy's own.

None of the three is served by the preview server, and none needs uploading to a plain static host if you set the headers yourself.

Everything under `assets/` has a name derived from its content, so a changed file always has a new name (cached as immutable). Page files and `search-index.json` keep their names and are served `no-cache`, so browsers revalidate them. Publishing keeps the modification time of unchanged files, so a time-based sync transfers only what changed:

```sh
rsync -rt --delete --exclude .generated publish/ user@host:/var/www/site/
```

`rsync -rtc` (checksums) works as well and does not depend on the times. `rsync -rtn --itemize-changes ...` shows what a sync would do.

A content edit transfers the edited page, the listings and term pages that show it, `search-index.json`, and the home page or sitemap when what they show changes. Everything else keeps its bytes and time.
