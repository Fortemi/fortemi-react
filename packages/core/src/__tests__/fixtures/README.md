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
