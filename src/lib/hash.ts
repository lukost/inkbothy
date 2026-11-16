import { createHash } from 'node:crypto';

/** Short content hash for file names that change with their content. */
export function shortHash(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 10);
}
