// Shared graph loader for the /fortemi Graph views (2D Sigma + 3D force-graph).
//
// Two bases, both served by Fortémi's native GraphRepository (no client-side
// graphology/Louvain — community detection runs in core):
//   • citations — buildLinkGraph('cites'): edges are the authored citation
//     links; communities are citation neighbourhoods.
//   • topics    — buildSimilarityGraph(aiSummarySet): edges are k-NN over the
//     "AI summaries" embedding set; communities cluster by what each paper is
//     *about* rather than who it cites.
//
// GraphRepository returns a CommunityGraph (node ids + edges + communities); we
// attach titles (for labels), degree (for sizing) and a greyscale tone per
// community (largest cluster = darkest), and hand back a render-ready shape.

import { GraphRepository, type CommunityGraph } from '@fortemi/core';

// Greyscale ramp for communities — warm-grey to sit on the cream "Lit"
// background; strictly greyscale (no bright community colours).
export const CLUSTER_GREYS = ['#2B2824', '#43403A', '#585149', '#6E665A', '#837A6B', '#968C7C'];

export type GraphBasis = 'citations' | 'topics';

export type CGNode = {
  id: string;
  label: string;
  size: number; // degree-derived
  color: string; // community tone
  community: number; // community rank (0 = largest)
  x?: number; // precomputed layout position (build-time snapshot only)
  y?: number;
};
export type CGLink = { source: string; target: string };
export type CitationGraph = { nodes: CGNode[]; links: CGLink[]; clusters: number };

type MinimalDb = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

function cleanTitle(t: string): string {
  return t.replace(/\s*\(part\s+\d+\s*\/\s*\d+\)\s*$/i, '').trim();
}

/**
 * Pure mapping from a Fortémi `CommunityGraph` to the render-ready
 * `CitationGraph` (labels, degree-derived size, greyscale community tone). Shared
 * by the runtime loader and the build-time snapshot writer
 * (scripts/prepare-fortemi-corpus.ts) so both render identically. Pass `posById`
 * to bake precomputed layout coordinates into the nodes.
 */
export function mapCommunityGraph(
  cg: CommunityGraph,
  titleById: Map<string, string>,
  posById?: Map<string, { x: number; y: number }>,
): CitationGraph {
  // Degree drives node size.
  const degree = new Map<string, number>();
  for (const e of cg.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // Community → greyscale tone (largest cluster = darkest).
  const commOfNode = new Map<string, string>();
  for (const c of cg.communities) for (const n of c.nodes) commOfNode.set(n, c.id);
  const rankByComm = new Map<string, number>();
  [...cg.communities]
    .sort((a, b) => b.nodes.length - a.nodes.length)
    .forEach((c, i) => rankByComm.set(c.id, i));

  const nodes: CGNode[] = cg.nodes.map((n) => {
    const comm = commOfNode.get(n.id);
    const rank = comm != null ? (rankByComm.get(comm) ?? 0) : 0;
    const deg = degree.get(n.id) ?? 0;
    const pos = posById?.get(n.id);
    return {
      id: n.id,
      label: titleById.get(n.id) ?? n.id,
      size: 3 + Math.sqrt(deg) * 1.5,
      color: CLUSTER_GREYS[rank % CLUSTER_GREYS.length],
      community: rank,
      ...(pos ? { x: pos.x, y: pos.y } : {}),
    };
  });
  const links: CGLink[] = cg.edges.map((e) => ({ source: e.source, target: e.target }));
  return { nodes, links, clusters: cg.communities.length };
}

/**
 * Load a build-time precomputed graph snapshot (public/fortemi-corpus/
 * graph.<basis>.snapshot.json). Instant — no DB graph build, no layout
 * simulation; nodes carry baked x/y. Returns null when the snapshot is absent so
 * callers fall back to the live `loadGraph`.
 */
export async function loadGraphSnapshot(basis: GraphBasis): Promise<CitationGraph | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}fortemi-corpus/graph.${basis}.snapshot.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as CitationGraph;
    if (!data?.nodes?.length || !data?.links?.length) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Build the graph for the chosen basis. Returns null when there's nothing to
 * show (no links yet, or the topical set isn't available / has no neighbours).
 */
export async function loadGraph(
  db: MinimalDb,
  basis: GraphBasis,
  summarySetId?: string,
): Promise<CitationGraph | null> {
  const repo = new GraphRepository(db as never);

  let cg: CommunityGraph;
  if (basis === 'topics') {
    if (!summarySetId) return null;
    // k-NN over the AI-summary vectors. k small enough to keep clusters legible.
    cg = await repo.buildSimilarityGraph(summarySetId, { k: 6, minSimilarity: 0.35 });
  } else {
    cg = await repo.buildLinkGraph('cites');
  }
  if (cg.nodes.length === 0 || cg.edges.length === 0) return null;

  // Titles for labels.
  const ids = cg.nodes.map((n) => n.id);
  const titleRows = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM note WHERE id = ANY($1)`,
    [ids],
  );
  const titleById = new Map(titleRows.rows.map((r) => [r.id, cleanTitle(r.title)]));

  return mapCommunityGraph(cg, titleById);
}
