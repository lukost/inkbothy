/** Code-unit order for machine keys (URLs, ISO dates, file names); locale-independent. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Case-insensitive English order for human-readable labels. */
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}
