/** Reproducible synthetic benchmark; refuses non-test storage and creates its own database. */
import postgres from 'postgres';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isolatedDatabaseUrl } from '../tests/support/test-database';
import { seedHistoricalDataset, historicalRange } from '../tests/fixtures/historical';
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
import { addDays } from '../plugins/training/dates';
const base = isolatedDatabaseUrl(),
  admin = postgres(base, { max: 1, onnotice: () => {} });
const name = `history_benchmark_${process.pid}_test`,
  url = new URL(base);
url.pathname = `/${name}`;
let queryCount = 0;
let trainingReadQuery: { text: string; parameters: postgres.SerializableParameter[] } | undefined;
const requested = Number(process.argv[2] ?? 30000);
if (!Number.isSafeInteger(requested) || requested < 30000 || requested > 1000000)
  throw new Error('Choose 30000–1000000 synthetic records.');
const samples: Record<string, unknown> = {};
async function measure(label: string, fn: () => Promise<unknown>, runs = 10) {
  const timings: number[] = [],
    queries: number[] = [],
    sizes: number[] = [];
  const memoryBefore = process.memoryUsage();
  let peakRss = memoryBefore.rss,
    peakHeap = memoryBefore.heapUsed;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  }, 5);
  try {
    for (let i = 0; i < runs; i++) {
      const count = queryCount,
        start = performance.now();
      const value = await fn();
      const bytes = Buffer.byteLength(JSON.stringify(value));
      timings.push(performance.now() - start);
      queries.push(queryCount - count);
      sizes.push(bytes);
    }
  } finally {
    clearInterval(sampler);
  }
  const sorted = timings.slice(1).sort((a, b) => a - b),
    quantile = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? timings[0];
  samples[label] = {
    runs,
    timingsMs: timings,
    responseBytes: sizes,
    queryCounts: queries,
    firstMs: timings[0],
    warmP50Ms: runs > 1 ? quantile(0.5) : null,
    warmP95Ms: runs > 1 ? quantile(0.95) : null,
    maxBytes: Math.max(...sizes),
    queriesPerCall: [...new Set(queries)],
    rssBefore: memoryBefore.rss,
    peakRss,
    heapBefore: memoryBefore.heapUsed,
    peakHeap,
  };
}
try {
  await admin`create database ${admin(name)}`;
  process.env.DATABASE_URL = url.toString();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  (globalThis as unknown as { athletePanelSql: ReturnType<typeof postgres> }).athletePanelSql =
    postgres(url.toString(), {
      max: 8,
      onnotice: () => {},
      debug: (_connection, text, parameters) => {
        queryCount++;
        if (!trainingReadQuery && text.includes('with dated as') && parameters.includes('workout'))
          trainingReadQuery = { text, parameters };
      },
    });
  await migrate();
  const seedStart = performance.now();
  const dataset = await connection().begin((tx) => seedHistoricalDataset(tx, requested));
  const seedMs = performance.now() - seedStart;
  await connection()`analyze activity_records.records`;
  await connection()`analyze training.records`;
  const { token } = await createGrant({
    label: 'Synthetic benchmark',
    version: 2,
    history: {
      ...historicalRange,
      categories: ['activities', 'health', 'training', 'context'],
      weekStartsOn: 1,
    },
    planning: { from: '2026-11-01', to: '2027-11-01' },
  });
  let discovery: Awaited<ReturnType<typeof readHistory>>;
  await measure('discovery', async () => (discovery = await readHistory(token, 'discover')));
  await measure('fiveYearMonthlyFirstPage', () =>
    readHistory(token, 'summary', { reviewToken: discovery!.reviewToken, limit: 200 }),
  );
  await measure('selectedMonthRecords', () =>
    readHistory(token, 'records', {
      reviewToken: discovery!.reviewToken,
      from: '2025-10-01',
      to: '2025-10-31',
      category: 'activities',
      sport: 'running',
      limit: 100,
    }),
  );
  const page = await readHistory(token, 'records', { category: 'activities', limit: 100 });
  await measure('nextDetailPage', () =>
    readHistory(token, 'records', {
      ...page.query,
      reviewToken: page.reviewToken,
      cursor: page.nextCursor!,
    }),
  );
  const plans =
    await connection()`explain (analyze,buffers,format json) select id,data->>'localDate' from activity_records.records where kind='activity' and deleted=false and data->>'localDate'>='2025-10-01' and data->>'localDate'<='2025-10-31' and data->>'sport'='running' order by data->>'localDate',id limit 101`;
  const trainingPlan = trainingReadQuery
    ? await connection().unsafe(
        `explain (analyze,buffers,format json) ${trainingReadQuery.text}`,
        trainingReadQuery.parameters,
      )
    : [];
  const context = await contextForToken(token);
  let submitted: Awaited<ReturnType<typeof submitProposal>>;
  const commands = Array.from({ length: 366 }, (_, day) => ({
    action: 'workout.create',
    values: {
      title: `Synthetic annual workout ${day}`,
      sport: 'running',
      schedule: { kind: 'independent', date: addDays('2026-11-01', day) },
      durationSeconds: 3600,
    },
  }));
  await measure(
    'annualValidationAndStorage',
    async () =>
      (submitted = await submitProposal(token, {
        commands,
        summary: 'Synthetic annual benchmark',
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
      })),
    1,
  );
  await measure(
    'annualReview',
    () => reviewProposal({ id: submitted.id, digest: submitted.digest }),
    3,
  );
  await measure('annualDetailLoad', () => proposalDetails({ id: submitted.id }), 3);
  let applied: Awaited<ReturnType<typeof applyProposal>>;
  await measure(
    'annualApply',
    async () =>
      (applied = await applyProposal({
        id: submitted.id,
        digest: submitted.digest,
        idempotencyKey: randomUUID(),
      })),
    1,
  );
  await measure(
    'annualUndo',
    () => undoChange({ id: applied.id, idempotencyKey: randomUUID() }),
    1,
  );
  const snapshot =
    await connection()`select pg_column_size(context) as stored_bytes,octet_length(context::text) as json_bytes,octet_length(changes::text) as diff_json_bytes from host.proposals where id=${submitted!.id}`;
  const result = {
    generatedAt: new Date().toISOString(),
    dataset,
    requested,
    seedMs,
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
    measurements: samples,
    queryPlan: plans[0],
    trainingQueryPlan: trainingPlan[0],
    annualSnapshot: snapshot[0],
    processResourceUsage: process.resourceUsage(),
    limitations: [
      'Synthetic local database; not production capacity.',
      'First measured call in each series and subsequent warm calls; discovery starts in a fresh benchmark process. OS/PostgreSQL caches were not forcibly cleared, so this is not a cold-cache measurement.',
      'Latency measures service execution and JSON serialization, not HTTP/TLS or external model processing.',
      'Peak RSS includes fixture generation and earlier operations; per-operation samples include before/peak values.',
    ],
  };
  await mkdir('.runtime/history', { recursive: true });
  await writeFile(
    `.runtime/history/benchmark-${requested}.json`,
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      { dataset, measurements: samples, report: `.runtime/history/benchmark-${requested}.json` },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase();
  await admin`drop database if exists ${admin(name)} with (force)`;
  await admin.end();
}
