// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSpeculationRules } from '../../src/generator/speculation.ts';
import { contentSecurityPolicy } from '../../src/lib/http-policy.ts';
import { isRecord } from '../../src/shared/guards.ts';

const ORIGIN = 'https://example.com';
const DOCUMENT_URL = `${ORIGIN}/blog/post/`;

/** Throws unless `value` is an object. */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value;
}

/**
 * Evaluates a document-rule predicate for the link `<a href="${href}">` on the page at
 * DOCUMENT_URL, as the Speculation Rules specification defines it. Unknown keys are errors.
 */
function matches(
  where: unknown,
  href: string,
  attributes: Readonly<Record<string, string>> = {},
): boolean {
  const condition = asRecord(where, 'condition');
  const entries = Object.entries(condition);
  const [entry] = entries;
  if (entries.length !== 1 || !entry) {
    throw new Error(`a condition has exactly one key: ${JSON.stringify(Object.keys(condition))}`);
  }
  const [key, operand] = entry;
  switch (key) {
    case 'and':
      return Array.isArray(operand) && operand.every((c) => matches(c, href, attributes));
    case 'or':
      return Array.isArray(operand) && operand.some((c) => matches(c, href, attributes));
    case 'not':
      return !matches(operand, href, attributes);
    case 'href_matches': {
      if (typeof operand !== 'string') {
        throw new Error('href_matches takes a pattern string here');
      }
      return new URLPattern(operand, DOCUMENT_URL).test(new URL(href, DOCUMENT_URL));
    }
    case 'selector_matches': {
      if (typeof operand !== 'string') {
        throw new Error('selector_matches takes a selector string');
      }
      const link = document.createElement('a');
      link.setAttribute('href', href);
      for (const [name, value] of Object.entries(attributes)) {
        link.setAttribute(name, value);
      }
      return link.matches(operand);
    }
    default:
      throw new Error(`unknown condition ${key}`);
  }
}

const { source, hash } = buildSpeculationRules();
const parsed = asRecord(JSON.parse(source), 'rules');

/** The single document rule, with its fields checked. */
function theRule(): Record<string, unknown> {
  const list = parsed.prerender;
  if (!Array.isArray(list) || list.length !== 1) {
    throw new Error('expected one prerender rule');
  }
  return asRecord(list[0], 'rule');
}

const prerendered = (href: string, attributes: Readonly<Record<string, string>> = {}): boolean =>
  matches(theRule().where, href, attributes);

describe('buildSpeculationRules', () => {
  it('is valid JSON with a prerender list and nothing else at the top', () => {
    expect(Object.keys(parsed)).toEqual(['prerender']);
    expect(source).not.toMatch(/<\/script|<!--/i);
  });

  it('prerenders on moderate eagerness, i.e. on hover', () => {
    expect(Object.keys(theRule()).sort()).toEqual(['eagerness', 'where']);
    expect(theRule().eagerness).toBe('moderate');
  });

  it('uses document rules (where), not a fixed url list', () => {
    expect(theRule()).not.toHaveProperty('urls');
    expect(Object.keys(asRecord(theRule().where, 'where'))).toEqual(['and']);
  });

  it.each([
    '/',
    '/blog/',
    '/blog/post/',
    '/blog/post/#section',
    '../other/',
    'https://example.com/projects/tool/',
    '/blog/category/linux/',
    '/attributions/',
    '/blog/post/image.png',
  ])('prerenders the page link %s', (href) => {
    expect(prerendered(href)).toBe(true);
  });

  it.each([
    ['a build-internal path', '/__preview/reload.js'],
    ['another internal path', '/__anything'],
    ['the sitemap', '/sitemap.xml'],
    ['a nested xml file', '/feeds/all.xml'],
    ['robots.txt', '/robots.txt'],
    ['the search index', '/search-index.json'],
    ['the manifest', '/manifest.json'],
    ['a json file in a subdirectory', '/data/x.json'],
    ['a fragment-only link', '#section'],
    ['a fragment-only link to the top', '#'],
    ['a pdf', '/files/paper.pdf'],
    ['an absolute xml link', 'https://example.com/sitemap.xml'],
  ])('leaves out %s', (_name, href) => {
    expect(prerendered(href)).toBe(false);
  });

  it.each([
    ['another origin', 'https://other.example/'],
    ['another origin with the same path', 'https://other.example/blog/'],
    ['a different port', 'https://example.com:8443/'],
    ['plain http', 'http://example.com/'],
  ])('leaves out %s: only same-origin links qualify', (_name, href) => {
    expect(prerendered(href)).toBe(false);
  });

  it.each([
    ['a download link', { download: '' }],
    ['a named download link', { download: 'report.csv' }],
    ['a nofollow link', { rel: 'nofollow' }],
    ['a link with several rel tokens, one of them nofollow', { rel: 'external nofollow noopener' }],
  ])('leaves out %s, whatever its address', (_name, attributes) => {
    expect(prerendered('/blog/', attributes)).toBe(false);
  });

  it('keeps links whose rel merely resembles nofollow, or that carry other attributes', () => {
    expect(prerendered('/blog/', { rel: 'noopener' })).toBe(true);
    expect(prerendered('/blog/', { rel: 'nofollowing' })).toBe(true);
    expect(prerendered('/blog/', { class: 'download', title: 'download' })).toBe(true);
  });

  it('does not exclude a page merely because its name contains an excluded word', () => {
    expect(prerendered('/blog/xml-parsing/')).toBe(true);
    expect(prerendered('/blog/json-schema/')).toBe(true);
    expect(prerendered('/blog/notes-txt/')).toBe(true);
    expect(prerendered('/blog/__init__/')).toBe(true);
  });

  it('is deterministic', () => {
    expect(buildSpeculationRules()).toEqual(buildSpeculationRules());
  });

  it('hashes exactly the inlined text, as a CSP sha256 source', () => {
    expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    expect(hash).toBe(`sha256-${createHash('sha256').update(source).digest('base64')}`);
  });

  it('is allowed by the policy built from its hash, which names no unsafe-inline', () => {
    const policy = contentSecurityPolicy({ scriptHashes: ['sha256-head=', hash] });
    expect(policy).toContain(`'${hash}'`);
    expect(policy.split('; ').find((d) => d.startsWith('script-src'))).not.toContain(
      'unsafe-inline',
    );
  });
});

describe('the evaluator (a test of the test)', () => {
  it('rejects conditions the specification does not define', () => {
    expect(() => matches({ nope: 1 }, '/')).toThrow('unknown condition nope');
    expect(() => matches({ and: [], not: {} }, '/')).toThrow('exactly one key');
    expect(() => matches([], '/')).toThrow('not an object');
    expect(() => matches({ href_matches: 3 }, '/')).toThrow('pattern string');
    expect(() => matches({ selector_matches: 3 }, '/')).toThrow('selector string');
  });

  it('combines and, or, not as Boolean logic', () => {
    const yes = { href_matches: '/*' };
    const no = { not: yes };
    expect(matches({ and: [yes, yes] }, '/a')).toBe(true);
    expect(matches({ and: [yes, no] }, '/a')).toBe(false);
    expect(matches({ or: [no, yes] }, '/a')).toBe(true);
    expect(matches({ or: [no, no] }, '/a')).toBe(false);
    expect(matches({ and: 'x' }, '/a')).toBe(false);
  });
});
