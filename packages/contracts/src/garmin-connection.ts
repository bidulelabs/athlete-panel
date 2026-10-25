export interface GarminConnection {
  connected: boolean;
  verified?: boolean;
  paused: boolean;
  lastError: string | null;
  lastErrorCode?: string | null;
  checkedAt?: string;
  historyStatus?: string | null;
  currentJob?: { id: string; kind: string; status: string; progress: string; nextRunAt: string | null; retrying: boolean } | null;
  coverageSummary?: { windows: number; failed: number; complete: number; empty: number; unavailable?: number };
}
