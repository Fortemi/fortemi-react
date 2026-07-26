#!/usr/bin/env bash
# Git gpg.program adapter for the project-specific commit-signing key.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

for candidate in "${XDG_RUNTIME_DIR:-}" /dev/shm; do
  if [[ -n "$candidate" && -d "$candidate" && -w "$candidate" && "$(stat -f -c %T "$candidate" 2>/dev/null || true)" == tmpfs ]]; then
    RUNTIME_PARENT="$candidate"
    break
  fi
done
[[ -n "${RUNTIME_PARENT:-}" ]] || { echo 'FAIL: writable tmpfs is required.' >&2; exit 1; }

TMP="$(mktemp -d "$RUNTIME_PARENT/fortemi-commit-signing.XXXXXX")"
GNUPGHOME="$TMP/gnupg"
cleanup() {
  RUNNER_TEMP="$TMP" bash "$ROOT/ci/vault-fetch.sh" --cleanup >/dev/null 2>&1 || true
  gpgconf --homedir "$GNUPGHOME" --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM
mkdir -m 700 "$GNUPGHOME"
touch "$TMP/fetched.env"
chmod 600 "$TMP/fetched.env"
# shellcheck source=tools/git/openbao-approle.sh
. "$ROOT/tools/git/openbao-approle.sh"
load_fortemi_git_approle "$TMP"
RUNNER_TEMP="$TMP" bash "$ROOT/ci/vault-fetch.sh" \
  --spec "$ROOT/ci/vault-fetch.commit-signing.spec" --env-file "$TMP/fetched.env" >/dev/null
# shellcheck disable=SC1090
. "$TMP/fetched.env"
GNUPGHOME="$GNUPGHOME" gpg --batch --import "$GPG_COMMIT_KEY_FILE" >/dev/null 2>&1
GNUPGHOME="$GNUPGHOME" gpg --batch --pinentry-mode loopback \
  --passphrase-file "$GPG_COMMIT_PASSPHRASE_FILE" "$@"
