import { describe, expect, it } from 'vitest';
import { renderRobots } from '../../src/generator/robots.ts';
import { CARDS, LIST, SECTIONS, STREAM } from '../helpers.ts';

describe('renderRobots', () => {
  it('allows everything except fragments, and names the absolute sitemap', () => {
    expect(renderRobots('https://example.com', SECTIONS)).toBe(
      'User-agent: *\nAllow: /\nDisallow: /blog/*/fragment.html\n\nSitemap: https://example.com/sitemap.xml\n',
    );
  });

  it('disallows the fragments of every stream section, and only of those', () => {
    const sections = { news: STREAM, notes: LIST, work: CARDS, diary: STREAM };
    expect(renderRobots('https://example.com', sections)).toBe(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /news/*/fragment.html',
        'Disallow: /diary/*/fragment.html',
        '',
        'Sitemap: https://example.com/sitemap.xml',
        '',
      ].join('\n'),
    );
  });

  it('has no Disallow line without stream sections', () => {
    expect(renderRobots('https://example.com', {})).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n',
    );
  });

  it('resolves the sitemap against a base URL with a path or trailing slash', () => {
    expect(renderRobots('https://example.com/', SECTIONS)).toContain(
      'Sitemap: https://example.com/sitemap.xml\n',
    );
  });
});
