import type { HistorySummary } from '@athlete-panel/contracts';

type Entry = { rows: HistorySummary[]; bytes: number; expiresAt: number };

/** Disposable process-local summaries. Authorization and collection versions are checked by every caller. */
export class HistorySummaryCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(
    private readonly maxBytes = 32 * 1024 * 1024,
    private readonly maxEntries = 8,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  private prune(now: number) {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(key);
  }
  get(key: string, now = Date.now()): HistorySummary[] | undefined {
    this.prune(now);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.rows;
  }
  put(key: string, rows: HistorySummary[], grantExpiresAt: number, now = Date.now()) {
    this.prune(now);
    this.remove(key);
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    const expiresAt = Math.min(grantExpiresAt, now + this.ttlMs);
    // Oversized results remain correct; they simply do not benefit from reuse.
    if (bytes > this.maxBytes || expiresAt <= now) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.remove(oldest);
    }
    this.entries.set(key, { rows, bytes, expiresAt });
    this.bytes += bytes;
  }
}

export const historySummaryCache = new HistorySummaryCache();
