export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      'rate_limited',
      `Too many connection requests. Try again in ${retryAfterSeconds} seconds.`,
      429,
      {
        retryAfterSeconds,
      },
    );
  }
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
