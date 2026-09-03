---
title: Inference Provider Routing Impact Analysis
date: 2026-09-03
status: in-progress
change_type: component addition
scope: fortemi-react runtime inference configuration
derived_from:
  - "@.aiwg/adrs/ADR-002-capability-modules.md"
  - "@.aiwg/adrs/ADR-010-portable-schema-topology-and-source-of-truth.md"
  - "@.aiwg/adrs/ADR-011-shard-server-conformance-and-version-negotiation.md"
  - "@../.aiwg/architecture/suite-integration-configuration-2026-07.md"
  - "@../.aiwg/architecture/ADR-suite-contract-authority-and-profiles.md"
  - "@../.aiwg/reports/data-compatibility-transportability-audit-2026-07-17.md"
---

# Inference Provider Routing Impact Analysis

## Change Summary

Fortemi React needs one runtime composition surface for configured inference providers across:

- in-browser or worker-hosted local models;
- local OpenAI-compatible servers such as Ollama, LM Studio, llama.cpp, vLLM, Jan, or LocalAI;
- keyed remote services exposed through OpenAI-compatible APIs; and
- host-managed bridge providers that keep secrets outside browser-readable package state.

The initial implementation adds task hints, route policies, bridge provider adaptation, and a
`configureInferenceRuntime()` helper. The React provider now exposes `providerRegistry` and accepts
an `inference` deployment config.

## Constraints

The runtime router is an inference plane only. It must not imply static-index, Knowledge Shard, or
live Fortemi persistence compatibility. Suite audit status remains `NO-GO` for unqualified data
compatibility or portability claims.

Provider credentials remain host-owned. Browser-only deployments may use unauthenticated local
servers or user-supplied in-browser providers, but keyed service providers should be routed through
`FortemiBridge.secrets` or another host secure-storage boundary.

Capability loading remains opt-in. No WASM model, WebLLM engine, or remote provider should load
until the host enables the corresponding capability or calls the routed provider directly.

## Research Basis

Local corpus:

- REF-067 supports adaptive embedding dimensionality and MRL-style coarse-to-fine retrieval.
- REF-069 supports domain-specific embedding fine-tuning when selected corpora need stronger
  retrieval than a generic default embedder.
- REF-278 frames model routing as cascaded escalation: start cheap/local, escalate only when task
  evidence needs it.

New induction tasks were filed in `/home/roctinam/dev/research-papers/.aiwg/research/queue/`
with a batch manifest at `/home/roctinam/dev/research-papers/.aiwg/research/queue/README.md`
for:

- Dynamic Model Routing and Cascading for Efficient LLM Inference;
- Query Routing for Retrieval-Augmented Language Models;
- Beyond Matryoshka: sparse coding for adaptive representations; and
- Temporal-aware Matryoshka adaptation for retrieval.

Additional 2026 internet sources queued for induction on 2026-09-03:

- LLMRouter: Unified Infrastructure for Developing, Evaluating, and Deploying LLM Routers;
- R3AG: Retriever Routing for Retrieval-Augmented Generation;
- The Workload-Router-Pool Architecture for LLM Inference Optimization; and
- HW-Router: Hardware-Aware Routing for Scalable Multi-LLM Serving.

These queued sources are not yet GRADE-assessed and should not be treated as corpus evidence until
the research repo induction workflow acquires full paper content, assigns stable REF IDs, and records
quality assessment.

## Current Implementation

Implemented:

- `InferenceTask` request hints for query/document/large-document embeddings and chat task classes.
- `ProviderRegistry.setRoute()`/`getRoute()`/`clearRoute()`/`clearRoutes()` with ordered provider IDs,
  optional tier filters, model overrides, and fallback control.
- Runtime fallback now applies to `embed()` and non-streaming `complete()` calls: if an eligible
  provider throws and fallback is enabled, the registry tries the next eligible provider and emits
  `provider.fallback` with provider IDs, error category, and error message only. Streaming routes
  still bind to a single provider up front.
- Explicit `providerIds` routes are closed chains: fallback does not spill to unlisted registered
  providers. Routes without provider IDs may still select across registered providers after tier/profile
  filters.
- `ProviderRoutePolicy.requirements` enforces provider profile constraints before dispatch:
  privacy tier, cost ceiling, minimum context length, minimum embedding dimensions, data class, and
  maximum input length.
- Core exports `providerSatisfiesRouteRequirements()` and `getProviderRouteRequirementIssue()` so
  runtime enforcement and route-configuration UI use the same requirement semantics.
- `ProviderRegistry.previewRoute()` and `probeRoute()` let host UIs verify task selection and provider
  health without sending note text, prompts, generated text, embeddings, or keys.
- Legacy embedding and LLM bridges now call the routed registry, preserving existing pipeline callers.
- `BridgeInferenceProvider` adapts host-managed bridge providers into the common interface.
- `configureInferenceRuntime()` composes configured providers, bridge providers, and optionally
  discovered local providers.
- `<FortemiProvider inference={...}>` initializes the routed runtime and exposes `providerRegistry`.
- Integration and API docs describe deployment configuration and task routing.
- The legacy embed/LLM function slots now accept optional task/model hints, so old callers remain valid while search can route `embedding.query` separately from document materialization.
- Built-in pipeline calls now tag query embeddings, document embeddings, title generation, AI revision, and concept tagging with task hints.
- The embedding generation pipeline now selects `embedding.large-document` automatically when combined
  note/attachment text crosses exported content-length or chunk-count thresholds; normal materialization
  remains `embedding.document`.
- Deployments can override those thresholds via `InferenceRuntimeConfig.embeddingTaskSelection` or
  non-React hosts can use `setEmbeddingTaskSelectionOptions()` directly.
- `ProviderRegistry` emits `provider.route.selected` for privacy-safe observability: provider ID/name, tier, capability, task, optional model, and route-match status only.
- `ProviderRegistry` emits `provider.route.completed` and `provider.route.failed` with attempt count,
  fallback count, latency, and error metadata only. Prompts, note bodies, generated text, embeddings,
  and keys are excluded.
- `ProviderRegistry` emits `provider.route.configured` and `provider.route.cleared` so host UIs can
  refresh route state without inspecting request payloads.
- The standalone app's provider settings now activate providers through the shared React context registry
  instead of a detached singleton, keep configured non-browser providers co-registered when credentials
  are available, and persist task route policies.
- Standalone route policies now persist ordered primary/fallback provider chains per task, migrating
  the earlier single-provider `providerId` field into `providerIds` on load.
- Standalone provider presets and Settings edits persist runtime provider profiles: privacy tier, cost
  tier, embedding dimensions, maximum input length, and allowed data classes.
- Standalone Settings warns when a saved task route targets an unregistered provider, an unsupported
  capability, or a provider profile that does not satisfy the route requirements.
- Standalone Settings can probe the resolved provider/model for a task route without invoking
  embedding or completion inference.
- Standalone Settings can draft a conservative local-first route profile from currently selectable
  providers, preferring local/free providers for query, tagging, linking, and general chat while
  favoring larger advertised embedding dimensions for document and large-document embedding routes.
- Browser-local transformers.js/WebLLM is registered as a lazy local `InferenceProvider`, so routes can
  target `browser` alongside local servers and host/service providers.
- Standalone Settings can discover reachable local OpenAI-compatible servers, merge them into saved
  provider configuration by provider ID or base URL, infer local/free provider profile defaults, and
  immediately re-register them for provider switching and task routes.
- Standalone provider probing refreshes missing or placeholder chat/embedding model defaults from
  OpenAI-compatible `/models` listings and re-syncs the shared registry when configuration changes.
- OpenAI-compatible provider model listing and local discovery use the same model-name classifier for
  embedding/chat/vision hints, keeping discovery, provider refresh, and route suggestion behavior aligned.
- Programmatic local discovery uses the same local/free/private/sensitive profile defaults as the
  standalone settings path, so data-class route requirements behave consistently for discovered
  local servers.
- Core exports runtime definition and merge helpers so deployments can compose shared provider packs,
  local-discovery policy, host bridge inclusion, embedding thresholds, and workspace route profiles
  before passing a single `inference` config to `FortemiProvider`. Provider packs merge by configured
  provider ID, with later fragments overriding earlier definitions to avoid duplicate registry entries.
- `ProviderRegistry.validateRoute()` and `validateRoutes()` expose payload-free route configuration
  checks for host deployments and Settings UIs: missing provider IDs, capability mismatches, missing
  handlers, profile requirement failures, empty explicit chains, and routes with no eligible provider.
- Route policy arrays and nested requirement arrays are cloned at the registry boundary so host config
  object reuse or mutation does not silently alter active routing behavior.
- React exports `useInferenceRouting()` as a thin wrapper over the shared registry, giving host UIs
  provider lists, active-provider switching, route editing, route validation, preview, and probe
  operations without introducing a second routing store.
- `configureInferenceRuntime()` returns `routeValidation` and flattened `routeIssues` alongside
  `registry` and `providers`, giving deployments an immediate payload-free configuration report after
  providers, bridges, local discovery, and routes are composed.
- Provider profile metadata is runtime-only and remains separate from Knowledge Shard profile names
  (`core-v1`, `full-v1`, `record-v1`).

## Migration Plan

### Phase 1: Additive Runtime Routing

- Keep all existing `setEmbedFunction` and `setLlmFunction` behavior callable.
- Add provider/task routes without changing shard schemas, AIWG index validation, or live service
  compatibility claims.
- Verify type safety and focused provider routing tests.

### Phase 2: Pipeline Adoption

- Thread specific task hints through embedding generation, semantic query embedding, title/revision,
  tagging, linking, AIWG review, and future document-ingestion jobs.
- Use `embedding.document` for normal note/document materialization and `embedding.query` for search
  queries so deployments can choose different models without replacing the whole semantic capability.
- Use route telemetry to evaluate static routing and fallback behavior before introducing learned or
  scored routing.

### Phase 3: Provider Profiles

- Add optional provider metadata for cost tier, privacy tier, max input length, supported embedding
  dimensions, and allowed data classes. Complete.
- Enforce fail-closed routing when a task requires a privacy or data-class boundary that no configured
  provider satisfies. Complete for static route requirements.
- Keep profile data separate from Knowledge Shard profile names (`core-v1`, `full-v1`, `record-v1`).
  Complete in implementation and docs.

### Phase 4: Learned or Scored Routing

- Introduce router scoring only after the static policy layer is stable.
- Evaluate cascade thresholds with reproducible fixtures before enabling automatic escalation.
- File an ADR if routing policy becomes persistent, learned, or user-visible enough to affect
  release semantics.

## Verification

Passed:

- `pnpm --filter @fortemi/core typecheck`
- `pnpm --filter @fortemi/react typecheck`
- `pnpm --filter @fortemi/standalone typecheck`

Attempted but blocked before test execution:

- `pnpm --filter @fortemi/core test -- src/__tests__/provider-registry.test.ts src/__tests__/inference-runtime.test.ts src/__tests__/openai-provider.test.ts`
- `pnpm --filter @fortemi/core test -- src/__tests__/local-discovery.test.ts src/__tests__/inference-runtime.test.ts`
- `pnpm --filter @fortemi/core test -- src/__tests__/provider-registry.test.ts src/__tests__/local-discovery.test.ts src/__tests__/inference-runtime.test.ts`
- `pnpm --filter @fortemi/core test -- src/__tests__/inference-runtime.test.ts src/__tests__/provider-registry.test.ts`
- `pnpm --filter @fortemi/core test -- src/__tests__/inference-runtime.test.ts src/__tests__/provider-registry.test.ts src/__tests__/local-discovery.test.ts`
- `pnpm --filter @fortemi/core test -- src/__tests__/inference-runtime.test.ts src/__tests__/provider-registry.test.ts src/__tests__/local-discovery.test.ts src/__tests__/embedding-pipeline.test.ts`
- `pnpm --filter @fortemi/core test -- src/__tests__/provider-registry.test.ts src/__tests__/inference-runtime.test.ts src/__tests__/local-discovery.test.ts src/__tests__/embedding-pipeline.test.ts`
- `pnpm --filter @fortemi/core test -- src/__tests__/openai-provider.test.ts src/__tests__/local-discovery.test.ts src/__tests__/provider-registry.test.ts src/__tests__/inference-runtime.test.ts src/__tests__/embedding-pipeline.test.ts`

The Vitest/esbuild startup path tries to parse `/home/roctinam/package.json`, which is currently an
empty unrelated parent file. No test body ran.

## Open Work

- Thread additional task hints into future linking, AIWG review, and document-ingestion jobs as those
  pipelines adopt routed inference.
- Add richer route simulation fixtures after the parent test-runner startup issue is resolved.
- Add clean tests once the parent package JSON startup issue is resolved or isolated.
- Induct and grade the newly queued internet sources before using them as corpus evidence.
