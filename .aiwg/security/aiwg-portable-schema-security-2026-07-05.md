# Security Appendix — AIWG Portable-Schema Surface

- **Date**: 2026-07-05
- **Parent**: `.aiwg/reports/aiwg-portable-schema-audit-2026-07-05.md` · Epic #235
- **Trust model**: the AIWG index, chunk manifests/parts, and Knowledge Shard archives may be **attacker-controlled data** loaded from a URL or file. The app is browser-only (PGlite/WASM, OPFS/IndexedDB), AGPL.

## Findings (severity-ranked)

### CRITICAL

**SEC1 — Prototype pollution via facet aggregation.** `pushFacet` / `getAiwgFortemiFacets` (`aiwg-index.ts:556-559,959-971`), reached from `queryAiwgFortemiIndex:1393` — i.e. an ordinary `useAiwgIndex().search()`. An untrusted index record with `facets:{"__proto__":["x"]}` causes `counts["__proto__"]["x"]=1`, mutating `Object.prototype`. No interaction beyond loading an index and searching.
*Fix:* reject `__proto__`/`constructor`/`prototype` keys (or use `Object.create(null)` / `Map`) in `pushFacet` and every `Record<string,unknown>` merge over untrusted `facets`/`metadata`/`frontmatter`.

### HIGH

**SEC2 — SSRF via manifest-controlled fetch.** `createAiwgFetchChunkLoader`/`createAiwgFetchDetailLoader` (`aiwg-index.ts:917-924,948-957`) call `fetch(new URL(part.href, baseUrl))` with no scheme/origin allowlist; an absolute `href` ignores `baseUrl`, so a malicious manifest redirects fetches to any origin.
*Fix:* allowlist scheme (https/blob/data) and origin; reject absolute cross-origin hrefs unless explicitly opted in by the caller.

**SEC3 — Decompression bomb.** `unpackTarGz` (`shard-tar.ts:163-166`) runs `gunzipSync` with no output-size cap, **before** any checksum check, on both `importShard` and `openShard`.
*Fix:* cap decompressed output size; stream with a byte budget; validate declared vs actual sizes.

**SEC4 — Path traversal (confidentiality).** `UrlComponentStore.read` (`shard-reader.ts:156-166`) builds `${baseUrl}/${filename}` from manifest-controlled `href`; `../` escapes the shard directory on same-origin/multi-tenant static hosting.
*Fix:* resolve + contain within the shard base; reject `..`/absolute segments.

**SEC5 — Algorithmic-complexity DoS.** `findAiwgStaticDuplicatePairs` (`aiwg-index.ts:1522-1541`) is unbounded O(n²) over an attacker-suppliable embedding set.
*Fix:* bound N (documented cap) or use an ANN/bucketing approach; reject oversized sets.

### MEDIUM

**SEC6 — Privacy/PII not enforced at generation.** `buildAiwgStaticEmbeddingSet` / `buildAiwgChunkedIndex` (`aiwg-index.ts:1004-1041,1095+`) never filter by `privacy.classification`/`pii`; enforcement is query-time only. NOTE: raw binary *bytes* are structurally impossible in the record type, so the "never inline raw bytes" half of #227/#1013 is satisfied — only the classification/PII gate is missing.
*Fix:* add a privacy/pii filter option to the builders, default-safe (exclude `private`/`pii` unless explicitly included), aligned with server #1013.

**SEC7 — Self-referential checksums.** `validateChecksums` (`checksum.ts:25-44`) hashes files inside the same untrusted archive → corruption detection, not tamper detection (attacker controls content + hash). `prefetchShard`'s out-of-band `expectedSha256` (`prefetch.ts:125-143`) IS real integrity.
*Fix:* document that in-archive checksums are transport-integrity only; recommend signed manifests / out-of-band hashes for provenance-sensitive imports.

### LOW

**SEC8 (was L1)** — `hashPath()` (`blob-store.ts:32-38`) does not validate hash format; currently unreachable (call sites use internally-computed `computeHash()`). Harden defensively.

## Controls verified CORRECT (do not re-flag)

- No filesystem zip-slip — tar contents stay in an in-memory `Map`, never written by archive-supplied filenames.
- Blob-store keys always internally computed.
- `encodeAiwgDetailId` base64url encoding is path-safe (#177).
- Service worker strictly same-origin gated (`sw.ts:23`); route handlers are inert 503 stubs.
- `plugin-content.ts`: origin allowlist + mandatory SRI + `credentials:'omit'`.
- Chunk caches LRU-bounded (parts 3 / details 32 / matches 5000).
- `importShard` wraps writes in a single DB transaction (clean rollback on malformed input).
- Checksum validation runs before component parsing (weak per SEC7 but correctly ordered).
- `field-mapper`/`plugin-content` parse→typed-copy or throw on non-array spread — no pollution merge there.

## Remediation grouping

- Immediate: **SEC1**.
- Hardening bundle: SEC2 + SEC3 + SEC4 + SEC5 (one issue).
- Privacy/integrity: SEC6 + SEC7 (converge with server #1013).
- Defensive: SEC8.
