/**
 * Offline-release reporting (P5-M1, D5-12). When the workstation is released while the API is
 * unreachable, that fact is queued (encrypted with `safeStorage`, like the token store) and sent to
 * `POST /gate/offline-releases` as soon as the API answers. Delivery is at least once and idempotent
 * per `releasedAt` (the server de-duplicates by user and releasedAt). Entries belong to the user
 * who was signed in; another user's entries are never sent under a different bearer token.
 */
import { z } from 'zod';
import type { ApiClient } from '../api/client';
import { OPERATIONS } from '../api/operations';
import type { FsPort, SafeStoragePort } from '../electron/types';
import type { Logger } from '../log';
import { SecureJsonFile } from '../session/secureFile';

const entrySchema = z
  .object({
    userId: z.string().min(1).max(64),
    releasedAt: z.iso.datetime(),
    /** Set when the release ended (re-lock or reconnect); else measured at send time. */
    endedAt: z.iso.datetime().nullable(),
  })
  .strict();
const queueSchema = z.array(entrySchema).max(200);
export type OfflineReleaseEntry = z.infer<typeof entrySchema>;

export class OfflineReporter {
  private queue: OfflineReleaseEntry[] = [];
  private flushing: Promise<void> | null = null;
  private readonly file: SecureJsonFile<OfflineReleaseEntry[]>;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      api: ApiClient;
      fs: FsPort;
      safeStorage: SafeStoragePort;
      filePath: string;
      log: Logger;
      now?: () => number;
    },
  ) {
    this.now = deps.now ?? Date.now;
    this.file = new SecureJsonFile<OfflineReleaseEntry[]>({
      fs: deps.fs,
      safeStorage: deps.safeStorage,
      filePath: deps.filePath,
      log: deps.log,
      label: 'offline_reports',
      parse: (v) => {
        const r = queueSchema.safeParse(v);
        return r.success ? r.data : null;
      },
    });
  }

  async load(): Promise<void> {
    this.queue = (await this.file.read()) ?? [];
  }

  pending(): readonly OfflineReleaseEntry[] {
    return this.queue;
  }

  async add(userId: string): Promise<void> {
    this.queue.push({
      userId,
      releasedAt: new Date(this.now()).toISOString(),
      endedAt: null,
    });
    this.queue = this.queue.slice(-200);
    await this.persist();
  }

  /** The offline release ended (workstation re-locked or the API answered). */
  async markEnded(userId: string): Promise<void> {
    const open = this.queue.find((e) => e.userId === userId && e.endedAt === null);
    if (!open) return;
    open.endedAt = new Date(this.now()).toISOString();
    await this.persist();
  }

  /** Send everything queued for `userId`. Single-flight; failures leave the entry queued. */
  flush(userId: string): Promise<void> {
    if (this.flushing) return this.flushing;
    const p = this.doFlush(userId).finally(() => {
      this.flushing = null;
    });
    this.flushing = p;
    return p;
  }

  private async doFlush(userId: string): Promise<void> {
    for (const entry of [...this.queue]) {
      if (entry.userId !== userId) continue;
      const ended = Date.parse(entry.endedAt ?? '') || this.now();
      const seconds = Math.max(0, Math.floor((ended - Date.parse(entry.releasedAt)) / 1000));
      const res = await this.deps.api.call(OPERATIONS['gate.offlineRelease'], {
        body: { releasedAt: entry.releasedAt, reason: 'api_unreachable', durationSeconds: seconds },
      });
      if (res.ok) {
        await this.drop(entry);
        continue;
      }
      const code = res.error.code;
      // The server refused the report itself (too old, malformed): resending cannot help.
      if (code === 'VALIDATION_ERROR' || code === 'BAD_REQUEST') {
        this.deps.log.warn('offline_reports.dropped', { code });
        await this.drop(entry);
        continue;
      }
      return; // network, auth, 5xx, restricted: keep and retry on the next opportunity
    }
  }

  private async drop(entry: OfflineReleaseEntry): Promise<void> {
    this.queue = this.queue.filter((e) => e !== entry);
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.queue.length === 0) await this.file.remove();
    else await this.file.write(this.queue);
  }
}
