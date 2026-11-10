/**
 * Cover windows (plan 2, R6): while locked, every display other than the one the gate is on gets a
 * non-interactive cover, and hot-plugged displays are covered too.
 */
import type { CoverWindowPort, DisplaysPort } from '../electron/types';

export class CoverManager {
  private readonly covers = new Map<number, CoverWindowPort>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly displays: DisplaysPort) {}

  get active(): boolean {
    return this.unsubscribe !== null;
  }

  count(): number {
    return this.covers.size;
  }

  enable(): void {
    if (this.unsubscribe) {
      this.sync();
      return;
    }
    this.unsubscribe = this.displays.onChange(() => {
      this.sync();
    });
    this.sync();
  }

  disable(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const c of this.covers.values()) c.close();
    this.covers.clear();
  }

  private sync(): void {
    const all = this.displays.all();
    const mainId = this.displays.windowDisplayId();
    const wanted = new Map(all.filter((d) => d.id !== mainId).map((d) => [d.id, d]));
    for (const [id, cover] of this.covers) {
      if (!wanted.has(id)) {
        cover.close();
        this.covers.delete(id);
      }
    }
    for (const [id, display] of wanted) {
      const existing = this.covers.get(id);
      if (existing) existing.setBounds(display.bounds);
      else this.covers.set(id, this.displays.createCover(display));
    }
  }
}
