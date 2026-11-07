/** A minimal in-process mutex: callers run one at a time, in arrival order. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Run `task` when every earlier task has finished. A failing task does not block later ones. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
