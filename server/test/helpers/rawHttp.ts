import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

// supertest/superagent pass the URL through WHATWG `new URL()`, which collapses `./` and `../` and
// turns `\` into `/` before the request leaves the client. Path-normalisation attacks must go on
// the wire byte-for-byte, so they use node:http directly.

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function rawRequest(
  server: http.Server,
  opts: { method: string; path: string; headers?: Record<string, string>; body?: string | Buffer },
): Promise<RawResponse> {
  const { port } = server.address() as AddressInfo;
  const bodyHeaders: Record<string, string> =
    opts.body === undefined
      ? {}
      : {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(opts.body)),
        };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: { ...bodyHeaders, ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export async function listen(app: Express): Promise<http.Server> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

export async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
