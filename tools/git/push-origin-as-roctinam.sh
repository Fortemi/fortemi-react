#!/usr/bin/env bash
# Push to the authoritative Gitea origin using the project-specific roctinam key.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
HANDOFF="${FORTEMI_GIT_HANDOFF:-/home/roctinam/.config/openbao/handoff/fortemi-react-git-roctinam.env}"
[[ -r "$HANDOFF" ]] || { echo "FAIL: OpenBao Git handoff is unavailable: $HANDOFF" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$HANDOFF"
set +a
export VAULT_ADDR="${VAULT_ADDR:-https://rca.s9.internal:8200}"
export VAULT_CACERT="${VAULT_CACERT:-$ROOT/ci/trust/integro-labs-root-ca-g2.crt}"
export VAULT_CI_ROLE_ID="$VAULT_GIT_ROLE_ID"
export VAULT_CI_SECRET_ID="$VAULT_GIT_SECRET_ID"

for candidate in "${XDG_RUNTIME_DIR:-}" /dev/shm; do
  if [[ -n "$candidate" && -d "$candidate" && -w "$candidate" && "$(stat -f -c %T "$candidate" 2>/dev/null || true)" == tmpfs ]]; then
    RUNTIME_PARENT="$candidate"
    break
  fi
done
[[ -n "${RUNTIME_PARENT:-}" ]] || { echo 'FAIL: writable tmpfs is required.' >&2; exit 1; }

TMP="$(mktemp -d "$RUNTIME_PARENT/fortemi-git-push.XXXXXX")"
cleanup() {
  RUNNER_TEMP="$TMP" bash "$ROOT/ci/vault-fetch.sh" --cleanup >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM
chmod 700 "$TMP"
touch "$TMP/fetched.env"
chmod 600 "$TMP/fetched.env"
RUNNER_TEMP="$TMP" bash "$ROOT/ci/vault-fetch.sh" \
  --spec "$ROOT/ci/vault-fetch.git-roctinam.spec" --env-file "$TMP/fetched.env"
# shellcheck disable=SC1090
. "$TMP/fetched.env"
chmod 600 "$GIT_SSH_PRIVATE_KEY_FILE"

identity="$(ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityFile="$GIT_SSH_PRIVATE_KEY_FILE" -T git@git.integrolabs.net 2>&1 || true)"
grep -q 'roctinam' <<<"$identity" || {
  echo 'FAIL: project SSH key did not authenticate as roctinam.' >&2
  printf '%s\n' "$identity" >&2
  exit 1
}

if [[ "${1:-}" == --check ]]; then
  echo 'Gitea SSH authentication passed for roctinam.'
  exit 0
fi

GIT_SSH_COMMAND="ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityFile=$GIT_SSH_PRIVATE_KEY_FILE" \
  git -C "$ROOT" push origin "$@"
