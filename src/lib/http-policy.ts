/** Page a host serves, with status 404, for paths that do not exist. */
export const NOT_FOUND_FILE = '404.html';
/** Host configuration written beside the site; never served. */
export const HEADERS_FILE = '_headers.txt';
export const CSP_FILE = '_csp.txt';
/** Marker of generated directories; see `GENERATED_MARKER`. */
export const MARKER_FILE = '.generated';
export const UNSERVED_FILES: ReadonlySet<string> = new Set([HEADERS_FILE, CSP_FILE, MARKER_FILE]);

export const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Cache rules for files whose names change with their content. */
const IMMUTABLE_RULES: readonly { readonly pattern: string; readonly matches: RegExp }[] = [
  { pattern: '/assets/*', matches: /^assets\// },
];

/**
 * Patterns for the pages and text files, disjoint from the immutable ones: hosts join the values of
 * all matching rules, so a catch-all `no-cache` would corrupt the immutable header. Other files,
 * such as post images, get the host's default (revalidate).
 */
const NO_CACHE_PATTERNS = [
  '/',
  '/*/',
  '/*.html',
  '/*.txt',
  '/*.xml',
  '/search-index.json',
] as const;

/** Hashes of the inline scripts the pages carry. */
export interface CspHashes {
  readonly scriptHashes: readonly string[];
}

/** Headers sent with every response, besides the CSP. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()',
};

/** Sent by a real host only: it would pin a local preview to HTTPS. */
const HSTS = ['Strict-Transport-Security', 'max-age=31536000'] as const;

/**
 * Content-Security-Policy. Styles carry no hashes: a hash disables `'unsafe-inline'`, which
 * highlighted code (style attributes) and diagrams (`<style>` elements) rely on.
 */
export function contentSecurityPolicy({ scriptHashes }: CspHashes): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.map((h) => `'${h}'`).join(' ')}`.trimEnd(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** Cache-Control for the file at `rel` (site-relative, `/`-separated). */
export function cacheControl(rel: string): string {
  return IMMUTABLE_RULES.some(({ matches }) => matches.test(rel)) ? IMMUTABLE : NO_CACHE;
}

/**
 * `_headers.txt`: the security and cache rules per path pattern. Rename it to `_headers` for
 * Netlify or Cloudflare Pages. `hsts` adds Strict-Transport-Security.
 */
export function renderHeaders(csp: string, hsts: boolean): string {
  const security: (readonly [string, string])[] = [
    ['Content-Security-Policy', csp],
    ...Object.entries(SECURITY_HEADERS),
    ...(hsts ? [HSTS] : []),
  ];
  const rule = (pattern: string, headers: readonly (readonly [string, string])[]) =>
    [pattern, ...headers.map(([name, value]) => `  ${name}: ${value}`)].join('\n');
  return `${[
    '# Rename to _headers when deploying.\n# Cache-Control patterns do not overlap: hosts join the values of every matching rule.',
    rule('/*', security),
    ...IMMUTABLE_RULES.map(({ pattern }) => rule(pattern, [['Cache-Control', IMMUTABLE]])),
    ...NO_CACHE_PATTERNS.map((pattern) => rule(pattern, [['Cache-Control', NO_CACHE]])),
  ].join('\n\n')}\n`;
}
