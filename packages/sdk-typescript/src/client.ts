import { ApiError, TransportError } from "./errors.js";
import type { IngestInput, RecallInput, EvolveInput, ReadInput, BootstrapInput, DeliveredInput, ChangeInput } from "./requests.js";
import type { ApiResponse, WriteResult, RecallResult, ReadResult, BootstrapResult, DeliveryResult, ChangeReceipt, ReviewsResult, SchemaResult } from "./types.js";

export interface ClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
type WireResponse<T> = Partial<ApiResponse<T>> & {
  error?: { code?: string; message?: string; issues?: unknown[] };
};

export class ContextWeave {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;

  constructor({ baseUrl, token, timeoutMs = 30_000, fetch: fetcher = globalThis.fetch }: ClientOptions) {
    this.baseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    if (!["http:", "https:"].includes(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password
      || this.baseUrl.search || this.baseUrl.hash) throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, query or fragment");
    if (typeof token !== "string" || !token.trim()) throw new TypeError("token is required");
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
  }

  ingest(input: IngestInput, options?: RequestOptions) { return this.request<WriteResult>("ingest", input, options); }
  recall(input: RecallInput, options?: RequestOptions) { return this.request<RecallResult>("recall", input, options); }
  evolve(input: EvolveInput, options?: RequestOptions) { return this.request<WriteResult>("evolve", input, options); }
  read(input: ReadInput, options?: RequestOptions) { return this.request<ReadResult>("read", input, options); }
  bootstrap(input: BootstrapInput = {}, options?: RequestOptions) { return this.request<BootstrapResult>("bootstrap", input, options); }
  acknowledge(input: DeliveredInput, options?: RequestOptions) { return this.request<DeliveryResult>("recall/delivered", input, options); }
  change(input: ChangeInput, options?: RequestOptions) { return this.request<ChangeReceipt>("changes/read", input, options); }
  schema(options?: RequestOptions) { return this.request<SchemaResult>("schema", undefined, options); }

  protected async request<T>(path: string, input?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response: Response;
    let payload: WireResponse<T>;
    try {
      response = await this.fetcher(new URL(`api/v1/${path}`, this.baseUrl), {
        method: input === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${this.token}`, ...(input === undefined ? {} : { "Content-Type": "application/json" }) },
        body: input === undefined ? undefined : JSON.stringify(input),
        signal, redirect: "error",
      });
      const text = await response.text();
      try { payload = JSON.parse(text); }
      catch (cause) { throw new TransportError("invalid_response", cause); }
    } catch (cause) {
      if (signal.aborted) throw new TransportError(signal.reason === timeout.reason && timeout.aborted ? "timeout" : "aborted", cause);
      if (cause instanceof TransportError) throw cause;
      throw new TransportError("network", cause);
    }
    if (payload?.api_version !== "1" || typeof payload.meta?.request_id !== "string") {
      throw new TransportError("invalid_response");
    }
    if (!response.ok) {
      if (typeof payload.error?.code !== "string" || typeof payload.error?.message !== "string") throw new TransportError("invalid_response");
      throw new ApiError(response.status, payload.error.code, payload.error.message, payload.meta.request_id, payload.error.issues);
    }
    if (!("data" in payload)) throw new TransportError("invalid_response");
    return payload as ApiResponse<T>;
  }
}

export class ContextWeaveAdmin extends ContextWeave {
  reviews(options?: RequestOptions) { return this.request<ReviewsResult>("admin/reviews", undefined, options); }
}
