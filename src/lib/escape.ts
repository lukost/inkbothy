const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for HTML/XML element content and quoted attribute values. */
export function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** `value` as a double-quoted CSS string; backslash, quote, `<` and control characters become hex escapes, safe in `<style>`. */
export function cssString(value: string): string {
  const escaped = value.replace(/[\\"<\p{Cc}]/gu, (c) => `\\${c.charCodeAt(0).toString(16)} `);
  return `"${escaped}"`;
}
