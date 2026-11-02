'use client';

import { useEffect, useState } from 'react';
import {
  responseError,
  workspaceEnvelopeSchema,
  type HealthRecord,
} from '@athlete-panel/contracts';

type HistoryResult = {
  from: string;
  to: string;
  attempt: number;
} & ({ records: HealthRecord[]; error?: never } | { records?: never; error: string });

/** Reuse the authenticated, bounded workspace read without changing Calendar's range. */
export function useHealthHistory(from: string, to: string) {
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/workspace?${new URLSearchParams({ from, to })}`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (response.status === 401) {
          window.location.assign('/login?next=%2Fhealth');
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(responseError(body, 'Unable to load health history.'));
        const records = workspaceEnvelopeSchema
          .parse(body)
          .state.health.filter((record) => record.localDate >= from && record.localDate <= to);
        if (!controller.signal.aborted) setResult({ from, to, attempt, records });
      } catch {
        if (!controller.signal.aborted)
          setResult({
            from,
            to,
            attempt,
            error: 'Unable to load health history for these dates. Try again.',
          });
      }
    }
    void load();
    return () => controller.abort();
  }, [from, to, attempt]);

  // Never show old measurements beneath newly selected dates, even before the effect runs.
  const current = result?.from === from && result.to === to && result.attempt === attempt;
  return {
    records: current ? result.records : undefined,
    error: current ? result.error : undefined,
    loading: !current,
    retry: () => setAttempt((value) => value + 1),
  };
}
