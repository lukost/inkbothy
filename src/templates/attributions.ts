import type { Attribution } from '../types.ts';
import { heading, html, type Markup } from './html.ts';

const SPDX_ID_RE = /^[A-Za-z0-9.+-]+$/;
const SAFE_CHAR_RE = /[A-Za-z0-9._-]/;
const ENCODER = new TextEncoder();

/** Injective, URL-safe encoding: other characters (incl. `~`, `@`) become `~XX` UTF-8 hex. */
function encodeFileName(name: string): string {
  let out = '';
  for (const char of name) {
    out += SAFE_CHAR_RE.test(char)
      ? char
      : [...ENCODER.encode(char)]
          .map((b) => `~${b.toString(16).toUpperCase().padStart(2, '0')}`)
          .join('');
  }
  return out;
}

/** Site-relative path of an entry's bundled licence text. */
export function licensePath(entry: Pick<Attribution, 'name' | 'version'>): string {
  const version = entry.version ? `@${encodeFileName(entry.version)}` : '';
  return `attributions/licenses/${encodeFileName(entry.name)}${version}.txt`;
}

function licenseLink(entry: Attribution): Markup | string {
  if (entry.licenseFile) {
    return html`<a href="/${licensePath(entry)}">${entry.license}</a>`;
  }
  if (SPDX_ID_RE.test(entry.license) && entry.license !== 'UNKNOWN') {
    return html`<a href="https://spdx.org/licenses/${entry.license}.html">${entry.license}</a>`;
  }
  return entry.license;
}

function entryList(entries: readonly Attribution[]): Markup {
  return html`<ul class="attribution-list">${entries.map(
    (e) => html`<li>
<strong>${e.url ? html`<a href="${e.url}">${e.name}</a>` : e.name}</strong>${e.version && html` ${e.version}`}
${e.author && html`<span class="attribution-author">by ${e.author}</span>`}
<span class="attribution-license">Licence: ${licenseLink(e)}</span>
</li>`,
  )}</ul>`;
}

/** `<main>` content of the attributions page: what ships to the browser, and what builds the site. */
export function renderAttributions(
  distributed: readonly Attribution[],
  builtWith: readonly Attribution[],
): Markup {
  return html`<section class="attributions">
${heading(1, 'Attributions')}
<p>This site is made with the following free and open-source software and assets.</p>
<h2>Distributed</h2>
<p>Served to your browser along with the pages.</p>
${distributed.length === 0 ? html`<p>No third-party components are currently distributed.</p>` : entryList(distributed)}
<h2>Built with</h2>
<p>Used to generate the site; none of it is served to your browser.</p>
${builtWith.length === 0 ? html`<p>No build-time components are listed.</p>` : entryList(builtWith)}
</section>`;
}
