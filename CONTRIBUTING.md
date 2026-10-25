# Contributing

Keep domain logic independent of HTTP/MCP and keep host conversation state outside
ContextWeave. Use the existing transaction and contract helpers. Preserve canonical text,
provenance, explicit version checks and deletion behavior when modifying projections.

Run the relevant existing tests for a change, then the release checks:
`npm test`, `npm run architecture:check`, `npm run boundary:check`, and the synthetic demo. Prefer
one integration regression for an actual bug over many tests mirroring implementation.

Never commit production databases, provider credentials, private conversation
fixtures or personal UI assets to the public package. Verify release archives in
a fresh directory. New endpoints belong in their domain router.

The project uses Apache-2.0; see LICENSE. Preserve third-party attribution and notices.
