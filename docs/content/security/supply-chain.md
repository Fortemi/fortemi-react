# Supply-Chain Release Controls

Fortemi follows the AIWG security-engineering supply-chain baseline for npm publication where the current infrastructure supports it.

## Controls

- Release publishes run only from `v*` tags or an explicit operator dispatch that resolves to a `v*` tag.
- Release tags must verify against the release-key public bundle committed under `.gitea/keys/maintainers.asc` or an equivalent `.gitea/allowed_signers` file.
- Fortemi follows AIWG's two-key model: personal maintainer keys sign commits; the release-only key signs `v*` tags. `tools/release/cut-tag.sh` fetches the release key and machine passphrase from OpenBao into an isolated temporary keyring, verifies the expected fingerprint, signs and verifies the tag, and removes the keyring on exit. It has no host-keyring fallback.
- Release-sensitive workflow actions and containers are pinned by immutable SHA or digest and recorded in `ci/digests.txt`.
- The pnpm workspace enforces `minimumReleaseAge: 10080` and `blockExoticSubdeps: true`.
- The publish workflow verifies package versions against the release tag before publishing.
- The publish workflow packs and inspects both npm artifacts before publish.
- `@fortemi/core` is published before `@fortemi/react`.
- Public npmjs.org publishing runs from the GitHub mirror in `.github/workflows/npm-publish.yml` via **npm trusted publishing** (GitHub Actions OIDC) with `--provenance`. There is no long-lived npm token: the workflow's short-lived `id-token` claims are verified by npmjs.org against a per-package trusted-publisher configuration (`GitHub Actions / Fortemi / fortemi-react / npm-publish.yml`, no environment) at `https://www.npmjs.com/package/<name>/access` for each of `@fortemi/core`, `@fortemi/graph`, and `@fortemi/react`.
- After each publish, the workflow independently verifies that a provenance attestation landed on npmjs.org (`npm view <pkg>@<version> --json → .dist.attestations`); a publish without provenance fails the run.
- Local Gitea publishing remains in `.gitea/workflows/publish.yml` and uses `secrets.GT_PUBLISH_TOKEN` for the internal Gitea package registry, falling back to `secrets.NPM_TOKEN` only for older repository configurations.

## Release Tag Recovery

If a pushed release tag fails the signed-tag gate because it was signed by a personal commit key, treat it like AIWG's wrong-key recovery path: no publish artifacts have passed the gate, so delete the bad tag on every remote and re-cut it with `tools/release/cut-tag.sh <version>`. Do not add the personal key to `.gitea/keys/maintainers.asc` just to make the failed tag pass.

## OpenBao Signing Inputs

The release operator supplies only the `ci-fortemi-react` reader AppRole
credentials and the OpenBao endpoint. Secret values are never accepted through
command-line arguments or printed:

- `VAULT_ADDR`
- `VAULT_CACERT` when the OpenBao issuer is not in the system trust store
- `VAULT_CI_ROLE_ID`
- `VAULT_CI_SECRET_ID`
- `RELEASE_SIGNING_KEY_VAULT_PATH` and `RELEASE_SIGNING_KEY_VAULT_FIELD`
- `RELEASE_SIGNING_PASSPHRASE_VAULT_PATH` and
  `RELEASE_SIGNING_PASSPHRASE_VAULT_FIELD`

Run `tools/release/cut-tag.sh <version> --dry-run` before the release ceremony
to fetch the authority, verify its fingerprint and committed public key, and
complete a signing probe without creating a tag.

The helper verifies TLS for AppRole login, KV reads, and token revocation. It
does not expose an insecure transport flag; a configured `VAULT_CACERT` must
name a readable reviewed PEM bundle.

## Active Publish Split

npm provenance requires a supported OIDC environment. AIWG uses GitHub Actions for the npmjs.org leg because npm does not list Gitea Actions as a trusted-publishing provider. Fortemi follows that split now:

- Gitea Actions verifies the signed release tag, typechecks, lints, builds, packs, inspects, and publishes the packages to the local Gitea package registry for internal use. Full test/e2e verification also runs on Gitea CI for every push.
- GitHub Actions on the mirror verifies the same signed tag and performs the final npmjs.org distribution via OIDC trusted publishing with `--provenance`. To limit spend on the GitHub leg, it does not repeat typecheck/lint/tests — verification lives on Gitea; GitHub is the delivery leg only.
- The public publish job grants `id-token: write` for the OIDC token exchange and provenance attestation; it does not run on pull requests.

This avoids a dual-publisher race: Gitea no longer publishes to npmjs.org, so the GitHub provenance publish is the only public distribution path.
