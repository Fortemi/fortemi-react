# Changelog

All notable changes to fortemi-react are documented here.

## v2026.5.2 - 2026-05-24

### Release Infrastructure

- Split repository release credentials so Gitea release publishing uses `GT_PUBLISH_TOKEN` and GitHub release publishing uses `GH_PUBLISH_TOKEN`.
- Fixed manual publish reruns by passing the selected release tag into signed-tag verification.
- Added release-note driven repository release bodies so GitHub and Gitea releases can publish the prepared announcement instead of generic generated copy.

### Published Packages

- `@fortemi/core@2026.5.2`
- `@fortemi/react@2026.5.2`

### Upgrade Notes

No runtime API changes are included in this release. Existing `@fortemi/core` and `@fortemi/react` consumers can upgrade from `2026.5.1` without code changes.

## v2026.5.1 - 2026-05-24

### Release Infrastructure

- Verified the full npm, Gitea release, and GitHub release path for signed Fortemi releases.
- Published `@fortemi/core@2026.5.1` and `@fortemi/react@2026.5.1` to npm.
- Created matching Gitea and GitHub repository releases for the signed `v2026.5.1` tag.

## v2026.5.0 - 2026-05-23

### Initial Published Packages

- Added the npm publish workflow for `@fortemi/core` and `@fortemi/react`.
- Added signed release-tag verification using the project release key.
- Published the first coordinated package release for the Fortemi browser packages.
