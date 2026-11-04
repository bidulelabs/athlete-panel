'use client';

import {
  chartsSummarySchema,
  type ChartsSummary,
  type ChartsSummaryInput,
} from '@athlete-panel/contracts';
import { useEffect, useState } from 'react';

export function useChartsSummary(selection: ChartsSummaryInput | null) {
  const [lastLoad, setLastLoad] = useState<{
    requestKey: string;
    summary?: ChartsSummary;
    error?: string;
  } | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey =
    selection && `${selection.template}:${selection.weekStart}:${selection.weeks}:${retryCount}`;
  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/plugins/charts/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selection),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Charts answered ${response.status}`);
        const summary = chartsSummarySchema.parse(await response.json());
        if (!controller.signal.aborted) setLastLoad({ requestKey, summary });
      } catch {
        if (!controller.signal.aborted)
          setLastLoad({ requestKey, error: 'This chart could not load for these dates.' });
      }
    })();
    return () => controller.abort();
  }, [selection, requestKey]);
  const loadForSelection = lastLoad?.requestKey === requestKey ? lastLoad : null;
  return {
    summary: loadForSelection
      ? loadForSelection.summary
      : requestKey
        ? lastLoad?.summary
        : undefined,
    loading: !loadForSelection,
    error: loadForSelection?.error,
    retry: () => setRetryCount((count) => count + 1),
  };
}
