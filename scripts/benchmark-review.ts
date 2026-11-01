/** Synthetic service-level benchmark, including complete paginated exports and a populated annual plan. */
import postgres from 'postgres';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isolatedDatabaseUrl } from '../tests/support/test-database';
import { seedHistoricalDataset, historicalRange } from '../tests/fixtures/historical';
import { annualRange, seedAnnualReview } from '../tests/fixtures/annual-review';
import { connection, closeDatabase } from '../packages/host/src/db';
import { migrate } from '../packages/host/src/migrations';
import {
  createGrant,
  contextForToken,
  submitProposal,
  reviewProposal,
  applyProposal,
  undoChange,
  proposalDetails,
} from '../plugins/agent-bridge/service';
import { readHistory } from '../plugins/agent-bridge/history';
import { mutate } from '../plugins/training/service';
import type { HistoryQuery } from '@athlete-panel/contracts';
const historyOnly = process.argv.includes('--history-only');
const requested = Number(process.argv[2] ?? 30000);
const label = process.argv[3] ?? 'current';
if (![30000, 100000].includes(requested) || !/^[a-z0-9-]+$/.test(label))
  throw new Error('Use 30000 or 100000 and an optional lowercase report label.');
const base = isolatedDatabaseUrl(),
  admin = postgres(base, { max: 1, onnotice: () => {} });
const name = `review_benchmark_${process.pid}_test`,
  url = new URL(base);
url.pathname = `/${name}`;
let queries = 0,
  historyQueries = 0;
let onHistoryScan: (() => void) | undefined;
let captureRead = false;
let readQuery: { text: string; parameters: postgres.SerializableParameter[] } | undefined;
const samples: Record<string, unknown> = {};
async function measure<T>(key: string, fn: () => Promise<T>, runs = 1): Promise<T> {
  const timings: number[] = [],
    queryCounts: number[] = [],
    readCounts: number[] = [],
    bytes: number[] = [];
  const before = process.memoryUsage();
  let rss = before.rss,
    heap = before.heapUsed;
  const memory = () => {
    const m = process.memoryUsage();
    rss = Math.max(rss, m.rss);
    heap = Math.max(heap, m.heapUsed);
  };
  const timer = setInterval(memory, 5);
  let value!: T;
  try {
    for (let i = 0; i < runs; i++) {
      const count = queries,
        reads = historyQueries,
        start = performance.now();
      value = await fn();
      bytes.push(Buffer.byteLength(JSON.stringify(value)));
      timings.push(performance.now() - start);
      queryCounts.push(queries - count);
      readCounts.push(historyQueries - reads);
      memory();
    }
  } finally {
    clearInterval(timer);
  }
  const sorted = timings.slice(1).sort((a, b) => a - b);
  samples[key] = {
    ...(key.endsWith('CompleteExport') ? { export: value } : {}),
    runs,
    timingsMs: timings,
    queryCounts,
    historyReadCounts: readCounts,
    responseBytes: bytes,
    warmP50Ms: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null,
    warmP95Ms: sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      : null,
    rssBefore: before.rss,
    peakRss: rss,
    heapBefore: before.heapUsed,
    peakHeap: heap,
  };
  console.log(`${key}: ${timings.map((t) => t.toFixed(1)).join(', ')} ms`);
  return value;
}
try {
  await admin`create database ${admin(name)}`;
  process.env.DATABASE_URL = url.toString();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  (globalThis as unknown as { athletePanelSql: ReturnType<typeof postgres> }).athletePanelSql =
    postgres(url.toString(), {
      max: 8,
      onnotice: () => {},
      debug: (_id, text, parameters) => {
        queries++;
        if (
          /^\s*(?:select|with)\b/i.test(text) &&
          /\bfrom\s+(?:activity_records\.records|training\.records|athlete\.records|garmin\.coverage)\b/i.test(
            text,
          )
        ) {
          historyQueries++;
          if (captureRead) {
            readQuery = { text, parameters };
            captureRead = false;
          }
          onHistoryScan?.();
          onHistoryScan = undefined;
        }
      },
    });
  await migrate();
  const dataset = await connection().begin((tx) => seedHistoricalDataset(tx, requested));
  const fixture = await connection().begin(seedAnnualReview);
  await connection()`analyze activity_records.records`;
  await connection()`analyze training.records`;
  const { token } = await createGrant({
    label: 'Synthetic performance',
    version: 2,
    history: {
      ...historicalRange,
      categories: ['activities', 'health', 'training', 'context'],
      weekStartsOn: 1,
    },
    planning: annualRange,
  });
  const discovery = await measure('discovery', () => readHistory(token, 'discover'), 4);
  const first = await measure('summaryFirstPage', () =>
    readHistory(token, 'summary', { reviewToken: discovery.reviewToken, limit: 100 }),
  );
  if (!first.nextCursor) throw new Error('Fixture must span several summary pages');
  await measure(
    'summaryNextPage',
    () =>
      readHistory(token, 'summary', {
        ...first.query,
        reviewToken: first.reviewToken,
        cursor: first.nextCursor!,
      }),
    4,
  );
  async function exportSummary(accessToken: string, reviewToken: string) {
    let page = await readHistory(accessToken, 'summary', {
      reviewToken,
      limit: 100,
    });
    let pages = 0,
      rows = 0,
      totalBytes = 0,
      maxPageBytes = 0;
    for (;;) {
      const size = Buffer.byteLength(JSON.stringify(page));
      pages++;
      rows += page.summaries!.length;
      totalBytes += size;
      maxPageBytes = Math.max(maxPageBytes, size);
      if (!page.nextCursor) break;
      page = await readHistory(accessToken, 'summary', {
        ...page.query,
        reviewToken: page.reviewToken,
        cursor: page.nextCursor,
      });
    }
    return { pages, rows, totalBytes, maxPageBytes };
  }
  await measure('summaryCompleteExport', () => exportSummary(token, discovery.reviewToken!), 2);
  // A different grant cannot reuse the preceding grant's aggregates. Database caches remain warm.
  const freshGrant = await createGrant({
    label: 'Synthetic fresh export',
    version: 2,
    planning: null,
    history: {
      ...historicalRange,
      categories: ['activities', 'health', 'training', 'context'],
      weekStartsOn: 1,
    },
  });
  const freshDiscovery = await readHistory(freshGrant.token, 'discover');
  await measure('summaryFreshCompleteExport', () =>
    exportSummary(freshGrant.token, freshDiscovery.reviewToken!),
  );
  // Include the CLI's automatic discovery in a complete first export, with a fresh grant/cache key.
  const workflowGrant = await createGrant({
    label: 'Synthetic automatic export',
    version: 2,
    planning: null,
    history: {
      ...historicalRange,
      categories: ['activities', 'health', 'training', 'context'],
      weekStartsOn: 1,
    },
  });
  await measure('automaticCompleteExport', async () => {
    const start = await readHistory(workflowGrant.token, 'discover');
    return exportSummary(workflowGrant.token, start.reviewToken);
  });
  await measure(
    'selectedMonthRecords',
    () =>
      readHistory(token, 'records', {
        reviewToken: discovery.reviewToken,
        category: 'activities',
        sport: 'running',
        from: '2025-10-01',
        to: '2025-10-31',
        limit: 100,
      }),
    4,
  );
  const detailPage = await readHistory(token, 'records', { category: 'activities', limit: 100 });
  await measure(
    'nextDetailPage',
    () =>
      readHistory(token, 'records', {
        ...detailPage.query,
        reviewToken: detailPage.reviewToken,
        cursor: detailPage.nextCursor!,
      }),
    4,
  );
  const queryPlans: Record<string, unknown> = {};
  for (const [label, query] of [
    [
      'activitiesMonth',
      { category: 'activities', sport: 'running', from: '2025-10-01', to: '2025-10-31' },
    ],
    ['healthMonth', { category: 'health', metric: 'steps', from: '2025-10-01', to: '2025-10-31' }],
    ['workoutsMonth', { category: 'workouts', from: '2025-10-01', to: '2025-10-31' }],
    ['workoutsFiveYears', { category: 'workouts' }],
    ['plans', { category: 'plans' }],
    ['events', { category: 'events' }],
  ] as [string, Partial<HistoryQuery>][]) {
    readQuery = undefined;
    captureRead = true;
    await readHistory(token, 'records', { ...query, limit: 100 });
    if (!readQuery) throw new Error(`No query captured for ${label}`);
    const captured = readQuery as { text: string; parameters: postgres.SerializableParameter[] };
    queryPlans[label] = (
      await connection().unsafe(
        `explain (analyze,buffers,format json) ${captured.text}`,
        captured.parameters,
      )
    )[0];
  }
  let snapshot: postgres.Row[] = [];
  let requestBytes = 0;
  if (!historyOnly) {
    const context = await measure('planningContext', () => contextForToken(token));
    const input = {
      commands: fixture.commands,
      summary: 'Synthetic 1500-command annual revision',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    };
    requestBytes = Buffer.byteLength(JSON.stringify(input));
    const submitted = await measure('annualSubmit', () => submitProposal(token, input));
    await measure('annualIdempotentSubmit', () => submitProposal(token, input));
    await measure(
      'annualReview',
      () => reviewProposal({ id: submitted.id, digest: submitted.digest }),
      4,
    );
    await measure('annualDetails', () => proposalDetails({ id: submitted.id }), 4);
    const applied = await measure('annualApply', () =>
      applyProposal({ id: submitted.id, digest: submitted.digest, idempotencyKey: randomUUID() }),
    );
    await measure('annualUndo', () => undoChange({ id: applied.id, idempotencyKey: randomUUID() }));
    snapshot =
      await connection()`select octet_length(context::text) as context_bytes,octet_length(changes::text) as diff_bytes from host.proposals where id=${submitted.id}`;
  }
  const concurrentGrant = await createGrant({
    label: 'Synthetic concurrent read',
    version: 2,
    planning: null,
    history: {
      ...historicalRange,
      categories: ['activities', 'health', 'training'],
      weekStartsOn: 1,
    },
  });
  let signalScan!: () => void;
  const scanning = new Promise<void>((resolve) => {
    signalScan = resolve;
  });
  onHistoryScan = signalScan;
  const historyStart = performance.now();
  const pendingRead = readHistory(concurrentGrant.token, 'summary').then(
    () => ({ result: 'success', durationMs: performance.now() - historyStart }),
    (error: unknown) => ({
      result: String((error as { code?: string }).code ?? error),
      durationMs: performance.now() - historyStart,
    }),
  );
  await Promise.race([
    scanning,
    pendingRead.then(() => {
      throw new Error('Summary finished before source scan observation');
    }),
  ]);
  const saveStart = performance.now();
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      {
        action: 'workout.create',
        values: {
          title: 'Synthetic concurrent save',
          sport: 'running',
          schedule: { kind: 'independent', date: '2026-10-30' },
        },
      },
    ],
  });
  const concurrentSaveMs = performance.now() - saveStart;
  const concurrentRead = await pendingRead;
  console.log(
    `Concurrent workout save: ${concurrentSaveMs.toFixed(1)} ms; summary ${concurrentRead.result} after ${concurrentRead.durationMs.toFixed(1)} ms`,
  );
  const plans =
    await connection()`explain (analyze,buffers,format json) select id,data->>'localDate' as date,data from activity_records.records where kind='activity' and deleted=false and data->>'localDate'>=${historicalRange.from} and data->>'localDate'<=${historicalRange.to} order by data->>'localDate',id limit 1000`;
  const result = {
    generatedAt: new Date().toISOString(),
    label,
    dataset: {
      ...dataset,
      annualExistingWorkouts: 1000,
      annualPlans: 1,
      total: dataset.total + 1001,
    },
    historyOnly,
    commands: historyOnly
      ? null
      : {
          total: 1500,
          create: 500,
          update: 500,
          delete: 500,
          requestBytes,
        },
    environment: {
      node: process.version,
      postgres: (await connection()`select version()`)[0]!.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      cpuCount: cpus().length,
      systemMemoryBytes: totalmem(),
    },
    samples,
    snapshot: snapshot[0],
    concurrent: { workoutSaveMs: concurrentSaveMs, summary: concurrentRead },
    representativeRecordQueryPlan: plans[0],
    queryPlans,
    resources: process.resourceUsage(),
    limitations: [
      'Synthetic local service execution, not production capacity or browser/HTTP latency.',
      'First calls are not cold-cache measurements. Warm quantiles use only three samples.',
      'Memory includes fixture generation and preceding operations; 5 ms sampling misses short synchronous peaks.',
    ],
  };
  await mkdir('.runtime/review-performance', { recursive: true });
  const path = `.runtime/review-performance/${label}-${requested}.json`;
  await writeFile(path, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(`Report: ${path}`);
} finally {
  await closeDatabase();
  await admin`drop database if exists ${admin(name)} with (force)`;
  await admin.end();
}
