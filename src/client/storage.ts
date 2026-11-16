/** Remember `value` under `key`, or forget the key when `value` is null; a no-op without storage. */
export function remember(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Storage is unavailable: the choice lasts for this page only.
  }
}
