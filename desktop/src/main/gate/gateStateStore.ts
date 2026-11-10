/**
 * Last server-known gate state per user (P5-M1). It exists for one decision: an employee whose last
 * known state is `restricted` must not be offered "Continue offline" (D5-5 outranks D5-12). It is
 * written from every gate status or attempt response, encrypted with `safeStorage` like the token
 * store, never plaintext. With no OS encryption it is memory-only, and the offline fail-open of
 * D5-12 applies on a later launch (documented residual risk).
 */
import { z } from 'zod';
import type { FsPort, SafeStoragePort } from '../electron/types';
import type { Logger } from '../log';
import { SecureJsonFile } from '../session/secureFile';

export type KnownGateState = 'restricted' | 'granted' | 'required';

const schema = z
  .object({
    userId: z.string().min(1).max(64),
    state: z.enum(['restricted', 'granted', 'required']),
    clearedUntil: z.string().max(40).nullable(),
    at: z.string().max(40),
  })
  .strict();
export type GateStateRecord = z.infer<typeof schema>;

export class GateStateStore {
  private current: GateStateRecord | null = null;
  private readonly file: SecureJsonFile<GateStateRecord>;
  private readonly now: () => number;

  constructor(deps: {
    fs: FsPort;
    safeStorage: SafeStoragePort;
    filePath: string;
    log: Logger;
    now?: () => number;
  }) {
    this.now = deps.now ?? Date.now;
    this.file = new SecureJsonFile<GateStateRecord>({
      fs: deps.fs,
      safeStorage: deps.safeStorage,
      filePath: deps.filePath,
      log: deps.log,
      label: 'gate_state',
      parse: (v) => {
        const r = schema.safeParse(v);
        return r.success ? r.data : null;
      },
    });
  }

  async load(): Promise<void> {
    this.current = await this.file.read();
  }

  /** The last state this machine learned from the server for `userId`, else null. */
  get(userId: string | null): GateStateRecord | null {
    return userId !== null && this.current?.userId === userId ? this.current : null;
  }

  async record(userId: string, state: KnownGateState, clearedUntil: string | null): Promise<void> {
    const next: GateStateRecord = {
      userId,
      state,
      clearedUntil,
      at: new Date(this.now()).toISOString(),
    };
    this.current = next;
    await this.file.write(next);
  }
}
