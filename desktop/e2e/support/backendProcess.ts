import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Shape of the harness ready line (server/src/testing/e2eServer.ts, ADR 0018). */
export interface BackendInfo {
  baseUrl: string;
  origin: string;
  accounts: Record<
    'admin' | 'admin2' | 'gate-pass' | 'gate-fail' | 'quiz',
    { email: string; password: string }
  >;
  gateKey: Record<string, number>;
  gateKeyText: Record<string, string>;
}

/** Playwright runs from desktop/ (where playwright.config.mts lives). */
export const RUN_DIR = resolve(process.cwd(), 'e2e/.run');
export const BACKEND_FILE = resolve(RUN_DIR, 'backend.json');
const HARNESS = resolve(process.cwd(), '../server/dist/src/testing/e2eServer.js');
const STARTUP_TIMEOUT_MS = 90_000; // covers the first MongoDB binary download

let child: ChildProcess | null = null;

export function startBackend(): Promise<BackendInfo> {
  return new Promise((resolveReady, reject) => {
    // stdin stays open (pipe): the harness exits when it closes.
    const proc = spawn(process.execPath, [HARNESS], {
      cwd: resolve(process.cwd(), '..'),
      env: { ...process.env, NODE_ENV: 'test', CSENSE_E2E_HARNESS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = proc;
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      reject(new Error(`e2e harness not ready after ${String(STARTUP_TIMEOUT_MS)} ms\n${err}`));
    }, STARTUP_TIMEOUT_MS);
    proc.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    proc.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      const line = out.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      try {
        const info = JSON.parse(line) as BackendInfo;
        clearTimeout(timer);
        mkdirSync(RUN_DIR, { recursive: true });
        writeFileSync(BACKEND_FILE, JSON.stringify(info));
        resolveReady(info);
      } catch {
        // partial line: wait for more
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`e2e harness exited early (code ${String(code)})\n${err}`));
    });
  });
}

export async function stopBackend(): Promise<void> {
  const proc = child;
  child = null;
  if (!proc || proc.exitCode !== null) return;
  const exited = new Promise<void>((r) =>
    proc.once('exit', () => {
      r();
    }),
  );
  proc.stdin?.end(); // graceful: the harness stops mongod itself when stdin closes
  const killer = setTimeout(() => proc.kill(), 15_000);
  await exited;
  clearTimeout(killer);
}
