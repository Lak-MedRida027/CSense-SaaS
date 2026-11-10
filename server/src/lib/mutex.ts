export class MutexTimeoutError extends Error {
  /** Settles when the abandoned task finally does (never rejects). For a bounded wait by callers. */
  readonly settled: Promise<void>;
  constructor(timeoutMs: number, settled: Promise<void> = Promise.resolve()) {
    super(`Task did not finish within ${String(timeoutMs)} ms`);
    this.name = 'MutexTimeoutError';
    this.settled = settled;
  }
}

/** A minimal in-process mutex: callers run one at a time, in arrival order. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Run `task` when every earlier task has finished. A failing task does not block later ones.
   * With `timeoutMs`, a task that has not settled by then is abandoned: its signal is aborted (a
   * well-behaved task checks it before every side effect), its caller gets a `MutexTimeoutError`
   * and the queue moves on, so one hung call cannot stall every writer.
   */
  run<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<T> {
    const controller = new AbortController();
    const guarded = (): Promise<T> => {
      if (timeoutMs === undefined) return task(controller.signal);
      let timer: NodeJS.Timeout | undefined;
      const running = task(controller.signal);
      const settled = running.then(
        () => undefined,
        () => undefined,
      );
      const limit = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new MutexTimeoutError(timeoutMs, settled));
        }, timeoutMs);
      });
      return Promise.race([running, limit]).finally(() => {
        clearTimeout(timer);
      });
    };
    const result = this.tail.then(guarded);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
