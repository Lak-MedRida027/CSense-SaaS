/**
 * Token store (plan 5.1, ADR 0014).
 *
 * - Access token: memory only. Never persisted, logged or sent over IPC.
 * - Refresh token: memory, plus `userData/session.v1.json` encrypted with `safeStorage` (DPAPI on
 *   Windows) when, and only when, real OS encryption is available. Otherwise memory-only: the user
 *   signs in at every launch. Nothing is ever written in plaintext and there is no override (S7).
 */
import { z } from 'zod';
import type { FsPort, SafeStoragePort } from '../electron/types';
import type { Logger } from '../log';

const fileSchema = z
  .object({
    v: z.literal(1),
    userId: z.string().min(1).max(64),
    refreshTokenExpiresAt: z.string().min(1).max(40),
    blob: z.string().min(1).max(8192),
  })
  .strict();

export interface StoredSession {
  userId: string;
  refreshToken: string;
  /** Epoch ms. */
  refreshExpiresAt: number;
}

export interface SessionTokens extends StoredSession {
  accessToken: string;
  /** Epoch ms. */
  accessExpiresAt: number;
}

export interface TokenStoreDeps {
  fs: FsPort;
  safeStorage: SafeStoragePort;
  /** Absolute path of session.v1.json. */
  filePath: string;
  log: Logger;
  now?: () => number;
}

export class TokenStore {
  private access: { token: string; expiresAt: number } | null = null;
  private refresh: StoredSession | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: TokenStoreDeps) {
    this.now = deps.now ?? Date.now;
  }

  private persistable = false;

  /**
   * True only when the OS can really encrypt (not Linux `basic_text`). Re-evaluated on load and on
   * every write, and cached for the synchronous `persistence` view. There is no override (S7).
   */
  async canPersist(): Promise<boolean> {
    try {
      const { safeStorage } = this.deps;
      if (!(await safeStorage.isEncryptionAvailable())) {
        this.persistable = false;
        return false;
      }
      const backend = safeStorage.selectedBackend();
      this.persistable = backend !== 'basic_text' && backend !== 'unknown';
    } catch {
      this.persistable = false;
    }
    return this.persistable;
  }

  /** Call once after `app.whenReady()` so `persistence` is accurate before the first sign-in. */
  async init(): Promise<void> {
    await this.canPersist();
  }

  get persistence(): 'encrypted' | 'memory_only' {
    return this.persistable ? 'encrypted' : 'memory_only';
  }

  /** Read the persisted session after `app.whenReady()`. Corrupt or expired files are deleted. */
  async load(): Promise<StoredSession | null> {
    const { fs, safeStorage, filePath, log } = this.deps;
    if (!(await this.canPersist())) return null;
    let raw: Buffer | null;
    try {
      raw = await fs.readFile(filePath);
    } catch {
      raw = null;
    }
    if (raw === null) return null;
    try {
      const parsed = fileSchema.parse(JSON.parse(raw.toString('utf8')));
      const expiresAt = Date.parse(parsed.refreshTokenExpiresAt);
      if (Number.isNaN(expiresAt) || expiresAt <= this.now()) {
        log.info('session.file_expired');
        await this.removeFile();
        return null;
      }
      const refreshToken = await safeStorage.decryptString(Buffer.from(parsed.blob, 'base64'));
      if (refreshToken === '') throw new Error('empty');
      this.refresh = { userId: parsed.userId, refreshToken, refreshExpiresAt: expiresAt };
      return this.refresh;
    } catch {
      // Another OS user, a DPAPI key change, or a damaged file: start signed out.
      log.warn('session.file_unreadable');
      await this.removeFile();
      return null;
    }
  }

  /** Replace the whole session (login, or refresh rotation). Memory first, then the encrypted file. */
  async set(tokens: SessionTokens): Promise<void> {
    this.access = { token: tokens.accessToken, expiresAt: tokens.accessExpiresAt };
    this.refresh = {
      userId: tokens.userId,
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
    };
    await this.persist();
  }

  getAccess(): { token: string; expiresAt: number } | null {
    return this.access;
  }

  getRefresh(): StoredSession | null {
    return this.refresh;
  }

  /** Wipe memory and file, whatever the network did. */
  async clear(): Promise<void> {
    this.access = null;
    this.refresh = null;
    await this.removeFile();
  }

  private async persist(): Promise<void> {
    const { fs, safeStorage, filePath, log } = this.deps;
    if (!this.refresh || !(await this.canPersist())) return;
    try {
      const blob = (await safeStorage.encryptString(this.refresh.refreshToken)).toString('base64');
      const body = JSON.stringify({
        v: 1,
        userId: this.refresh.userId,
        refreshTokenExpiresAt: new Date(this.refresh.refreshExpiresAt).toISOString(),
        blob,
      });
      const dir = filePath.slice(
        0,
        Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')),
      );
      if (dir) await fs.mkdir(dir);
      const tmp = `${filePath}.tmp`;
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, filePath);
    } catch {
      // The session keeps working from memory; the next launch simply asks for credentials.
      log.warn('session.persist_failed');
    }
  }

  private async removeFile(): Promise<void> {
    try {
      await this.deps.fs.unlink(this.deps.filePath);
    } catch {
      // Already gone.
    }
  }
}
