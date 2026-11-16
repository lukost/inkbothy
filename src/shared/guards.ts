/** Plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Array whose items are all strings. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Message of any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `value`, or an error naming what is missing: a lookup that must succeed. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`missing ${what}`);
  }
  return value;
}

/** Own property `key` of `record`, ignoring inherited names such as `constructor`. */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
