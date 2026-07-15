// src/components/fortemi/ShardNoteModal.tsx
//
// Reader-backed note popup for the static-file (openShard / useShard) surfaces —
// NO PGlite. Mirrors NoteViewer/NoteModal (the PGlite-hook viewer) but reads the
// note directly off a ShardReader: original_content (Full) / revised_content
// (Summary AI), sibling chunks by source (part navigator), linksOf (related), and
// conceptsOf (W3C SKOS concepts — round-trip via the shard now, #127 closed +
// magly.net #31 corpus population). Provenance is not shown on the reader path yet:
// ShardReader has no provenanceOf() (filed Fortemi/fortemi-react#198); the full
// PGlite app shows PROV via useNoteProvenance.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ShardReader, ShardReaderNote, ShardLink, ShardSkosConcept } from '@fortemi/core';
import { documentTitle } from './dedupeDocuments';

const mono = 'var(--font-family-lit-mono)';
const sans = 'var(--font-family-lit-sans)';
const ink = 'var(--color-lit-ink)';
const mute = 'var(--color-lit-ink-mute)';
const rule = 'var(--color-lit-rule)';
const live = 'var(--color-lit-accent-live)';

function partNum(title: string | null | undefined): number {
  const m = title?.match(/\(part (\d+)\/\d+\)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
function fmtDate(v: unknown): string {
  if (v == null) return '—';
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}
function Hint({ children }: { children: ReactNode }) {
  return <p style={{ fontFamily: mono, fontSize: 13, color: mute, margin: '12px 0' }}>{children}</p>;
}
function navBtn(disabled: boolean): CSSProperties {
  return { background: 'transparent', border: `1px solid ${rule}`, color: disabled ? rule : ink, cursor: disabled ? 'default' : 'pointer', padding: '2px 8px', fontFamily: mono, fontSize: 12 };
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ fontFamily: mono, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: mute, margin: '0 0 8px' }}>{title}</h4>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '1ch', fontFamily: mono, fontSize: 12.5, color: ink, padding: '3px 0', lineHeight: 1.5 }}>
      <span style={{ color: mute, minWidth: '14ch', flexShrink: 0 }}>{k}</span>
      <span style={{ wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
}

type Tab = 'content' | 'metadata';

export function ShardNoteViewer({ reader, noteId, onOpen }: { reader: ShardReader; noteId: string; onOpen?: (id: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('content');
  const [showFull, setShowFull] = useState(false);
  const [origIdx, setOrigIdx] = useState(0);
  const [parts, setParts] = useState<ShardReaderNote[] | null>(null);
  const [source, setSource] = useState('');
  const [related, setRelated] = useState<{ id: string; title: string; kind: string }[] | null>(null);
  const [concepts, setConcepts] = useState<ShardSkosConcept[] | null>(null);
  const scrollTop = () => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => {
    setShowFull(false);
    setOrigIdx(0);
    let alive = true;
    void (async () => {
      // Resolve the opened note's document (its `source`), then gather all its
      // sibling chunks so the Full-note view can paginate the whole document.
      const opened = await reader.getNote(noteId);
      const src = (opened as { source?: string } | null)?.source ?? noteId;
      const all = await reader.listNotes({ limit: 100000 });
      if (!alive) return;
      const sibs = all.items.filter((n) => (n as { source?: string }).source === src);
      sibs.sort((a, b) => partNum(a.title) - partNum(b.title));
      setSource(src);
      setParts(sibs.length ? sibs : opened ? [opened] : null);
      const primaryId = sibs[0]?.id ?? noteId;
      const [lk, cn] = await Promise.all([
        reader.linksOf(primaryId).catch(() => [] as ShardLink[]),
        reader.conceptsOf(primaryId).catch(() => [] as ShardSkosConcept[]),
      ]);
      // Resolve each citation's target note id to the cited document's title
      // (deduped by document) — a raw note id means nothing to a reader.
      const titleById = new Map(all.items.map((n) => [n.id, documentTitle(n.title)] as const));
      const seen = new Set<string>();
      const rel: { id: string; title: string; kind: string }[] = [];
      for (const l of lk) {
        if (!l.to_note_id) continue;
        const title = titleById.get(l.to_note_id) ?? l.to_note_id;
        if (!title || seen.has(title)) continue;
        seen.add(title);
        rel.push({ id: l.to_note_id, title, kind: l.kind || 'cites' });
      }
      if (alive) {
        setRelated(rel);
        setConcepts(cn);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reader, noteId]);

  if (!parts) return <Hint>loading…</Hint>;
  const primary = parts[0] as ShardReaderNote & { original_content?: string; revised_content?: string | null };
  const count = parts.length;
  const safe = Math.min(origIdx, count - 1);
  const cur = parts[safe] as ShardReaderNote & { original_content?: string };
  const ai = (primary.revised_content ?? '').trim();
  const fullPrimary = primary.original_content ?? '';
  const hasAi = ai.length > 0 && ai !== fullPrimary.trim();
  const body = showFull ? cur.original_content ?? fullPrimary : ai || fullPrimary;
  const title = documentTitle(primary.title);

  return (
    <div ref={rootRef} style={{ scrollMarginTop: 16 }}>
      <h3 style={{ fontFamily: sans, fontSize: 19, fontWeight: 600, color: ink, margin: '0 0 6px', lineHeight: 1.3 }}>{title}</h3>
      {source && <div style={{ fontFamily: mono, fontSize: 12, color: mute, marginBottom: 16 }}>{source}</div>}

      <div style={{ display: 'flex', gap: '2ch', borderBottom: `1px solid ${rule}`, marginBottom: 16 }}>
        {(['content', 'metadata'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} style={{ background: 'transparent', border: 'none', borderBottom: tab === t ? `2px solid ${ink}` : '2px solid transparent', marginBottom: -1, padding: '6px 0', fontFamily: mono, fontSize: 13, color: tab === t ? ink : mute, cursor: 'pointer' }}>
            {t === 'content' ? 'Content' : 'Metadata'}
          </button>
        ))}
      </div>

      {tab === 'content' ? (
        <div>
          <div style={{ display: 'inline-flex', border: `1px solid ${rule}`, marginBottom: 14 }}>
            {[{ full: false, label: 'Summary (AI)' }, { full: true, label: 'Full note' }].map((opt) => (
              <button key={opt.label} type="button" onClick={() => setShowFull(opt.full)} style={{ padding: '5px 12px', fontFamily: mono, fontSize: 12, cursor: 'pointer', border: 'none', background: showFull === opt.full ? ink : 'transparent', color: showFull === opt.full ? 'var(--color-lit-bg)' : mute }}>
                {opt.label}
              </button>
            ))}
          </div>
          {showFull && count > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', margin: '12px 0', fontFamily: mono, fontSize: 12, color: mute }}>
              <button type="button" disabled={safe <= 0} onClick={() => setOrigIdx(safe - 1)} style={navBtn(safe <= 0)}>‹ prev</button>
              <span>part {safe + 1} / {count}</span>
              <button type="button" disabled={safe >= count - 1} onClick={() => { setOrigIdx(safe + 1); scrollTop(); }} style={navBtn(safe >= count - 1)}>next ›</button>
            </div>
          )}
          {!showFull && !hasAi && (
            <p style={{ fontFamily: mono, fontSize: 12, color: mute, margin: '0 0 10px' }}>No AI summary generated for this note yet — showing the original text.</p>
          )}
          <div className="fortemi-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <div>
          <Section title="Core">
            <Row k="id" v={primary.id} />
            <Row k="source" v={source || '—'} />
            <Row k="format" v={(primary as { format?: string }).format || '—'} />
            <Row k="tags" v={primary.tags?.length ? primary.tags.join(', ') : '—'} />
            <Row k="created" v={fmtDate((primary as { created_at?: unknown }).created_at)} />
            <Row k="parts" v={String(count)} />
          </Section>
          <Section title="Revision">
            <Row k="ai revision" v={hasAi ? 'present' : 'none (original only)'} />
          </Section>
          <Section title="Concepts · W3C SKOS">
            {concepts == null ? (
              <Hint>loading…</Hint>
            ) : concepts.length === 0 ? (
              <Hint>No concepts indexed for this note.</Hint>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {concepts.map((c) => (
                  <span key={c.id} title={c.definition ?? undefined} style={{ fontFamily: mono, fontSize: 12, color: live, border: `1px solid ${rule}`, borderRadius: 999, padding: '2px 10px' }}>
                    {c.pref_label}
                  </span>
                ))}
              </div>
            )}
          </Section>
          <Section title="Related notes">
            {related == null ? <Hint>loading…</Hint> : related.length === 0 ? <Hint>No linked notes.</Hint> : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {related.map((r) => (
                  <li key={r.id} style={{ padding: '3px 0' }}>
                    {onOpen ? (
                      <button type="button" onClick={() => onOpen(r.id)} style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: mono, fontSize: 12.5, color: ink, lineHeight: 1.5 }}>
                        <span style={{ color: mute }}>→ {r.kind}: </span>
                        <span style={{ borderBottom: `1px solid ${rule}` }}>{r.title}</span>
                      </button>
                    ) : (
                      <span style={{ fontFamily: mono, fontSize: 12.5, color: ink, lineHeight: 1.5 }}>
                        <span style={{ color: mute }}>→ {r.kind}: </span>
                        {r.title}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

export function ShardNoteModal({ reader, noteId, onClose }: { reader: ShardReader; noteId: string; onClose: () => void }) {
  // Hold the viewed note locally so clicking a related citation navigates in
  // place; reset when the parent opens a different note.
  const [activeId, setActiveId] = useState(noteId);
  useEffect(() => setActiveId(noteId), [noteId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(28,24,18,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', background: 'var(--color-lit-bg)', border: `1px solid ${rule}`, maxWidth: '78ch', width: '100%', boxShadow: '0 16px 56px rgba(0,0,0,0.28)' }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, right: 16, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: mono, fontSize: 12, color: mute, zIndex: 1 }}>esc ✕</button>
        <div style={{ padding: '28px 32px', maxHeight: '84vh', overflowY: 'auto' }}>
          <ShardNoteViewer reader={reader} noteId={activeId} onOpen={setActiveId} />
        </div>
      </div>
    </div>
  );
}

export default ShardNoteModal;
