# AIWG CRM Integration

Fortemi React can consume AIWG project index exports produced by aiwg-crm and future
AIWG index tooling. The first supported contract is `aiwg.fortemi.index.export.v1`.

## Contract

An export contains a deterministic `items[]` array. Each record includes:

- stable `id`, `type`, and source locator,
- display `title` and searchable `text`,
- structured `facets`, `tags`, and `concepts`,
- `relationships` to CRM and AIWG records,
- field-level `provenance`,
- privacy classification and PII flag,
- `updated_at` timestamp.

Use `validateAiwgFortemiIndexExport(value)` or
`assertAiwgFortemiIndexExport(value)` before using untrusted exports.

## Query

`queryAiwgFortemiIndex(index, query, options)` searches title/text/tags/concepts and
filters by type, facets, tags, concepts, privacy, and relationship target.

React apps can use `useAiwgIndex()` to load an export, search it, and maintain
human-gated review decisions in local state.

## Graph Projection

`useAiwgIndex()` also exposes `toCommunityGraph()`, which projects the loaded
AIWG export into graph nodes and edges suitable for `GraphView`. Nodes preserve
the source item id, title, type, tags, concepts, privacy classification, and PII
flag so reviewers can inspect CRM, task, and AIWG artifact relationships without
writing back to canonical AIWG data.

```tsx
import { useEffect, useMemo } from 'react'
import { GraphView, useAiwgIndex } from '@fortemi/react'

function AiwgReviewGraph({ exportJson }: { exportJson: unknown }) {
  const { index, loadIndex, toCommunityGraph } = useAiwgIndex()
  const graph = useMemo(() => (index ? toCommunityGraph() : null), [index, toCommunityGraph])

  useEffect(() => {
    loadIndex(exportJson)
  }, [exportJson, loadIndex])

  return <GraphView graph={graph} height={520} />
}
```

## Review Queues

Review decisions are exported separately as
`aiwg.fortemi.review-decisions.v1`. They are proposals only. Fortemi React does not
write canonical CRM JSON or trigger outreach.

## Fixture

`packages/core/test/fixtures/sanitized-aiwg-fortemi-index.json` mirrors the aiwg-crm
shared fixture and contains synthetic contact, organization, event, interaction, and
AIWG artifact records.
