// 3D citation graph for the /fortemi sub-app — react-force-graph-3d (Three.js),
// lazy-loaded by GraphView so Three only ships when the 3D mode is selected.
// Same data + Louvain communities as the 2D view, restyled to the greyscale
// "Lit" palette on the cream background. Hover shows the paper title; clicking
// a node opens the NoteModal reader.
//
// The <ForceGraph3D> lives in a memoised Scene with referentially-stable props
// so that opening/closing the reader (which re-renders this component) never
// touches the renderer — the user's orbit position and zoom are preserved.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import ForceGraph3D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-3d';
import type { ShardReader } from '@fortemi/core';
import { graphThemeFor, useThemeMode } from '@fortemi/examples-shared/ui';
import { ShardNoteModal } from './ShardNoteModal';
import { NoteModal } from './NoteViewer';
import { LoadingBlock } from './Spinner';
import { loadGraph, loadGraphSnapshot, type CitationGraph, type GraphBasis } from './citationGraph';

const BG = 'var(--surface)';
const INK_MUTE = 'var(--muted)';
const RULE = 'var(--rule)';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

type FGNode = NodeObject & { id: string; label: string; size: number; color: string };
type FGData = { nodes: { id: string; label: string; size: number; color: string }[]; links: { source: string; target: string }[] };

function communityColor(mode: 'light' | 'dark', rank: number): string {
  const colors = mode === 'dark'
    ? ['#5b8cff', '#4fd1c5', '#f5a623', '#9b8cff', '#5bb9ff', '#ffcf7a']
    : ['#2563eb', '#0f8f87', '#b26b00', '#6957c8', '#1673b8', '#8a5200'];
  return colors[rank % colors.length];
}

// Pure, module-level accessors — stable identity keeps the memoised Scene from
// re-rendering (and the renderer from re-processing) on parent state changes.
const nodeColorAcc = (n: NodeObject) => (n as FGNode).color;
const nodeValAcc = (n: NodeObject) => (n as FGNode).size;
const nodeLabelAcc = (n: NodeObject) => (n as FGNode).label;
type PinnedNode = FGNode & { fx?: number; fy?: number; fz?: number };

const Scene = memo(function Scene({
  graphData,
  width,
  height,
  onOpen,
  background,
  link,
}: {
  graphData: FGData;
  width: number;
  height: number;
  onOpen: (n: NodeObject) => void;
  background: string;
  link: string;
}) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const anchorRef = useRef<PinnedNode | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __fortemiFg3d?: ForceGraphMethods }).__fortemiFg3d = fgRef.current;
  });

  // Ctrl/⌘-click: pin the node at the centre and reheat the force simulation so
  // the graph re-settles around it (animates live), then zoomToFit recenters on
  // engine stop. Plain click opens the reader (no reheat → camera retained).
  const handleNodeClick = useCallback(
    (n: NodeObject, event?: MouseEvent) => {
      if (event && (event.ctrlKey || event.metaKey)) {
        const node = n as PinnedNode;
        const prev = anchorRef.current;
        if (prev && prev !== node) {
          prev.fx = undefined;
          prev.fy = undefined;
          prev.fz = undefined;
        }
        node.fx = 0;
        node.fy = 0;
        node.fz = 0;
        anchorRef.current = node;
        fgRef.current?.d3ReheatSimulation();
        return;
      }
      onOpen(n);
    },
    [onOpen],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor={background}
      showNavInfo={false}
      enableNodeDrag={false}
      nodeColor={nodeColorAcc}
      nodeVal={nodeValAcc}
      nodeLabel={nodeLabelAcc}
      nodeRelSize={5}
      nodeResolution={12}
      nodeOpacity={0.95}
      linkColor={() => link}
      linkOpacity={0.6}
      linkWidth={0.7}
      warmupTicks={60}
      cooldownTicks={140}
      onEngineStop={() => fgRef.current?.zoomToFit(600, 60)}
      onNodeClick={handleNodeClick}
    />
  );
});

type GraphDb = Parameters<typeof loadGraph>[0];

export function Graph3D({
  ready,
  basis,
  summarySetId,
  db,
  reader,
}: {
  ready: boolean;
  basis: GraphBasis;
  summarySetId?: string;
  db?: GraphDb;
  reader?: ShardReader;
}) {
  const themeMode = useThemeMode();
  const graphTheme = graphThemeFor(themeMode).force3d;
  const boxRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<CitationGraph | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [openId, setOpenId] = useState<string | null>(null);

  // Size the renderer to its container (react-force-graph defaults to window).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        setPhase('loading');
        // Snapshot-first (skips the DB graph build); live fallback otherwise.
        // The 3D force engine computes its own positions, so the snapshot's 2D
        // x/y are ignored here — the win is avoiding buildSimilarityGraph/
        // buildLinkGraph at view time.
        const cg = (await loadGraphSnapshot(basis)) ?? (db ? await loadGraph(db, basis, summarySetId) : null);
        if (cancelled) return;
        if (!cg) {
          setPhase('empty');
          return;
        }
        setData(cg);
        setPhase('ready');
      } catch (e) {
        if (!cancelled) {
          setErrMsg((e as Error).message);
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, db, basis, summarySetId]);

  // react-force-graph mutates node/link objects (adds x/y/z) — give it fresh
  // copies once per data load. Stable across reader open/close.
  const graphData = useMemo<FGData>(
    () =>
      data
        ? {
            nodes: data.nodes.map((n) => ({ id: n.id, label: n.label, size: n.size, color: communityColor(themeMode, n.community) })),
            links: data.links.map((l) => ({ source: l.source, target: l.target })),
          }
        : { nodes: [], links: [] },
    [data, themeMode],
  );

  // Stable open handler so the memoised Scene never re-renders on openId change.
  const handleOpen = useCallback((n: NodeObject) => setOpenId((n as FGNode).id), []);

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __fortemiFg3dData?: FGData }).__fortemiFg3dData = graphData;
  }, [graphData]);

  const caption: CSSProperties = { fontFamily: MONO, fontSize: 12, color: INK_MUTE, letterSpacing: '0.02em' };
  const box: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '70vh',
    minHeight: 480,
    border: `1px solid ${RULE}`,
    background: BG,
    borderRadius: 2,
    overflow: 'hidden',
  };
  const overlay: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: BG,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={caption}>
        {phase === 'ready'
          ? `${data?.nodes.length ?? 0} papers · ${data?.links.length ?? 0} ${basis === 'topics' ? 'topical links' : 'citation links'} · ${data?.clusters ?? 0} clusters — drag to orbit · scroll to zoom · click to read · ⌘/ctrl-click to re-anchor`
          : phase === 'empty'
            ? basis === 'topics'
              ? 'No topical links — the AI-summary set is unavailable.'
              : 'No citation links in this corpus.'
            : 'Citation network (3D)'}
      </div>

      <div ref={boxRef} style={box}>
        {phase === 'ready' && size.w > 0 && (
          <Scene graphData={graphData} width={size.w} height={size.h} onOpen={handleOpen} background={graphTheme.background} link={graphTheme.link} />
        )}
        {(phase === 'idle' || phase === 'loading') && (
          <div style={overlay}>
            <LoadingBlock message="Loading the citation network…" />
          </div>
        )}
        {phase === 'error' && (
          <div style={{ ...overlay, color: INK_MUTE, fontFamily: MONO, fontSize: 13, padding: 24, textAlign: 'center' }}>
            Could not build the graph: {errMsg}
          </div>
        )}
        {phase === 'empty' && (
          <div style={{ ...overlay, color: INK_MUTE, fontFamily: MONO, fontSize: 13 }}>No links to show.</div>
        )}
      </div>

      {openId &&
        (reader ? (
          <ShardNoteModal reader={reader} noteId={openId} onClose={() => setOpenId(null)} />
        ) : (
          <NoteModal noteId={openId} onClose={() => setOpenId(null)} />
        ))}
    </div>
  );
}
