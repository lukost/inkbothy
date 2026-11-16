/** Absolute URL for a root-relative `url` on the site at `baseUrl`. */
export function absoluteUrl(baseUrl: string, url: string): string {
  return new URL(url, baseUrl).href;
}

/** Normalised http(s) URL, or null for anything else (javascript:, file:, non-strings, garbage). */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
