'use client';
import { Alert } from '@athlete-panel/ui';
import {
  Button,
  NativeSelect,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@athlete-panel/ui';
import { useEffect, useState } from 'react';
import { ErrorMessage } from '@athlete-panel/ui';

type CoverageRow = {
  stream: string;
  from: string;
  to: string;
  status: string;
  records: number;
  missingDays: number;
  unknownMetrics: number;
  error: string | null;
};
type CoveragePage = { rows: CoverageRow[]; total: number; offset: number; limit: number };
export function CoverageHistory({
  checkedAt,
  disabled,
  onRetry,
}: {
  checkedAt?: string;
  disabled: boolean;
  onRetry: (from?: string, to?: string) => void;
}) {
  const [filter, setFilter] = useState('all'),
    [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ key: string; data: CoveragePage } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const key = `${filter}:${offset}`;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch('/api/plugins/garmin/coverage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter, offset }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Your session expired. Sign in again to check history.'
              : 'History coverage could not refresh. Try again.',
          );
        const data = (await response.json()) as CoveragePage;
        if (active) {
          setPage({ key, data });
          setError(null);
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : 'History coverage is unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [filter, offset, key, checkedAt, retry]);
  const result = page?.key === key ? page.data : null;
  return (
    <section className="section-block" aria-label="History coverage">
      <div className="section-heading">
        <div>
          <h2>History coverage</h2>
          <p className="muted-text">
            A verified connection does not mean history is complete. Empty and unavailable periods
            are not zero measurements.
          </p>
        </div>
        <Button variant="outline" className="button" disabled={disabled} onClick={() => onRetry()}>
          Retry date range
        </Button>
      </div>
      <label className="field">
        <span>Show history windows</span>
        <NativeSelect
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setOffset(0);
          }}
        >
          <option value="all">All windows</option>
          <option value="failed">Failed windows</option>
          <option value="unavailable">Unavailable windows</option>
        </NativeSelect>
      </label>
      <ErrorMessage error={error} />
      {error && (
        <Button variant="outline" className="button" onClick={() => setRetry((value) => value + 1)}>
          Reload coverage
        </Button>
      )}
      {filter === 'unavailable' && (
        <Alert role="status" className="callout">
          Garmin could not provide these periods. Check your key permissions and device/data
          availability before retrying.
        </Alert>
      )}
      {result ? (
        <>
          <p className="muted-text" role="status">
            {result.total
              ? `${offset + 1}–${Math.min(offset + result.rows.length, result.total)} of ${result.total} windows`
              : 'No matching windows.'}
            {loading ? ' · Refreshing…' : ''}
            {error ? ' · Last loaded result' : ''}
          </p>
          {!!result.rows.length && (
            <div className="coverage-scroll">
              <Table className="coverage-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Stream</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Through</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={`${row.stream}:${row.from}:${row.to}`}>
                      <TableCell>{row.stream}</TableCell>
                      <TableCell>
                        {row.from === '0001-01-01' ? 'Available history' : row.from}
                      </TableCell>
                      <TableCell>{row.to}</TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>{row.records}</TableCell>
                      <TableCell>
                        {row.error ||
                          `${row.missingDays} missing days · ${row.unknownMetrics} unknown measurements`}
                      </TableCell>
                      <TableCell>
                        {['failed', 'unavailable'].includes(row.status) &&
                          row.from !== '0001-01-01' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="button small"
                              disabled={disabled}
                              onClick={() => onRetry(row.from, row.to)}
                            >
                              Retry this period
                            </Button>
                          )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              className="button"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous windows
            </Button>
            <Button
              variant="outline"
              className="button"
              disabled={loading || offset + result.rows.length >= result.total}
              onClick={() => setOffset(offset + 50)}
            >
              Next windows
            </Button>
          </div>
        </>
      ) : (
        <p role="status">{loading ? 'Loading coverage…' : 'Coverage unavailable.'}</p>
      )}
    </section>
  );
}
