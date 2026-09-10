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
