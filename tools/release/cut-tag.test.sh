#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
RUNTIME_PARENT="$(mktemp -d /dev/shm/fortemi-release-test.XXXXXX)"
trap 'rm -rf "$TMP" "$RUNTIME_PARENT"' EXIT

VERSION="$(node -e "console.log(require('$ROOT/package.json').version)")"
FINGERPRINT="26CB074F65E89E5F4DFD7C71F410C8C763C90CC9"
FIXTURE="$TMP/repo"
FAKE_BIN="$TMP/bin"
mkdir -p "$FIXTURE/tools/release" "$FIXTURE/ci" "$FIXTURE/.gitea/keys" \
  "$FIXTURE/packages/core" "$FIXTURE/packages/graph" "$FIXTURE/packages/react" \
  "$FIXTURE/apps/standalone" "$FAKE_BIN"
cp "$ROOT/tools/release/cut-tag.sh" "$FIXTURE/tools/release/"
cp "$ROOT/ci/vault-fetch.sh" "$FIXTURE/ci/"
cp "$ROOT/ci/vault-fetch.release-signing.spec" "$FIXTURE/ci/"
touch "$FIXTURE/.gitea/keys/maintainers.asc"

for package_json in \
  package.json \
  packages/core/package.json \
  packages/graph/package.json \
  packages/react/package.json \
  apps/standalone/package.json; do
  printf '{"version":"%s"}\n' "$VERSION" >"$FIXTURE/$package_json"
done

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_LOG"
case "$*" in
  *auth/approle/login*)
    cat >/dev/null
    printf '{"auth":{"client_token":"test-token"}}\n'
    ;;
  *auth/token/revoke-self*)
    printf '{}\n'
    ;;
  *release/data/key*)
    if [ "${FAKE_OPENBAO_UNAVAILABLE:-0}" = "1" ]; then exit 22; fi
    if [ "${FAKE_OPENBAO_MALFORMED:-0}" = "1" ]; then printf '{'; exit 0; fi
    printf '{"data":{"data":{"private_key":"test-private-key"}}}\n'
    ;;
  *release/data/passphrase*)
    printf '{"data":{"data":{"passphrase":"test-passphrase"}}}\n'
    ;;
  *)
    printf '{}\n'
    ;;
esac
EOF

cat >"$FAKE_BIN/gpg" <<'EOF'
#!/usr/bin/env bash
printf 'gpg %s\n' "$*" >>"$FAKE_LOG"
if [[ "$*" == *"--import-options show-only"* ]]; then
  printf 'fpr:::::::::%s:\n' "${FAKE_GPG_FINGERPRINT:-26CB074F65E89E5F4DFD7C71F410C8C763C90CC9}"
elif [[ "$*" == *"--show-keys --with-colons"* ]]; then
  printf 'fpr:::::::::26CB074F65E89E5F4DFD7C71F410C8C763C90CC9:\n'
elif [[ "$*" == *"--detach-sign"* ]]; then
  [ "${FAKE_GPG_SIGN_FAIL:-0}" != "1" ] || exit 1
fi
EOF

cat >"$FAKE_BIN/gpgconf" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"$FAKE_BIN/stat" <<'EOF'
#!/usr/bin/env bash
if [ "${FAKE_NO_TMPFS:-0}" = "1" ]; then
  printf 'ext2/ext3\n'
else
  /usr/bin/stat "$@"
fi
EOF

cat >"$FAKE_BIN/git" <<'EOF'
#!/usr/bin/env bash
printf 'git %s\n' "$*" >>"$FAKE_LOG"
if [ "$1" = "rev-parse" ]; then
  [ "${FAKE_TAG_EXISTS:-0}" = "1" ]
elif [[ "$*" == *" tag -v "* ]]; then
  [ "${FAKE_TAG_VERIFY_FAIL:-0}" != "1" ]
else
  exit 0
fi
EOF
chmod +x "$FAKE_BIN"/*

run_case() {
  local name="$1"
  shift
  : >"$TMP/$name.log"
  (
    cd "$FIXTURE"
    export PATH="$FAKE_BIN:$PATH"
    export FAKE_LOG="$TMP/$name.log"
    export XDG_RUNTIME_DIR="$RUNTIME_PARENT"
    export VAULT_ADDR="https://openbao.example.test"
    export VAULT_CI_ROLE_ID="test-role"
    export VAULT_CI_SECRET_ID="test-secret"
    export RELEASE_SIGNING_KEY_VAULT_PATH="release/key"
    export RELEASE_SIGNING_KEY_VAULT_FIELD="private_key"
    export RELEASE_SIGNING_PASSPHRASE_VAULT_PATH="release/passphrase"
    export RELEASE_SIGNING_PASSPHRASE_VAULT_FIELD="passphrase"
    unset VAULT_CACERT
    "$@"
  )
}

run_case dry-run tools/release/cut-tag.sh "$VERSION" --dry-run |
  grep -q "OpenBao signing dry-run passed"
! grep -q "tag -s" "$TMP/dry-run.log"

run_case signed tools/release/cut-tag.sh "$VERSION" >"$TMP/signed.out"
grep -q "OpenBao-custodied release key" "$TMP/signed.out"
grep -q "tag -s" "$TMP/signed.log"
grep -q "tag -v" "$TMP/signed.log"
! grep -q "push" "$TMP/signed.log"
! grep -Eq '(^| )(-k|--insecure)( |$)' "$TMP/signed.log"
for secret in test-secret test-token test-private-key test-passphrase; do
  ! grep -q "$secret" "$TMP/signed.out"
done

printf 'test-ca\n' >"$TMP/openbao-ca.pem"
run_case ca-bundle env VAULT_CACERT="$TMP/openbao-ca.pem" \
  tools/release/cut-tag.sh "$VERSION" --dry-run >"$TMP/ca-bundle.out"
grep -q -- "--cacert $TMP/openbao-ca.pem" "$TMP/ca-bundle.log"

if run_case missing-ca env VAULT_CACERT="$TMP/missing-ca.pem" \
  tools/release/cut-tag.sh "$VERSION" --dry-run >"$TMP/missing-ca.out" 2>&1; then
  echo "missing CA bundle unexpectedly passed" >&2
  exit 1
fi
grep -q "VAULT_CACERT is not readable" "$TMP/missing-ca.out"
! grep -q "auth/approle/login" "$TMP/missing-ca.log"

if run_case no-tmpfs env FAKE_NO_TMPFS=1 \
  tools/release/cut-tag.sh "$VERSION" --dry-run >"$TMP/no-tmpfs.out" 2>&1; then
  echo "disk-backed release scratch unexpectedly passed" >&2
  exit 1
fi
grep -q "requires a writable tmpfs scratch surface" "$TMP/no-tmpfs.out"
! grep -q "auth/approle/login" "$TMP/no-tmpfs.log"

if run_case wrong-key env FAKE_GPG_FINGERPRINT=BAD \
  tools/release/cut-tag.sh "$VERSION" --dry-run >"$TMP/wrong-key.out" 2>&1; then
  echo "wrong authority unexpectedly passed" >&2
  exit 1
fi
grep -q "fingerprint does not match" "$TMP/wrong-key.out"

if run_case unavailable env FAKE_OPENBAO_UNAVAILABLE=1 \
  tools/release/cut-tag.sh "$VERSION" --dry-run >"$TMP/unavailable.out" 2>&1; then
  echo "unavailable OpenBao unexpectedly passed" >&2
  exit 1
fi
grep -q "did not return" "$TMP/unavailable.out"

if run_case malformed env FAKE_OPENBAO_MALFORMED=1 \
  tools/release/cut-tag.sh "$VERSION" --dry-run >"$TMP/malformed.out" 2>&1; then
  echo "malformed OpenBao response unexpectedly passed" >&2
  exit 1
fi
grep -q "did not return" "$TMP/malformed.out"

if run_case exists env FAKE_TAG_EXISTS=1 \
  tools/release/cut-tag.sh "$VERSION" >"$TMP/exists.out" 2>&1; then
  echo "existing tag unexpectedly passed" >&2
  exit 1
fi
grep -q "already exists" "$TMP/exists.out"
! grep -q "auth/approle/login" "$TMP/exists.log"

if run_case sign-fail env FAKE_GPG_SIGN_FAIL=1 \
  tools/release/cut-tag.sh "$VERSION" >"$TMP/sign-fail.out" 2>&1; then
  echo "failed signing probe unexpectedly passed" >&2
  exit 1
fi
grep -q "could not complete the signing probe" "$TMP/sign-fail.out"
! grep -q "tag -s" "$TMP/sign-fail.log"

if find "$RUNTIME_PARENT" -mindepth 1 -maxdepth 1 -name 'fortemi-release-signing.*' | grep -q .; then
  echo "release key material was not cleaned up" >&2
  exit 1
fi

printf 'cut-tag OpenBao tests passed\n'
