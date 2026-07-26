#!/usr/bin/env bash
# Load the project Git AppRole from an explicit handoff or encrypted host credentials.

load_fortemi_git_approle() {
  local scratch="$1"
  local default_handoff="/home/roctinam/.config/openbao/handoff/fortemi-react-git-roctinam.env"
  local handoff="${FORTEMI_GIT_HANDOFF:-$default_handoff}"
  local role_credential="${FORTEMI_GIT_ROLE_CREDENTIAL:-/etc/credstore.encrypted/openbao-git-fortemi-react-runtime-role-id}"
  local secret_credential="${FORTEMI_GIT_SECRET_CREDENTIAL:-/etc/credstore.encrypted/openbao-git-fortemi-react-runtime-secret-id}"

  if [[ -n "${FORTEMI_GIT_HANDOFF:-}" || -r "$default_handoff" ]]; then
    [[ -r "$handoff" ]] || {
      echo "FAIL: explicit OpenBao Git handoff is unavailable: $handoff" >&2
      return 1
    }
    set -a
    # shellcheck disable=SC1090
    . "$handoff"
    set +a
  else
    command -v sudo >/dev/null 2>&1 || {
      echo "FAIL: sudo is required to decrypt the project OpenBao credentials." >&2
      return 1
    }
    command -v systemd-creds >/dev/null 2>&1 || {
      echo "FAIL: systemd-creds is required to decrypt the project OpenBao credentials." >&2
      return 1
    }

    umask 077
    if ! sudo -n systemd-creds decrypt "$role_credential" - >"$scratch/openbao-role-id"; then
      echo "FAIL: could not decrypt the project OpenBao role ID." >&2
      return 1
    fi
    if ! sudo -n systemd-creds decrypt "$secret_credential" - >"$scratch/openbao-secret-id"; then
      echo "FAIL: could not decrypt the project OpenBao secret ID." >&2
      return 1
    fi
    VAULT_GIT_ROLE_ID="$(<"$scratch/openbao-role-id")"
    VAULT_GIT_SECRET_ID="$(<"$scratch/openbao-secret-id")"
  fi

  [[ -n "${VAULT_GIT_ROLE_ID:-}" ]] || {
    echo "FAIL: OpenBao Git role ID is empty." >&2
    return 1
  }
  [[ -n "${VAULT_GIT_SECRET_ID:-}" ]] || {
    echo "FAIL: OpenBao Git secret ID is empty." >&2
    return 1
  }

  export VAULT_ADDR="${VAULT_ADDR:-https://rca.s9.internal:8200}"
  export VAULT_CACERT="${VAULT_CACERT:-$ROOT/ci/trust/integro-labs-root-ca-g2.crt}"
  export VAULT_CI_ROLE_ID="$VAULT_GIT_ROLE_ID"
  export VAULT_CI_SECRET_ID="$VAULT_GIT_SECRET_ID"
}
