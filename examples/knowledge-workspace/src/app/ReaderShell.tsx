// src/components/fortemi/ReaderShell.tsx
//
// Zero-PGlite default for the /fortemi sub-app (magly.net #12, @fortemi 2026.6.5
// openShard/useShard). Browse + full-text search + the relationship graph all run
// in place over corpus.notes.shard with NO database. Anything that needs the full
// local PGlite archive — semantic search, adding your own notes, AI enrichment —
// calls onUpgrade(), and FortemiApp swaps in the full PGlite workspace (unchanged).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShard } from '@fortemi/react';
import type { ShardReader, ShardReaderNote } from '@fortemi/core';
import { ShardNoteModal, ShardNoteViewer } from './ShardNoteModal';
import { GraphView } from './GraphView';
import { dedupeDocuments, documentTitle } from './dedupeDocuments';
import { loadStoredNotes, type StoredVisitorNote } from './visitorNotes';
import { Spinner } from './Spinner';

const NOTES_SHARD = `${import.meta.env.BASE_URL}fortemi-corpus/corpus.notes.shard`;

const mono = 'var(--font-family-lit-mono)';
const sans = 'var(--font-family-lit-sans)';
const serif = 'var(--font-family-lit-serif)';
const ink = 'var(--color-lit-ink)';
const mute = 'var(--color-lit-ink-mute)';
const rule = 'var(--color-lit-rule)';
const live = 'var(--color-lit-accent-live)';

export type Tab = 'search' | 'notes' | 'graph' | 'settings';
/** What the user wanted when they triggered the upgrade to the full PGlite app. */
export type UpgradeIntent = { tab: Tab; autoSemantic?: boolean; openLlm?: boolean };

type DocRow = { id: string; title: string | null; snippet?: string; tags?: string[]; displayTitle: string; userNote?: StoredVisitorNote };
// A browse-list document: either a corpus doc (shard `parts`) or one of the
// visitor's own notes (`userNote`, read from localStorage in the no-DB reader).
type ReaderDoc = { source: string; title: string; isUser: boolean; parts?: ShardReaderNote[]; userNote?: StoredVisitorNote };

function partNum(title: string | null): number {
  const m = title?.match(/\(part (\d+)\/\d+\)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
function stripTags(s: string): string {
  return s.replace(/<\/?[^>]+>/g, '');
}

// ── Visitor's own notes (kept in localStorage; read in the no-DB reader) ──
// The reader reads the corpus shard, which doesn't contain the visitor's notes —
// so we merge them in from localStorage here. This is the "read is fast" half of
// the story: a note you wrote with the AI tools shows up instantly in the no-DB
// browse + search alongside the corpus, no database to load.
function userNoteTitle(n: StoredVisitorNote): string {
  const t = (n.title ?? '').trim();
  if (t) return t.replace(/\s*\(part \d+\/\d+\)\s*$/, '');
  return n.content.split('\n')[0].slice(0, 80).trim() || '(untitled)';
}
function matchStoredNotes(q: string): StoredVisitorNote[] {
  const needle = q.toLowerCase();
  return loadStoredNotes().filter(
    (n) => n.content.toLowerCase().includes(needle) || (n.title ?? '').toLowerCase().includes(needle),
  );
}
function userSnippet(content: string, q: string): string {
  const i = content.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return content.slice(0, 160) + (content.length > 160 ? '…' : '');
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + content.slice(start, start + 160) + (start + 160 < content.length ? '…' : '');
}

function UserNoteViewer({ note }: { note: StoredVisitorNote }) {
  return (
    <div>
      <h3 style={{ fontFamily: serif, fontSize: 22, color: ink, margin: '0 0 6px', lineHeight: 1.2 }}>{userNoteTitle(note)}</h3>
      <div style={{ fontFamily: mono, fontSize: 12, color: mute, marginBottom: 16 }}>your note</div>
      <div className="fortemi-md" style={{ fontFamily: serif, fontSize: 15, color: ink, lineHeight: 1.7 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
      </div>
    </div>
  );
}

function UserNoteModal({ note, onClose }: { note: StoredVisitorNote; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '7vh 16px 16px', overflowY: 'auto' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, background: 'var(--color-lit-bg)', border: `1px solid ${rule}`, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', padding: '28px 28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: mute, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4, marginTop: -8 }}>×</button>
        </div>
        <UserNoteViewer note={note} />
      </div>
    </div>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: [Tab, string][] = [
    ['search', 'Search'],
    ['notes', 'Notes'],
    ['graph', 'Graph'],
    ['settings', 'Capabilities'],
  ];
  return (
    <div style={{ display: 'flex', gap: '2ch', borderBottom: `1px solid ${rule}`, marginBottom: 20 }}>
      {tabs.map(([id, label]) => (
        <button key={id} type="button" onClick={() => setTab(id)} style={{ background: 'transparent', border: 'none', borderBottom: tab === id ? `2px solid ${ink}` : '2px solid transparent', padding: '8px 0', marginBottom: -1, fontFamily: mono, fontSize: 14, color: tab === id ? ink : mute, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Search (reader, text-only) ───────────────────────────────
function SearchTab({ reader, onUpgrade }: { reader: ShardReader; onUpgrade: (i: UpgradeIntent) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<StoredVisitorNote | null>(null);

  useEffect(() => {
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
          const r = await reader.search(q, { rank: true, snippets: true, limit: 60 });
          const snip = new Map((r.rankedItems ?? []).map((ri) => [ri.note.id, ri.snippet]));
          const shardRows: DocRow[] = dedupeDocuments(r.items, 8).map((n) => ({ id: n.id, title: n.title, displayTitle: n.displayTitle, tags: n.tags, snippet: snip.get(n.id) }));
          // Merge the visitor's own notes (from localStorage) — first, so they're
          // easy to find. Text-matched locally; no database.
          const userRows: DocRow[] = matchStoredNotes(q).map((n) => ({ id: n.source, title: n.title, displayTitle: userNoteTitle(n), tags: ['your note'], snippet: userSnippet(n.content, q), userNote: n }));
          if (!cancelled) setResults([...userRows, ...shardRows]);
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
  }, [query, reader]);

  return (
    <div>
      <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search the corpus…" style={{ width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontFamily: mono, fontSize: 15, color: ink, background: 'var(--color-lit-bg-deep)', border: `1px solid ${rule}` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', flexWrap: 'wrap', margin: '12px 0 0' }}>
        <button type="button" onClick={() => onUpgrade({ tab: 'search', autoSemantic: true })} style={{ fontFamily: mono, fontSize: 12, padding: '5px 14px', border: `1px solid ${ink}`, background: 'transparent', color: ink, cursor: 'pointer', letterSpacing: '0.04em' }}>
          Enable semantic search
        </button>
        <span style={{ fontFamily: mono, fontSize: 11, color: mute }}>Text search is instant, no database. Semantic adds meaning-based ranking (loads the local engine).</span>
      </div>
      <p style={{ fontFamily: mono, fontSize: 12, color: mute, margin: '8px 0 20px' }}>
        {searching ? 'searching…' : results.length > 0 ? `text mode · ${results.length} document${results.length === 1 ? '' : 's'}` : ' '}
      </p>
      {results.map((r) => (
        <button key={r.id} type="button" onClick={() => (r.userNote ? setOpenUser(r.userNote) : setOpenId(r.id))} style={{ display: 'block', width: '100%', maxWidth: '70ch', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${rule}`, padding: '12px 0', cursor: 'pointer' }}>
          <div style={{ display: 'flex', gap: '1ch', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: serif, fontSize: 16, color: ink, fontWeight: 500, borderBottom: `1px solid ${rule}` }}>{r.displayTitle}</span>
            {r.tags?.[0] && <span style={{ fontFamily: mono, fontSize: 11, color: live }}>{r.tags[0]}</span>}
          </div>
          {r.snippet && <div style={{ fontFamily: serif, fontSize: 14, color: mute, marginTop: 4, lineHeight: 1.5 }}>{stripTags(r.snippet)}</div>}
        </button>
      ))}
      {query.trim() && !searching && results.length === 0 && <p style={{ fontFamily: mono, fontSize: 13, color: mute }}>No matches.</p>}
      {openId && <ShardNoteModal reader={reader} noteId={openId} onClose={() => setOpenId(null)} />}
      {openUser && <UserNoteModal note={openUser} onClose={() => setOpenUser(null)} />}
    </div>
  );
}

// ── Notes (reader browse; add/AI upgrade to the full archive) ──
function NotesTab({ reader, onUpgrade }: { reader: ShardReader; onUpgrade: (i: UpgradeIntent) => void }) {
  const [all, setAll] = useState<ShardReaderNote[] | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await reader.listNotes({ limit: 100000 });
      if (alive) setAll(r.items);
    })();
    return () => {
      alive = false;
    };
  }, [reader]);

  const documents = useMemo<ReaderDoc[]>(() => {
    const map = new Map<string, ShardReaderNote[]>();
    for (const n of all ?? []) {
      const src = (n as { source?: string }).source ?? n.id;
      const arr = map.get(src);
      if (arr) arr.push(n);
      else map.set(src, [n]);
    }
    const corpus: ReaderDoc[] = [...map.entries()]
      .map(([source, parts]) => {
        parts.sort((a, b) => partNum(a.title) - partNum(b.title));
        return { source, parts, title: documentTitle(parts[0].title), isUser: false };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    // The visitor's own notes (localStorage), newest first, pinned to the top —
    // the same notes the full PGlite app shows, here in the no-DB reader.
    const userDocs: ReaderDoc[] = loadStoredNotes()
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .map((n) => ({ source: n.source, title: userNoteTitle(n), isUser: true, userNote: n }));
    return [...userDocs, ...corpus];
  }, [all]);

  if (!all) return <p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: mute }}><Spinner color={mute} /> opening the corpus…</p>;

  const selected = documents.find((d) => d.source === selectedSource) ?? null;
  const pageCount = Math.max(1, Math.ceil(documents.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageDocs = documents.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 24 }}>
      <div>
        <div style={{ border: `1px solid ${rule}`, borderLeft: `2px solid ${live}`, background: 'var(--color-lit-bg-deep)', padding: '10px 12px', marginBottom: 16 }}>
          <p style={{ fontFamily: serif, fontSize: 13, color: ink, lineHeight: 1.5, margin: '0 0 8px' }}>Add your own notes — and let AI tag concepts and draft titles — in the full local archive (loads the in-browser database).</p>
          <button type="button" onClick={() => onUpgrade({ tab: 'notes' })} style={{ padding: '5px 12px', fontFamily: mono, fontSize: 12, background: ink, color: 'var(--color-lit-bg)', border: `1px solid ${ink}`, cursor: 'pointer' }}>Open the full archive</button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {pageDocs.map((d) => (
            <li key={d.source}>
              <button type="button" onClick={() => setSelectedSource(d.source)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 0 8px 10px', background: 'transparent', border: 'none', borderBottom: `1px solid ${rule}`, borderLeft: selectedSource === d.source ? `2px solid ${ink}` : '2px solid transparent', cursor: 'pointer' }}>
                <span style={{ display: 'block', fontFamily: serif, fontSize: 14, color: ink, fontWeight: selectedSource === d.source ? 600 : 400, lineHeight: 1.35 }}>
                  {d.title}
                  {d.parts && d.parts.length > 1 && <span style={{ fontFamily: mono, fontSize: 11, color: mute, fontWeight: 400 }}> · {d.parts.length} parts</span>}
                </span>
                <span style={{ display: 'block', fontFamily: mono, fontSize: 11, color: mute, marginTop: 2 }}>{d.isUser ? 'your note' : d.source}</span>
              </button>
            </li>
          ))}
        </ul>
        {pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', marginTop: 12, fontFamily: mono, fontSize: 12, color: mute }}>
            <button type="button" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)} style={{ background: 'transparent', border: `1px solid ${rule}`, color: safePage <= 0 ? rule : ink, cursor: safePage <= 0 ? 'default' : 'pointer', padding: '2px 8px', fontFamily: mono, fontSize: 12 }}>‹ prev</button>
            <span>page {safePage + 1} / {pageCount} · {documents.length} docs</span>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} style={{ background: 'transparent', border: `1px solid ${rule}`, color: safePage >= pageCount - 1 ? rule : ink, cursor: safePage >= pageCount - 1 ? 'default' : 'pointer', padding: '2px 8px', fontFamily: mono, fontSize: 12 }}>next ›</button>
          </div>
        )}
      </div>
      <div style={{ borderLeft: `1px solid ${rule}`, paddingLeft: 24, minHeight: 200 }}>
        {selected ? (
          selected.isUser && selected.userNote ? (
            <UserNoteViewer note={selected.userNote} />
          ) : (
            <ShardNoteViewer reader={reader} noteId={selected.parts![0].id} />
          )
        ) : (
          <p style={{ fontFamily: mono, fontSize: 13, color: mute }}>Select a document to read it.</p>
        )}
      </div>
    </div>
  );
}

// ── Capabilities (upgrade affordances) ───────────────────────
function SettingsTab({ onUpgrade }: { onUpgrade: (i: UpgradeIntent) => void }) {
  const btn = { padding: '8px 16px', fontFamily: mono, fontSize: 14, background: 'transparent', border: `1px solid ${ink}`, color: ink, cursor: 'pointer' } as const;
  return (
    <div style={{ maxWidth: '64ch' }}>
      <h3 style={{ fontFamily: sans, fontSize: 18, color: ink, margin: '0 0 12px' }}>Semantic search</h3>
      <p style={{ fontFamily: serif, fontSize: 15, color: mute, lineHeight: 1.6, margin: '0 0 16px' }}>Full-text search and the relationship graph work immediately with no database. Semantic search is opt-in: it loads the in-browser PGlite engine, a ~23 MB embedding model, and the summary vectors — all on your device, nothing leaves the page.</p>
      <button type="button" onClick={() => onUpgrade({ tab: 'search', autoSemantic: true })} style={btn}>Enable semantic search</button>

      <h3 style={{ fontFamily: sans, fontSize: 18, color: ink, margin: '32px 0 12px' }}>AI features (language model)</h3>
      <p style={{ fontFamily: serif, fontSize: 15, color: mute, lineHeight: 1.6, margin: '0 0 16px' }}>Off by default. A language model adds note concept-tagging, title generation, and summaries — run one in your browser or connect an OpenAI-compatible endpoint. Opens with the full local archive.</p>
      <button type="button" onClick={() => onUpgrade({ tab: 'settings', openLlm: true })} style={btn}>Enable AI features</button>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div style={{ fontFamily: serif }}>{children}</div>;
}

export function ReaderShell({ onUpgrade }: { onUpgrade: (i: UpgradeIntent) => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [err, setErr] = useState('');
  // /fortemi opens on the citation graph — the most immediate read of what the
  // corpus *is* (papers + how they cite each other), before the visitor narrows
  // with search. Reader-driven, so it runs on the no-database base surface.
  const [tab, setTab] = useState<Tab>('graph');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(NOTES_SHARD);
        if (!res.ok) throw new Error(`corpus ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (alive) setBytes(buf);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const source = useMemo(() => bytes, [bytes]);

  if (err) return <Frame><p style={{ fontFamily: mono, fontSize: 13, color: mute }}>Couldn’t open the corpus: {err}</p></Frame>;
  if (!source) return <Frame><p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: mute }}><Spinner color={mute} /> opening the corpus…</p></Frame>;
  return <ReaderShellInner source={source} tab={tab} setTab={setTab} onUpgrade={onUpgrade} />;
}

function ReaderShellInner({ source, tab, setTab, onUpgrade }: { source: Uint8Array; tab: Tab; setTab: (t: Tab) => void; onUpgrade: (i: UpgradeIntent) => void }) {
  const shard = useShard(source);
  const ready = !shard.loading && !shard.error && !!shard.reader;

  return (
    <Frame>
      <TabBar tab={tab} setTab={setTab} />
      {!ready ? (
        <p style={{ display: 'flex', alignItems: 'center', gap: '1ch', fontFamily: mono, fontSize: 13, color: mute }}>
          <Spinner color={mute} /> {shard.error ? `couldn’t open the corpus: ${shard.error.message}` : 'opening the corpus…'}
        </p>
      ) : (
        <>
          {tab === 'search' && <SearchTab reader={shard.reader as ShardReader} onUpgrade={onUpgrade} />}
          {tab === 'notes' && <NotesTab reader={shard.reader as ShardReader} onUpgrade={onUpgrade} />}
          {tab === 'graph' && <GraphView ready={ready} reader={shard.reader as ShardReader} />}
          {tab === 'settings' && <SettingsTab onUpgrade={onUpgrade} />}
        </>
      )}
    </Frame>
  );
}

export default ReaderShell;
