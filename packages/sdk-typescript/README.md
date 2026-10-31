# ContextWeave TypeScript SDK

A dependency-free runtime client for HTTP API v1. Requires Node.js 22+ with native fetch. The backend requires Node.js 24+. This package is an unpublished preview; its name and version are provisional.

From the repository root:

```sh
npm ci
npm run sdk:build
npm run sdk:test
```

To try it in another project, create a tarball with `npm pack ./packages/sdk-typescript` after building, then install that tarball. Both ESM `import` and CommonJS `require` are supported, with corresponding declarations. Do not put a server token in browser code.

```ts
import { ContextWeave, ApiError, TransportError } from "@contextweave/sdk";

const moss = new ContextWeave({
  baseUrl: "http://127.0.0.1:2091",
  token: process.env.MOSS_RUNTIME_TOKEN!,
  timeoutMs: 30_000,
});

const result = await moss.recall({ query: "What is the launch color?" });
console.log(result.data.memories);
console.log(result.meta.request_id);
```

Use the server root as `baseUrl`, without `/api/v1`. A reverse-proxy mount such as `https://example.test/moss/` is preserved. Redirects are rejected. No environment variables are implicitly read by the client.

Methods return the complete `{ api_version, data, meta }` envelope. `meta.recall_status` stays separate from memory context. Runtime methods are `ingest`, `recall`, `read`, `evolve`, `bootstrap`, `acknowledge`, `change`, and `schema`. `ContextWeaveAdmin` adds `reviews`; initialize it separately with an admin token. Credentials never grant more authority than the server policy permits.

Writes require a unique `change_id`, `family_key`, title, content, and source evidence. The SDK does not manufacture evidence or user authorization. A successful HTTP response may contain `data.status === "review_required"`; check it before treating a write as saved. A context-gated `read` returns `available: false`. Evolution requires the current content hash and update timestamp obtained through `read`.

For confirmed delivery, request `delivery_mode: "confirmed"`, inject the selected memories into model context, then call `acknowledge({ receipt_id, memory_ids })`. A receipt is optional when there are no memories. Reads and failed injection attempts must not trigger acknowledgement. Repeating the same acknowledgement is safe.

On upgraded backends ordinary recall always returns `data.receipt`, including empty
recalls. `ContextWeaveAdmin.receipt({ receipt_id })` reads the owner-only query,
titles, tiers, filtering reasons, routes and timing. Keep this data outside model
context. `acknowledge` accepts optional `memory_package_tokens` from the host.
See [receipt contract](../../docs/RECALL_RECEIPT.md).

Every method accepts a final `{ signal, timeoutMs }` option. The timeout covers both fetch and response-body reading. Server errors throw `ApiError` with `status`, `code`, `requestId`, and optional validation `issues`. Network, timeout, cancellation and malformed/version-mismatched responses throw `TransportError` with code `network`, `timeout`, `aborted`, or `invalid_response`.

There are no automatic retries. A failed write can have reached the server; reuse its unchanged `change_id` when retrying an applied intent. Pending reviews are reconsiderable and are not immutable applied receipts. See [HTTP API v1](../../docs/HTTP_API_V1.md) for the full authority and retry contract.

Run the synthetic end-to-end example against an isolated backend:

```sh
MOSS_BASE_URL=http://127.0.0.1:2091 MOSS_RUNTIME_TOKEN=your-runtime-token npm run example:sdk
```

Each run deliberately saves one synthetic record. CI runs the example against a temporary database. No paid model routes are needed.

Input types are generated from the backend's executable schema (`npm run sdk:generate`); CI checks drift. Additional response fields remain accessible as `unknown` on memory cards; semantic constraints are enforced by the server. Building the SDK requires the root development dependencies; the packed client has no runtime dependencies.
