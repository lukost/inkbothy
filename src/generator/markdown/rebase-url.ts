const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Only the path matters; the origin just lets URL resolve.
const ORIGIN = 'https://rebase.invalid';

/** Attributes holding one URL. Inline `style="url(…)"` is not rebased. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'xlink:href',
  'src',
  'poster',
  'data',
  'cite',
]);

/** Resolve a document-relative URL against `baseUrl`; everything else is returned as is. */
export function rebaseUrl(value: string, baseUrl: string): string {
  if (value === '' || /^[/#\\]/.test(value) || SCHEME.test(value)) {
    return value;
  }
  const url = new URL(value, new URL(baseUrl, ORIGIN));
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Rebase the URL of every candidate in a `srcset`, keeping descriptors and spacing. */
export function rebaseSrcset(value: string, baseUrl: string): string {
  let expectUrl = true;
  const parts: string[] = [];
  for (const token of value.split(/(\s+)/)) {
    if (token.trim() === '') {
      parts.push(token);
    } else if (expectUrl) {
      // Commas around the URL separate candidates (`a.png, b.png 2x`, `a.png 1x,,b.png`); they are not part of it.
      const body = token.replace(/^,+/, '');
      const url = body.replace(/,+$/, '');
      parts.push(
        token.slice(0, token.length - body.length),
        rebaseUrl(url, baseUrl),
        body.slice(url.length),
      );
      expectUrl = url === '' || url !== body;
    } else {
      // A descriptor may run into the next URL: `1x,b.png`.
      const comma = token.indexOf(',');
      const next = comma === -1 ? '' : token.slice(comma + 1);
      parts.push(comma === -1 ? token : token.slice(0, comma + 1), rebaseSrcset(next, baseUrl));
      expectUrl = comma !== -1 && (next === '' || next.endsWith(','));
    }
  }
  return parts.join('');
}

/** The value of HTML attribute `name` (lower case) rebased; attributes that hold no URL are returned as is. */
export function rebaseAttribute(name: string, value: string, baseUrl: string): string {
  if (URL_ATTRIBUTES.has(name)) {
    return rebaseUrl(value, baseUrl);
  }
  return name === 'srcset' ? rebaseSrcset(value, baseUrl) : value;
}
