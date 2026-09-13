# Candidate Search Source Identity

`source.receipt.json` binds these eleven schema/vector files to immutable
Fortemi source `e99e4723293d12e76862ea83fda86ed70d3573c8`, plus that revision's
OpenAPI and authority documentation. CI verifies the actual upstream bytes,
not only agreement between local files and a local checksum.

The three older receipts remain byte-identical historical adoption records.
Their pre-commit bases and older OpenAPI hashes are not rewritten or treated as
the current authority revision. The supplemental source pin proves committed
candidate provenance, not publication, live runtime compatibility, complete
capability negotiation or issue acceptance. All promotion claims remain false.

The verifier accepts `--authority-root <repo>` to read immutable Git objects
offline. Without it, CI uses bounded immutable-origin reads with no redirect or
local-byte fallback. Both paths verify the same digests and complete inventory.

Authority: [Fortemi #1091](https://git.integrolabs.net/Fortemi/fortemi/issues/1091).
Consumer: [Core #405](https://git.integrolabs.net/Fortemi/fortemi-react/issues/405).
Other declared consumers, producer CI, installed/released acceptance and release
publication remain separate gates. Suite NO-GO and named shard profiles are unchanged.

## Existing Predicate Semantics

Core uses strict Ajv validation before SQL compilation, then checks reversed
range bounds in Unicode scalar/numeric order. Migration 33 supplies bounded
index keys with exact rechecks on author metadata. Source runs come from scoped
source identities, not author metadata. See ADR-016 for scope/default changes,
upgrade/rollback behavior and remaining cross-runtime/citation acceptance.

`src/__tests__/metadata-predicates.test.ts` executes the 51 input/truth cases and
15 SQL scope cases on a fully migrated clean PGlite database. It maps the corpus
owner tenant-a to Core's default source scope explicitly and keeps tenant-b
foreign. It never changes expected membership. Additional tests exercise actual
search entries, selective plans and old-database upgrade; they do not establish
verified hosted authorization, real model inference or released compatibility.
