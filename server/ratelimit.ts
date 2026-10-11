/** Small in-memory sliding-window limiter. Per-process: adequate for a single-instance prototype. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Returns true if the call is allowed (and records it). */
  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
    return true;
  }
}
