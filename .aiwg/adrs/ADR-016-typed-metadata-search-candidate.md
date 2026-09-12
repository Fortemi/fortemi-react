# ADR-016: Typed Metadata Search Candidate

- Status: Implementation candidate, not a promoted cross-runtime contract
- Date: 2026-09-12
- Consumer: [Core #405](https://git.integrolabs.net/Fortemi/fortemi-react/issues/405)
- Authority: [Fortemi #1091](https://git.integrolabs.net/Fortemi/fortemi/issues/1091),
  `contracts/metadata-search/candidate/1.0.0/`
- Related: ADR-015 source identity, ADR-011 named shard profiles, suite NO-GO

## Decision

Consume byte-identical candidate schema and truth corpora through a hash-bound
candidate receipt. The upstream source is uncommitted work on a named base;
hashes identify those bytes, not a published producer revision. Do not advertise
the candidate as a negotiated server/wire capability or silently promote its receipt.

PGlite compiles validated predicates into typed SQL over author `note.metadata`.
Numbers, strings, booleans and present JSON null remain distinct; absence is not
null. Range bounds use numeric or Unicode scalar order, not JavaScript UTF-16
order or database locale. Errors contain stable codes and no input values.
All public SearchRepository entries validate before any database lookup.

Migration 33 replaces the five generated-metadata and five native unbounded text
indexes with five bounded typed author-metadata indexes. It adds the authority's
versioned immutable numeric/text key functions and two source-identity indexes.
Keys narrow candidates only; exact rechecks preserve large stored values and
avoid prefix, clamp and truncation false positives. No stored metadata is
rewritten. Never change indexed key-function semantics in place.

## Local Scope Versus Authorization

Core's note table has `archive_id` but no tenant ownership column or hosted RLS.
An explicit archive filter selects the note's archive. An explicit tenant filter
requires a matching same-archive source identity; the default tenant also admits
native notes with no source identity. These are local selection rules, not
authentication or authorization. A multi-tenant hosted adapter still needs a
verified context and its own authority-qualified isolation boundary.

Import-run predicates use the supplied tenant, defaulting to `default`, and the
note's archive. All positive clauses quantify over one identity; absence means
no identity in that scope has a run. Correlated EXISTS avoids multiplying notes,
counts or ranked candidates. Locators apply that same source scope and import-run
conjunction, excluding other tenants, archives and nonmatching runs.

The SQL corpus's owning `tenant-a` maps explicitly to Core's database-local
`default`; `tenant-b` remains foreign. Expected IDs and authority bytes are not
changed. This proves source quantification, not producer hosted authorization.
The previous unscoped import/locator lookup is intentionally tightened; callers
working with non-default source tenants must supply the existing tenant option.

## Migration And Rollback

Upgrade through the ordinary transactional migration runner, including existing
version-32 databases. Preserve data and migration history. Older code can read
the unchanged tables but regains its incorrect text-comparison behavior and may
scan without its old indexes. It is not a qualified search rollback. Restoring
old unbounded indexes can fail on large values accepted after upgrade; do not
truncate metadata or delete user data to force rollback. Preserve a pre-upgrade
backup when deploying; corrected binaries are the preferred recovery path.

## Evidence And Remaining Gates

The unchanged 66-case authority corpus executes actual Core-generated SQL after
the full PGlite migration chain. Tests also cover natural selective index plans,
version-32 upgrade with metadata preservation, uncompressible post-upgrade writes,
54 equality/membership/range retrieval checks across six paths and three modes,
duplicate/foreign source locators, and validation before selector resolution.
Vectors in these tests are explicitly synthetic, not inference qualification.

The schema import uses the standard JSON import attribute so native Node ESM
and browser bundlers load the same candidate bytes. Bundled builds and Vitest
alone do not qualify source-level Node loading: the standalone Playwright tests
import Core through the source alias, so test collection and actual browser
execution remain distinct required checks.

## Public Adapter Operations

`BackendCapabilities.typedMetadataPredicates` describes local candidate-v1
operations only. It is not a compatibility-discovery revision, server response,
or promoted authority receipt. PGlite supports it through the same indexed
repository implementation; RecordStore, static shards and the current remote
adapter explicitly report false and reject supplied predicates before I/O.
Absent flags on third-party providers mean unsupported to `selectBackend`.
Local source scope is likewise rejected where unsupported rather than ignored.

The PGlite adapter and search tool forward metadata and tenant/archive selection.
The adapter uses fts/semantic/hybrid modes; the tool retains text/semantic/hybrid/
auto. PGlite advertises semantic operations only with both vector availability
and an injected query embedder. Predicates are validated before embedding or SQL;
an invalid embedding fails before SQL, and unsupported modes do not fall back.
Public tag-AND/source-OR filters apply before ranking. Existing repository/tool
tags retain ANY semantics. RecordStore's existing tag/source scan filters now
apply before its result limit; this is not an authorized metadata slow path.

All built-in `evidenceLocators` capability flags remain false. PGlite forwards
its partial scoped source projections, but they do not qualify complete stable
note/chunk/span citations. The local candidate corpus is tested through PGlite
and the tool in every supported forced mode; unsupported adapters run the same
corpus as rejection-before-I/O checks, not equivalent retrieval implementations.

This is the PGlite correction, not completion of #405 or #1091. Remaining work:
the promoted producer request/result authority and immutable pins; RecordStore
and third-party adapter conformance beyond the tested built-in gates;
reproducible note/chunk/span citation semantics (legacy current-chunk projection
is not yet qualified); full deletion/purge, verified hosted authorization and
cache matrices; clean installed and released cross-runtime acceptance; CI and
release publication. No new suite parity, backup or portability claim is made.
AIWG static indexing, Knowledge Shard transfer and live persistence stay separate.
