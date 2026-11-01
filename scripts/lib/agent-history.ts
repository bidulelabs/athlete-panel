import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { historyQuerySchema, historyResponseSchema } from '../../packages/contracts/src';

import { historySession, type HistorySession } from './history-session';

type Values = Record<string, string | boolean | undefined>;
export async function runHistoryCli(
  operation: string | undefined,
  values: Values,
  request: (path: string, body: unknown) => Promise<unknown>,
  save: (path: string, text: string) => Promise<void>,
  session?: HistorySession,
) {
  operation ??= 'summary';
  if (!['discover', 'summary', 'records', 'context'].includes(operation))
    throw new Error('Use history discover, summary, records or context. See pnpm agent --help.');
  const explicitReview = Boolean(values['review-file'] || values['after-file']);
  if (values.restart && explicitReview)
    throw new Error('Use --restart without --review-file or --after-file to start a new review.');
  if (values.page && values.all)
    throw new Error('Choose --page for one page or --all for the complete export.');
  const all =
    values.all ||
    Boolean(
      values.out &&
      !values.page &&
      !values['after-file'] &&
      ['summary', 'records'].includes(operation),
    );
  if (all && !values.out)
    throw new Error('Use --all with --out so a changed review cannot publish a partial export.');
  if (all && !['records', 'summary'].includes(operation))
    throw new Error('--all is supported for summary and records.');
  const query: Record<string, unknown> = {};
  if (values['after-file']) {
    const previous = historyResponseSchema.parse(
      JSON.parse(await readFile(resolve(String(values['after-file'])), 'utf8')),
    );
    if (previous.operation !== operation || !previous.nextCursor)
      throw new Error('This file has no next page for the requested command.');
    Object.assign(query, previous.query, {
      reviewToken: previous.reviewToken,
      cursor: previous.nextCursor,
    });
  }
  if (values['review-file']) {
    const previous = JSON.parse(await readFile(resolve(String(values['review-file'])), 'utf8')) as {
      reviewToken?: unknown;
    } | null;
    if (typeof previous?.reviewToken !== 'string' || !previous.reviewToken.length)
      throw new Error(
        'The review file has no review token. Use a history discover result or a previous history response.',
      );
    query.reviewToken = previous.reviewToken;
  }
  for (const key of ['from', 'to', 'category', 'sport', 'subgroup', 'metric', 'period', 'section'])
    if (values[key] !== undefined) query[key] = values[key];
  if (values['record-id']) query.recordId = values['record-id'];
  if (values.limit) query.limit = Number(values.limit);
  const input = historyQuerySchema.parse(query);
  if (session && !explicitReview) {
    const review = await historySession(session, Boolean(values.restart), request, save);
    input.reviewToken = review.reviewToken;
  }
  const fetchPage = async (body: unknown) => {
    try {
      return historyResponseSchema.parse(await request(`history-${operation}`, body));
    } catch (error) {
      if (
        (error as { code?: string }).code === 'history_changed' ||
        (error instanceof Error && error.message.includes('history_changed'))
      )
        throw new Error(
          'history_changed: Training or health records changed during this review. Discard earlier results and repeat your first history command with --restart. No partial export was saved.',
          { cause: error },
        );
      throw error;
    }
  };
  let page = await fetchPage(input);
  if (!all) {
    const output = JSON.stringify(page, null, 2) + '\n';
    if (values.out) await save(resolve(String(values.out)), output);
    else console.log(output);
    return;
  }
  const destination = resolve(String(values.out)),
    temporary = join(dirname(destination), `.athlete-panel-history-${randomUUID()}.tmp`);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const file = await open(temporary, 'wx', 0o600);
  try {
    const field = operation === 'records' ? 'records' : 'summaries';
    const { records: _records, summaries: _summaries, ...metadata } = page;
    await file.write(
      JSON.stringify({ ...metadata, nextCursor: null }).slice(0, -1) + `,"${field}":[`,
    );
    let first = true;
    for (;;) {
      for (const item of page[field] ?? []) {
        await file.write((first ? '' : ',') + JSON.stringify(item));
        first = false;
      }
      if (!page.nextCursor) break;
      page = await fetchPage({
        ...page.query,
        reviewToken: page.reviewToken,
        cursor: page.nextCursor,
      });
    }
    await file.write(']}\n');
    await file.close();
    await rename(temporary, destination);
  } finally {
    await file.close();
    await rm(temporary, { force: true });
  }
}
