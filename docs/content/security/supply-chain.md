# Supply-Chain Release Controls

Fortemi follows the AIWG security-engineering supply-chain baseline for npm publication where the current infrastructure supports it.

## Controls

- Release publishes run only from `v*` tags or an explicit operator dispatch that resolves to a `v*` tag.
- Release tags must verify against the release-key public bundle committed under `.gitea/keys/maintainers.asc` or an equivalent `.gitea/allowed_signers` file.
- Fortemi follows AIWG's two-key model: personal maintainer keys sign commits; the release-only key signs `v*` tags. Use `tools/release/cut-tag.sh` so `git tag` cannot accidentally use the personal commit-signing key from global git config.
- Release-sensitive workflow actions and containers are pinned by immutable SHA or digest and recorded in `ci/digests.txt`.
- The pnpm workspace enforces `minimumReleaseAge: 10080` and `blockExoticSubdeps: true`.
- The publish workflow verifies package versions against the release tag before publishing.
- The publish workflow packs and inspects both npm artifacts before publish.
- `@fortemi/core` is published before `@fortemi/react`.
- Public npmjs.org publishing runs from the GitHub mirror in `.github/workflows/npm-publish.yml` using the mirror's `secrets.NPMJS_TOKEN` and `npm publish --provenance`.
- Local Gitea publishing remains in `.gitea/workflows/publish.yml` and uses `secrets.GT_PUBLISH_TOKEN` for the internal Gitea package registry, falling back to `secrets.NPM_TOKEN` only for older repository configurations.

## Release Tag Recovery

If a pushed release tag fails the signed-tag gate because it was signed by a personal commit key, treat it like AIWG's wrong-key recovery path: no publish artifacts have passed the gate, so delete the bad tag on every remote and re-cut it with `tools/release/cut-tag.sh <version>`. Do not add the personal key to `.gitea/keys/maintainers.asc` just to make the failed tag pass.

## Active Publish Split

npm provenance requires a supported OIDC environment. AIWG uses GitHub Actions for the npmjs.org leg because npm does not list Gitea Actions as a trusted-publishing provider. Fortemi follows that split now:

- Gitea Actions verifies the signed release tag, builds, packs, inspects, and publishes `@fortemi/core` and `@fortemi/react` to the local Gitea package registry for internal use.
- GitHub Actions on the mirror verifies the same signed tag and performs the final npmjs.org distribution with `NPMJS_TOKEN` and `npm publish --provenance`.
- The public publish job grants `id-token: write` only to attach provenance; it does not run on pull requests.

This avoids a dual-publisher race: Gitea no longer publishes to npmjs.org, so the GitHub provenance publish is the only public distribution path.
