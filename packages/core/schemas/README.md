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

## Knowledge Shard `1.0.0` / `core-v1` (vendored)

The exact Fortemi-owned schemas live under
`knowledge-shard/1.0.0/core-v1/`. The upstream contract and consumer receipt
record the immutable Fortemi commit, source paths, individual file digests,
schema-bundle digest, and golden-corpus digest.

Run the blocking drift check with:

```bash
pnpm --filter @fortemi/core verify:knowledge-shard-contract
```

The older `knowledge-shard.schema.json` remains only as a transitional validator
for React extension records that do not yet have a server-owned profile. It is
not used as authority for `core-v1`. Profile selection and portable treatment
of extensions remain tracked separately; no extension is implicitly part of
the canonical profile.
