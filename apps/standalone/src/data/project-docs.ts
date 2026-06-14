import aiwgCrmIntegration from '../../../../docs/aiwg-crm-integration.md?raw'
import apiReference from '../../../../docs/api-reference.md?raw'
import dynamicUserAuthoredCommunities from '../../../../docs/architecture/dynamic-user-authored-communities.md?raw'
import graphCommunityShardArtifacts from '../../../../docs/architecture/graph-community-shard-artifacts.md?raw'
import graphSourceController from '../../../../docs/architecture/graph-source-controller.md?raw'
import phase0EmbeddingGraphOwnership from '../../../../docs/architecture/phase-0-embedding-graph-ownership.md?raw'
import precomputedSimilarityGraphs from '../../../../docs/architecture/precomputed-similarity-graphs.md?raw'
import virtualEmbeddingSets from '../../../../docs/architecture/virtual-embedding-sets.md?raw'
import deployment from '../../../../docs/deployment.md?raw'
import examples from '../../../../docs/examples.md?raw'
import extending from '../../../../docs/extending.md?raw'
import gettingStarted from '../../../../docs/getting-started.md?raw'
import integration from '../../../../docs/integration.md?raw'
import release20260502 from '../../../../docs/releases/v2026.5.2.md?raw'
import release20260503 from '../../../../docs/releases/v2026.5.3.md?raw'
import release20260504 from '../../../../docs/releases/v2026.5.4.md?raw'
import release20260600 from '../../../../docs/releases/v2026.6.0.md?raw'
import search from '../../../../docs/search.md?raw'
import pluginContentSecurity from '../../../../docs/security/plugin-content-security.md?raw'
import supplyChain from '../../../../docs/security/supply-chain.md?raw'

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
  doc('docs/aiwg-crm-integration.md', aiwgCrmIntegration, ['docs:integration']),
  doc('docs/api-reference.md', apiReference, ['docs:api']),
  doc('docs/architecture/dynamic-user-authored-communities.md', dynamicUserAuthoredCommunities, ['docs:architecture']),
  doc('docs/architecture/graph-community-shard-artifacts.md', graphCommunityShardArtifacts, ['docs:architecture']),
  doc('docs/architecture/graph-source-controller.md', graphSourceController, ['docs:architecture']),
  doc('docs/architecture/phase-0-embedding-graph-ownership.md', phase0EmbeddingGraphOwnership, ['docs:architecture']),
  doc('docs/architecture/precomputed-similarity-graphs.md', precomputedSimilarityGraphs, ['docs:architecture']),
  doc('docs/architecture/virtual-embedding-sets.md', virtualEmbeddingSets, ['docs:architecture']),
  doc('docs/deployment.md', deployment, ['docs:deployment']),
  doc('docs/examples.md', examples, ['docs:examples']),
  doc('docs/extending.md', extending, ['docs:extending']),
  doc('docs/getting-started.md', gettingStarted, ['docs:getting-started']),
  doc('docs/integration.md', integration, ['docs:integration']),
  doc('docs/releases/v2026.5.2.md', release20260502, ['docs:release']),
  doc('docs/releases/v2026.5.3.md', release20260503, ['docs:release']),
  doc('docs/releases/v2026.5.4.md', release20260504, ['docs:release']),
  doc('docs/releases/v2026.6.0.md', release20260600, ['docs:release']),
  doc('docs/search.md', search, ['docs:search']),
  doc('docs/security/plugin-content-security.md', pluginContentSecurity, ['docs:security']),
  doc('docs/security/supply-chain.md', supplyChain, ['docs:security']),
]
