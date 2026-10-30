'use client';
import './coverage.css';
import {
  coveragePageSchema,
  importStreamSchema,
  type ImportStream,
  type CoveragePage,
} from '@athlete-panel/contracts';
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

export function CoverageHistory({
  checkedAt,
  disabled,
  onRetry,
}: {
  checkedAt?: string;
  disabled: boolean;
  onRetry: (from?: string, to?: string, stream?: ImportStream) => void;
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
        const data = coveragePageSchema.parse(await response.json());
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
    <section aria-label="History coverage results">
      <div className="section-heading">
        <div>
          <p className="muted-text">
            Scanned means Garmin answered a request. It does not mean every measurement was
            available. Missing data is not a zero measurement.
          </p>
        </div>
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
          <option value="unscanned">Unscanned windows</option>
          <option value="failed">Failed windows</option>
          <option value="unavailable">Unavailable windows</option>
          <option value="rejected">Rejected records</option>
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
                    <TableHead>Scan / data</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={`${row.stream}:${row.from}:${row.to}`}>
                      <TableCell data-label="Stream">{row.stream}</TableCell>
                      <TableCell data-label="From">
                        {row.from === '0001-01-01' ? 'Available history' : row.from}
                      </TableCell>
                      <TableCell data-label="Through">{row.to}</TableCell>
                      <TableCell data-label="Scan / data">
                        {row.scanState ?? 'unscanned'} · {row.status}
                      </TableCell>
                      <TableCell data-label="Records">
                        {row.scanState === 'unscanned' ? '—' : row.records}
                      </TableCell>
                      <TableCell data-label="Details">
                        {row.scanState === 'unscanned'
                          ? 'No completed scan covers this period.'
                          : row.error ||
                            `${row.missingDays} missing days · ${row.unknownMetrics} unknown measurements`}
                        {row.rejectedRecords > 0 && (
                          <details>
                            <summary>
                              {row.rejectedRecords} rejected record
                              {row.rejectedRecords === 1 ? '' : 's'}
                            </summary>
                            <p>
                              Showing {row.diagnostics.length} diagnostic samples. Retry this period
                              after correcting the source or importer.
                            </p>
                            <ul>
                              {row.diagnostics.map((item, index) => (
                                <li key={index}>
                                  {item.date ?? 'Date unavailable'} ·{' '}
                                  {item.identifier
                                    ? `Record ${item.identifier}`
                                    : `Row ${item.index + 1}`}{' '}
                                  · {item.code.replaceAll('_', ' ')}
                                  {item.fields.length ? ` (${item.fields.join(', ')})` : ''}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </TableCell>
                      <TableCell data-label="Action">
                        {(['failed', 'unavailable', 'unscanned'].includes(row.status) ||
                          row.rejectedRecords > 0) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="button small"
                            disabled={disabled}
                            onClick={() => {
                              const stream = importStreamSchema.safeParse(row.stream);
                              onRetry(row.from, row.to, stream.success ? stream.data : undefined);
                            }}
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
