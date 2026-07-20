#!/usr/bin/env bash
# Cut a signed Fortemi release tag with the OpenBao-custodied release key.
#
# The private key and machine passphrase are fetched through the repository's
# least-privilege AppRole into a temporary memory-backed keyring. The wrapper
# verifies the configured fingerprint, creates and verifies the tag, then
# removes all fetched material before anything is pushed.

set -euo pipefail

RELEASE_KEY_FINGERPRINT="${FORTEMI_RELEASE_KEY_FINGERPRINT:-26CB074F65E89E5F4DFD7C71F410C8C763C90CC9}"

if [ $# -lt 1 ]; then
  cat <<EOF >&2
Usage: $0 <version> [-m "<tag message>"] [--dry-run]

Examples:
  $0 2026.5.0
  $0 2026.5.1-rc.0 -m "v2026.5.1-rc.0"
  $0 2026.5.1 --dry-run
EOF
  exit 1
fi

VERSION="$1"
shift

TAG_MESSAGE=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message)
      TAG_MESSAGE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

TAG="v${VERSION}"
GIT_TAG_GPG_OPTS=()

if ! [[ "$VERSION" =~ ^[0-9]{4}\.([1-9]|1[0-2])\.([0-9]|[1-9][0-9]+)(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "FAIL: '$VERSION' must match YYYY.M.PATCH[-prerelease] with no leading zeros." >&2
  exit 1
fi

# Every workspace package stays in version lockstep, including private packages.
for package_json in package.json packages/core/package.json packages/graph/package.json packages/react/package.json apps/standalone/package.json; do
  pkg_version="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${package_json}','utf8')).version)")"
  if [ "$pkg_version" != "$VERSION" ]; then
    echo "FAIL: ${package_json} version is '${pkg_version}', expected '${VERSION}'." >&2
    exit 1
  fi
done

# Refuse before retrieving any secret material.
if git rev-parse "$TAG" >/dev/null 2>&1; then
  cat <<EOF >&2
FAIL: Tag '$TAG' already exists locally. Delete it explicitly before recreating:
  git tag -d $TAG
EOF
  exit 1
fi

for required in VAULT_ADDR VAULT_CI_ROLE_ID VAULT_CI_SECRET_ID; do
  if [ -z "${!required:-}" ]; then
    echo "FAIL: $required is required for OpenBao-backed release signing." >&2
    exit 1
  fi
done

is_writable_tmpfs() {
  local path="$1"
  [ -n "$path" ] &&
    [ -d "$path" ] &&
    [ -w "$path" ] &&
    [ "$(stat -f -c %T "$path" 2>/dev/null || true)" = "tmpfs" ]
}

RELEASE_TEMP_PARENT=""
for candidate in "${XDG_RUNTIME_DIR:-}" /dev/shm; do
  if is_writable_tmpfs "$candidate"; then
    RELEASE_TEMP_PARENT="$candidate"
    break
  fi
done
if [ -z "$RELEASE_TEMP_PARENT" ]; then
  echo "FAIL: Release signing requires a writable tmpfs scratch surface." >&2
  exit 1
fi
RELEASE_TEMP_ROOT="$(mktemp -d "$RELEASE_TEMP_PARENT/fortemi-release-signing.XXXXXX")"
RELEASE_GNUPGHOME="$RELEASE_TEMP_ROOT/gnupg"
RELEASE_FETCH_ENV="$RELEASE_TEMP_ROOT/fetched.env"
mkdir -p "$RELEASE_GNUPGHOME"
touch "$RELEASE_FETCH_ENV"
chmod 700 "$RELEASE_TEMP_ROOT" "$RELEASE_GNUPGHOME"
chmod 600 "$RELEASE_FETCH_ENV"

cleanup_release_key() {
  RUNNER_TEMP="$RELEASE_TEMP_ROOT" bash ci/vault-fetch.sh --cleanup >/dev/null 2>&1 || true
  gpgconf --homedir "$RELEASE_GNUPGHOME" --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$RELEASE_TEMP_ROOT"
}
trap cleanup_release_key EXIT

if ! RUNNER_TEMP="$RELEASE_TEMP_ROOT" bash ci/vault-fetch.sh \
  --spec ci/vault-fetch.release-signing.spec \
  --env-file "$RELEASE_FETCH_ENV"; then
  echo "FAIL: OpenBao did not return the release-signing material." >&2
  exit 1
fi

# The fetch file contains paths to mode-600 files, never secret values.
# shellcheck disable=SC1090
set -a
. "$RELEASE_FETCH_ENV"
set +a
export GNUPGHOME="$RELEASE_GNUPGHOME"

IMPORTED_FINGERPRINT="$(
  gpg --batch --with-colons --import-options show-only --import "$GPG_SIGNING_KEY_FILE" 2>/dev/null |
    awk -F: '$1=="fpr" { print $10; exit }'
)"
if [ "$IMPORTED_FINGERPRINT" != "$RELEASE_KEY_FINGERPRINT" ]; then
  echo "FAIL: OpenBao release key fingerprint does not match the configured authority." >&2
  exit 1
fi
gpg --batch --import "$GPG_SIGNING_KEY_FILE" >/dev/null 2>&1

GPG_WRAPPER="$GNUPGHOME/git-gpg.sh"
GPG_PROBE="$GNUPGHOME/signing-probe"
printf 'fortemi release signing probe\n' >"$GPG_PROBE"
printf 'pinentry-mode loopback\n' >"$GNUPGHOME/gpg.conf"
cat >"$GPG_WRAPPER" <<WRAP
#!/usr/bin/env bash
exec gpg --batch --pinentry-mode loopback --passphrase-file "$GPG_PASSPHRASE_FILE" "\$@"
WRAP
chmod 700 "$GPG_WRAPPER"
if ! gpg --batch --pinentry-mode loopback --passphrase-file "$GPG_PASSPHRASE_FILE" \
  --yes --local-user "$RELEASE_KEY_FINGERPRINT" --detach-sign "$GPG_PROBE" \
  >/dev/null 2>&1; then
  echo "FAIL: OpenBao release key could not complete the signing probe." >&2
  exit 1
fi
rm -f "$GPG_PROBE.sig"
rm -f "$GPG_PROBE"
GIT_TAG_GPG_OPTS=(-c "gpg.program=$GPG_WRAPPER")

if ! gpg --show-keys --with-colons .gitea/keys/maintainers.asc 2>/dev/null \
  | awk -F: '$1=="fpr" {print $10}' \
  | grep -qx "$RELEASE_KEY_FINGERPRINT"; then
  echo "FAIL: Release-signing authority is not published in .gitea/keys/maintainers.asc." >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "OpenBao signing dry-run passed for $TAG with $RELEASE_KEY_FINGERPRINT."
  exit 0
fi

if [ -z "$TAG_MESSAGE" ]; then
  TAG_MESSAGE="$TAG"
fi

git "${GIT_TAG_GPG_OPTS[@]}" tag -s -u "$RELEASE_KEY_FINGERPRINT" "$TAG" -m "$TAG_MESSAGE"

if ! git "${GIT_TAG_GPG_OPTS[@]}" tag -v "$TAG" >/dev/null 2>&1; then
  echo "FAIL: local verification failed for $TAG; deleting the bad local tag." >&2
  git tag -d "$TAG" >/dev/null 2>&1 || true
  exit 1
fi

cat <<EOF
Signed tag $TAG with the OpenBao-custodied release key $RELEASE_KEY_FINGERPRINT.

Next:
  git push origin main --tags
  git push github main --tags
EOF
