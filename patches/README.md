# Vitest Progress Timer

`vitest-runner-4.1.1-progress.patch` changes only the pinned test runner's
progress-event throttle. It flushes at the exact 100ms boundary and clears an
expired timer handle before re-entering the throttle, allowing an early timer
to re-arm. Otherwise the last hook event can remain unsent until another test
event arrives, which never occurs during a blocked hook.

Upstream source: [Vitest v4.1.1 run.ts](https://github.com/vitest-dev/vitest/blob/v4.1.1/packages/runner/src/run.ts#L466).
The patch is applied by pnpm and bound in the lockfile, without a runtime
dependency upgrade or changes to assertions, deadlines, coverage or workers.

`packages/core/scripts/runner-progress-throttle.test.mjs` extracts the installed
function using the TypeScript parser and tests exact, late and early timers.
The unchanged real Vitest interruption test remains required. Remove this patch
only after an upstream upgrade passes these checks with a reviewed probe update.
