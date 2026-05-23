# Supply-Chain Release Controls

Fortemi follows the AIWG security-engineering supply-chain baseline for npm publication where the current infrastructure supports it.

## Controls

- Release publishes run only from `v*` tags or an explicit operator dispatch that resolves to a `v*` tag.
- Release tags must verify against the AIWG maintainer public key bundle committed under `.gitea/keys/maintainers.asc` or an equivalent `.gitea/allowed_signers` file. Fortemi uses the same release and commit signing identity as AIWG on this system.
- Release-sensitive workflow actions and containers are pinned by immutable SHA or digest and recorded in `ci/digests.txt`.
- The pnpm workspace enforces `minimumReleaseAge: 10080` and `blockExoticSubdeps: true`.
- The publish workflow verifies package versions against the release tag before publishing.
- The publish workflow packs and inspects both npm artifacts before publish.
- `@fortemi/core` is published before `@fortemi/react`.

## Current Limitation

npm trusted publishing and npm provenance require a supported OIDC provider. AIWG uses GitHub Actions for the npmjs.org OIDC leg because npm does not list Gitea Actions as a trusted-publishing provider. Fortemi currently publishes from Gitea Actions with a scoped `NPM_TOKEN`, so signed tags, pinned workflow inputs, package-content checks, and token scoping are the active compensating controls.

If Fortemi later adds a GitHub mirror with trusted publishing enabled, move the npmjs.org publish leg to that provider and use `npm publish --provenance`.
