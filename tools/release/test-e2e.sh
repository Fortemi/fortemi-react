#!/usr/bin/env bash
# Run the release browser gate in the same Playwright runtime as hosted CI.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAYWRIGHT_VERSION="1.58.2"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: Docker is required for the pinned release E2E runtime." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "FAIL: Docker is installed but the daemon is unavailable." >&2
  exit 1
fi
if [ ! -d "$ROOT/node_modules" ]; then
  echo "FAIL: node_modules is missing; run pnpm install --frozen-lockfile first." >&2
  exit 1
fi

installed_version="$(
  node -p "require('$ROOT/node_modules/@playwright/test/package.json').version"
)"
if [ "$installed_version" != "$PLAYWRIGHT_VERSION" ]; then
  echo "FAIL: installed Playwright is $installed_version; expected $PLAYWRIGHT_VERSION." >&2
  exit 1
fi

docker run --rm --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e CI=true \
  -e HOME=/tmp \
  -e COREPACK_HOME="/tmp/corepack-$(id -u)" \
  -v "$ROOT:/workspace" \
  -w /workspace \
  "$PLAYWRIGHT_IMAGE" \
  bash -lc '
    mkdir -p /tmp/corepack-bin
    corepack enable --install-directory /tmp/corepack-bin
    export PATH="/tmp/corepack-bin:$PATH"
    pnpm --filter @fortemi/standalone exec playwright test \
      --reporter=line \
      --output=/tmp/fortemi-e2e-results
  '
