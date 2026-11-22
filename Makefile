.PHONY: install build publish serve init-site docs mutate test coverage typecheck lint format check clean

install:
	npm ci

# SITE=<dir> selects the site directory (default ./site), OUT=<dir> the build directory.
# DRAFTS=1 includes drafts and PORT=<n> sets the preview port; command-line variables reach the
# generator as environment variables, as do SITE_DIR, OUT_DIR and PUBLISH_DIR.
build:
	node src/generator/cli.ts $(if $(SITE),--site $(SITE)) $(if $(OUT),--out $(OUT))

# PUBLISH=<dir> selects the publish directory.
publish: build
	node src/generator/publish.ts $(if $(SITE),--site $(SITE)) $(if $(OUT),--build $(OUT)) $(if $(PUBLISH),--publish $(PUBLISH))

serve: publish
	node src/server/cli.ts $(if $(SITE),--site $(SITE))

# Copies site.sample/ to SITE (default ./site); refuses a non-empty directory.
init-site:
	node src/tools/init-site.ts $(if $(SITE),--site $(SITE))

# Regenerates site.sample/site.schema.json and docs/site-yaml.md from the configuration schema.
docs:
	node src/tools/gen-docs.ts

# Mutation testing, not part of `make check` and slow. MUTATE holds the arguments of the tool:
# files or directories under src/ (default: all of src/), --jobs <n>, --timeout <s>.
mutate:
	node src/tools/mutate.ts $(MUTATE)

test:
	npm test

coverage:
	npm run test:coverage

typecheck:
	npm run typecheck

lint:
	npm run lint

format:
	npm run format

check:
	npm run check

clean:
	rm -rf build publish coverage .tmp
