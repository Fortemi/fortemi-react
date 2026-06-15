#!/usr/bin/env bash
# Cut a signed Fortemi release tag with the release-signing key.
#
# This mirrors AIWG's two-key release model:
# - personal maintainer keys sign commits
# - the project release key signs release tags
#
# Plain `git tag -s` can accidentally use the maintainer's personal
# commit-signing key from global git config. This wrapper forces the
# release key and verifies the tag locally before anything is pushed.

set -euo pipefail

RELEASE_KEY_FINGERPRINT="${FORTEMI_RELEASE_KEY_FINGERPRINT:-FE9272F0BC5781E1DE77FAAA719AB63879E84CE8}"

if [ $# -lt 1 ]; then
  cat <<EOF >&2
Usage: $0 <version> [-m "<tag message>"]

Examples:
  $0 2026.5.0
  $0 2026.5.1-rc.0 -m "v2026.5.1-rc.0"
EOF
  exit 1
fi

VERSION="$1"
shift

TAG_MESSAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message)
      TAG_MESSAGE="$2"
      shift 2
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

TAG="v${VERSION}"

if ! [[ "$VERSION" =~ ^[0-9]{4}\.([1-9]|1[0-2])\.([0-9]|[1-9][0-9]+)(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "FAIL: '$VERSION' must match YYYY.M.PATCH[-prerelease] with no leading zeros." >&2
  exit 1
fi

# Every workspace package stays in version lockstep, including the private root
# and the private demo app — not just the three published packages.
for package_json in package.json packages/core/package.json packages/graph/package.json packages/react/package.json apps/standalone/package.json; do
  pkg_version="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${package_json}','utf8')).version)")"
  if [ "$pkg_version" != "$VERSION" ]; then
    echo "FAIL: ${package_json} version is '${pkg_version}', expected '${VERSION}'." >&2
    exit 1
  fi
done

if ! gpg --list-secret-keys "$RELEASE_KEY_FINGERPRINT" >/dev/null 2>&1; then
  cat <<EOF >&2
FAIL: Release-signing key $RELEASE_KEY_FINGERPRINT was not found in the active GPG keyring.

If this is running from an agent runtime, check:
  gpgconf --list-dirs | grep '^homedir:'

Then rerun with the operator keyring if needed:
  GNUPGHOME=/home/<user>/.gnupg $0 $VERSION
EOF
  exit 1
fi

if ! gpg --show-keys --with-colons .gitea/keys/maintainers.asc 2>/dev/null \
  | awk -F: '$1=="fpr" {print $10}' \
  | grep -qx "$RELEASE_KEY_FINGERPRINT"; then
  cat <<EOF >&2
FAIL: Release-signing key $RELEASE_KEY_FINGERPRINT is not published in .gitea/keys/maintainers.asc.

Publish the public key before cutting the tag:
  gpg --armor --export $RELEASE_KEY_FINGERPRINT >> .gitea/keys/maintainers.asc
EOF
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  cat <<EOF >&2
FAIL: Tag '$TAG' already exists locally. Delete it explicitly before recreating:
  git tag -d $TAG
EOF
  exit 1
fi

if [ -z "$TAG_MESSAGE" ]; then
  TAG_MESSAGE="$TAG"
fi

git tag -s -u "$RELEASE_KEY_FINGERPRINT" "$TAG" -m "$TAG_MESSAGE"

if ! git tag -v "$TAG" >/dev/null 2>&1; then
  echo "FAIL: local verification failed for $TAG; deleting the bad local tag." >&2
  git tag -d "$TAG" >/dev/null 2>&1 || true
  exit 1
fi

cat <<EOF
Signed tag $TAG with release key $RELEASE_KEY_FINGERPRINT.

Next:
  git push origin main --tags
  git push github main --tags
EOF
