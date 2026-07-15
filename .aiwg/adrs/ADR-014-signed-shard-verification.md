# ADR-014: Signed Knowledge-Shard manifests — Ed25519 over WebCrypto, verify before persistence

- **Status**: Proposed (accepted on merge of the #324 delivery PR)
- **Date**: 2026-07-15
- **Issue**: #324 (child of epic #322)
- **Relates**: ADR-013 D6 (verify-before-persist pipeline order), ADR-011 (shard conformance), `packages/core/src/shard/checksum.ts` (SEC7 consistency-vs-authenticity note), #271 (byte round-trip)

## Context

Shard in-archive SHA-256 checksums and BLAKE3-addressed blob sidecars detect **transport corruption and content mismatch**, not **tampering**: an attacker who controls the archive controls both the file bytes and the manifest hashes, so a passing checksum proves only internal consistency (`checksum.ts` SEC7). There is no publisher-provenance gate, so a tampered shard can write attacker-controlled records and attachment bytes straight into local canonical records, the BlobStore, and PGlite.

ADR-013 D6 fixed the *pipeline order* (verify → validate manifest → validate hashes → commit records → hydrate bytes → project). This ADR chooses the *signing primitive* and defines the signed payload, envelope, key/trust model, and typed failures that make that order enforceable. Signing lives entirely in the Fortemi shard layer; Bytecask stays signing-unaware (it only ever receives already-verified content-addressed bytes).

### Constraints

- **Browser + server (Node) compatible** with no heavy new dependency.
- **Deterministic verification** — the same shard verifies identically everywhere.
- **Small, auditable trust surface** — key discovery/rotation/revocation must be expressible without a PKI.

## Decision

### D1. Algorithm: Ed25519 via the Web Crypto API

Signatures are **Ed25519** (`crypto.subtle.sign/verify` with algorithm `'Ed25519'`). Ed25519 is available in all target runtimes as of 2026 (Chrome ≥137, Safari ≥17, Firefox ≥129, Node ≥18 WebCrypto) and needs **zero new dependencies** — SubtleCrypto is already used for shard SHA-256. Keys are represented as **raw 32-byte public keys, base64url-encoded** in the envelope (`crypto.subtle.importKey('raw', …, { name: 'Ed25519' }, …, ['verify'])`). Rejected alternatives are recorded below.

A capability probe (`isShardSigningSupported()`) reports Ed25519 availability; on a runtime without it, signed-shard *verification* fails closed with a typed `unsupported` error rather than silently downgrading.

### D2. Signed payload = the canonical manifest digest, never self-referential

The signature covers a **signing payload** that is a stable serialization of:

- `format_version` — signing-envelope version (`'1'`).
- `signer` — key identity: `{ key_id, algorithm: 'ed25519', public_key }` (public_key base64url raw).
- `manifest_digest` — SHA-256 hex of the **canonical manifest bytes** (`manifest.json` exactly as packed), which already includes every component `checksums` entry.
- `blob_digests` — sorted list of the referenced sidecar blob BLAKE3 digests (bare hex), so the signature commits to the byte set, not just the metadata.

The payload is serialized as canonical JSON (sorted keys, no whitespace) and hashed; the Ed25519 signature is over that hash. The envelope stores the payload fields plus `signature` (base64url) as a **separate archive entry** `signature.json` — the signed payload never contains its own signature (no self-reference), and `signature.json` is **excluded** from `manifest.checksums` (it post-dates the manifest it signs).

### D3. Verification order — nothing persists before the signature verifies

```text
untrusted shard bytes
  1. parse bounded envelope           (size/þ shape caps; hostile-input safe)
  2. resolve trusted key              (signer.key_id against the trust store)
  3. verify Ed25519 signature         over the recomputed payload hash
  4. validate signed manifest         (manifest_digest == SHA-256(manifest.json))
  5. validate component + blob hashes  (existing checksum + BLAKE3 sidecar checks)
  6. commit canonical records
  7. hydrate verified bytes           (BlobStore)
  8. update optional PGlite projection
```

**No unverified shard bytes reach canonical records, the BlobStore, or PGlite.** Steps 1–5 are pure and side-effect-free. The `blob_digests` in the payload are cross-checked against the sidecar entries at step 5, so a swapped blob fails before hydration.

### D4. Unsigned-shard policy — explicit, caller-chosen, default reject

`verifySignature: 'require' | 'prefer' | 'trusted-local-only'` on `ImportOptions`:

- **`require`** (default when a trust store is supplied) — an unsigned or bad-signature shard is rejected with a typed error; nothing persists.
- **`prefer`** — a validly-signed shard is verified; an unsigned shard imports with a prominent `warnings` entry (explicit "unauthenticated import" acknowledgment). A shard with a *present but invalid* signature is always rejected (a broken signature is never downgraded to unsigned).
- **`trusted-local-only`** — signatures are ignored entirely; for a user importing their own local export. Requires no trust store; emits an informational warning.

When no `trustStore`/policy is supplied at all, behavior is unchanged from today (unsigned import, checksum-only) — signed verification is strictly additive and opt-in, so existing callers are unaffected.

### D5. Key discovery, trust, rotation, revocation

- **Trust store**: an injected `ShardTrustStore` — `resolve(key_id) → { public_key, revoked } | null`. The default in-memory implementation is seeded from a caller-supplied allowlist of `{ key_id, public_key }`; a host may back it with anything (a fetched publisher key set, a config file).
- **Rotation**: additive — a new `key_id` is added to the store; old shards keep verifying against their (still-present) key.
- **Revocation**: a `key_id` marked `revoked` fails verification with a typed `revoked` error even if the signature is cryptographically valid.
- **Unknown signer**: `key_id` absent from the store → typed `unknown-signer` error (distinct from bad-signature, so hosts can prompt to trust-on-first-use if they choose).

### D6. Typed failures

`verifyShardSignature()` returns a discriminated union so callers distinguish causes without string-matching:

```ts
type ShardSignatureVerdict =
  | { ok: true; keyId: string }
  | { ok: false; reason: 'unsigned' }
  | { ok: false; reason: 'malformed'; detail: string }      // envelope shape/size
  | { ok: false; reason: 'unknown-signer'; keyId: string }
  | { ok: false; reason: 'revoked'; keyId: string }
  | { ok: false; reason: 'bad-signature'; keyId: string }
  | { ok: false; reason: 'content-mismatch'; detail: string } // manifest/blob digest ≠ payload
  | { ok: false; reason: 'unsupported' }                     // no Ed25519 in this runtime
```

## Consequences

**Positive**: publisher provenance before any local mutation; the SEC7 gap is closed; zero new dependencies; deterministic cross-runtime verification; rotation/revocation without a PKI; typed failures enable good UX (trust-on-first-use, revocation messaging). Signing stays out of Bytecask.

**Negative / cost**: signed export needs the private key (a `signShard()` helper + key-management burden on publishers — the export side is scaffolded here but private-key custody is the operator's); a runtime without Ed25519 cannot verify signed shards (fails closed — acceptable, the target matrix all support it); the envelope adds one small archive entry.

**Risk if deferred**: every shard exchanged remains a trust-free write path into local canonical records and the BlobStore.

## Alternatives considered

- **ECDSA P-256** — also WebCrypto-native and universally available, but Ed25519 has smaller keys/signatures, is misuse-resistant (deterministic, no per-signature nonce to get wrong), and matches modern signing conventions. P-256 remains the fallback if an Ed25519 gap surfaces on a required runtime.
- **RSA-PSS** — WebCrypto-native but large keys/signatures and slower; no upside here.
- **Detached signature over the whole `.tar.gz`** — rejected: the archive is recompressed/repacked in places (clustering, layout), so a byte-exact whole-archive hash is fragile; signing the canonical manifest digest + blob digest set is stable across repacking and still commits to all content.
- **libsodium / `@noble/curves`** — a proven Ed25519 implementation, but adds a dependency for something WebCrypto already provides on every target runtime. Kept as the fallback if `unsupported` becomes common.
- **A full X.509/PKI chain** — rejected as over-engineered for the trust model; a flat `key_id → public_key` allowlist with revocation covers publisher provenance without CA machinery.

## References

- @.aiwg/adrs/ADR-013-single-bytecask-substrate-optional-pglite-projection.md — D6 pipeline order
- @packages/core/src/shard/checksum.ts — SEC7 consistency-vs-authenticity note
- @packages/core/src/shard/shard-signature.ts — this ADR's implementation
- RFC 8032 (Ed25519); W3C Web Cryptography API (Ed25519 registration)
- Issues: #324, #322 (epic)
