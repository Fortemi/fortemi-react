# Vendored schemas

`aiwg-fortemi-index-export.schema.json` is pinned from the AIWG repository.
Its receipt records the exact source repository, path, commit, and SHA-256.

To refresh it, review the upstream diff at a specific commit, replace the
schema, update the receipt, and run:

```bash
pnpm --filter @fortemi/core exec vitest run src/__tests__/aiwg-index-schema.test.ts src/__tests__/aiwg-index.test.ts
```

Do not fetch or execute upstream content during builds. Schema updates are
reviewed source changes committed through the normal pull-request workflow.
