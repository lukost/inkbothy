import { describe, expect, it } from 'vitest';
import {
  cacheControl,
  contentSecurityPolicy,
  renderHeaders,
  SECURITY_HEADERS,
  UNSERVED_FILES,
} from '../../src/lib/http-policy.ts';

describe('contentSecurityPolicy', () => {
  it('allows own resources, the listed inline scripts and inline styles, and nothing else', () => {
    expect(contentSecurityPolicy({ scriptHashes: ['sha256-a=', 'sha256-b='] })).toBe(
      [
        "default-src 'self'",
        "script-src 'self' 'sha256-a=' 'sha256-b='",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; '),
    );
  });

  it('has no trailing space without hashes, and never pairs unsafe-inline with style hashes', () => {
    const policy = contentSecurityPolicy({ scriptHashes: [] });
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toMatch(/style-src[^;]*sha256/);
  });
});

describe('cacheControl', () => {
  it.each([
    ['assets/main-ABC.js', true],
    ['assets/fonts/x.woff2', true],
    ['search-index.json', false],
    ['index.html', false],
    ['blog/a/index.html', false],
    ['404.html', false],
    ['assetsx/a.js', false],
    ['manifest.json', false],
  ])('%s -> immutable: %s', (rel, immutable) => {
    expect(cacheControl(rel)).toBe(immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
  });
});

describe('renderHeaders', () => {
  const text = renderHeaders('POLICY', false);

  /** Rules of a `_headers` file: pattern -> header lines. */
  function rules(file: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    let current: string[] = [];
    for (const line of file.split('\n')) {
      if (line.startsWith('/')) {
        current = [];
        out.set(line, current);
      } else if (line.startsWith('  ')) {
        current.push(line.trim());
      }
    }
    return out;
  }

  /** Netlify/Cloudflare pattern: `*` matches any characters. */
  const matcher = (pattern: string) =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    );

  it('says to rename the file and carries the security headers on every path', () => {
    expect(text.startsWith('# Rename to _headers when deploying.')).toBe(true);
    expect(rules(text).get('/*')).toEqual([
      'Content-Security-Policy: POLICY',
      ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}`),
    ]);
  });

  it('adds Strict-Transport-Security only for a production host', () => {
    expect(text).not.toContain('Strict-Transport-Security');
    expect(rules(renderHeaders('POLICY', true)).get('/*')).toContain(
      'Strict-Transport-Security: max-age=31536000',
    );
  });

  it('puts Cache-Control on no catch-all pattern', () => {
    expect(
      rules(text)
        .get('/*')
        ?.some((h) => h.startsWith('Cache-Control')),
    ).toBe(false);
  });

  it.each([
    '/',
    '/blog/',
    '/blog/a/',
    '/404.html',
    '/blog/a/fragment.html',
    '/robots.txt',
    '/sitemap.xml',
    '/attributions/licenses/mit.txt',
    '/assets/main-ABC.js',
    '/assets/fonts/f.woff2',
    '/search-index.json',
    '/blog/a/diagram.png',
  ])('gives %s at most one Cache-Control value, the one the preview sends', (url) => {
    const values = [...rules(text)]
      .filter(([pattern]) => matcher(pattern).test(url))
      .flatMap(([, headers]) => headers.filter((h) => h.startsWith('Cache-Control')));
    expect(values.length).toBeLessThanOrEqual(1);
    const rel = url.slice(1);
    if (/\.(png)$/.test(url)) {
      expect(values).toEqual([]);
    } else {
      expect(values).toEqual([`Cache-Control: ${cacheControl(rel)}`]);
    }
  });

  it('exposes the same security headers the preview sends, and never serves the host files', () => {
    expect(Object.keys(SECURITY_HEADERS)).toEqual([
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Cross-Origin-Opener-Policy',
      'Permissions-Policy',
    ]);
    expect([...UNSERVED_FILES].sort()).toEqual(['.generated', '_csp.txt', '_headers.txt']);
  });
});
