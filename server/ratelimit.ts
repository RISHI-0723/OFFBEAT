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

import type { Db } from "./db";

/**
 * Fixed-window limiter shared by every function instance through the database (one atomic upsert per attempt).
 * Windows are coarser than the sliding limiter above (a burst can straddle a boundary), which is acceptable here.
 */
export class DbRateLimiter {
  constructor(
    private db: Db,
    private name: string,
    private max: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  async take(key: string): Promise<boolean> {
    const t = this.now();
    const start = new Date(Math.floor(t / this.windowMs) * this.windowMs);
    const rows = await this.db.query<{ hits: number }>(
      "INSERT INTO rate_limits (key, window_start, hits) VALUES ($1, $2, 1) ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1 RETURNING hits",
      [`${this.name}:${key}`, start],
    );
    if (Math.random() < 0.01) await this.db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 hours'").catch(() => []);
    return rows[0]!.hits <= this.max;
  }
}
