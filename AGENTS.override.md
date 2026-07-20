# AGENTS.override.md

## Suite Data Integration Contract

Treat `.aiwg/architecture/SAD.md` and ADR-010/011 as the integration authority
for this repository.

- Keep the AIWG static-index, Knowledge Shard, and live Fortemi MCP persistence
  planes separate. Connect planes only through an explicit, tested adapter.
- Do not claim "full", "100%", or server parity without naming a shard profile
  and its passing cross-repository evidence.
- The Fortemi server owns the Knowledge Shard schema. The vendored React schema
  is a revision-and-digest-pinned receipt, not an independent source of truth.
- Validate schema, version, profile, checksums, records, counts, and sidecars
  before any PGlite or RecordStore mutation. Unsupported required components
  fail closed.
- `full-v1`, `core-v1`, and `record-v1` have different loss
  budgets. RecordStore support is an explicit subset unless its profile says
  otherwise.
- Changes to shard or AIWG conversion behavior require source tests, the
  published-package boundary test where applicable, and real producer/consumer
  import evidence before release.

## Signing Keys

Private signing-key custody is OpenBao-only. Hydrate only the required key into
a temporary `GNUPGHOME`, verify the operation, and remove the temporary keyring.

- Release tags: `26CB074F65E89E5F4DFD7C71F410C8C763C90CC9`
  (`Fortemi React Release Signing`), at
  `kv_internal/gpg/fortemi-react-release-signing-key`.
- Commits: `CD2CD155A057B212A525E1C2A7E29DCA3E39B9B8`
  (`Fortemi React Commit Signing`), at
  `kv_internal/gpg/fortemi-react-commit-signing-key`.

Never use the commit key for release tags or the release key for commits.

Repository-local Git identity must be `roctinam` with the verified email
`1159087+jmagly@users.noreply.github.com`. Commit signing uses
`tools/git/gpg-from-openbao.sh`. Pushes to authoritative `origin` use
`tools/git/push-origin-as-roctinam.sh`, which hydrates the dedicated SSH key at
`kv_internal/gitea/fortemi-react-roctinam-ssh-key` into tmpfs and refuses to
push unless Gitea identifies it as `roctinam`.
