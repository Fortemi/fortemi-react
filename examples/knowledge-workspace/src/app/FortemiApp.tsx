// src/components/fortemi/FortemiApp.tsx
//
// The full Fortémi sub-app surface (issue #22), dynamically imported by the
// /fortemi route so @fortemi/react + PGlite WASM + the embeddings shard stay
// out of the main bundle.
//
// Load strategy (text-first; staged, opt-in vectors so the main thread never
// blocks long enough for the browser's "page unresponsive" dialog):
//   1. On mount: importShard(corpus.notes.shard) → full-text search ready fast.
//   2. "Enable semantic" (OPT-IN, default = small summaries set):
//        a. DROP the HNSW index (browser-WASM incremental HNSW is too slow;
//           bulk-load then rebuild once)
//        b. importShard(corpus.summaries.shard, {skip}) → ~363 summary vectors
//           (one per doc), notes already present
//        c. CREATE the HNSW index (363 nodes → fast)
//        d. load the all-MiniLM-L6-v2 query model (~23 MB), register semantic →
//           useSearch goes hybrid, ranked against the summaries set
//      Each phase yields (tick) so the progress UI repaints.
//   3. "Content" (on demand, from the Search tab): importShard(corpus.shard)
//      adds the full ~3,149-vector content set + rebuilds the HNSW index.
//
// As of @fortemi 2026.6.1 the durable fixes are adopted: the provider runs in
// worker mode (DB + HNSW off the main thread, Fortemi/fortemi-react#146), and
// importShard reports per-phase progress + yields cooperatively (#147). The
// staged/opt-in loading here still stands — it cuts bandwidth and is the
// fallback if worker mode is ever forced to "main". Set-scoped shard export
// (#148) replaced the old carve-by-delete in the build scripts.
//
// Three personas from one surface: research-corpus browser (the seeded
// operator corpus), personal notebook (visitor can add notes), and an
// agent-memory inspector (provenance / concepts surface, read-only here).

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  FortemiProvider,
  useFortemiContext,
  useSearch,
  useNotes,
  useCreateNote,
  useJobQueue,
  useGpuCapabilities,
  useEmbeddingSets,
} from '@fortemi/react';
import {
  importShard,
  registerSemanticCapabilityWorker,
  prefetchShard,
  fromPrefetched,
  isShardPrefetched,
  enqueueNoteCreationJobs,
  generateId,
  type DatabaseClient,
  type JobStatus,
  type NoteSummary,
} from '@fortemi/core';
import { NoteViewer, NoteModal } from './NoteViewer';
import { GraphView } from './GraphView';
import { dedupeDocuments } from './dedupeDocuments';
import { TypingText } from './TypingText';
import { loadStoredNotes, upsertStoredNote, setStoredNoteTitle } from './visitorNotes';
import { combinedDocumentSearch } from './combinedSearch';
import { LlmSetupModal } from './LlmSetupModal';
import { loadLlmConfig, enableRemoteLlm, disableLlm, type LlmConfig } from './llmSetup';
import { ReaderShell, type UpgradeIntent } from './ReaderShell';

type SearchDoc = {
  id: string;
  title: string | null;
  snippet?: string;
  tags?: string[];
  has_embedding?: boolean;
  displayTitle: string;
};

const CORPUS_ROOT = `${import.meta.env.BASE_URL}fortemi-corpus`;
const NOTES_SHARD = `${CORPUS_ROOT}/corpus.notes.shard`;
// Default semantic set: notes + the "AI summaries" set only (~363 vectors, one
// per doc). Small HNSW build → no main-thread freeze. The full content set
// (~3,149 chunk vectors) lives in FULL_SHARD and loads on demand when the user
// selects "Content" / deep search.
const SUMMARIES_SHARD = `${CORPUS_ROOT}/corpus.summaries.shard`;
const FULL_SHARD = `${CORPUS_ROOT}/corpus.shard`;
const HNSW_CREATE =
  'CREATE INDEX IF NOT EXISTS idx_embedding_vector ON embedding USING hnsw (vector vector_cosine_ops) WITH (m = 16, ef_construction = 64)';

// Yield to the event loop so the browser can repaint between heavy phases (the
// progress bar updates, and Chrome's "page unresponsive" watchdog resets). The
// single big WASM calls (importShard, HNSW build) still block, but the small
// summaries set keeps each well under the freeze threshold; the bigger content
// load is opt-in. requestAnimationFrame keeps it tied to a paint.
const tick = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const mono = 'var(--font-family-lit-mono)';
const serif = 'var(--font-family-lit-serif)';
const sans = 'var(--font-family-lit-sans)';
const ink = 'var(--color-lit-ink)';
const mute = 'var(--color-lit-ink-mute)';
const rule = 'var(--color-lit-rule)';
const live = 'var(--color-lit-accent-live)';

type Tab = 'search' | 'notes' | 'graph' | 'settings';
type Semantic = 'off' | 'loading' | 'on' | 'error';

// ── spinner (self-contained SVG SMIL; no global keyframes) ───
function Spinner({ size = 14, color = live }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={rule} strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

// ── determinate progress bar (download %) + indeterminate phases ──
function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  return (
    <div style={{ margin: '-12px 0 20px', maxWidth: '70ch' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 12, color: live, marginBottom: 6 }}>
        <Spinner />
        <span>
          {label}
          {pct != null && ` · ${pct}%`}
        </span>
      </div>
      <div style={{ height: 4, background: rule, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: pct != null ? `${pct}%` : '100%',
            background: live,
            opacity: pct != null ? 1 : 0.4,
            transition: 'width 0.2s linear',
          }}
        />
      </div>
    </div>
  );
}

// ── background-job status (note enrichment pipeline) ──
// Live indicator of the jobs queued when a visitor adds a note: how many remain
// and what they're waiting on. useJobQueue refreshes `jobs` every poll, so this
// updates as the worker processes them. Hidden when nothing is queued.
function JobStatusBar({ jobs, llmReady, semanticReady }: { jobs: JobStatus[]; llmReady: boolean; semanticReady: boolean }) {
  const active = jobs.filter((j) => j.status === 'pending' || j.status === 'processing');
  if (active.length === 0) return null;
  const processing = active.filter((j) => j.status === 'processing').length;
  let llmJobs = 0;
  let semanticJobs = 0;
  let otherJobs = 0;
  for (const j of active) {
    if (j.required_capability === 'llm') llmJobs++;
    else if (j.required_capability === 'semantic') semanticJobs++;
    else otherJobs++;
  }
  const parts: string[] = [];
  if (llmJobs) parts.push(`${llmJobs} ${llmReady ? 'tagging & summarizing' : 'waiting on AI'}`);
  if (semanticJobs) parts.push(`${semanticJobs} ${semanticReady ? 'embedding' : 'waiting on embeddings'}`);
  if (otherJobs) parts.push(`${otherJobs} queued`);
  const stalled = (llmJobs && !llmReady) || (semanticJobs && !semanticReady);
  return (
    <div style={{ margin: '-12px 0 20px', maxWidth: '70ch', border: `1px solid ${rule}`, borderLeft: `2px solid ${live}`, background: 'var(--color-lit-bg-deep)', padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 12, color: ink }}>
        {processing > 0 ? <Spinner /> : <span style={{ color: live }}>◷</span>}
        <span>
          Background jobs · <strong>{active.length}</strong> remaining
          {parts.length > 0 && <span style={{ color: mute }}> — {parts.join(' · ')}</span>}
        </span>
      </div>
      {stalled && (
        <div style={{ fontFamily: mono, fontSize: 11, color: mute, marginTop: 4 }}>
          {llmJobs && !llmReady ? 'Enable AI' : ''}
          {llmJobs && !llmReady && semanticJobs && !semanticReady ? ' / ' : ''}
          {semanticJobs && !semanticReady ? 'enable semantic search' : ''}
          {' '}from Capabilities to process these.
        </div>
      )}
    </div>
  );
}

// fetch with streamed download progress (bytes received / Content-Length).
// Falls back to a plain arrayBuffer when the length is unknown.
// ── shard prefetch + warm import (official @fortemi 2026.6.4 prefetchShard API,
// Fortemi/fortemi-react#181) ───────────────────────────────────────────────
// Warm shard bytes on idle so opting into a heavier set is just the (visible,
// progress-tracked) HNSW build — the download wait is gone. `useCacheStorage`
// persists warmth across reloads; concurrent calls for the same url de-dupe, so
// a click that lands mid-prefetch shares the in-flight fetch (no double download).

// Prefetch on idle, best-effort, Save-Data-aware. Never throws.
function prefetchShardsIdle(urls: string[]): void {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData) return;
  const run = () => {
    for (const url of urls) {
      if (isShardPrefetched(url)) continue;
      void prefetchShard(url, { useCacheStorage: true }).catch(() => {
        /* offline / 404 — the opt-in path will warm it on demand */
      });
    }
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

// Bytes ready for importShard: instant when already warm, else a de-duped fetch.
// No download %, but importShard reports the real work (the HNSW build) itself.
async function warmShardBytes(url: string): Promise<Uint8Array> {
  if (isShardPrefetched(url)) return fromPrefetched(url);
  return (await prefetchShard(url, { useCacheStorage: true })).bytes;
}

// ── error boundary ───────────────────────────────────────────
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(e: Error, i: ErrorInfo) {
    console.error('[fortemi] app error:', e, i);
  }
  render() {
    if (this.state.error) {
      return (
        <p style={{ fontFamily: mono, fontSize: 14, color: mute }}>
          The in-browser database failed to start: {this.state.error.message}
        </p>
      );
    }
    return this.props.children;
  }
}

// ── query-embedding worker (off the main thread) ──
// queryEmbed.worker.ts runs the MiniLM model load + every per-query embed off
// the main thread, answering @fortemi/core's official embed transport (#180).
// We register it with registerSemanticCapabilityWorker; here we just spawn it and
// eagerly warm the model (with a progress bar) via the worker's `{type:'load'}`
// side-channel, so enable shows progress instead of a silent first-query stall.
function createEmbedWorker(): Worker {
  return new Worker(new URL('./queryEmbed.worker.ts', import.meta.url), { type: 'module' });
}

function warmEmbedWorker(worker: Worker, report: (label: string, pct: number | null) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as { type?: string; label?: string; pct?: number | null; message?: string };
      if (m?.type === 'progress') {
        report(m.label ?? 'Downloading embedding model', m.pct ?? null);
      } else if (m?.type === 'ready') {
        worker.removeEventListener('message', onMsg);
        resolve();
      } else if (m?.type === 'load-error') {
        worker.removeEventListener('message', onMsg);
        reject(new Error(m.message || 'embedding model failed to load'));
      }
      // embed-protocol responses (kind: 'fortemi:embed:*') are ignored here.
    };
    worker.addEventListener('message', onMsg);
    worker.onerror = (e) => {
      worker.removeEventListener('message', onMsg);
      reject(new Error(e.message || 'embedding worker failed'));
    };
    report('Downloading embedding model (~23 MB)', null);
    worker.postMessage({ type: 'load' });
  });
}

// ── shared bits ──────────────────────────────────────────────
function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: [Tab, string][] = [
    ['search', 'Search'],
    ['notes', 'Notes'],
    ['graph', 'Graph'],
    ['settings', 'Capabilities'],
  ];
  return (
    <div style={{ display: 'flex', gap: '2ch', borderBottom: `1px solid ${rule}`, marginBottom: 24 }}>
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: tab === id ? `2px solid ${ink}` : '2px solid transparent',
            padding: '8px 0',
            marginBottom: -1,
            fontFamily: mono,
            fontSize: 14,
            color: tab === id ? ink : mute,
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Search tab ───────────────────────────────────────────────
function SearchTab({
  ready,
  semantic,
  onEnableSemantic,
  summarySetId,
  contentSetId,
  content,
  onLoadContent,
}: {
  ready: boolean;
  semantic: Semantic;
  onEnableSemantic: () => void;
  summarySetId?: string;
  contentSetId?: string;
  content: Semantic;
  onLoadContent: () => void;
}) {
  const search = useSearch();
  const [query, setQuery] = useState('');
  // Default to the summaries set — it's the one loaded by default. "Content" is
  // an on-demand upgrade (loads the full content set on first selection).
  const [setMode, setSetMode] = useState<'content' | 'summaries'>('summaries');
  const [openId, setOpenId] = useState<string | null>(null);
  const [results, setResults] = useState<SearchDoc[]>([]);
  const [searching, setSearching] = useState(false);
  // Which embedding set hybrid search ranks against. Text mode ignores it.
  // While "Content" is selected but not yet loaded, fall back to the summaries
  // set so results stay sensible until the content index finishes building.
  const activeSetId = setMode === 'content' ? (contentSetId ?? summarySetId) : summarySetId;
  useEffect(() => {
    if (!ready) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          let merged: SearchDoc[];
          if (semantic === 'on') {
            // Hybrid (text + vector via RRF) already handles multi-word recall;
            // over-fetch chunks and collapse to one row per parent document.
            const resp = await search.search(q, { limit: 60, embeddingSetId: activeSetId });
            merged = dedupeDocuments(resp.results, 8);
          } else {
            // Text-only: plainto_tsquery ANDs every term, so multi-word queries
            // miss. OR-combine the terms, then collapse to documents.
            merged = await combinedDocumentSearch(
              (q2, opts) => search.search(q2, { ...opts, mode: 'text' }),
              q,
              8,
            );
          }
          if (!cancelled) setResults(merged);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, ready, semantic, activeSetId]);
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ready ? 'search the corpus…' : 'importing corpus into your browser…'}
          disabled={!ready}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '14px 16px',
            paddingRight: ready ? 16 : 44,
            fontFamily: mono,
            fontSize: 15,
            color: ink,
            background: 'var(--color-lit-bg-deep)',
            border: `1px solid ${rule}`,
          }}
        />
        {!ready && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
            <Spinner color={mute} />
          </span>
        )}
      </div>
      {ready && semantic === 'off' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', flexWrap: 'wrap', margin: '12px 0 0' }}>
          <button
            type="button"
            onClick={onEnableSemantic}
            style={{ fontFamily: mono, fontSize: 12, padding: '5px 14px', border: `1px solid ${ink}`, background: 'transparent', color: ink, cursor: 'pointer', letterSpacing: '0.04em' }}
          >
            Enable semantic search
          </button>
          <span style={{ fontFamily: mono, fontSize: 11, color: mute }}>
            Text search is on now. Semantic adds meaning-based ranking (one-time model load).
          </span>
        </div>
      )}
      {semantic === 'loading' && (
        <p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 12, color: live, margin: '12px 0 0' }}>
          <Spinner /> enabling semantic search…
        </p>
      )}
      {semantic === 'on' && summarySetId && (
        <div style={{ display: 'flex', gap: 0, margin: '12px 0 0', alignItems: 'center' }}>
          {(
            [
              ['summaries', 'AI summaries'],
              ['content', 'Content'],
            ] as const
          ).map(([id, label], i) => {
            const loadingThis = id === 'content' && content === 'loading';
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (id === 'content' && content !== 'on' && content !== 'loading') onLoadContent();
                  setSetMode(id);
                }}
                title={
                  id === 'summaries'
                    ? 'Rank by AI-summary similarity (what each paper is about) — loaded by default'
                    : content === 'on'
                      ? 'Rank by full note content'
                      : 'Load the full content set (~10 MB) and rank by note content'
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5ch',
                  fontFamily: mono,
                  fontSize: 12,
                  padding: '4px 12px',
                  border: `1px solid ${rule}`,
                  borderRight: i === 0 ? 'none' : `1px solid ${rule}`,
                  background: setMode === id ? ink : 'transparent',
                  color: setMode === id ? 'var(--color-lit-bg)' : mute,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                {loadingThis && <Spinner size={11} color={setMode === id ? 'var(--color-lit-bg)' : live} />}
                {label}
                {id === 'content' && content !== 'on' && !loadingThis && <span style={{ opacity: 0.7 }}> ↓</span>}
              </button>
            );
          })}
        </div>
      )}
      <p style={{ fontFamily: mono, fontSize: 12, color: mute, margin: '8px 0 20px' }}>
        {searching
          ? 'searching…'
          : results.length > 0
            ? `${semantic === 'on' ? 'hybrid' : 'text'} mode · ${results.length} document${results.length === 1 ? '' : 's'}`
            : ' '}
        {semantic === 'on' && ` · ${setMode === 'content' && content === 'on' ? 'content' : 'AI summaries'} set`}
        {content === 'loading' && ' · loading content…'}
      </p>
      {results.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => setOpenId(r.id)}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: '70ch',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${rule}`,
            padding: '12px 0',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', gap: '1ch', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: serif, fontSize: 16, color: ink, fontWeight: 500, borderBottom: `1px solid ${rule}` }}>
              {r.displayTitle}
            </span>
            {r.tags?.[0] && <span style={{ fontFamily: mono, fontSize: 11, color: live }}>{r.tags[0]}</span>}
            {r.has_embedding && <span style={{ fontFamily: mono, fontSize: 10, color: mute }}>· vec</span>}
          </div>
          {r.snippet && (
            <div style={{ fontFamily: serif, fontSize: 14, color: mute, marginTop: 4, lineHeight: 1.5 }}>
              {r.snippet.replace(/<\/?[^>]+>/g, '')}
            </div>
          )}
        </button>
      ))}
      {ready && query.trim() && !searching && results.length === 0 && (
        <p style={{ fontFamily: mono, fontSize: 13, color: mute }}>No matches.</p>
      )}
      {openId && <NoteModal noteId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── Notes tab (browse by document + view + add) ──────────────
// Each chunk is a separate note titled "<doc> (part N/M)"; collapse them back
// into one row per source document so the browser is a legible catalog, not a
// wall of chunk-parts. A selected multi-part doc gets a part navigator.
function partNum(title: string | null): number {
  const m = title?.match(/\(part (\d+)\/\d+\)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
function docTitle(title: string | null): string {
  return (title ?? '(untitled)').replace(/\s*\(part \d+\/\d+\)\s*$/, '');
}
// Visitor notes use an opaque unique source (`visitor:<id>`) so each is its own
// single-note document; show a friendly label instead of the raw id.
function displaySource(source: string): string {
  return source.startsWith('visitor:') ? 'your note' : source;
}

function NotesTab({
  ready,
  llmReady,
  onNeedLlm,
  db,
  activeJobs,
  semanticOff,
  onEnableSemantic,
}: {
  ready: boolean;
  llmReady: boolean;
  onNeedLlm: () => void;
  db: DatabaseClient;
  activeJobs: number;
  semanticOff: boolean;
  onEnableSemantic: () => void;
}) {
  // Fetch all chunk-notes so every document groups into the list. The limit caps
  // CHUNKS, not documents — full-doc research is ~11 chunks each, so a low limit
  // drops most documents. 10000 covers the
  // whole corpus with headroom; grouping + pagination happen client-side below.
  const { data, loading, refresh } = useNotes({ limit: 10000, sort: 'created_at', order: 'asc' });
  const create = useCreateNote();
  // While the enrichment pipeline is working, poll so a note's freshly-written
  // title/summary/concepts land in the list (TypingText then types them in).
  useEffect(() => {
    if (activeJobs <= 0) return;
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, [activeJobs, refresh]);
  // Restore the visitor's own notes from a previous session once the corpus is
  // mounted. createNote restores content + the persisted title; we then re-enqueue
  // enrichment with hasTitle=true so the note re-embeds (and re-summarizes/tags)
  // when the capabilities are on — the title is preserved, and the embedding comes
  // back without persisting the raw vector (the query model loads for search
  // anyway, so regenerating one note's vector is effectively free).
  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const stored = loadStoredNotes();
    (async () => {
      for (const n of stored) {
        try {
          const c = await create.createNote({ content: n.content, title: n.title ?? undefined, source: n.source, tags: n.tags });
          await enqueueNoteCreationJobs(db, c.id, true);
        } catch {
          /* skip any note that fails to restore */
        }
      }
      // useNotes mounts before the shard import finishes when Notes was the
      // upgrade intent. Refresh even when there are no visitor notes to restore
      // so the newly imported corpus replaces that initial empty result.
      await refresh();
      // The visitor had embeddings last time — turn semantic back on so their
      // restored notes re-embed and are searchable again (the query model is
      // browser-cached after the first download, so this return is fast).
      if (stored.length > 0 && semanticOff) onEnableSemantic();
    })();
  }, [ready]);
  // Keep stored titles current as enrichment writes them in (so a return visit
  // shows the AI title, not "(untitled)").
  useEffect(() => {
    for (const n of data?.items ?? []) {
      if (n.source.startsWith('visitor:')) setStoredNoteTitle(n.source, n.title);
    }
  }, [data]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState('');
  const [offerLlm, setOfferLlm] = useState(false);
  const [reran, setReran] = useState(false);
  const PAGE_SIZE = 25;

  // Group notes into documents by `source`, parts ordered within each doc.
  const documents = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const n of data?.items ?? []) {
      const arr = map.get(n.source);
      if (arr) arr.push(n);
      else map.set(n.source, [n]);
    }
    const docs = [...map.entries()].map(([source, parts]) => {
      parts.sort((a, b) => partNum(a.title) - partNum(b.title));
      const isVisitor = source.startsWith('visitor:');
      // Newest-first among the user's own notes so a just-added one lands at the
      // very top, where they can watch the agent write its title/summary in.
      const added = parts[0].created_at ? new Date(parts[0].created_at).getTime() : 0;
      return { source, parts, title: docTitle(parts[0].title), isVisitor, added };
    });
    docs.sort((a, b) => {
      // The visitor's own notes pin to the top (newest first); the corpus follows,
      // alphabetical as before.
      if (a.isVisitor !== b.isVisitor) return a.isVisitor ? -1 : 1;
      if (a.isVisitor && b.isVisitor) return b.added - a.added;
      return a.title.localeCompare(b.title);
    });
    return docs;
  }, [data]);

  if (!ready)
    return (
      <p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: mute }}>
        <Spinner color={mute} />
        Importing corpus into your browser…
      </p>
    );

  const selectedDoc = documents.find((d) => d.source === selectedSource) ?? null;
  const pageCount = Math.max(1, Math.ceil(documents.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageDocs = documents.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 24 }}>
      <div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const content = draft.trim();
            if (!content) return;
            // Unique source per note → each visitor note is its own single-note
            // document (a shared 'visitor' source collapses them into one
            // multi-part doc with bogus part navigation).
            const created = await create.createNote({
              content,
              source: `visitor:${generateId()}`,
              tags: ['visitor-note'],
            });
            // Persist it so it's restored on a return visit (title is updated as
            // enrichment writes it — see the title-sync effect).
            upsertStoredNote({
              source: created.source,
              content,
              title: created.title ?? null,
              tags: ['visitor-note'],
              createdAt: new Date().toISOString(),
            });
            // Queue the enrichment pipeline (title, concept tags, AI summary,
            // embedding, linking). The job worker (useJobQueue, in the workspace)
            // processes them; LLM-dependent jobs run once a model is configured,
            // otherwise they defer (#143) and run when one is enabled.
            await enqueueNoteCreationJobs(db, created.id, false);
            // Adding a note auto-enables semantic search (like enabling AI does),
            // so the note's embedding job can run and the note becomes
            // semantically searchable. Free in-browser model; the progress bar
            // discloses the one-time download. No-op if already on/loading.
            if (semanticOff) onEnableSemantic();
            setDraft('');
            await refresh();
            if (!llmReady) setOfferLlm(true);
          }}
          style={{ marginBottom: 16 }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="add your own note to the local archive…"
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              fontFamily: serif,
              fontSize: 14,
              background: 'var(--color-lit-bg-deep)',
              border: `1px solid ${rule}`,
              color: ink,
              resize: 'vertical',
            }}
          />
          <button
            type="submit"
            style={{
              marginTop: 8,
              padding: '6px 14px',
              fontFamily: mono,
              fontSize: 13,
              background: 'transparent',
              border: `1px solid ${rule}`,
              color: ink,
              cursor: 'pointer',
            }}
          >
            Add note
          </button>
        </form>
        {documents.some((d) => d.isVisitor) && (
          <div style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={async () => {
                // Re-queue the full enrichment pipeline (title, concepts, summary,
                // embedding, linking) for every note the visitor added — useful
                // after enabling AI, or to refresh. Turn the needed capabilities on
                // so the jobs actually run.
                const ids = documents.filter((d) => d.isVisitor).flatMap((d) => d.parts.map((p) => p.id));
                for (const id of ids) {
                  try {
                    await enqueueNoteCreationJobs(db, id, false);
                  } catch {
                    /* skip a note that fails to enqueue */
                  }
                }
                if (semanticOff) onEnableSemantic();
                if (!llmReady) setOfferLlm(true);
                setReran(true);
                window.setTimeout(() => setReran(false), 3000);
                await refresh();
              }}
              style={{ padding: '5px 12px', fontFamily: mono, fontSize: 12, background: 'transparent', color: ink, border: `1px solid ${rule}`, cursor: 'pointer' }}
            >
              Re-run enrichment on your notes
            </button>
            {reran && <span style={{ fontFamily: mono, fontSize: 11, color: live }}>re-queued ✓</span>}
          </div>
        )}
        {offerLlm && !llmReady && (
          <div
            style={{
              border: `1px solid ${rule}`,
              borderLeft: `2px solid ${live}`,
              background: 'var(--color-lit-bg-deep)',
              padding: '10px 12px',
              marginBottom: 16,
            }}
          >
            <p style={{ fontFamily: serif, fontSize: 13, color: ink, lineHeight: 1.5, margin: '0 0 8px' }}>
              Want AI to tag concepts and draft a title for your notes? It needs a language model.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setOfferLlm(false);
                  onNeedLlm();
                }}
                style={{ padding: '5px 12px', fontFamily: mono, fontSize: 12, background: ink, color: 'var(--color-lit-bg)', border: `1px solid ${ink}`, cursor: 'pointer' }}
              >
                Enable AI
              </button>
              <button
                type="button"
                onClick={() => setOfferLlm(false)}
                style={{ padding: '5px 12px', fontFamily: mono, fontSize: 12, background: 'transparent', color: mute, border: `1px solid ${rule}`, cursor: 'pointer' }}
              >
                Not now
              </button>
            </div>
          </div>
        )}
        {/* Only on the first load — background refreshes (while the pipeline runs)
            must not flash "loading…" on every poll. */}
        {loading && !data?.items?.length && (
          <p style={{ fontFamily: mono, fontSize: 13, color: mute }}>loading…</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {pageDocs.map((d) => (
            <li key={d.source}>
              <button
                type="button"
                onClick={() => setSelectedSource(d.source)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 0 8px 10px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${rule}`,
                  borderLeft: selectedSource === d.source ? `2px solid ${ink}` : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    fontFamily: serif,
                    fontSize: 14,
                    color: ink,
                    fontWeight: selectedSource === d.source ? 600 : 400,
                    lineHeight: 1.35,
                  }}
                >
                  {/* The user's own notes type their AI title in as it lands;
                      corpus titles are stable, so render them plainly. */}
                  {d.isVisitor ? <TypingText text={d.title} /> : d.title}
                  {d.parts.length > 1 && (
                    <span style={{ fontFamily: mono, fontSize: 11, color: mute, fontWeight: 400 }}> · {d.parts.length} parts</span>
                  )}
                </span>
                <span style={{ display: 'block', fontFamily: mono, fontSize: 11, color: mute, marginTop: 2 }}>
                  {displaySource(d.source)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', marginTop: 12, fontFamily: mono, fontSize: 12, color: mute }}>
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage(safePage - 1)}
              style={{ background: 'transparent', border: `1px solid ${rule}`, color: safePage <= 0 ? rule : ink, cursor: safePage <= 0 ? 'default' : 'pointer', padding: '2px 8px', fontFamily: mono, fontSize: 12 }}
            >
              ‹ prev
            </button>
            <span>
              page {safePage + 1} / {pageCount} · {documents.length} docs
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              style={{ background: 'transparent', border: `1px solid ${rule}`, color: safePage >= pageCount - 1 ? rule : ink, cursor: safePage >= pageCount - 1 ? 'default' : 'pointer', padding: '2px 8px', fontFamily: mono, fontSize: 12 }}
            >
              next ›
            </button>
          </div>
        )}
      </div>
      <div style={{ borderLeft: `1px solid ${rule}`, paddingLeft: 24, minHeight: 200 }}>
        {selectedDoc ? (
          <NoteViewer
            noteId={selectedDoc.parts[0].id}
            parts={selectedDoc.parts.map((p) => ({ id: p.id, title: p.title ?? null }))}
          />
        ) : (
          <p style={{ fontFamily: mono, fontSize: 13, color: mute }}>Select a document to read it.</p>
        )}
      </div>
    </div>
  );
}

// ── Capabilities tab ─────────────────────────────────────────
function SettingsTab({
  semantic,
  semanticMsg,
  onEnableSemantic,
  llmOn,
  llmConfig,
  savedLocalPending,
  onOpenLlm,
  onDisableLlm,
}: {
  semantic: Semantic;
  semanticMsg: string;
  onEnableSemantic: () => void;
  llmOn: boolean;
  llmConfig: LlmConfig | null;
  savedLocalPending: boolean;
  onOpenLlm: () => void;
  onDisableLlm: () => void;
}) {
  const gpu = useGpuCapabilities();
  const llmLabel =
    llmConfig?.kind === 'remote'
      ? `${llmConfig.label ?? llmConfig.preset} · ${llmConfig.model}`
      : llmConfig?.kind === 'local'
        ? 'local in-browser model'
        : '';
  return (
    <div style={{ maxWidth: '64ch' }}>
      <h3 style={{ fontFamily: sans, fontSize: 18, color: ink, margin: '0 0 12px' }}>Semantic search</h3>
      <p style={{ fontFamily: serif, fontSize: 15, color: mute, lineHeight: 1.6, margin: '0 0 16px' }}>
        Full-text search works immediately, no setup. Semantic search is opt-in: enabling it downloads a
        ~23 MB embedding model (all-MiniLM-L6-v2) and the default summary vectors (one per document), and
        builds a small index — all in your browser, nothing leaves the page. From the Search tab you can
        then load the full per-passage content set (~10 MB) for deeper ranking.
      </p>
      {semantic === 'off' && (
        <button
          type="button"
          onClick={onEnableSemantic}
          style={{
            padding: '8px 16px',
            fontFamily: mono,
            fontSize: 14,
            background: 'transparent',
            border: `1px solid ${ink}`,
            color: ink,
            cursor: 'pointer',
          }}
        >
          Enable semantic search
        </button>
      )}
      {semantic === 'loading' && (
        <p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: live }}>
          <Spinner /> {semanticMsg || 'Enabling semantic search…'}
        </p>
      )}
      {semantic === 'on' && (
        <p style={{ fontFamily: mono, fontSize: 13, color: live }}>
          ✓ Semantic search active — queries now run hybrid (full-text + vector).
        </p>
      )}
      {semantic === 'error' && (
        <div>
          <p style={{ fontFamily: mono, fontSize: 13, color: mute, margin: '0 0 8px' }}>
            Couldn’t enable semantic: {semanticMsg}
          </p>
          <button
            type="button"
            onClick={onEnableSemantic}
            style={{ padding: '8px 16px', fontFamily: mono, fontSize: 14, background: 'transparent', border: `1px solid ${ink}`, color: ink, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      <h3 style={{ fontFamily: sans, fontSize: 18, color: ink, margin: '32px 0 12px' }}>AI features (language model)</h3>
      <p style={{ fontFamily: serif, fontSize: 15, color: mute, lineHeight: 1.6, margin: '0 0 16px' }}>
        Off by default. A language model adds note concept-tagging, title generation, and summaries.
        Run one in your browser (a one-time download) or connect an OpenAI-compatible endpoint. Search
        works fine without it. Enabling AI also turns on semantic search if it isn’t already — a one-time
        ~23 MB embedding model plus the summary vectors — so a note you add gets fully processed
        (summary, concepts, and its own vector).
      </p>
      {llmOn ? (
        <div>
          <p style={{ fontFamily: mono, fontSize: 13, color: live, margin: '0 0 10px' }}>✓ AI active — {llmLabel}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onOpenLlm}
              style={{ padding: '6px 14px', fontFamily: mono, fontSize: 13, background: 'transparent', border: `1px solid ${rule}`, color: ink, cursor: 'pointer' }}
            >
              Change
            </button>
            <button
              type="button"
              onClick={onDisableLlm}
              style={{ padding: '6px 14px', fontFamily: mono, fontSize: 13, background: 'transparent', border: `1px solid ${rule}`, color: mute, cursor: 'pointer' }}
            >
              Turn off{llmConfig?.kind === 'remote' ? ' & forget key' : ''}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={onOpenLlm}
            style={{ padding: '8px 16px', fontFamily: mono, fontSize: 14, background: 'transparent', border: `1px solid ${ink}`, color: ink, cursor: 'pointer' }}
          >
            {savedLocalPending ? 'Resume local model' : 'Enable AI features'}
          </button>
          {savedLocalPending && (
            <p style={{ fontFamily: mono, fontSize: 12, color: mute, margin: '8px 0 0' }}>
              You enabled a local model before — it’s cached, so this just loads it back.
            </p>
          )}
        </div>
      )}

      <h3 style={{ fontFamily: sans, fontSize: 18, color: ink, margin: '32px 0 12px' }}>Hardware</h3>
      <p style={{ fontFamily: mono, fontSize: 13, color: mute, lineHeight: 1.7 }}>
        WebGPU:{' '}
        {gpu.isDetecting
          ? 'detecting…'
          : gpu.caps
            ? gpu.caps.webgpuAvailable
              ? `available${gpu.caps.vendor ? ` · ${gpu.caps.vendor}` : ''}`
              : 'not available (semantic still works on CPU/WASM)'
            : 'unknown'}
        {gpu.vramTier && gpu.vramTier !== 'unknown' ? ` · VRAM tier: ${gpu.vramTier}` : ''}
      </p>
    </div>
  );
}

// ── orchestrator inside the provider ─────────────────────────
function FortemiWorkspace({
  initialTab = 'search',
  autoSemantic = false,
  openLlm = false,
}: {
  initialTab?: Tab;
  autoSemantic?: boolean;
  openLlm?: boolean;
}) {
  const { db, capabilityManager } = useFortemiContext();
  // Run the job-queue worker for the full-app session: registers the pipeline
  // handlers (title, concept tags, AI revision, embedding, linking) and processes
  // jobs enqueued on note creation. LLM/semantic jobs gate on their capability.
  const { jobs } = useJobQueue(2500);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [semantic, setSemantic] = useState<Semantic>('off');
  const [semanticMsg, setSemanticMsg] = useState('');
  const [semanticPct, setSemanticPct] = useState<number | null>(null);
  const [mountMsg, setMountMsg] = useState('Downloading the corpus…');
  const [mountPct, setMountPct] = useState<number | null>(null);
  // The full "Full content" set (~3,149 vectors) is loaded on demand when the
  // user picks "Content" search — separate from the default summaries set.
  const [content, setContent] = useState<Semantic>('off');
  const [contentMsg, setContentMsg] = useState('');
  const [contentPct, setContentPct] = useState<number | null>(null);
  // LLM (off by default; opt-in via the modal). The model/library are only
  // fetched when the user explicitly enables — see llmSetup.ts.
  const [llmOn, setLlmOn] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmConfig | null>(null);
  const [savedLocalPending, setSavedLocalPending] = useState(false);
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const llmRestored = useRef(false);
  const embedWorkerRef = useRef<Worker | null>(null);
  useEffect(() => () => embedWorkerRef.current?.terminate(), []);
  const report = (label: string, pct: number | null) => {
    setSemanticMsg(label);
    setSemanticPct(pct);
  };
  const started = useRef(false);

  // notes-first import for fast text search
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const bytes = await warmShardBytes(NOTES_SHARD);
        setMountMsg('Importing corpus…');
        const r = await importShard(db, bytes, {
          onProgress: (p) => {
            setMountMsg(`Importing corpus · ${p.phase}`);
            setMountPct(p.total ? Math.round((p.done / p.total) * 100) : null);
          },
        });
        if (!r.success) throw new Error(r.errors.join('; ') || 'import failed');
        setReady(true);
        // Text search is live; warm the summary vectors in the background so the
        // "Enable semantic" click is just the HNSW build, not a download wait.
        prefetchShardsIdle([SUMMARIES_SHARD]);
      } catch (e) {
        setLoadErr((e as Error).message);
      }
    })();
  }, [db]);

  // Arrived here via an upgrade from the reader shell (ReaderShell → FortemiApp):
  // honor the intent once the corpus is imported — auto-enable semantic and/or
  // open the LLM modal so the user lands where they clicked, no second click.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!ready || autoRan.current) return;
    autoRan.current = true;
    if (openLlm) setLlmModalOpen(true);
    if (autoSemantic && semantic === 'off') void enableSemantic();
  }, [ready]);

  // Opt-in (not automatic). Default semantic = the small summaries set: download
  // the summaries shard (notes skip + ~363 vectors), build a tiny HNSW, load the
  // query-embedding model. Each phase yields so the UI keeps painting; the small
  // set keeps the blocking calls well under the freeze threshold.
  async function enableSemantic() {
    setSemantic('loading');
    try {
      await db.exec('DROP INDEX IF EXISTS idx_embedding_vector');
      await tick();
      report('Downloading summary vectors…', null);
      const buf = await warmShardBytes(SUMMARIES_SHARD); // instant when idle-prefetched
      await tick();
      report('Importing summary vectors…', null);
      const r = await importShard(db, buf, {
        conflictStrategy: 'skip',
        // #147: per-phase progress + cooperative yielding inside the import.
        onProgress: (p) =>
          report(`Importing summary vectors · ${p.phase}`, p.total ? Math.round((p.done / p.total) * 100) : null),
      });
      if (!r.success) throw new Error(r.errors.join('; ') || 'summary import failed');
      await tick();
      report('Building semantic index…', null);
      await db.exec(HNSW_CREATE);
      await tick();
      // Off-thread query embedding via the official worker transport (#180):
      // spawn + eagerly warm the model (with progress), then register the
      // worker-backed 'semantic' capability and enable it (useSearch checks
      // isReady('semantic') to flip queries to hybrid mode). This also moves the
      // job-queue embedding handler off-thread (wired at the get/setEmbedFunction seam).
      const worker = createEmbedWorker();
      embedWorkerRef.current?.terminate();
      embedWorkerRef.current = worker;
      await warmEmbedWorker(worker, report);
      registerSemanticCapabilityWorker(capabilityManager, worker);
      await capabilityManager.enable('semantic');
      setSemantic('on');
      // Likely next opt-in is the full content set — warm its bytes on idle.
      prefetchShardsIdle([FULL_SHARD]);
    } catch (e) {
      setSemanticMsg((e as Error).message);
      setSemantic('error');
    }
  }

  // On demand: add the full "Full content" set (~3,149 chunk vectors) — heavier
  // import + HNSW rebuild, so it only runs when the user selects "Content".
  async function loadContent() {
    if (content === 'loading' || content === 'on') return;
    setContent('loading');
    try {
      await db.exec('DROP INDEX IF EXISTS idx_embedding_vector');
      await tick();
      setContentMsg('Downloading full content vectors…');
      setContentPct(null);
      const buf = await warmShardBytes(FULL_SHARD); // instant when idle-prefetched
      await tick();
      setContentMsg('Importing content vectors…');
      setContentPct(null);
      const r = await importShard(db, buf, {
        conflictStrategy: 'skip',
        onProgress: (p) => {
          setContentMsg(`Importing content vectors · ${p.phase}`);
          setContentPct(p.total ? Math.round((p.done / p.total) * 100) : null);
        },
      });
      if (!r.success) throw new Error(r.errors.join('; ') || 'content import failed');
      await tick();
      setContentMsg('Rebuilding semantic index…');
      await db.exec(HNSW_CREATE);
      await tick();
      await refreshSets();
      setContent('on');
    } catch (e) {
      setContentMsg((e as Error).message);
      setContent('error');
    }
  }

  // Re-apply a previously-chosen LLM. Remote endpoints re-attach silently (no
  // download). A saved LOCAL model is NOT auto-loaded — we don't pull the heavy
  // web-llm chunk on every visit; we offer a one-click "Resume" instead.
  useEffect(() => {
    if (llmRestored.current) return;
    llmRestored.current = true;
    const saved = loadLlmConfig();
    if (!saved) return;
    if (saved.kind === 'remote') {
      void enableRemoteLlm(capabilityManager, saved)
        .then(() => {
          setLlmConfig(saved);
          setLlmOn(true);
        })
        .catch(() => {
          // endpoint unreachable now — keep the config so the user can retry or
          // forget it from Capabilities, but leave the capability off.
          setLlmConfig(saved);
        });
    } else {
      setLlmConfig(saved);
      setSavedLocalPending(true);
    }
  }, [capabilityManager]);

  // Embedding sets arrive with their shards: the "AI summaries" set when the
  // user enables semantic, the "Full content" set when they load content. The
  // mount DB (notes-only) has none, so refresh after each comes on.
  const { embeddingSets, refresh: refreshSets } = useEmbeddingSets();
  useEffect(() => {
    if (semantic === 'on') void refreshSets();
  }, [semantic, refreshSets]);
  const summarySetId = embeddingSets.find((s) => s.name === 'AI summaries')?.id;
  const contentSetId = embeddingSets.find((s) => s.name === 'Full content')?.id;

  if (loadErr) {
    return (
      <p style={{ fontFamily: mono, fontSize: 14, color: mute }}>Couldn’t load the corpus: {loadErr}</p>
    );
  }

  return (
    <>
      <TabBar tab={tab} setTab={setTab} />
      <JobStatusBar jobs={jobs} llmReady={llmOn} semanticReady={semantic === 'on'} />
      {semantic === 'loading' && <ProgressBar pct={semanticPct} label={semanticMsg || 'Enabling semantic search…'} />}
      {semantic === 'error' && (
        <p style={{ margin: '-12px 0 20px', fontFamily: mono, fontSize: 12, color: mute }}>
          Semantic search unavailable ({semanticMsg}) — full-text search still works.
        </p>
      )}
      {content === 'loading' && <ProgressBar pct={contentPct} label={contentMsg || 'Loading full content…'} />}
      {content === 'error' && (
        <p style={{ margin: '-12px 0 20px', fontFamily: mono, fontSize: 12, color: mute }}>
          Content set unavailable ({contentMsg}) — summary search still works.
        </p>
      )}
      {tab === 'search' && (
        <SearchTab
          ready={ready}
          semantic={semantic}
          onEnableSemantic={enableSemantic}
          summarySetId={summarySetId}
          contentSetId={contentSetId}
          content={content}
          onLoadContent={loadContent}
        />
      )}
      {tab === 'notes' && (
        <NotesTab
          ready={ready}
          llmReady={llmOn}
          onNeedLlm={() => setLlmModalOpen(true)}
          db={db}
          activeJobs={jobs.filter((j) => j.status === 'pending' || j.status === 'processing').length}
          semanticOff={semantic === 'off'}
          onEnableSemantic={() => void enableSemantic()}
        />
      )}
      {tab === 'graph' && <GraphView ready={ready} summarySetId={summarySetId} db={db} />}
      {tab === 'settings' && (
        <SettingsTab
          semantic={semantic}
          semanticMsg={semanticMsg}
          onEnableSemantic={enableSemantic}
          llmOn={llmOn}
          llmConfig={llmConfig}
          savedLocalPending={savedLocalPending}
          onOpenLlm={() => setLlmModalOpen(true)}
          onDisableLlm={() => {
            disableLlm(capabilityManager);
            setLlmOn(false);
            setLlmConfig(null);
            setSavedLocalPending(false);
          }}
        />
      )}
      {!ready && !loadErr && (
        <div style={{ marginTop: 24 }}>
          <ProgressBar pct={mountPct} label={mountMsg} />
        </div>
      )}
      <LlmSetupModal
        open={llmModalOpen}
        onClose={() => setLlmModalOpen(false)}
        manager={capabilityManager}
        savedLocal={savedLocalPending}
        onEnabled={(cfg) => {
          setLlmConfig(cfg);
          setLlmOn(true);
          setSavedLocalPending(false);
          setLlmModalOpen(false);
          // AI note-enrichment also embeds each note, which needs the semantic
          // capability — turn it on too (loads the embedding model + vectors, with
          // a progress bar) so a note gets fully processed: summary, concepts, and
          // vector. No-op if semantic is already on.
          if (semantic === 'off') void enableSemantic();
        }}
      />
    </>
  );
}

export default function FortemiApp() {
  // Reader-first (magly.net #12): the default sub-app runs zero-PGlite over the
  // notes shard (browse + text search + graph). PGlite mounts only when the user
  // opts into something that needs it — semantic search, adding notes, or AI —
  // at which point we swap in the full workspace and honor the upgrade intent.
  const [upgrade, setUpgrade] = useState<UpgradeIntent | null>(null);

  if (!upgrade) return <ReaderShell onUpgrade={setUpgrade} />;

  return (
    <Boundary>
      <Suspense
        fallback={
          <p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: mute }}>
            <Spinner color={mute} />
            Starting the in-browser database…
          </p>
        }
      >
        {/* executionMode="worker" (@fortemi 2026.6.1, Fortemi/fortemi-react#146)
            runs PGlite + the HNSW build in a Web Worker, off the main thread —
            the structural fix for the import freeze.
            persistence="memory": the corpus is re-imported per session (fast —
            the shard BYTES are cached, only the in-RAM build re-runs). We do NOT
            persist the whole DB to idb/opfs — PGlite serializes every write, so a
            persisted corpus import crawls (idb especially). The visitor's OWN
            notes are persisted separately + restored on mount (visitorNotes.ts),
            which is what "leave a note and come back" actually needs. */}
        <FortemiProvider persistence="memory" archiveName="fortemi-knowledge-workspace" executionMode="worker">
          <FortemiWorkspace initialTab={upgrade.tab} autoSemantic={upgrade.autoSemantic} openLlm={upgrade.openLlm} />
        </FortemiProvider>
      </Suspense>
    </Boundary>
  );
}
