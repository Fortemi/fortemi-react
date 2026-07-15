// Citation graph views for the /fortemi sub-app.
//
// Nodes are research papers (one per primary note), edges are the `cites`
// links. Inspired by the Hall of the Mind (HotM) Sigma explorer, restyled to
// the site's greyscale "Lit" palette — no bright community colours. Cluster
// structure is surfaced via Louvain (greyscale tone per cluster) plus a
// force-directed layout that separates clusters spatially.
//
// GraphView is a thin wrapper with a 2D / 3D toggle:
//   • 2D  → Sigma + LinLog ForceAtlas2 (this file)
//   • 3D  → react-force-graph-3d / Three.js (lazy-loaded; Graph3D.tsx)
// Data for both comes from the shared loadCitationGraph() loader.

import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import type { ShardReader } from '@fortemi/core';
import { graphThemeFor, useThemeMode } from '@fortemi/examples-shared/ui';
import { NoteModal } from './NoteViewer';
import { ShardNoteModal } from './ShardNoteModal';
import { LoadingBlock } from './Spinner';
import { loadGraph, loadGraphSnapshot, type GraphBasis } from './citationGraph';

// loadGraph's first param (the live-fallback DB) without importing the internal type.
type GraphDb = Parameters<typeof loadGraph>[0];

const Graph3D = lazy(() => import('./Graph3D').then((m) => ({ default: m.Graph3D })));

const BG = 'var(--surface)';
const INK = 'var(--ink)';
const INK_MUTE = 'var(--muted)';
const RULE = 'var(--rule)';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

type Mode = '2d' | '3d';

function communityColor(mode: 'light' | 'dark', rank: number): string {
  const colors = mode === 'dark'
    ? ['#5b8cff', '#4fd1c5', '#f5a623', '#9b8cff', '#5bb9ff', '#ffcf7a']
    : ['#2563eb', '#0f8f87', '#b26b00', '#6957c8', '#1673b8', '#8a5200'];
  return colors[rank % colors.length];
}

const segBtn = (active: boolean, first = false): CSSProperties => ({
  fontFamily: MONO,
  fontSize: 12,
  padding: '4px 12px',
  border: `1px solid ${RULE}`,
  borderRight: first ? 'none' : `1px solid ${RULE}`,
  background: active ? INK : 'transparent',
  color: active ? BG : INK_MUTE,
  cursor: 'pointer',
  letterSpacing: '0.04em',
});

export function GraphView({
  ready,
  summarySetId,
  db,
  reader,
}: {
  ready: boolean;
  summarySetId?: string;
  db?: GraphDb;
  reader?: ShardReader;
}) {
  const [mode, setMode] = useState<Mode>('2d');
  const [basis, setBasis] = useState<GraphBasis>('citations');

  const row: CSSProperties = { display: 'flex', gap: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={row}>
          <button style={segBtn(basis === 'citations', true)} onClick={() => setBasis('citations')}>
            Citations
          </button>
          <button
            style={segBtn(basis === 'topics')}
            title="Cluster by AI-summary similarity (what each paper is about)"
            onClick={() => setBasis('topics')}
          >
            Topics
          </button>
        </div>
        <div style={row}>
          <button style={segBtn(mode === '2d', true)} onClick={() => setMode('2d')}>
            2D
          </button>
          <button style={segBtn(mode === '3d')} onClick={() => setMode('3d')}>
            3D
          </button>
        </div>
      </div>

      {mode === '2d' ? (
        <Graph2D ready={ready} basis={basis} summarySetId={summarySetId} db={db} reader={reader} />
      ) : (
        <Suspense fallback={<CanvasBox><Overlay><LoadingBlock message="Loading the 3D renderer…" /></Overlay></CanvasBox>}>
          <Graph3D ready={ready} basis={basis} summarySetId={summarySetId} db={db} reader={reader} />
        </Suspense>
      )}
    </div>
  );
}

// ── shared chrome ────────────────────────────────────────────
const canvasBoxStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '70vh',
  minHeight: 480,
  border: `1px solid ${RULE}`,
  background: BG,
  borderRadius: 2,
  overflow: 'hidden',
};
const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: BG,
};
function CanvasBox({ children }: { children: React.ReactNode }) {
  return <div style={canvasBoxStyle}>{children}</div>;
}
function Overlay({ children }: { children: React.ReactNode }) {
  return <div style={overlayStyle}>{children}</div>;
}

// ── 2D (Sigma) ───────────────────────────────────────────────
function Graph2D({
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
  const sigmaTheme = graphThemeFor(themeMode).sigma;
  const graphInk = sigmaTheme.ink ?? (themeMode === 'dark' ? '#ffffff' : '#0e1726');
  const graphMuted = sigmaTheme.node ?? (themeMode === 'dark' ? '#5b8cff' : '#2563eb');
  const graphEdge = sigmaTheme.edge ?? (themeMode === 'dark' ? '#314264' : '#9aaccc');
  const graphDimNode = sigmaTheme.dimNode ?? (themeMode === 'dark' ? '#182541' : '#d9e2f4');
  const graphDimEdge = sigmaTheme.dimEdge ?? (themeMode === 'dark' ? '#111c32' : '#e8eef9');
  const graphLabel = sigmaTheme.label ?? graphInk;
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const anchorRef = useRef<string | null>(null); // soft anchor (hub) — emphasised, no dimming
  const neighborsRef = useRef<Set<string>>(new Set());

  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [settling, setSettling] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [stats, setStats] = useState<{ nodes: number; edges: number; clusters: number }>({
    nodes: 0,
    edges: 0,
    clusters: 0,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    // No persistent "started" guard: the `cancelled` closure is the single
    // source of truth so StrictMode / dep-change re-runs cannot strand the
    // load on "loading". The build is idempotent.
    let cancelled = false;

    (async () => {
      try {
        setPhase('loading');
        // Snapshot-first: a precomputed graph (instant, with baked positions);
        // fall back to the live DB build when no snapshot is published.
        const data = (await loadGraphSnapshot(basis)) ?? (db ? await loadGraph(db, basis, summarySetId) : null);
        if (cancelled) return;
        if (!data) {
          setPhase('empty');
          return;
        }
        // When the snapshot carries positions we skip the FA2 settle entirely.
        const positioned = data.nodes.some((n) => n.x != null && n.y != null);

        const graph = new Graph({ multi: false, type: 'undirected' });
        for (const n of data.nodes) {
          const nodeColor = communityColor(themeMode, n.community);
          graph.addNode(n.id, {
            label: n.label,
            size: n.size,
            color: nodeColor,
            baseColor: nodeColor,
            x: n.x ?? Math.random() * 2 - 1,
            y: n.y ?? Math.random() * 2 - 1,
          });
        }
        for (const l of data.links) {
          if (graph.hasNode(l.source) && graph.hasNode(l.target) && !graph.hasEdge(l.source, l.target)) {
            graph.addEdge(l.source, l.target, { size: 0.6, color: graphEdge });
          }
        }

        setStats({ nodes: graph.order, edges: graph.size, clusters: data.clusters });
        graphRef.current = graph;

        if (cancelled || !containerRef.current) return;
        sigmaRef.current?.kill();
        sigmaRef.current = null;

        const renderer = new Sigma(graph, containerRef.current, {
          renderLabels: true,
          labelColor: { color: graphLabel },
          labelSize: 11,
          labelFont: MONO,
          labelDensity: 0.7,
          labelGridCellSize: 70,
          // Suppress labels in the default view; the reducer forceLabels only
          // the anchor + hovered/focused node and its neighbours.
          labelRenderedSizeThreshold: 10000,
          defaultNodeColor: graphMuted,
          defaultEdgeColor: graphEdge,
          defaultEdgeType: 'line',
          minCameraRatio: 0.05,
          maxCameraRatio: 2.5,
          nodeReducer: (node, data) => {
            const base = (data.baseColor as string) ?? (data.color as string);
            const focus = hoveredRef.current ?? selectedRef.current;
            if (focus) {
              if (node === focus) return { ...data, color: graphInk, zIndex: 2, forceLabel: true };
              if (neighborsRef.current.has(node)) return { ...data, color: graphMuted, zIndex: 1, forceLabel: true };
              return { ...data, color: graphDimNode, label: '', zIndex: 0 };
            }
            if (node === anchorRef.current) return { ...data, color: graphInk, zIndex: 1, forceLabel: true };
            return { ...data, color: base };
          },
          edgeReducer: (edge, data) => {
            const focus = hoveredRef.current ?? selectedRef.current;
            const g = graphRef.current;
            if (!focus || !g) return data;
            const [s, t] = g.extremities(edge);
            if (s === focus || t === focus) return { ...data, color: graphMuted, size: 1.1, zIndex: 1 };
            return { ...data, color: graphDimEdge, zIndex: 0 };
          },
        });

        const recomputeNeighbors = (node: string) => {
          const ns = new Set<string>();
          graph.forEachNeighbor(node, (nb) => ns.add(nb));
          neighborsRef.current = ns;
        };
        const focusCamera = (node: string) => {
          const pos = renderer.getNodeDisplayData(node);
          if (!pos) return;
          renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.45 }, { duration: 600 });
        };

        const layoutSettings = () => ({
          ...forceAtlas2.inferSettings(graph),
          linLogMode: true,
          outboundAttractionDistribution: true,
          adjustSizes: false,
          gravity: 1,
        });

        // Ctrl/⌘-click: pin the node at the layout centre and re-run the force
        // layout so the graph re-settles around it (animates live from the
        // current positions into the new configuration), then re-fit.
        const reanchor = (node: string) => {
          const prev = anchorRef.current;
          if (prev && prev !== node && graph.hasNode(prev)) graph.removeNodeAttribute(prev, 'fixed');
          graph.setNodeAttribute(node, 'x', 0);
          graph.setNodeAttribute(node, 'y', 0);
          graph.setNodeAttribute(node, 'fixed', true);
          anchorRef.current = node;
          selectedRef.current = null;
          hoveredRef.current = null;
          neighborsRef.current = new Set();

          layoutRef.current?.kill();
          const re = new FA2Layout(graph, { settings: layoutSettings() });
          layoutRef.current = re;
          setSettling(true);
          re.start();
          window.setTimeout(() => {
            if (cancelled) return;
            re.stop();
            layoutRef.current = null;
            setSettling(false);
            renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 600 });
            renderer.refresh();
          }, 4500);
        };

        renderer.on('enterNode', ({ node }) => {
          hoveredRef.current = node;
          recomputeNeighbors(node);
          renderer.refresh();
          if (containerRef.current) containerRef.current.style.cursor = 'pointer';
        });
        renderer.on('leaveNode', () => {
          hoveredRef.current = null;
          if (selectedRef.current) recomputeNeighbors(selectedRef.current);
          else neighborsRef.current = new Set();
          renderer.refresh();
          if (containerRef.current) containerRef.current.style.cursor = 'default';
        });
        renderer.on('clickNode', ({ node, event }) => {
          const native = (event as { original?: MouseEvent }).original;
          if (native && (native.ctrlKey || native.metaKey)) {
            reanchor(node);
            return;
          }
          selectedRef.current = node;
          recomputeNeighbors(node);
          focusCamera(node);
          renderer.refresh();
        });
        renderer.on('doubleClickNode', ({ node, event }) => {
          event.preventSigmaDefault();
          setOpenId(node);
        });
        renderer.on('clickStage', () => {
          selectedRef.current = null;
          neighborsRef.current = new Set();
          renderer.refresh();
        });

        sigmaRef.current = renderer;
        if (import.meta.env.DEV) {
          (window as unknown as { __fortemiSigma?: Sigma }).__fortemiSigma = renderer;
        }
        setPhase('ready');

        // Soft-anchor the most-central paper: a focal point without dimming/zoom.
        const setAnchor = () => {
          let anchor: string | null = null;
          let best = -1;
          graph.forEachNode((n) => {
            const d = graph.degree(n);
            if (d > best) {
              best = d;
              anchor = n;
            }
          });
          anchorRef.current = anchor;
        };

        // Always settle on open. A static snapshot reads as a cramped, "locked"
        // hairball and gives no signal the graph is interactive; letting the force
        // layout run for a few seconds spreads communities apart (LinLog pulls
        // tight clusters together, pushes hubs to the rim) and the live motion
        // signals it's a force graph — ⌘/ctrl-click a node to re-settle around it.
        // Baked snapshot positions are a warm start (fast convergence); without
        // them it's a cold run seeded from random.
        const layout = new FA2Layout(graph, { settings: layoutSettings() });
        layoutRef.current = layout;
        setSettling(true);
        layout.start();

        const runMs = positioned ? 4000 : Math.min(9000, 3500 + graph.order * 9);
        window.setTimeout(() => {
          if (cancelled) return;
          layout.stop();
          layoutRef.current = null;
          setSettling(false);
          // Soft-anchor the most-significant document (highest degree) as the
          // focal point — emphasised in ink with a forced label, no dimming — so
          // the whole settled graph stays readable with a clear place to start.
          setAnchor();
          renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 500 });
          renderer.refresh();
        }, runMs);
      } catch (e) {
        if (!cancelled) {
          setErrMsg((e as Error).message);
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      layoutRef.current?.kill();
      layoutRef.current = null;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [ready, db, basis, summarySetId, themeMode, graphDimEdge, graphDimNode, graphEdge, graphInk, graphLabel, graphMuted]);

  const caption: CSSProperties = { fontFamily: MONO, fontSize: 12, color: INK_MUTE, letterSpacing: '0.02em' };
  const edgeLabel = basis === 'topics' ? 'topical links' : 'citation links';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={caption}>
        {phase === 'ready'
          ? `${stats.nodes} papers · ${stats.edges} ${edgeLabel} · ${stats.clusters} clusters` +
            (settling
              ? ' — settling…'
              : ' — click to focus · ⌘/ctrl-click to re-anchor · double-click to open')
          : phase === 'empty'
            ? basis === 'topics'
              ? 'No topical links — the AI-summary set is unavailable.'
              : 'No citation links in this corpus.'
            : 'Citation network'}
      </div>

      <CanvasBox>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {(phase === 'idle' || phase === 'loading') && (
          <Overlay>
            <LoadingBlock message="Loading the citation network…" />
          </Overlay>
        )}
        {phase === 'error' && (
          <div style={{ ...overlayStyle, color: INK, fontFamily: MONO, fontSize: 13, padding: 24, textAlign: 'center' }}>
            Could not build the graph: {errMsg}
          </div>
        )}
        {phase === 'empty' && (
          <div style={{ ...overlayStyle, color: INK_MUTE, fontFamily: MONO, fontSize: 13 }}>No links to show.</div>
        )}
      </CanvasBox>

      {openId &&
        (reader ? (
          <ShardNoteModal reader={reader} noteId={openId} onClose={() => setOpenId(null)} />
        ) : (
          <NoteModal noteId={openId} onClose={() => setOpenId(null)} />
        ))}
    </div>
  );
}
