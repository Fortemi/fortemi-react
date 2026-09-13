# ADR-016: Typed Metadata Search Candidate

## Immutable Candidate Source Pin (Cycle100)

The candidate schemas/vectors now have an additional `source.receipt.json` bound
to producer commit `e99e4723293d12e76862ea83fda86ed70d3573c8`. It covers all eleven
consumed schema/vector files, the current generated OpenAPI and authority README.
CI verifies upstream bytes independently, with bounded reads, strict inventory
and negative drift tests. Offline checks use immutable Git objects, not mutable
working-tree files. The three historical adoption receipts remain byte-identical.

This is a committed candidate source identity, not a contract promotion. Source
pin reconciliation no longer depends on an uncommitted base, but full producer CI,
other consumer pins, runtime matrices, release qualification and full issue
acceptance remain open. Existing source semantics and capability flags do not change.

## Cycle96 Consumer Regression Boundary

Core runtime/package source remains unchanged;220groups/293actual hosted requests
pass. The producer verifies one prior browser detail read per note and four Core
enrichment reads separately;635durable audit rows include added browser activity.
HotM context-owned React/request/gate isolation passes eleven actual browser note/
stream controls, but external job persistence and clipped mobile note controls
remain. No wire or immutable authority change. Full consumer/profile/lifecycle/CI/
delivery/release sweep and suite NO-GO remain; see suite Cycle96 exact receipts.

## Cycle95 Consumer Regression Boundary

Core runtime/package source remains unchanged. The installed candidate again passes
220groups/293actual hosted requests; producer audit records625durable rows with
browser traffic included. HotM actual production browser passes six stream lifecycle
controls but retains stale tenant A notes after switching to B, and its central job
cache remains unscoped. These are application isolation gaps, not a Core transport
or selected-memory wire change. Native/full lifecycle, immutable authority pins,
all consumer/profile/CI/delivery and release sweep remain. Suite NO-GO retained.

- Status: Implementation candidate, not a promoted cross-runtime contract
- Date: 2026-09-12
- Consumer: [Core #405](https://git.integrolabs.net/Fortemi/fortemi-react/issues/405)
- Authority: [Fortemi #1091](https://git.integrolabs.net/Fortemi/fortemi/issues/1091),
  `contracts/metadata-search/candidate/1.0.0/`
- Related: ADR-015 source identity, ADR-011 named shard profiles, suite NO-GO

## Decision

Cycle94 consumer update: HotM's realtime candidate adopts the producer selected-
memory reader endpoint with bounded exact-field decoding. Generated-schema and
real-server metadata/SSE receipts remain distinct from UI tests and released
compatibility. Core runtime/package source is unchanged and does not call this
endpoint; existing package/wire authority pins remain. Full original20scope,
all prior holds and lifecycle/every-consumer/CI/delivery/release gates persist.

Cycle93 producer selected-memory context candidate exposes authorized name/schema
to readers and tenant-qualifies default uniqueness. It is a HotM realtime
dependency; Core does not call the new endpoint and its runtime/package/wire pins
remain unchanged. Producer-only tests do not replace Cycle92's failed real-client
acceptance. Consumer adoption, authority pins, actual-daemon/live and all remaining
CI/delivery/release gates remain pending; suiteNO-GO is retained.

Cycle92 addresses the HotM consumer application's archive request-name/event-
schema separation and context replacement. Its real resolver/client/parser is
tested against the private producer fixture, with application-service/UI tests
owned by HotM. Core's runtime/package/wire pins remain unchanged. This is not a
new Core release or a full hosted lifecycle/every-consumer qualification; suite
NO-GO and the remaining CI/delivery/release gates are retained.

Final Cycle92 HotM local tests/build pass, but the real producer test is NOT_PASS:
archive metadata GET returns503 before SSE admission. Archive GET migration and
the admin-only inventory/default-resolution dependency remain unresolved. The
unchanged Core package's prior receipts are retained at their original scope;
Cycle92 does not replace them with a new end-to-end PASS.

Cycle91 producer work adds typed temporary-database retries, bounded read-only
note snapshots in fenced completion, and schema-based hosted live/replay filtering.
Core runtime/package, wire authority and pins remain unchanged. The suite Cycle91
checkpoint owns source-bound native/binary/parser regression evidence, not a new
released Core or HotM application qualification. HotM's archive-name/event-schema
mapping, other handlers/follow-ups/index/queue, complete lifecycle, every consumer,
CI/delivery/releases and suite NO-GO remain.

Final Cycle91 regression passes 220 installed-Core groups/293 requests and six
actual-binary live/seeded-replay streams through the unchanged HotM parser. The
transport's archive-name adapter is an owned fixture, not an application fix.
Core's 580 runtime/package files remain unchanged. The reviewed private HTTP
database capacity profile passes twice without slot refusals in its bounded log
tail; this is not evidence about shared vLLM or the earlier terminal lockups.

Cycle90 connects the producer's first hosted production handler through an
explicit registry, bounded claim drain and attempt-fenced lifecycle callbacks.
Existing job event payloads use claim-bound tenant/archive envelope context.
No Core runtime/package, wire authority, receipt or capability flag changes.
Producer native/actual-binary evidence is recorded in the suite Cycle90
checkpoint, not a new released Core qualification. Remaining worker handlers,
follow-up/note.updated/index events, scoped queue summaries, live SSE lifecycle,
full consumer/CI/delivery/release gates and suite NO-GO remain.

Cycle89 producer work implements one pool-free hosted document-type handler with
scoped detection/assignment/provenance and job-bound replay, plus native membership
trigger routing/statistics fixes. Production registration/claim drain, other
handlers, follow-up embedding execution and tenant events remain unqualified.
Core runtime/package and wire authorities/pins are unchanged. The suite Cycle89
checkpoint owns final source-bound regression and cleanup evidence; no released
consumer or readiness promotion follows, and suiteNO-GO remains.

Cycle88 producer work adds bounded claim-bound content transactions and an explicit
hosted handler/context interface. Native-write and rollback tests qualify the
interface, not production handlers or claim drain. The unchanged installed Core
package again passes220groups/293requests through the actual-binary harness:
278binary/15auxiliary, healthy startup and580durable audit rows. Core runtime,
authority receipts and readiness flags are unchanged. Handler retry safety,
follow-ups/events and full lifecycle/cache/EE/performance/every-consumer/CI/delivery/
release gates remain; suiteNO-GO is not cleared.

Cycle87 producer progress adds bounded active-tenant claim dispatch and immutable
post-commit, attempt-fenced settlement capabilities. Non-bypass tests cover
allowlists, routing exclusion, fairness, commit failure, deadlines and late
callbacks. These primitives are not wired to production handlers or claim drain;
Core runtime/package, wire authority receipts and capability flags remain unchanged.
Full worker/lifecycle/cache/EE/performance/every-consumer/delivery/release gates
and suiteNO-GO remain. See the producer hosted-worker-transactions impact record.

The unchanged installed Core package again passes220groups/293requests through
the Cycle87 actual-binary harness, with278binary/15auxiliary requests, healthy
recovery startup and580durable audit rows. This is regression evidence, not a
new producer handler-execution, released-package or capability qualification.

Cycle86 repairs producer startup/periodic recovery with bounded registry pages
and per-tenant transactions. Non-bypass recovery tests and the actual-binary
installed-Core220group/293request matrix pass, including healthy recovery,
durable audit and mandatory private bootstrap dependencies. The unchanged Core
runtime/package and historical authority receipts are not promoted. Producer
claims, handlers, callbacks and tenant events remain unqualified; full lifecycle,
cache/EE/performance/every-consumer/CI/delivery/release gates and suiteNO-GO remain.

Cycle85 producer progress adds transaction-scoped queue operations and attempt-UUID
fencing with non-bypass database tests. Production dispatch and handlers are not
wired to them, and the Cycle84 worker-health failure remains open. Core runtime,
candidate package, authority receipts and capability flags are unchanged; this
producer library result is not additional installed-consumer acceptance. See
Fortemi's `.aiwg/architecture/impact/hosted-worker-transactions.md` and linked
Cycle85 issue reports. Full lifecycle/consumer/CI/delivery/release gates remain.

Cycle84 runs the unchanged installed Core package against the actual producer
binary with its mandatory private bootstrap dependencies.220groups/293requests
pass, of which278reach the launched binary and15exercise auxiliary constructed
policy/TLS/cold-JWKS controls. Durable tenant audit, all five Redis startup stores,
forced-RLS checks and graceful binary shutdown are observed. These are precise
local candidate results, not released-runtime or complete capability evidence.

The overall gate remains NOT_PASS because the production worker's unscoped pool
cannot reap tenant-RLS jobs: fresh/reused connections reproduce42704/22P02.
The test retains worker-health failure after preserving HTTP/audit/cleanup evidence.
Probe-only tenant scope and column grants diagnose fixture prerequisites but do
not repair hosted worker dispatch. Worker lifecycle, cache expiry/revocation,
EE policy atomicity, performance, every consumer, delivery and release remain.
Core runtime, candidate tarball, historical receipts and capability flags are
unchanged. The suite remains NO-GO; see the Cycle84 linked reports.

Cycle82 reuses the unchanged Cycle80 installed package with a real HTTPS issuer
and the producer's production ClerkProvider/PgTenantStore authentication path.
The same search/detail/resolution matrix now crosses JWT signature/claim/scope
checks and database tenant admission. Negative trust, issuer/JWKS availability,
cached-key rotation and tenant-state cells have separate receipts. Core runtime,
package bytes, historical authority receipts and capability flags are unchanged.
The pinned producer verifier retains cached old keys and rejects new unknown kid
values without a same-URI refresh; this does not prove immediate key revocation.
Production binary bootstrap, EE policy atomicity, cache expiry, lifecycle workers,
models, performance, every consumer and released-runtime gates remain open.

Cycle81 clean-installs the unchanged Cycle80 tarball and calls the actual producer
search, note-detail and resolution handlers over private loopback using native
Node fetch. The fixture covers three modes, two tenants and an archive, all four
text units, index7, exact BOM/astral/combining/CRLF bytes, typed resolution scope,
target-note policy denial and stale/archive/tombstone/SQL-deleted state. Server
traffic and access counts distinguish search enrichment from resolution.
The candidate package and historical receipts are unchanged. Fixture identities,
synthetic vectors and SQL deletion are not production JWT/JWKS, inference or
lifecycle-worker purge/crash/restore acceptance. Released-runtime and full
capability gates remain open. See the linked Cycle81 issue receipts.

Cycle80 adds `RemoteDataBackend.resolveEvidence` with a distinct
`resolution.receipt.json` adopting the producer's current-storage POST schema and
21 shared wire vectors. Locator, metadata and option validation plus the 65,536
encoded-byte limit run before headers or transport. Auth/archive context comes
from existing configured headers, not caller tenant/archive/visibility fields.
Optional typed predicates and archived inclusion narrow this resolution request;
they do not expand the remote search query subset or negotiated capabilities.

Requests use no-store and reject redirects. A single 30-second deadline covers
headers, fetch and streaming, with caller abort support. Responses require JSON,
no-store, strict schema, well-formed UTF-8 and exact cited-span byte length; the
stream buffer is bounded by worst-case JSON escaping of that span. No detail
read, Unicode normalization, unbounded server error body or retained cause is
used. HTTP errors keep a bounded status classification. Full-text digest and
current authorization checks belong to the producer: a partial returned range
cannot independently prove its parent text digest. Launched producer-to-consumer,
production JWT/JWKS/lifecycle/cache and released-runtime gates remain distinct.
Historical GET/evidence receipts remain unchanged and complete capability false.

Cycle79 producer work adds a separate current-storage resolution POST endpoint
and candidate wire authority. Core's existing GET search REST receipt and pure/
PGlite resolver do not certify that endpoint. Keep those historical receipts
unchanged; remote resolution must explicitly adopt the new schema/corpus and
prove normalized note-policy, tenant/archive, current-unit/source, no-store and
bounded-error behavior through a clean installed/live consumer. No new Core
runtime implementation or full capability is claimed by this producer progress.

Cycle78 adopts the producer's full candidate REST request/result schema through
a separate `rest.receipt.json`; the earlier predicate/evidence receipt stays
byte-identical. All four JSON schemas are registered locally, including the
predicate file-location alias for its distinct canonical $id. Strict Ajv
validation runs before any response projection or detail request. The producer
clarifies object types and conditional property declarations for strict Ajv
compilation without weakening instance validation or changing accepted values.

Unknown response/hit/chain/degradation fields, non-FTS degradation, uint32 chain
overflow and foreign chain identity fail with bounded invalid-response errors.
Existing note/query/total/limit and immutable evidence checks remain. The
adapter still exposes only q/mode/limit/tags, with limit1..100/default20 and
defaultFTS; schema adoption does not enable the server's additional parameters.
Unsupported metadata/scope/diversity options remain rejected before I/O.
Semantic degradation is represented as explicit FTS, never a fabricated mode.

The request/response corpus, source tests and clean installed package gate bind
this candidate's bytes and behavior. No old receipt is rewritten as new evidence,
and no published revision, full capability, hosted authorization or live/released
consumer acceptance follows from this change. Further declared consumers,
producer scoped resolution and lifecycle/cache/JWT/JWKS/performance gates remain.

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

The separate citation candidate now consumes authority-owned
`evidence-locator.schema.json` and55 shared text-binding vectors. The pure
`search-evidence` module validates immutable locator copies, binds exact UTF-8
text and rejects stale/mismatched/unavailable snapshots. Coordinates are explicit
half-open UTF-8 byte offsets, not JavaScript UTF-16 positions; BOMs, combining
characters and line endings are preserved. Native text-unit IDs plus full-text
SHA-256 distinguish current/title/attachment/embedding content. The hash is not
an access grant or retention promise. The per-hit candidate envelope and PGlite
projection now use these identities; full producer REST authority/resolution,
auth/deletion/purge and released-consumer acceptance remain. See the producer
candidate's EVIDENCE.md for the separately verified producer projection/fusion.

The authority-owned evidence-set schema and36 shared cases define an optional
`SearchResult.evidence` envelope with explicit omissions, max64locators, strict
same-note validation, Unicode scalar ordering, deduplication and semantic-first
bounded retention. Pure Rust/TypeScript merge implementations preserve distinct
source identities and omission reasons. Producer candidate SearchHit validation,
scoped SQL and actual fusion retention are now verified in Cycle75; full REST
authority, offline bundled OpenAPI and producer database resolution remain open.

PGlite projects citations in the actual lexical/vector ranking query. Whole
matching title/body/completed attachment units are attributed individually;
cross-unit conjunctions without one matching unit report unavailable evidence.
The winning stored embedding row supplies its own native ID/index/text. Built-in
PostgreSQL SHA-256 over UTF-8 binds raw text within that statement; raw contents
never cross the projection boundary. A65th candidate detects the64-locator limit,
oversized/unrepresentable units are explicit omissions, and no rendered snippet
supplies coordinates. Hybrid fusion retains both retrieval legs without rebinding
later text, and rechecks note/metadata/deletion scope during display hydration.
JSON transport preserves leading BOMs in native hit IDs. Six former citation
failures now pass with explicit new-field assertions and real storage resolution;
sealed RED receipts remain historical evidence. Legacy locators remain separate.

`SearchRepository.resolveEvidence` now resolves candidate locators against current
PGlite storage in one parameterized statement. Its explicit scope accepts only
tenant, archive, visibility and typed metadata predicates; unsupported fields and
malformed scopes fail before I/O. The default source tenant is `default`, including
native notes with no source identity but excluding foreign-owned sources. Note
visibility/deletion, exact native unit ID/index and any source tuple are checked
in the same statement snapshot. A locator is not an authorization grant.

The SQL projection withholds text above16MiB before returning it, and transports
accepted UTF-8 as hex. This preserves a leading BOM otherwise removed by PGlite's
ordinary text decoder; explicit fatal UTF-8 decoding retains BOMs and line endings.
The response is only the bound byte range, without raw external keys or source
metadata. Changed, deleted, purged, out-of-scope and missing text all return
`SEARCH_EVIDENCE_UNAVAILABLE`; malformed locator/scope uses
`SEARCH_EVIDENCE_INVALID`, and predicate errors retain their existing code.

Focused real-storage tests cover all four units, nonzero embedding index, exact
Unicode bytes, changed content/identity, attachment lifecycle, terminal purge
receipts, default/foreign source scope, correlated source tuples, metadata and
oversized UTF-8 projection. This qualifies local resolver behavior only. It does
not qualify historical retention, concurrent hosted authorization, cache behavior,
producer database resolution, UI exposure or clean released consumers.

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
both legacy scoped source projections and the new optional candidate evidence
envelope. Neither qualifies producer/hosted/clean released citation behavior.
The remote adapter now validates a present candidate envelope against the same
strict authority-owned sub-contract and enclosing normalized note identity before
any detail enrichment. Null, malformed, foreign-note, unknown-field, duplicate,
unordered and over-limit evidence rejects the whole response with a bounded
`RemoteBackendError` of kind `invalid-response`, without retaining input/cause.
Absent evidence remains absent for older producers. All search modes, semantic
entry points and explicit degraded reports forward the immutable validated set
as `BackendSearchHit.evidence`, not `remoteSearch` metadata or legacy locators.
Later detail text never rebinds the ranked snapshot. This is response validation,
not an authorization grant or a remote database-resolution implementation.

The source regression uses synthetic evidence atop an unchanged historical
producer envelope:22failures/onelegacycontrol before the correction,23passing
cases after it. The clean-installed public entry also checks all four text units,
index7, exact UTF-8/source binding, three modes, legacy absence and malformed
second-hit rejection before even the first detail read. A negative package-gate
test detects consumers that drop evidence. These checks do not replace a fresh
real producer-to-installed-consumer HTTP capture or published runtime matrix.
The local candidate corpus is tested through PGlite
and the tool in every supported forced mode; unsupported adapters run the same
corpus as rejection-before-I/O checks, not equivalent retrieval implementations.

This is the PGlite correction, not completion of #405 or #1091. Remaining work:
the promoted producer request/result authority and immutable pins; RecordStore
and third-party adapter conformance beyond the tested built-in gates;
producer full REST authority/resolution and cross-runtime note/chunk/span citation acceptance
(legacy current-chunk projection is not qualified); full deletion/purge, verified hosted authorization and
cache matrices; clean installed and released cross-runtime acceptance; CI and
release publication. No new suite parity, backup or portability claim is made.
AIWG static indexing, Knowledge Shard transfer and live persistence stay separate.

## Candidate Package Gate

The candidate directory is included in the Core tarball without promoting it to
a REST schema export. The release verifier compares packaged schema/fixture and
receipt bytes, then runs55binding/36envelope cases and real three-mode PGlite
search/resolution through the clean-installed public entry. It also checks adapter
forwarding while the complete capability remains false, exact BOM/Unicode bytes,
winning embedding identity, changed text and deletion. Negative verifier tests
reject missing or altered packaged contracts before API execution.

The shard implementation receipt's existing search/public-entry dependencies
must be refreshed together with the new helper/schema dependencies. Rehashing
alone is not conformance: require the current portable inventory and package gate.
Bounded local partitions must cover that exact inventory without dropping files;
retain failed/timeout attempts separately. Neither package verification nor these
local partitions substitute for producer runtime or released consumer acceptance.
