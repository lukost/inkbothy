interface Setting {
  readonly settings?: { readonly foreground?: string };
}

/** Distinct, lower-cased foreground colours a theme can paint, including its default. */
export function foregrounds(
  rules: readonly Setting[] | undefined,
  colors: Readonly<Record<string, string>> | undefined,
): string[] {
  const found = [
    colors?.['editor.foreground'],
    ...(rules ?? []).map((r) => r.settings?.foreground),
  ].filter((c): c is string => typeof c === 'string');
  return [...new Set(found.map((c) => c.toLowerCase()))].sort();
}
