import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigError } from '../config/load.ts';
import type { SiteConfig } from '../config/schema.ts';
import { shortHash } from '../lib/hash.ts';
import { isErrnoException } from '../lib/node-guards.ts';
import { assertInside, SITE_CONFIG_FILE } from '../lib/paths.ts';
import { errorMessage } from '../shared/guards.ts';
import type { IconLink } from '../templates/layout.ts';

const TYPES: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface Icons {
  /** The `<link>` elements of every page's head. */
  readonly links: readonly IconLink[];
  /** Hashed copies to write, with output paths relative to the site root. */
  readonly files: readonly { readonly path: string; readonly contents: Uint8Array }[];
}

/**
 * Reads the configured icon files from the site directory.
 * @throws ConfigError naming the setting if a file cannot be read
 */
export async function loadIcons(
  { favicon, appleTouchIcon }: Pick<SiteConfig, 'favicon' | 'appleTouchIcon'>,
  siteDir: string,
): Promise<Icons> {
  const configured = [
    { field: 'favicon', rel: 'icon', stem: 'favicon', source: favicon },
    {
      field: 'appleTouchIcon',
      rel: 'apple-touch-icon',
      stem: 'apple-touch-icon',
      source: appleTouchIcon,
    },
  ] as const;
  const links: IconLink[] = [];
  const files: { path: string; contents: Uint8Array }[] = [];
  for (const { field, rel, stem, source } of configured) {
    if (source === undefined) {
      continue;
    }
    let contents: Uint8Array;
    try {
      contents = await fs.readFile(assertInside(siteDir, source));
    } catch (err) {
      const reason =
        isErrnoException(err) && err.code === 'ENOENT'
          ? 'file not found in the site directory'
          : errorMessage(err);
      throw new ConfigError(`${SITE_CONFIG_FILE}: ${field}: ${source}: ${reason}`);
    }
    const ext = path.posix.extname(source).toLowerCase();
    const href = `/assets/${stem}-${shortHash(contents)}${ext}`;
    files.push({ path: href.slice(1), contents });
    links.push(rel === 'icon' ? { rel, href, type: TYPES[ext] } : { rel, href });
  }
  return { links, files };
}
