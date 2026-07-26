#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/scratch"
cat >"$TMP/bin/sudo" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == "-n" ]] && shift
exec "$@"
EOF
cat >"$TMP/bin/systemd-creds" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "decrypt" && "$3" == "-" ]]
case "$2" in
  *role-id) printf 'systemd-role\n' ;;
  *secret-id) printf 'systemd-secret\n' ;;
  *) exit 2 ;;
esac
EOF
chmod 700 "$TMP/bin/sudo" "$TMP/bin/systemd-creds"

(
  unset FORTEMI_GIT_HANDOFF VAULT_GIT_ROLE_ID VAULT_GIT_SECRET_ID
  PATH="$TMP/bin:$PATH"
  FORTEMI_GIT_ROLE_CREDENTIAL="$TMP/runtime-role-id"
  FORTEMI_GIT_SECRET_CREDENTIAL="$TMP/runtime-secret-id"
  # shellcheck source=tools/git/openbao-approle.sh
  . "$ROOT/tools/git/openbao-approle.sh"
  load_fortemi_git_approle "$TMP/scratch"
  [[ "$VAULT_CI_ROLE_ID" == "systemd-role" ]]
  [[ "$VAULT_CI_SECRET_ID" == "systemd-secret" ]]
  [[ "$(stat -c %a "$TMP/scratch/openbao-role-id")" == "600" ]]
  [[ "$(stat -c %a "$TMP/scratch/openbao-secret-id")" == "600" ]]
)

cat >"$TMP/handoff.env" <<'EOF'
VAULT_GIT_ROLE_ID=handoff-role
VAULT_GIT_SECRET_ID=handoff-secret
EOF
chmod 600 "$TMP/handoff.env"
(
  unset VAULT_GIT_ROLE_ID VAULT_GIT_SECRET_ID
  FORTEMI_GIT_HANDOFF="$TMP/handoff.env"
  # shellcheck source=tools/git/openbao-approle.sh
  . "$ROOT/tools/git/openbao-approle.sh"
  load_fortemi_git_approle "$TMP/scratch"
  [[ "$VAULT_CI_ROLE_ID" == "handoff-role" ]]
  [[ "$VAULT_CI_SECRET_ID" == "handoff-secret" ]]
)

if (
  FORTEMI_GIT_HANDOFF="$TMP/missing.env"
  # shellcheck source=tools/git/openbao-approle.sh
  . "$ROOT/tools/git/openbao-approle.sh"
  load_fortemi_git_approle "$TMP/scratch"
) 2>/dev/null; then
  echo "explicit missing handoff unexpectedly passed" >&2
  exit 1
fi

echo "OpenBao Git AppRole bootstrap tests passed."
