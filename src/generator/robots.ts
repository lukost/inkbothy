import type { SiteConfig } from '../config/schema.ts';
import { absoluteUrl } from '../lib/url.ts';
import { FRAGMENT_FILE } from '../templates/article.ts';

/** `robots.txt`: everything may be crawled except the fragments of stream sections, which are not pages. */
export function renderRobots(baseUrl: string, sections: SiteConfig['sections']): string {
  const streams = Object.entries(sections).filter(([, { layout }]) => layout === 'stream');
  return [
    'User-agent: *',
    'Allow: /',
    ...streams.map(([key]) => `Disallow: /${key}/*/${FRAGMENT_FILE}`),
    '',
    `Sitemap: ${absoluteUrl(baseUrl, '/sitemap.xml')}`,
    '',
  ].join('\n');
}
