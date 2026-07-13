---
title: AI Capabilities
tags: ai, capabilities, data
---

# AI Capabilities

Capabilities are **opt-in**. Nothing downloads until you ask.

- `useGpuCapabilities` / `useInferenceCapabilities` detect the hardware tier,
- `useLocalDiscovery` finds local servers (Ollama, LM Studio),
- `useCapabilitySetup` wires embeddings and a local LLM,
- `useJobQueue` watches the revision → title → embedding → tagging pipeline.

Enabled embeddings add semantic ranking to [search](05-search).
