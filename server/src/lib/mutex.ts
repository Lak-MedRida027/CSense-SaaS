export class MutexTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Task did not finish within ${String(timeoutMs)} ms`);
    this.name = 'MutexTimeoutError';
  }
}

/** A minimal in-process mutex: callers run one at a time, in arrival order. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Run `task` when every earlier task has finished. A failing task does not block later ones.
   * With `timeoutMs`, a task that has not settled by then is abandoned: its caller gets a
   * `MutexTimeoutError` and the queue moves on, so one hung call cannot stall every writer.
   * (The abandoned task may still complete later; its work must be safe to finish unobserved.)
   */
  run<T>(task: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const guarded = (): Promise<T> => {
      if (timeoutMs === undefined) return task();
      let timer: NodeJS.Timeout | undefined;
      const limit = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new MutexTimeoutError(timeoutMs));
        }, timeoutMs);
      });
      const running = task();
      // An abandoned task that fails later must not become an unhandled rejection.
      running.catch(() => undefined);
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
