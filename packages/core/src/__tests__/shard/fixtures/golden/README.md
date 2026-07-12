# Server Golden Shard Fixtures

This directory is reserved for pinned server-generated `.shard` fixtures used by
the #255 golden round-trip suite.

Refresh a fixture from a running Fortemi server with:

```bash
pnpm --filter @fortemi/core shard:refresh-golden -- \
  --server http://localhost:8080 \
  --version 2026.2.9
```

The script fetches `GET /api/v1/backup/knowledge-shard`, writes
`server-<version>.shard`, and writes a sibling `.receipt.json` containing the
source URL, pinned version, byte length, fetch timestamp, and SHA-256 digest.

Do not hand-author files here. Fixtures in this directory must come from the
server export endpoint for a pinned server version so schema and round-trip
tests prove cross-repository conformance instead of React-only behavior.

