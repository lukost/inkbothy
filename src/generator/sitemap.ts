import { escapeHtml } from '../lib/escape.ts';
import { absoluteUrl } from '../lib/url.ts';

export interface SitemapEntry {
  readonly url: string;
  readonly lastmod: string | null;
}

/** sitemaps.org XML. */
export function renderSitemap(baseUrl: string, entries: readonly SitemapEntry[]): string {
  const urls = entries.map(({ url, lastmod }) => {
    const loc = `<loc>${escapeHtml(absoluteUrl(baseUrl, url))}</loc>`;
    return `<url>${loc}${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
