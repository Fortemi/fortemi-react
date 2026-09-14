#!/usr/bin/env bash
# Run the release browser gate in the same Playwright runtime as hosted CI.

set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAYWRIGHT_VERSION="1.58.2"
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"
[[ $# -eq 0 ]] || { echo 'FAIL: test-e2e.sh takes no arguments.' >&2; exit 2; }

for program in docker node timeout realpath; do
  command -v "$program" >/dev/null 2>&1 || {
    echo "FAIL: $program is required for the bounded release E2E runtime." >&2
    exit 1
  }
done
# This gate owns containers on the local daemon, never a selected remote context.
docker_cli() { timeout --foreground 20 docker --host unix:///var/run/docker.sock "$@"; }
if ! docker_cli info >/dev/null 2>&1; then
  echo "FAIL: Docker is installed but the daemon is unavailable." >&2
  exit 1
fi
if [ ! -d "$ROOT/node_modules" ]; then
  echo "FAIL: node_modules is missing; run pnpm install --frozen-lockfile first." >&2
  exit 1
fi

installed_version="$(node -e 'console.log(require(process.argv[1]+"/node_modules/@playwright/test/package.json").version)' "$ROOT")"
if [ "$installed_version" != "$PLAYWRIGHT_VERSION" ]; then
  echo "FAIL: installed Playwright is $installed_version; expected $PLAYWRIGHT_VERSION." >&2
  exit 1
fi

image_id="$(docker_cli image inspect --format '{{.Id}}' "$PLAYWRIGHT_IMAGE")"
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'FAIL: cached Playwright image identity is invalid.' >&2; exit 1; }
pnpm_version="$(node -e 'const p=require(process.argv[1]+"/package.json").packageManager; if(!/^pnpm@[0-9]+\.[0-9]+\.[0-9]+$/.test(p)) process.exit(1); console.log(p.slice(5))' "$ROOT")"

tool_mount=()
if [[ -n "${FORTEMI_RELEASE_PNPM_BIN:-}" ]]; then
  tool="$(realpath "$FORTEMI_RELEASE_PNPM_BIN")"
  [[ -f "$tool" && -x "$tool" ]] || { echo 'FAIL: standalone pnpm executable is unavailable.' >&2; exit 1; }
  tool_mount=(--mount "type=bind,source=$tool,target=/opt/fortemi/bin/pnpm,readonly")
else
  tool="$(realpath "${COREPACK_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/node/corepack}")"
  [[ -f "$tool/v1/pnpm/$pnpm_version/bin/pnpm.cjs" ]] || {
    echo "FAIL: cached pnpm $pnpm_version is required; alternatively set FORTEMI_RELEASE_PNPM_BIN to its standalone executable." >&2
    exit 1
  }
  # Mount only the selected package, not the operator's whole cache.
  tool_mount=(--mount "type=bind,source=$tool/v1/pnpm/$pnpm_version,target=/opt/fortemi/pnpm-cache,readonly")
fi
[[ "$ROOT$tool" != *','* && "$ROOT$tool" != *$'\n'* ]] || { echo 'FAIL: unsupported bind path.' >&2; exit 1; }

run_id="$(node -e 'console.log(require("node:crypto").randomUUID())')"
name="fortemi-release-e2e-$(id -u)-$run_id"
artifacts="$ROOT/test-results/$name"
mkdir -p "$artifacts"
launched=0
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [[ "$launched" == 1 ]]; then
    if owner="$(docker_cli inspect --format '{{index .Config.Labels "io.fortemi.release-e2e.owner"}}' "$name" 2>/dev/null)"; then
      if [[ "$owner" != "$run_id" ]]; then
        echo "FAIL: container ownership mismatch: $name" >&2
        exit 1
      fi
      docker_cli inspect "$name" >"$artifacts/container.json" || status=1
      docker_cli rm --force "$name" >/dev/null || status=1
      # A successful daemon query must confirm absence; an inspect error is ambiguous.
      if remaining="$(docker_cli ps -a --filter "name=^/$name$" --format '{{.ID}}')" && [[ -z "$remaining" ]]; then
        printf 'Owned container removed: %s\n' "$name" >"$artifacts/cleanup.txt"
      else
        echo "FAIL: container removal could not be confirmed: $name" >&2
        status=1
      fi
    else
      echo "FAIL: container state unavailable: $name" >&2
      status=1
    fi
  fi
  printf 'Release E2E exit=%s evidence=%s\n' "$status" "$artifacts"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
launched=1

# The in-container deadline survives a disconnected or killed Docker client.
timeout --foreground --signal=TERM --kill-after=10 800 \
docker --host unix:///var/run/docker.sock run --name "$name" \
  --label "io.fortemi.release-e2e.owner=$run_id" \
  --pull=never --init --cpus=2 --memory=8g --memory-swap=8g --pids-limit=256 \
  --network=none --ipc=private --shm-size=256m --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --log-driver=local --log-opt=max-size=1m --log-opt=max-file=1 \
  --ulimit nofile=65536:65536 \
  --user "$(id -u):$(id -g)" \
  -e CI=true \
  -e CHOKIDAR_USEPOLLING=true \
  -e HOME=/tmp \
  -e COREPACK_ENABLE_NETWORK=0 \
  -e npm_config_offline=true \
  -e NODE_OPTIONS=--max-old-space-size=2048 \
  -e CUDA_VISIBLE_DEVICES= -e NVIDIA_VISIBLE_DEVICES=void \
  -e "FORTEMI_PNPM_VERSION=$pnpm_version" \
  -e PLAYWRIGHT_JSON_OUTPUT_NAME=/results/results.json \
  -e COREPACK_HOME="/tmp/corepack-$(id -u)" \
  --mount "type=bind,source=$ROOT,target=/workspace" \
  --mount "type=bind,source=$artifacts,target=/results" \
  "${tool_mount[@]}" \
  -w /workspace \
  --entrypoint /usr/bin/timeout "$image_id" \
  --signal=TERM --kill-after=10 720 bash -lc '
    set -euo pipefail
    cpus="$(node tools/release/e2e-runtime.mjs)"
    finish() {
      status=$?
      trap - EXIT
      node tools/release/e2e-runtime.mjs --finish || status=1
      exit "$status"
    }
    trap finish EXIT
    if [[ -x /opt/fortemi/bin/pnpm ]]; then
      export PATH="/opt/fortemi/bin:$PATH"
    else
      mkdir -p "$COREPACK_HOME/v1/pnpm/$FORTEMI_PNPM_VERSION" /tmp/corepack-bin
      cp -a /opt/fortemi/pnpm-cache/. "$COREPACK_HOME/v1/pnpm/$FORTEMI_PNPM_VERSION/"
      corepack enable --install-directory /tmp/corepack-bin
      export PATH="/tmp/corepack-bin:$PATH"
    fi
    [[ "$(pnpm --version)" == "$FORTEMI_PNPM_VERSION" ]] || { echo "FAIL: pnpm version mismatch" >&2; exit 1; }
    taskset --cpu-list "$cpus" pnpm --filter @fortemi/standalone exec playwright test \
      --reporter=line,json \
      --output=/results/artifacts
  '
node "$ROOT/tools/release/e2e-runtime.mjs" --report "$artifacts/results.json"
