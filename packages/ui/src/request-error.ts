/** A failed request can offer a read-only reload beside the form that owns its draft. */
export class ReloadableRequestError extends Error {
  constructor(
    message: string,
    readonly reload: () => Promise<void>,
  ) {
    super(message);
  }
}
