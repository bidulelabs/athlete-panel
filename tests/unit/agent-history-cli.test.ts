import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runHistoryCli } from '../../scripts/lib/agent-history';
import { savePrivateFile } from '../../scripts/lib/agent-client';
const response = {
  version: 1,
  operation: 'records',
  scope: {
    from: '2021-10-31',
    to: '2026-10-31',
    includeNotes: false,
    categories: ['activities'],
    weekStartsOn: 1,
  },
  reviewToken: 'opaque',
  expiresAt: '2026-10-31T12:00:00Z',
  asOf: '2026-10-31T11:00:00Z',
  query: {
    category: 'activities',
    from: '2021-10-31',
    to: '2026-10-31',
    limit: 1,
    period: 'month',
    section: 'core',
  },
  records: [
    { category: 'activities', id: 'first', date: '2024-01-01', data: { durationSeconds: 100 } },
  ],
  nextCursor: 'page2',
  warnings: [],
};
it('streams complete pages to a private atomic file and carries exact query/review identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'history-cli-')),
    out = join(dir, 'all.json');
  try {
    let calls = 0;
    await runHistoryCli(
      'records',
      { category: 'activities', out, all: true },
      async (_path, body) => {
        calls++;
        if (calls === 1) return response;
        expect(body).toMatchObject({
          reviewToken: 'opaque',
          cursor: 'page2',
          category: 'activities',
          limit: 1,
        });
        return {
          ...response,
          nextCursor: null,
          records: [{ ...response.records[0], id: 'second' }],
        };
      },
      savePrivateFile,
    );
    const value = JSON.parse(await readFile(out, 'utf8'));
    expect(value.records.map((r: { id: string }) => r.id)).toEqual(['first', 'second']);
    expect(value.nextCursor).toBeNull();
    expect((await stat(out)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('a changed review leaves the previous destination untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'history-cli-stale-')),
    out = join(dir, 'all.json');
  try {
    await writeFile(out, 'previous', { mode: 0o600 });
    let calls = 0;
    await expect(
      runHistoryCli(
        'records',
        { category: 'activities', out, all: true },
        async () => {
          if (++calls === 1) return response;
          throw new Error('history_changed: restart');
        },
        savePrivateFile,
      ),
    ).rejects.toThrow('history_changed');
    expect(await readFile(out, 'utf8')).toBe('previous');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('rejects a missing review token instead of silently starting a different review', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'history-cli-invalid-'));
  const review = join(dir, 'review.json');
  let requests = 0;
  try {
    for (const value of [null, {}, { reviewToken: '' }]) {
      await writeFile(review, JSON.stringify(value));
      await expect(
        runHistoryCli(
          'summary',
          { 'review-file': review },
          async () => {
            requests++;
            return response;
          },
          savePrivateFile,
        ),
      ).rejects.toThrow('no review token');
    }
    expect(requests).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('automatically discovers, saves a private review and uses it for later queries; restart is explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'history-auto-'));
  const session = { path: join(dir, 'session.json'), identity: 'connection-a' };
  let discoveries = 0;
  const calls: { path: string; body: unknown }[] = [];
  const request = async (path: string, body: unknown) => {
    calls.push({ path, body });
    if (path === 'history-discover') {
      discoveries++;
      return {
        ...response,
        operation: 'discover',
        records: undefined,
        reviewToken: `review-${discoveries}`,
        nextCursor: null,
      };
    }
    return {
      ...response,
      operation: path.slice(8),
      records: undefined,
      summaries: [],
      nextCursor: null,
      reviewToken: (body as { reviewToken: string }).reviewToken,
    };
  };
  try {
    await runHistoryCli(
      undefined,
      { out: join(dir, 'overview.json') },
      request,
      savePrivateFile,
      session,
    );
    await runHistoryCli(
      'summary',
      { from: '2025-01-01', to: '2025-12-31', out: join(dir, 'year.json') },
      request,
      savePrivateFile,
      session,
    );
    expect(discoveries).toBe(1);
    expect(calls[2]?.body).toMatchObject({
      reviewToken: 'review-1',
      from: '2025-01-01',
      period: 'month',
    });
    expect((await stat(session.path)).mode & 0o777).toBe(0o600);
    await runHistoryCli(
      'summary',
      { restart: true, out: join(dir, 'new.json') },
      request,
      savePrivateFile,
      session,
    );
    expect(discoveries).toBe(2);
    await runHistoryCli(
      'summary',
      { out: join(dir, 'reconnected.json') },
      request,
      savePrivateFile,
      { ...session, identity: 'connection-b' },
    );
    expect(discoveries).toBe(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('defaults file exports to all pages, while --page preserves explicit pagination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'history-pages-'));
  try {
    let calls = 0;
    const request = async () =>
      ++calls === 1
        ? response
        : { ...response, nextCursor: null, records: [{ ...response.records[0], id: 'second' }] };
    const out = join(dir, 'all.json');
    await runHistoryCli('records', { category: 'activities', out }, request, savePrivateFile);
    expect(calls).toBe(2);
    expect(JSON.parse(await readFile(out, 'utf8')).records).toHaveLength(2);
    calls = 0;
    await runHistoryCli(
      'records',
      { category: 'activities', out, page: true },
      request,
      savePrivateFile,
    );
    expect(calls).toBe(1);
    expect(JSON.parse(await readFile(out, 'utf8')).nextCursor).toBe('page2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('retains a stale automatic review and previous export until an explicit restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'history-stale-auto-'));
  const session = { path: join(dir, 'session.json'), identity: 'a' };
  const out = join(dir, 'out.json');
  const review = { ...response, operation: 'discover', records: undefined, nextCursor: null };
  try {
    await savePrivateFile(session.path, JSON.stringify({ identity: 'a', review }));
    await savePrivateFile(out, 'previous');
    let calls = 0;
    const request = async () => {
      calls++;
      throw Object.assign(new Error('Records changed'), { code: 'history_changed' });
    };
    await expect(
      runHistoryCli('records', { category: 'activities', out }, request, savePrivateFile, session),
    ).rejects.toThrow('--restart');
    expect(calls).toBe(1);
    expect(await readFile(out, 'utf8')).toBe('previous');
    expect(JSON.parse(await readFile(session.path, 'utf8')).review.reviewToken).toBe('opaque');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
