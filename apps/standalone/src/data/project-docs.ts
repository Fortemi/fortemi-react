import dynamicUserAuthoredCommunities from '../../../../.aiwg/architecture/dynamic-user-authored-communities.md?raw'
import graphCommunityShardArtifacts from '../../../../.aiwg/architecture/graph-community-shard-artifacts.md?raw'
import graphSourceController from '../../../../.aiwg/architecture/graph-source-controller.md?raw'
import phase0EmbeddingGraphOwnership from '../../../../.aiwg/architecture/phase-0-embedding-graph-ownership.md?raw'
import precomputedSimilarityGraphs from '../../../../.aiwg/architecture/precomputed-similarity-graphs.md?raw'
import virtualEmbeddingSets from '../../../../.aiwg/architecture/virtual-embedding-sets.md?raw'
import deployment from '../../../../docs/content/advanced/deployment.md?raw'
import extending from '../../../../docs/content/advanced/extending.md?raw'
import apiReference from '../../../../docs/content/api-reference.md?raw'
import gettingStarted from '../../../../docs/content/getting-started.md?raw'
import aiwgCrmIntegration from '../../../../docs/content/guides/aiwg-crm-integration.md?raw'
import examples from '../../../../docs/content/guides/examples.md?raw'
import integration from '../../../../docs/content/guides/integration.md?raw'
import search from '../../../../docs/content/guides/search.md?raw'
import release20260502 from '../../../../docs/content/releases/v2026.5.2.md?raw'
import release20260503 from '../../../../docs/content/releases/v2026.5.3.md?raw'
import release20260504 from '../../../../docs/content/releases/v2026.5.4.md?raw'
import release20260600 from '../../../../docs/content/releases/v2026.6.0.md?raw'
import release20260601 from '../../../../docs/content/releases/v2026.6.1.md?raw'
import release20260602 from '../../../../docs/content/releases/v2026.6.2.md?raw'
import release20260603 from '../../../../docs/content/releases/v2026.6.3.md?raw'
import release20260604 from '../../../../docs/content/releases/v2026.6.4.md?raw'
import release20260605 from '../../../../docs/content/releases/v2026.6.5.md?raw'
import release20260606 from '../../../../docs/content/releases/v2026.6.6.md?raw'
import release20260607 from '../../../../docs/content/releases/v2026.6.7.md?raw'
import release20260608 from '../../../../docs/content/releases/v2026.6.8.md?raw'
import release20260609 from '../../../../docs/content/releases/v2026.6.9.md?raw'
import release20260700 from '../../../../docs/content/releases/v2026.7.0.md?raw'
import release20260701 from '../../../../docs/content/releases/v2026.7.1.md?raw'
import release20260702 from '../../../../docs/content/releases/v2026.7.2.md?raw'
import release20260703 from '../../../../docs/content/releases/v2026.7.3.md?raw'
import release20260704 from '../../../../docs/content/releases/v2026.7.4.md?raw'
import release20260706 from '../../../../docs/content/releases/v2026.7.6.md?raw'
import release20260707 from '../../../../docs/content/releases/v2026.7.7.md?raw'
import release20260708 from '../../../../docs/content/releases/v2026.7.8.md?raw'
import release20260709 from '../../../../docs/content/releases/v2026.7.9.md?raw'
import release20260710 from '../../../../docs/content/releases/v2026.7.10.md?raw'
import release20260711 from '../../../../docs/content/releases/v2026.7.11.md?raw'
import release20260712 from '../../../../docs/content/releases/v2026.7.12.md?raw'
import release20260713 from '../../../../docs/content/releases/v2026.7.13.md?raw'
import release20260714 from '../../../../docs/content/releases/v2026.7.14.md?raw'
import release20260715 from '../../../../docs/content/releases/v2026.7.15.md?raw'
import release20260705 from '../../../../docs/content/releases/v2026.7.5.md?raw'
import pluginContentSecurity from '../../../../docs/content/security/plugin-content-security.md?raw'
import supplyChain from '../../../../docs/content/security/supply-chain.md?raw'

export interface ProjectDoc {
  path: string
  title: string
  content: string
  tags: string[]
}

function titleFromMarkdown(path: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  return path.split('/').pop()?.replace(/\.md$/, '').replace(/-/g, ' ') ?? path
}

function doc(path: string, content: string, tags: string[]): ProjectDoc {
  return {
    path,
    title: titleFromMarkdown(path, content),
    content,
    tags: ['docs', `docs:${path}`, ...tags],
  }
}

export const PROJECT_DOCS: ProjectDoc[] = [
  doc('docs/content/guides/aiwg-crm-integration.md', aiwgCrmIntegration, ['docs:integration']),
  doc('docs/content/api-reference.md', apiReference, ['docs:api']),
  doc('.aiwg/architecture/dynamic-user-authored-communities.md', dynamicUserAuthoredCommunities, ['docs:architecture']),
  doc('.aiwg/architecture/graph-community-shard-artifacts.md', graphCommunityShardArtifacts, ['docs:architecture']),
  doc('.aiwg/architecture/graph-source-controller.md', graphSourceController, ['docs:architecture']),
  doc('.aiwg/architecture/phase-0-embedding-graph-ownership.md', phase0EmbeddingGraphOwnership, ['docs:architecture']),
  doc('.aiwg/architecture/precomputed-similarity-graphs.md', precomputedSimilarityGraphs, ['docs:architecture']),
  doc('.aiwg/architecture/virtual-embedding-sets.md', virtualEmbeddingSets, ['docs:architecture']),
  doc('docs/content/advanced/deployment.md', deployment, ['docs:deployment']),
  doc('docs/content/guides/examples.md', examples, ['docs:examples']),
  doc('docs/content/advanced/extending.md', extending, ['docs:extending']),
  doc('docs/content/getting-started.md', gettingStarted, ['docs:getting-started']),
  doc('docs/content/guides/integration.md', integration, ['docs:integration']),
  doc('docs/content/releases/v2026.5.2.md', release20260502, ['docs:release']),
  doc('docs/content/releases/v2026.5.3.md', release20260503, ['docs:release']),
  doc('docs/content/releases/v2026.5.4.md', release20260504, ['docs:release']),
  doc('docs/content/releases/v2026.6.0.md', release20260600, ['docs:release']),
  doc('docs/content/releases/v2026.6.1.md', release20260601, ['docs:release']),
  doc('docs/content/releases/v2026.6.2.md', release20260602, ['docs:release']),
  doc('docs/content/releases/v2026.6.3.md', release20260603, ['docs:release']),
  doc('docs/content/releases/v2026.6.4.md', release20260604, ['docs:release']),
  doc('docs/content/releases/v2026.6.5.md', release20260605, ['docs:release']),
  doc('docs/content/releases/v2026.6.6.md', release20260606, ['docs:release']),
  doc('docs/content/releases/v2026.6.7.md', release20260607, ['docs:release']),
  doc('docs/content/releases/v2026.6.8.md', release20260608, ['docs:release']),
  doc('docs/content/releases/v2026.6.9.md', release20260609, ['docs:release']),
  doc('docs/content/releases/v2026.7.0.md', release20260700, ['docs:release']),
  doc('docs/content/releases/v2026.7.1.md', release20260701, ['docs:release']),
  doc('docs/content/releases/v2026.7.2.md', release20260702, ['docs:release']),
  doc('docs/content/releases/v2026.7.3.md', release20260703, ['docs:release']),
  doc('docs/content/releases/v2026.7.4.md', release20260704, ['docs:release']),
  doc('docs/content/releases/v2026.7.15.md', release20260715, ['docs:release']),
  doc('docs/content/releases/v2026.7.14.md', release20260714, ['docs:release']),
  doc('docs/content/releases/v2026.7.13.md', release20260713, ['docs:release']),
  doc('docs/content/releases/v2026.7.12.md', release20260712, ['docs:release']),
  doc('docs/content/releases/v2026.7.11.md', release20260711, ['docs:release']),
  doc('docs/content/releases/v2026.7.10.md', release20260710, ['docs:release']),
  doc('docs/content/releases/v2026.7.9.md', release20260709, ['docs:release']),
  doc('docs/content/releases/v2026.7.8.md', release20260708, ['docs:release']),
  doc('docs/content/releases/v2026.7.7.md', release20260707, ['docs:release']),
  doc('docs/content/releases/v2026.7.6.md', release20260706, ['docs:release']),
  doc('docs/content/releases/v2026.7.5.md', release20260705, ['docs:release']),
  doc('docs/content/guides/search.md', search, ['docs:search']),
  doc('docs/content/security/plugin-content-security.md', pluginContentSecurity, ['docs:security']),
  doc('docs/content/security/supply-chain.md', supplyChain, ['docs:security']),
]
