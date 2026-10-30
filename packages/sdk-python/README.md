# ContextWeave Python SDK

Typed synchronous and asynchronous clients for HTTP API v1. Requires Python 3.11+ and HTTPX. This is an unpublished preview; package name and version are provisional.

From the repository root, create a virtual environment and install the preview:

```sh
python3 -m venv /tmp/contextweave-python-env
. /tmp/contextweave-python-env/bin/activate
python -m pip install './packages/sdk-python[dev]'
npm ci
npm run python:test
```

```python
from contextweave import ContextWeave

with ContextWeave(base_url="http://127.0.0.1:2091", token="your-runtime-token") as moss:
    result = moss.recall({"query": "What is the launch color?"})
    print(result["data"]["memories"])
    print(result["meta"]["request_id"])
```

For asynchronous hosts:

```python
from contextweave import AsyncContextWeave

async with AsyncContextWeave(base_url="http://127.0.0.1:2091", token="your-runtime-token") as moss:
    result = await moss.recall({"query": "What is the launch color?"})
```

Use the server root as `base_url`, without `/api/v1`; proxy mount paths such as `https://example.test/moss/` are preserved. All methods return the original dictionary envelope, including `meta.recall_status`. No server or credentials are selected implicitly. Environment proxy configuration is disabled; inject a configured HTTPX transport when needed. Redirects are not followed.

Runtime methods: `ingest`, `recall`, `read`, `evolve`, `bootstrap`, `acknowledge`, `change`, `schema`. `ContextWeaveAdmin` and `AsyncContextWeaveAdmin` additionally expose `reviews`; initialize them separately with an admin token. Use context managers to close pooled connections, or call `close()` / `await aclose()`.

Input TypedDicts live in `contextweave.requests`; response types live in `contextweave.types`. Inputs and method paths are generated from the executable server schema. CI checks drift and validates consumer types. Static types provide editor guidance; the server enforces semantic validation. Additional response keys are preserved at runtime.

Writes need a unique `change_id`, `family_key`, title, content and source evidence. Check `data.status`: `review_required` is a successful decision with no canonical write. Context-gated reads return `available: False`. Evolution needs the hash and timestamp of the current target, obtained through `read`. The SDK never fabricates source evidence or user authorization.

For confirmed delivery, request `delivery_mode: "confirmed"`, inject selected memories into model context, then acknowledge their IDs and receipt. A response with no memories may have no delivery receipt. Reads and unsuccessful injection attempts do not imply delivery.

`ApiError` exposes `status`, `code`, `request_id` and optional validation `issues`. `TransportError.code` distinguishes `network`, `timeout` and `invalid_response`. No automatic retries are performed. Retrying an applied intent uses its unchanged `change_id`; pending reviews are reconsiderable rather than immutable applied receipts. Async cancellation propagates as the standard `asyncio.CancelledError`.

The constructor and each method accept `timeout` in seconds. This uses HTTPX's connect/read/write/pool inactivity timeouts, not a total wall-clock deadline. Async hosts can use `asyncio.timeout(seconds)` around an operation for a total deadline. Synchronous calls can time out but have no separate cancellation handle.

After installation, run the synthetic example against an isolated backend:

```sh
MOSS_BASE_URL=http://127.0.0.1:2091 MOSS_RUNTIME_TOKEN=your-runtime-token python examples/python/run.py
```

Each example run deliberately saves one synthetic record. Tests start a temporary backend and remove its database afterward; paid model routes are disabled. Build an sdist and wheel with `python -m build packages/sdk-python`. For testing in another project, install the wheel from `packages/sdk-python/dist/`. No PyPI publication workflow is included.
