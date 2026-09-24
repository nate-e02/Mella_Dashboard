/**
 * Per-connection outbound coalescing: at most one frame per key per
 * interval, always the latest value. Pure so it can be unit-tested.
 */
export class Coalescer<T> {
  private lastSentAt = new Map<string, number>();
  private pending = new Map<string, { value: T; intervalMs: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Returns the value to send right now, or null if it was queued as pending. */
  offer(key: string, value: T, intervalMs: number): T | null {
    const now = this.now();
    const last = this.lastSentAt.get(key);
    if (last === undefined || now - last >= intervalMs) {
      if (!this.pending.has(key)) {
        this.lastSentAt.set(key, now);
        return value;
      }
    }
    this.pending.set(key, { value, intervalMs });
    return null;
  }

  /** Pending values whose interval has elapsed (call from a periodic flush). */
  drain(): { key: string; value: T }[] {
    const now = this.now();
    const out: { key: string; value: T }[] = [];
    for (const [key, entry] of this.pending) {
      const last = this.lastSentAt.get(key) ?? 0;
      if (now - last >= entry.intervalMs) {
        this.pending.delete(key);
        this.lastSentAt.set(key, now);
        out.push({ key, value: entry.value });
      }
    }
    return out;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  forget(key: string) {
    this.pending.delete(key);
    this.lastSentAt.delete(key);
  }
}
