export class ContextWeaveError extends Error {
  override name = "ContextWeaveError";
}

export class ApiError extends ContextWeaveError {
  override name = "ApiError";
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly issues?: unknown[],
  ) { super(message); }
}

export class TransportError extends ContextWeaveError {
  override name = "TransportError";
  constructor(public readonly code: "network" | "timeout" | "aborted" | "invalid_response", cause?: unknown) {
    super(`ContextWeave request failed: ${code}`, { cause });
  }
}
