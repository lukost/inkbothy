import { Parser } from 'htmlparser2';

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
]);

/** A `javascript:` URL, ignoring case and the whitespace and control characters browsers skip. */
const isScriptUrl = (value: string): boolean =>
  value
    .replace(/[\s\p{Cc}]/gu, '')
    .toLowerCase()
    .startsWith('javascript:');

/**
 * Markup in rendered content that the site's CSP would block or that weakens it: inline scripts,
 * event-handler attributes, `javascript:` URLs and `<base>`.
 *
 * @returns one message per kind found
 */
export function cspIssues(html: string): string[] {
  const found = new Set<string>();
  const parser = new Parser({
    onopentag(name, attribs) {
      if (name === 'script' && !('src' in attribs)) {
        found.add('inline <script> is blocked by the Content-Security-Policy');
      }
      if (name === 'base') {
        found.add('<base> is not allowed by the Content-Security-Policy');
      }
      for (const [attr, value] of Object.entries(attribs)) {
        if (/^on/i.test(attr)) {
          found.add(`event-handler attribute ${attr} is blocked by the Content-Security-Policy`);
        }
        if (URL_ATTRIBUTES.has(attr.toLowerCase()) && isScriptUrl(value)) {
          found.add('javascript: URL is blocked by the Content-Security-Policy');
        }
      }
    },
  });
  parser.end(html);
  return [...found];
}
