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

## Knowledge Shard `1.2.0` / `core-v1`, `record-v1`, and `full-v1` (vendored)

The exact Fortemi-owned schemas live under
`knowledge-shard/1.2.0/`. The immutable `1.0.0` and `1.1.0` authorities remain
vendored beside it. The upstream contract and consumer receipt record the
immutable Fortemi commit, current and historical source paths, individual file
digests, bundle digests, golden corpora, and registered migration targets.

Run the blocking drift check with:

```bash
pnpm --filter @fortemi/core verify:knowledge-shard-contract
```

The older `knowledge-shard.schema.json` remains only as a transitional validator
for React extension records that do not yet have a server-owned profile. It is
not used as authority for `core-v1`. Profile selection and portable treatment
of extensions remain tracked separately; no extension is implicitly part of
the canonical profile.

`knowledge-shard-core-v1-pglite-self.receipt.json` binds the current
`@fortemi/core@2026.7.13` PGlite `1.2.0/core-v1` self-cell to an immutable live
fixture and signed producer commit. Its dedicated suite proves hierarchy,
metadata, explicit nulls, tombstones, current-minus-two/current behavior,
schema-next-major and malformed rejection, the gzip expansion cap, repeated
clean import, semantic re-export, and zero persistent mutation on every
rejection. This self-cell is not cross-repository or complete-backup evidence.

`knowledge-shard-core-v1-pglite-to-fortemi.receipt.json` reuses that exact
signed-producer fixture and binds the independent Fortemi clean-destination
consumer. It proves current-minus-two/current behavior, hierarchy, metadata,
explicit nulls, tombstones, malformed and next-major rejection, configured
resource-limit rejection, repeated import, semantic re-export, and zero
persistent mutation on rejection. The receipt is limited to the
`pglite-core-v1-to-fortemi` cell and is not suite-wide or complete-backup
evidence.

`knowledge-shard-core-v1-fortemi-to-pglite.receipt.json` binds the current
Fortemi producer fixture to an independent clean PGlite consumer at delivered
commit `fb570b85`. It proves hierarchy, metadata values, explicit nulls,
tombstones, attachment projections, current-minus-two/current behavior,
malformed and next-major rejection, the archive expansion cap, repeated
import, semantic re-export, and zero mutation on rejection. Timestamp spelling
is normalized to the same RFC 3339 instant. The receipt is limited to the
`fortemi-core-v1-to-pglite` cell and is not suite-wide or complete-backup
evidence.

`knowledge-shard-record-v1-recordstore-self.receipt.json` binds the current
`@fortemi/core@2026.7.13` RecordStore producer and self-consumer to a
deterministic `1.2.0/record-v1` fixture. The portable gate reproduces the
fixture and proves hierarchy, metadata values, explicit nulls, tombstones,
oldest-defined `1.1.0` acceptance, undefined `1.0.0` rejection, malformed and
next-major rejection, resource limits, repeated import, exact component
re-export, and zero mutation on rejection. The receipt preserves the mandatory
loss report and remains a lossy, non-cross-repository self-cell; it is not
complete-backup evidence.

## Knowledge Shard `2.0.0` / `full-v1` receipts

`knowledge-shard-v2.advertisement.receipt.json` pins the current Fortemi
revision 21 opt-in advertisement and schema bundle.
`knowledge-shard-v2.schema.receipt.json`,
`knowledge-shard-v2.implementation.receipt.json`, and
`knowledge-shard-v2.presence.receipt.json` remain immutable revision 20
implementation lineage; they are not relabelled as revision 21 evidence.
`knowledge-shard-v2.fortemi-runtime.receipt.json` is the byte-identical
delivered revision 20 Fortemi consumer receipt, and
`knowledge-shard-v2.cross-repository.receipt.json` binds the exact four
released revision 20 producer/destination cells that permit the revision 21
receipt-bound advertisement. The blocking drift check validates the current
advertisement and its historical evidence lineage separately.

Refresh the two changed vendored authority files and current advertisement
receipt deterministically from the exact Fortemi commit:

```bash
pnpm shard:refresh-v2-authority --authority-root ../fortemi
pnpm shard:refresh-v2-authority --authority-root ../fortemi --verify
```

## Platform contract receipts

The Fortemi authority repository orchestrates the required Linux x86_64 and
Darwin arm64 jobs. Each job runs the same reusable consumer command from the
fortemi-react repository:

```bash
FORTEMI_PLATFORM_SERVER_URL=https://fortemi.example \
FORTEMI_PLATFORM_SERVER_TOKEN="$FORTEMI_TOKEN" \
  pnpm test:platform-contract --output artifacts/fortemi-react-platform.json
```

The command rejects every platform except Linux x86_64 and Darwin arm64. It
requires the live Fortemi server origin and bearer token before doing any
work. It runs `verify:knowledge-shard-contract` as a preflight before invoking
the complete `pnpm test:portable-contract` behavioral suite. It then validates
`/api/v1/system/compatibility`, requiring contract revision `21` and
`auth.required: true`, downloads an authenticated
`2.0.0/full-v1` server export, proves next-major rejection without database or
blob mutation, imports into a clean migrated in-memory PGlite destination, and
re-exports the exact logical files. The token is never recorded.

The command emits a machine-readable receipt only after all three gates pass.
The receipt binds the exact checkout and package version to the current Fortemi
revision 21 advertisement, historical revision 20 implementation lineage,
schema and profile digests, live server-to-core evidence, required profile
cells, clean-destination/skew/zero-mutation evidence, and the RecordStore
`record-v1` losses and claim boundary.

Verify an emitted receipt without rerunning the large behavioral suite:

```bash
pnpm verify:platform-contract-receipt artifacts/fortemi-react-platform.json
```

Both commands reject dirty checkouts by default. `--allow-dirty` is available
only for local diagnostics; such a receipt records its dirty state and is not
eligible for the authority-owned platform matrix. These receipts prove only
the named profile cells on Linux x86_64 or Darwin arm64. They do not establish
universal portability, complete backup, RecordStore `full-v1`, or a shared
schema between the AIWG static index, the AIWG-to-shard bridge, Knowledge Shard
state transfer, and live persistence.

### Profile-aware APIs

`getKnowledgeShardProfileRegistry()` exposes the pinned authority status.
At contract revision 19, the schema `1.2.0` authority supports all three
profiles. React backends advertise only exact tuples proven by their own
producer/consumer paths: PGlite `1.2.0/core-v1` and receipt-backed
`2.0.0/full-v1`, and RecordStore `1.2.0/record-v1`. The schema-2 advertisement
is bound by `knowledge-shard-v2.cross-repository.receipt.json` to released
React and AIWG archives plus clean PGlite and Fortemi destination evidence.
It does not widen RecordStore or establish an unqualified suite claim.
Traceability continues the profile and convergence work closed in
[React #355](https://git.integrolabs.net/Fortemi/fortemi-react/issues/355)
and [React #356](https://git.integrolabs.net/Fortemi/fortemi-react/issues/356),
and pairs with the independent Fortemi destination gate in
[Fortemi #1084](https://git.integrolabs.net/Fortemi/fortemi/issues/1084).

Use `exportShardWithReport(db, { profile: 'core-v1' })` for a named PGlite
export. It returns the archive with a versioned capability/loss report and
self-validates the generated bytes against schema `1.2.0`. Current named
exports include active and soft-deleted notes and carry `deleted_at` as explicit
JSON `null` or the exact timestamp. Schema `1.0.0` and `1.1.0` named archives
remain readable under their immutable validators, with missing tombstones and
embedding lineage interpreted only through documented null defaults. The legacy `exportShard()`
byte-returning API remains unprofiled and is not advertised as portable.

RecordStore advertises `record-v1` for named export and import. Its
report-returning paths emit the mandatory loss report and validate the exact
profile before returning bytes or mutating records. Unknown, reserved, and
backend-unsupported profiles fail before mutation.
