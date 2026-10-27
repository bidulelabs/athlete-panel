export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
    this.status =
      code === 'NOT_FOUND'
        ? 404
        : code === 'FORBIDDEN'
          ? 403
          : code === 'STALE_REVISION' || code === 'HISTORY_CONFLICT' || code === 'ALREADY_LINKED'
            ? 409
            : 400;
  }
}
export function fail(code: string, message: string, details?: unknown): never {
  throw new DomainError(code, message, details);
}
