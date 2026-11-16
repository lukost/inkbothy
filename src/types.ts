/** Shared contracts between content model, generator and templates. */

import type { SiteConfig } from './config/schema.ts';

export interface Update {
  readonly date: string;
  readonly note: string;
}

export interface Link {
  readonly label: string;
  readonly url: string;
}

/** Normalised front-matter. */
export interface Meta {
  readonly title: string;
  readonly summary: string;
  /** `YYYY-MM-DD`, or null when missing/invalid. */
  readonly published: string | null;
  /** Newest first. */
  readonly updates: readonly Update[];
  /** Date of the newest update, or null. */
  readonly updated: string | null;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly draft: boolean;
  /** Force the table of contents on or off; absent = automatic. */
  readonly toc?: boolean;
  /** Shown first in `cards` sections and listed in `featured` home blocks. */
  readonly featured?: boolean;
  /** Article-level copyright notice. */
  readonly copyright?: string;
  /** Status, free text. */
  readonly status?: string;
  /** Repository (http/https). */
  readonly repo?: string;
  readonly links?: readonly Link[];
  /** Front-matter keys the model does not know, passed through untouched. */
  readonly extra: Readonly<Record<string, unknown>>;
}

/** A content bundle as loaded by the generator. */
export interface Item {
  /** Bundle directory, POSIX, relative to the content root ('' = home). */
  readonly rel: string;
  /** Relative path of the bundle's index.md or index.html. */
  readonly source: string;
  /** Renderer of `body`. */
  readonly format: 'markdown' | 'html';
  readonly url: string;
  /** Key of the declared section the item belongs to; null for pages (home, resume, …). */
  readonly section: string | null;
  /**
   * What the bundle is: the home page, a top-level page, a resume (a page whose directory holds
   * the resume data), a section's introduction, or an item of a section.
   */
  readonly kind: 'home' | 'page' | 'resume' | 'intro' | 'member';
  readonly slug: string;
  readonly meta: Meta;
  /** Markdown without front-matter, or the HTML fragment of an `index.html` page. */
  readonly body: string;
  /** Relative paths of the bundle's other files. */
  readonly assets: readonly string[];
}

export interface Term {
  readonly slug: string;
  readonly label: string;
}

/** A taxonomy term with the items carrying it. */
export interface TaxonomyTerm extends Term {
  readonly items: readonly Item[];
}

/** Resolves any spelling of a label to its canonical term. */
export type Lookup = (label: string) => Term | undefined;

export interface TermLookup {
  readonly category: Lookup;
  readonly tag: Lookup;
}

/** What a section's items are called in reader-visible text. */
export interface ItemNoun {
  readonly singular: string;
  readonly plural: string;
}

export interface Attribution {
  readonly name: string;
  /** '' if unknown. */
  readonly version: string;
  /** '' if unknown. */
  readonly author: string;
  /** http(s) project link. */
  readonly url: string | null;
  /** SPDX id/expression or 'UNKNOWN'. */
  readonly license: string;
  /** Absolute path of the licence text, if any. */
  readonly licenseFile: string | null;
}

export interface BuildOptions {
  /** Site directory: `site.yaml` and the content tree. */
  readonly siteDir?: string;
  /** Directory with `attributions.yaml`, `license-overrides.yaml` and `licenses/`. */
  readonly dataDir?: string;
  readonly outDir?: string;
  readonly config?: SiteConfig;
  /** Include drafts (preview builds). */
  readonly drafts?: boolean;
  readonly now?: Date;
}

/** Root-relative URLs of the hashed entry assets every page references. */
export interface Assets {
  readonly js: string;
  readonly css: string;
  /** Fonts to preload (woff2). */
  readonly preload: readonly string[];
}

export interface BuildResult {
  /** Deployable files, relative to the output directory, sorted. */
  readonly files: readonly string[];
  readonly warnings: readonly string[];
}
