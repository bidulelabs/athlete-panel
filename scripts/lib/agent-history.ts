import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { historyQuerySchema, historyResponseSchema } from '../../packages/contracts/src';

type Values = Record<string, string | boolean | undefined>;
export async function runHistoryCli(
  operation: string | undefined,
  values: Values,
  request: (path: string, body: unknown) => Promise<unknown>,
  save: (path: string, text: string) => Promise<void>,
) {
  if (!operation || !['discover', 'summary', 'records', 'context'].includes(operation))
    throw new Error('Use history discover, summary, records or context. See pnpm agent --help.');
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
  const fetchPage = async (body: unknown) =>
    historyResponseSchema.parse(await request(`history-${operation}`, body));
  let page = await fetchPage(input);
  if (!values.all) {
    const output = JSON.stringify(page, null, 2) + '\n';
    if (values.out) await save(resolve(String(values.out)), output);
    else console.log(output);
    return;
  }
  if (!values.out)
    throw new Error('Use --all with --out so a changed review cannot publish a partial export.');
  if (operation !== 'records' && operation !== 'summary')
    throw new Error('--all is supported for summary and records.');
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
