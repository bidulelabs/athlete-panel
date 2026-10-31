import { z } from 'zod';
import { AppError, RateLimitError } from './errors';
export async function readJson(request: Request, limit = 256 * 1024): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > limit)
    throw new AppError(
      'too_large',
      `Request exceeds the ${limit / 1024} KiB limit. Reduce its size and retry; nothing was applied.`,
      413,
    );
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError(
          'too_large',
          `Request exceeds the ${limit / 1024} KiB limit. Reduce its size and retry; nothing was applied.`,
          413,
        );
      }
      chunks.push(value);
    }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('invalid_json', 'A valid JSON body is required.');
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
/** Validate server output separately from submitted input; never expose invalid stored values. */
export function contractValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError('invalid_response', 'The server returned an invalid response.', 500);
  return parsed.data;
}
export function contractJson<T>(schema: z.ZodType<T>, value: unknown) {
  return json(contractValue(schema, JSON.parse(JSON.stringify(value))));
}
export function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return json(
      {
        error: {
          code: 'validation',
          message: 'Check the submitted values.',
          details: error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
      },
      400,
    );
  if (
    error instanceof AppError ||
    (error instanceof Error && error.name === 'DomainError' && 'status' in error && 'code' in error)
  ) {
    const known = error as AppError;
    const response = json(
      { error: { code: known.code, message: known.message, details: known.details } },
      known.status,
    );
    if (error instanceof RateLimitError)
      response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'request_failed',
      type: error instanceof Error ? error.name : 'Unknown',
    }),
  );
  return json(
    {
      error: {
        code: 'internal',
        message:
          'The request could not be completed. Your draft has been retained; retry after checking server status.',
      },
    },
    500,
  );
}
