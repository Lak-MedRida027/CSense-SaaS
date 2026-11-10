import { readFileSync } from 'node:fs';
import { BACKEND_FILE, type BackendInfo } from './backendProcess';

export type { BackendInfo };

export function backend(): BackendInfo {
  return JSON.parse(readFileSync(BACKEND_FILE, 'utf8')) as BackendInfo;
}

/** Requests the API has handled so far (harness-only endpoint). */
export async function requestCount(b: BackendInfo = backend()): Promise<number> {
  const res = await fetch(`${b.origin}/__harness/requests`);
  return ((await res.json()) as { count: number }).count;
}

interface Envelope<T> {
  status: number;
  body: T;
}

/** Direct HTTP to the API (admin actions the desktop has no UI for yet). */
export async function api<T = unknown>(
  b: BackendInfo,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Envelope<T>> {
  const res = await fetch(`${b.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export async function loginHttp(
  b: BackendInfo,
  who: keyof BackendInfo['accounts'],
): Promise<string> {
  const r = await api<{ accessToken: string }>(b, 'POST', '/auth/login', {
    body: b.accounts[who],
  });
  if (r.status !== 200) throw new Error(`HTTP login failed for ${who}: ${String(r.status)}`);
  return r.body.accessToken;
}
