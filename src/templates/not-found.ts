import { heading, html, type Markup } from './html.ts';

/** Main content of the not-found page; its links are root-relative because it is served at any path. */
export function renderNotFound(): Markup {
  return html`<article>
${heading(1, 'Page not found')}
<p>There is nothing at this address. The link may be wrong, or the page may have moved.</p>
<p><a href="/">Back to the home page</a></p>
</article>`;
}
