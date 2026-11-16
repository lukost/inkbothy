import { createHash } from 'node:crypto';

/** Paths that must never be prerendered: build internals and non-page files. */
const EXCLUDED_PATHS = ['/__*', '/*.xml', '/*.txt', '/*.json', '/*.pdf'] as const;

/** Links that stay on the page, download a file or ask not to be followed. */
const EXCLUDED_LINKS = '[href^="#"], [download], [rel~="nofollow"]';

export interface SpeculationRules {
  /** Script text exactly as inlined. */
  readonly source: string;
  /** CSP source expression for the inline script: `sha256-<base64>`. */
  readonly hash: string;
}

/**
 * Speculation rules that prerender same-origin pages when a link is hovered (moderate eagerness);
 * unsupported browsers ignore the script. The text is hashed for the Content-Security-Policy.
 */
export function buildSpeculationRules(): SpeculationRules {
  const source = JSON.stringify({
    prerender: [
      {
        where: {
          and: [
            { href_matches: '/*' },
            ...EXCLUDED_PATHS.map((pattern) => ({ not: { href_matches: pattern } })),
            { not: { selector_matches: EXCLUDED_LINKS } },
          ],
        },
        eagerness: 'moderate',
      },
    ],
  });
  return { source, hash: `sha256-${createHash('sha256').update(source).digest('base64')}` };
}
