# Candidate Metadata Predicates

Fortemi owns these three byte-identical schema/corpus files. See the candidate
receipt for upstream base, paths and SHA-256 identities. The source is not yet
committed or released as a contract; this directory does not advertise a backend
capability, replace a producer authority, or qualify a Knowledge Shard profile.

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
