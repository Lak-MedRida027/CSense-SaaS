/**
 * A small JSON file encrypted with `safeStorage` (DPAPI on Windows), the same mechanism as the token
 * store (ADR 0014). Used for the last known gate state and the offline-release report queue.
 *
 * Fail closed on secrecy: if OS encryption is unavailable (or Linux `basic_text`) NOTHING is written;
 * the value lives in memory only. A corrupt or undecryptable file is deleted and reads as empty.
 * Layout: `{ "v": 1, "blob": base64(encrypt(JSON)) }`, written atomically (temp file, then rename).
 */
import { z } from 'zod';
import type { FsPort, SafeStoragePort } from '../electron/types';
import type { Logger } from '../log';

const envelope = z.object({ v: z.literal(1), blob: z.string().min(1).max(262_144) }).strict();

export async function canEncrypt(safeStorage: SafeStoragePort): Promise<boolean> {
  try {
    if (!(await safeStorage.isEncryptionAvailable())) return false;
    const backend = safeStorage.selectedBackend();
    return backend !== 'basic_text' && backend !== 'unknown';
  } catch {
    return false;
  }
}

export interface SecureFileDeps<T> {
  fs: FsPort;
  safeStorage: SafeStoragePort;
  filePath: string;
  log: Logger;
  /** Validates the decrypted JSON. Return null to treat the content as invalid. */
  parse: (value: unknown) => T | null;
  /** Name used in log lines (never content). */
  label: string;
}

export class SecureJsonFile<T> {
  constructor(private readonly deps: SecureFileDeps<T>) {}

  async read(): Promise<T | null> {
    const { fs, safeStorage, filePath, log, parse, label } = this.deps;
    if (!(await canEncrypt(safeStorage))) return null;
    let raw: Buffer | null;
    try {
      raw = await fs.readFile(filePath);
    } catch {
      raw = null;
    }
    if (raw === null) return null;
    try {
      const env = envelope.parse(JSON.parse(raw.toString('utf8')));
      const plain = await safeStorage.decryptString(Buffer.from(env.blob, 'base64'));
      const value = parse(JSON.parse(plain));
      if (value === null) throw new Error('invalid');
      return value;
    } catch {
      log.warn(`${label}.file_unreadable`);
      await this.remove();
      return null;
    }
  }

  private chain: Promise<void> = Promise.resolve();

  /** Persist when encryption is available; otherwise a no-op (memory-only). Writes are serialised. */
  write(value: T): Promise<void> {
    const next = this.chain.then(() => this.doWrite(value));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async doWrite(value: T): Promise<void> {
    const { fs, safeStorage, filePath, log, label } = this.deps;
    if (!(await canEncrypt(safeStorage))) return;
    try {
      const blob = (await safeStorage.encryptString(JSON.stringify(value))).toString('base64');
      const dir = filePath.slice(
        0,
        Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')),
      );
      if (dir) await fs.mkdir(dir);
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ v: 1, blob }));
      await fs.rename(tmp, filePath);
    } catch {
      log.warn(`${label}.persist_failed`);
    }
  }

  async remove(): Promise<void> {
    try {
      await this.deps.fs.unlink(this.deps.filePath);
    } catch {
      // Already gone.
    }
  }
}
