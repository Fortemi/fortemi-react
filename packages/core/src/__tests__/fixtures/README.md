# Remote Producer Fixture

`remote-adapter.json` is a verbatim capture owned by Fortemi, not a
consumer-invented success mock. `remote-adapter.producer-pin.json` separates the
immutable fixture-source commit from the released server runtime that produced
it. The producer's Rust tests deserialize it through actual runtime models.

CI checks both upstream bytes and the local copy with:

```sh
node packages/core/scripts/verify-remote-producer-fixture.mjs
```

For an offline check against the immutable producer Git object:

```sh
node packages/core/scripts/verify-remote-producer-fixture.mjs --authority-root /path/to/fortemi
```

The 25 cases cover empty/nonempty notes, revised content, directional links,
SKOS tuples, seeded provenance, full-text search, a missing-query response,
authoritative not-found, star/unstar and cleanup. They do not establish auth
denial, semantic availability, full mutation conformance or released React
acceptance. `remote-errors.test.ts` separately names its synthetic fault
injection. Producer #1146 and React #417-421 remain linked qualification gates.

`remote-operations.json` adds a separately pinned 37-case clean capture, including
semantic/hybrid fallback, search limit/no-match filters and each advertised REST
lifecycle mutation. The verifier checks both captures against their own immutable
producer commits. The first fixture is unchanged. Successful vector retrieval,
auth/error runtime coverage and live published-package qualification still require
separate evidence; synthetic fault tests do not satisfy those gates.

## Supplemental Native Capture (#417/#418/#421)

`native-remote-auth.json` and its adjacent receipt are verbatim producer-owned
files from Fortemi commit `912c0636a6d2273e5663a977e0182bfe874c3bd3`.
Their separate pin binds fixture bytes, receipt bytes and the capture script to
that immutable commit. The same verifier above checks all three against upstream
Git objects (or bounded immutable HTTP fetches). The historical 25/37-case pins
remain unchanged.

The receipt records 13 checks and 86 real HTTP calls from the published Linux
AMD64 server 2026.9.9 with a clean-installed, published Core 2026.9.4. Runtime
executable, consumer tarball and fixture-source identities are distinct. Health
`git_sha: unknown` is not used as source proof. Receipt cleanup assertions describe
the historical disposable run, not current host state.

`remote-native-capture.test.ts` replays exact raw response strings with captured
status, content type and Retry-After. Note-route replays require exact methods,
paths and query strings, with FIFO queues per route for concurrent enrichment.
They cover list/detail UTC fields, directional links, composed SKOS/provenance,
authoritative 404, missing/invalid identity 401, real producer 500 and 429
responses, and post-fault recovery. The two 429 responses are selected from the
capture; replay does not trigger a new rate-limit event.

The public personal-mode runtime uses AllowAllPolicy for authenticated note
reads. Its actual 403 is an operator-inventory denial, **not a note denial**.
That response is separately labeled transport injection when replayed through
Core note methods. Neither this replay nor the native receipt qualifies hosted
OIDC/JWT, multi-tenant note denial, read-only mutation enforcement, inference,
all REST operations or other platforms. Current source replay is not a new live
run or a new published-consumer release. Suite NO-GO remains in effect.

`tools/release/verify-remote-package.mjs <core.tgz> <version> <loopback-url>
<lane-container> <receipt.json>` clean-installs the supplied tarball and exercises
its public remote adapter against an exact-image, zero-physical-notes disposable
server. It verifies reads/links/concepts/provenance composition, FTS/tag/limit
behavior, explicit semantic degradation, lifecycle mutations and cleanup. It
records package bytes, verifier source, runtime and response hashes separately.
The container must use the capture script's lane labels and unavailable-inference
configuration. Removing its owned tmpfs container remains mandatory after the
run. A candidate check does not prove registry publication, successful vector
retrieval or auth qualification; rerun released-package acceptance separately.
