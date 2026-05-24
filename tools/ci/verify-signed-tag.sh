#!/usr/bin/env bash
# Verify that the release tag triggering this workflow is signed by a
# maintainer key published in the repo.

set -euo pipefail

GH_REF="${GITHUB_REF:-}"
TAG="${RELEASE_TAG:-}"

if [ -z "$TAG" ]; then
  TAG="${GH_REF#refs/tags/}"
fi

if [ -z "$TAG" ] || [ "$TAG" = "$GH_REF" ]; then
  cat <<EOF >&2
Signed-tag verify: not a tag push.
  GITHUB_REF=$GH_REF
  RELEASE_TAG=${RELEASE_TAG:-}

Release publishing must run against a signed v* tag.
EOF
  exit 1
fi

GPG_KEYS_FILE=".gitea/keys/maintainers.asc"
SSH_SIGNERS_FILE=".gitea/allowed_signers"

HAS_GPG=0
HAS_SSH=0

if [ -s "$GPG_KEYS_FILE" ]; then
  HAS_GPG=1
fi

if [ -s "$SSH_SIGNERS_FILE" ]; then
  HAS_SSH=1
fi

if [ "$HAS_GPG" = "0" ] && [ "$HAS_SSH" = "0" ]; then
  cat <<'EOF' >&2
Signed-tag gate failed: no maintainer public keys are published.

Add one of:
  .gitea/keys/maintainers.asc
  .gitea/allowed_signers

Use a project-scoped release-signing key, not a personal commit key.
EOF
  exit 1
fi

if [ "$HAS_GPG" = "1" ]; then
  if ! command -v gpg >/dev/null 2>&1; then
    echo "gpg is required to verify GPG-signed release tags." >&2
    exit 1
  fi
  gpg --batch --no-tty --import "$GPG_KEYS_FILE" 2>&1 | grep -E '(imported|unchanged)' || true
fi

if [ "$HAS_SSH" = "1" ]; then
  git config gpg.ssh.allowedSignersFile "$PWD/$SSH_SIGNERS_FILE"
fi

echo "Verifying release tag signature: $TAG"

if VERIFY_OUTPUT="$(git tag -v "$TAG" 2>&1)"; then
  echo "Tag $TAG verified successfully."
  echo "$VERIFY_OUTPUT" | grep -E '^(gpg|Good signature|Signature made|Signer|Signer email)' || true
  exit 0
fi

cat <<EOF >&2
Signed-tag gate failed: tag '$TAG' did not verify.

$VERIFY_OUTPUT

Create release tags with a published project release key:
  git tag -s "$TAG" -m "$TAG"
EOF
exit 1
