/** Node system error (has string `code` and `syscall`; library errors with only `code` don't qualify). */
export function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return (
    value instanceof Error &&
    'code' in value &&
    typeof value.code === 'string' &&
    'syscall' in value
  );
}
