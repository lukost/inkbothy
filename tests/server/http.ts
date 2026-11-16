import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';

export interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
  readonly text: string;
}

export interface Listening {
  readonly port: number;
  close(): Promise<void>;
}

/** Serve `listener` on an ephemeral loopback port. */
export async function listening(listener: http.RequestListener): Promise<Listening> {
  const server = http.createServer(listener);
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a === null || typeof a === 'string') {
        reject(new Error('no TCP address'));
      } else {
        resolve(a);
      }
    });
  });
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export interface RequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

/** Raw request: the path is sent as given and bodies are not decoded. */
export function request(
  port: number,
  rawPath: string,
  { method = 'GET', headers = {} }: RequestInit = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: rawPath, method, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', () => undefined);
        res.on('close', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            text: body.toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Every response carries the CSP and the fixed security headers. */
export function expectSecure(reply: Reply, csp: string): void {
  expect(reply.headers['content-security-policy']).toBe(csp);
  expect(reply.headers['x-content-type-options']).toBe('nosniff');
  expect(reply.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(reply.headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(reply.headers['permissions-policy']).toContain('camera=()');
  expect(reply.headers['strict-transport-security']).toBeUndefined();
}
