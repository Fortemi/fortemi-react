# Schemas

## `aiwg-fortemi-index-export.schema.json` (vendored)

Pinned from the AIWG repository.
Its receipt records the exact source repository, path, commit, and SHA-256.

To refresh it, review the upstream diff at a specific commit, replace the
schema, update the receipt, and run:

```bash
pnpm --filter @fortemi/core exec vitest run src/__tests__/aiwg-index-schema.test.ts src/__tests__/aiwg-index.test.ts
```

Do not fetch or execute upstream content during builds. Schema updates are
reviewed source changes committed through the normal pull-request workflow.

## `knowledge-shard.schema.json` (transitional validation copy)

This local schema is consumed by `src/shard/schema-validator.ts` and the shard
conformance tests under `src/__tests__/shard/`. It is not the cross-repository
authority. The Fortemi server owns that contract.

Before server-compatibility claims can ship, replace this transitional copy
with a receipt that records the exact Fortemi repository, source path,
revision, and SHA-256, then validate it against server-produced golden
fixtures. React extension components are portable only when a named
server-owned profile declares them.
