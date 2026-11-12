'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  raceAnalysisSchema,
  raceMutationResultSchema,
  raceUploadInputSchema,
  responseError,
  type RaceAnalysis,
  type RaceUploadInput,
} from '@athlete-panel/contracts';

export function useRaceAnalysis(raceId: string) {
  const [value, setValue] = useState<RaceAnalysis | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const token = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/plugins/race-analysis/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raceId }),
        signal: AbortSignal.timeout(15000),
      });
      const json: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(json, 'Unable to load this course.'));
      const result = raceAnalysisSchema.parse(json);
      if (token === sequence.current) setValue(result);
      return result;
    } catch (cause) {
      if (token === sequence.current)
        setError(cause instanceof Error ? cause.message : 'Unable to load this course.');
      return null;
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }, [raceId]);
  useEffect(() => {
    setValue(null);
    void reload();
    return () => {
      sequence.current++;
    };
  }, [reload]);
  return { value, error, loading, reload };
}
export async function uploadRaceFile(file: File, input: RaceUploadInput) {
  const form = new FormData();
  form.set('file', file);
  form.set('metadata', JSON.stringify(raceUploadInputSchema.parse(input)));
  const response = await fetch('/api/plugins/race-analysis/uploads/track', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  }).catch(() => {
    throw new Error(
      'The server did not answer. The file may have been saved. Reload saved data to check before trying again.',
    );
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(responseError(body, 'The upload failed. Your file selection has been kept.'));
  return raceMutationResultSchema.parse(body);
}
