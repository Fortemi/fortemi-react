// src/components/fortemi/NoteViewer.tsx
//
// Shared note viewer for the Fortémi surfaces, mirroring the full Fortémi
// server's note view. Two tabs:
//
//   Content  — toggles the AI revision (NoteFull.current.content, default)
//              against the full original note (NoteFull.original.content).
//   Metadata — W3C SKOS concepts (useNoteConcepts), W3C PROV provenance
//              (useNoteProvenance), related links (useRelatedNotes), and the
//              core note metadata + revision provenance.
//
// Rendered inline by the /fortemi Notes detail pane and wrapped by NoteModal
// for the quick-search popup on the homepage and the /fortemi search results.
// It reads the DB through @fortemi/react hooks, so it works unchanged inside
// any FortemiProvider.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNote, useNotes, useNoteConcepts, useNoteProvenance, useRelatedNotes } from '@fortemi/react';
import type { NoteFull } from '@fortemi/core';

/** Parse the trailing "(part N/M)" chunk index a multi-chunk document carries. */
function partNum(title: string | null | undefined): number {
  const m = title?.match(/\(part (\d+)\/\d+\)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Visitor notes carry an opaque unique source (`visitor:<id>`); label it. */
function displaySource(source: string | null | undefined): string {
  if (!source) return '';
  return source.startsWith('visitor:') ? 'your note' : source;
}

function navBtn(disabled: boolean): CSSProperties {
  return {
    background: 'transparent',
    border: `1px solid ${rule}`,
    color: disabled ? rule : ink,
    cursor: disabled ? 'default' : 'pointer',
    padding: '2px 8px',
    fontFamily: mono,
    fontSize: 12,
  };
}

/** Chunk part navigator — rendered above AND below the Full-note content so a
 *  long part can be advanced without scrolling back to the top. */
function PartNav({
  idx,
  count,
  onPrev,
  onNext,
  onTop,
}: {
  idx: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onTop?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1ch', margin: '12px 0', fontFamily: mono, fontSize: 12, color: mute }}>
      <button type="button" disabled={idx <= 0} onClick={onPrev} style={navBtn(idx <= 0)}>
        ‹ prev
      </button>
      <span>
        part {idx + 1} / {count}
      </span>
      <button type="button" disabled={idx >= count - 1} onClick={onNext} style={navBtn(idx >= count - 1)}>
        next ›
      </button>
      {onTop && (
        <button type="button" onClick={onTop} style={{ ...navBtn(false), marginLeft: '1ch' }}>
          ↑ top
        </button>
      )}
    </div>
  );
}

const mono = 'var(--font-family-lit-mono)';
const sans = 'var(--font-family-lit-sans)';
const ink = 'var(--color-lit-ink)';
const mute = 'var(--color-lit-ink-mute)';
const rule = 'var(--color-lit-rule)';
const live = 'var(--color-lit-accent-live)';

function Hint({ children }: { children: ReactNode }) {
  return <p style={{ fontFamily: mono, fontSize: 13, color: mute, margin: '12px 0' }}>{children}</p>;
}

function fmtDate(v: unknown): string {
  if (v == null) return '—';
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

type ViewTab = 'content' | 'metadata';

// One chunk of a document. A multi-part document passes all of its chunk notes
// so the Full note (original) view can paginate them; the summary and metadata
// are whole-document and read from the primary (first) part.
export type NotePart = { id: string; title: string | null };

export function NoteViewer({ noteId, parts }: { noteId: string; parts?: NotePart[] }) {
  const note = useNote(noteId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<ViewTab>('content');
  const [showFull, setShowFull] = useState(false); // default = AI summary
  const [origIdx, setOrigIdx] = useState(0); // chunk index for the Full note (original) view
  const scrollToTop = () => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // A newly opened document starts on the summary at part 1.
  useEffect(() => {
    setShowFull(false);
    setOrigIdx(0);
  }, [noteId]);

  // The Full note tab paginates the document's original chunks. The summary is
  // whole-document and identical across chunks, so paging only changes the
  // original text — never the summary or metadata, which come from the primary part.
  const chunkParts = parts && parts.length > 0 ? parts : null;
  const partCount = chunkParts ? chunkParts.length : 1;
  const safeOrig = Math.min(origIdx, partCount - 1);
  const origNoteId = chunkParts ? chunkParts[safeOrig].id : noteId;
  const orig = useNote(origNoteId);

  if (note.loading && !note.data) return <Hint>loading…</Hint>;
  if (!note.data) return <Hint>Couldn’t load this note.</Hint>;

  const d = note.data;
  const ai = d.current.content ?? '';
  const fullPrimary = d.original.content ?? '';
  const hasAiRevision = ai.trim().length > 0 && ai.trim() !== fullPrimary.trim();
  const origContent = orig.data?.original.content ?? orig.data?.current.content ?? fullPrimary;
  // Summary (AI) shows the revision (current.content); Full note shows the original
  // (paginated per chunk). The toggle is always present so Fortémi's AI-revision
  // feature is demonstrated on every note; a note lacking a revision falls back to
  // its original text under the Summary tab.
  const body = showFull ? origContent : ai || fullPrimary;

  return (
    <div ref={rootRef} style={{ scrollMarginTop: 16 }}>
      <h3 style={{ fontFamily: sans, fontSize: 19, fontWeight: 600, color: ink, margin: '0 0 6px', lineHeight: 1.3 }}>
        {/* Strip the "(part N/M)" suffix — the Full-note navigator conveys the part. */}
        {(d.title || '(untitled)').replace(/\s*\(part \d+\/\d+\)\s*$/, '')}
      </h3>
      {d.source && <div style={{ fontFamily: mono, fontSize: 12, color: mute, marginBottom: 16 }}>{displaySource(d.source)}</div>}

      <div style={{ display: 'flex', gap: '2ch', borderBottom: `1px solid ${rule}`, marginBottom: 16 }}>
        {(['content', 'metadata'] as ViewTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? `2px solid ${ink}` : '2px solid transparent',
              marginBottom: -1,
              padding: '6px 0',
              fontFamily: mono,
              fontSize: 13,
              color: tab === t ? ink : mute,
              cursor: 'pointer',
            }}
          >
            {t === 'content' ? 'Content' : 'Metadata'}
          </button>
        ))}
      </div>

      {tab === 'content' ? (
        <div>
          <div style={{ display: 'inline-flex', border: `1px solid ${rule}`, marginBottom: 14 }}>
            {[
              { full: false, label: 'Summary (AI)' },
              { full: true, label: 'Full note' },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setShowFull(opt.full)}
                style={{
                  padding: '5px 12px',
                  fontFamily: mono,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: 'none',
                  background: showFull === opt.full ? ink : 'transparent',
                  color: showFull === opt.full ? 'var(--color-lit-bg)' : mute,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {showFull && partCount > 1 && (
            <PartNav idx={safeOrig} count={partCount} onPrev={() => setOrigIdx(safeOrig - 1)} onNext={() => setOrigIdx(safeOrig + 1)} />
          )}
          {!showFull && !hasAiRevision && (
            <p style={{ fontFamily: mono, fontSize: 12, color: mute, margin: '0 0 10px' }}>
              No AI summary generated for this note yet — showing the original text.
            </p>
          )}
          <div className="fortemi-md">
            {showFull && orig.loading && !orig.data ? <Hint>loading…</Hint> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>}
          </div>
          {showFull && partCount > 1 && (
            <PartNav
              idx={safeOrig}
              count={partCount}
              onPrev={() => {
                setOrigIdx(safeOrig - 1);
                scrollToTop();
              }}
              onNext={() => {
                setOrigIdx(safeOrig + 1);
                scrollToTop();
              }}
              onTop={scrollToTop}
            />
          )}
        </div>
      ) : (
        <MetadataPanel noteId={noteId} d={d} hasAiRevision={hasAiRevision} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h4
        style={{
          fontFamily: mono,
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: mute,
          margin: '0 0 8px',
        }}
      >
        {title}
      </h4>
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

function MetadataPanel({ noteId, d, hasAiRevision }: { noteId: string; d: NoteFull; hasAiRevision: boolean }) {
  const { concepts, loading: cLoading } = useNoteConcepts(noteId);
  const { events, loading: pLoading } = useNoteProvenance(noteId);
  const { links, loading: rLoading } = useRelatedNotes(noteId, 8);

  return (
    <div>
      <Section title="Core">
        <Row k="id" v={d.id} />
        <Row k="source" v={displaySource(d.source) || '—'} />
        <Row k="format" v={d.format || '—'} />
        <Row k="visibility" v={d.visibility || '—'} />
        <Row k="tags" v={d.tags?.length ? d.tags.join(', ') : '—'} />
        <Row k="created" v={fmtDate(d.created_at)} />
        <Row k="updated" v={fmtDate(d.updated_at)} />
      </Section>

      <Section title="Revision">
        <Row k="ai revision" v={hasAiRevision ? 'present' : 'none (original only)'} />
        <Row k="generations" v={String(d.current.generation_count)} />
        <Row k="model" v={d.current.model || '—'} />
        <Row k="user-edited" v={d.current.is_user_edited ? 'yes' : 'no'} />
        {d.current.ai_metadata != null && (
          <Row k="ai metadata" v={<code style={{ fontSize: 11 }}>{JSON.stringify(d.current.ai_metadata)}</code>} />
        )}
      </Section>

      <Section title="Concepts · W3C SKOS">
        {cLoading ? (
          <Hint>loading…</Hint>
        ) : concepts.length === 0 ? (
          <Hint>No concepts indexed for this note.</Hint>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {concepts.map((c) => (
              <span
                key={c.conceptId}
                title={c.schemeName}
                style={{ fontFamily: mono, fontSize: 12, color: live, border: `1px solid ${rule}`, borderRadius: 999, padding: '2px 10px' }}
              >
                {c.prefLabel}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Provenance · W3C PROV">
        {pLoading ? (
          <Hint>loading…</Hint>
        ) : events.length === 0 ? (
          <Hint>No provenance events recorded.</Hint>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {events.map((e, i) => (
              <li
                key={i}
                style={{ fontFamily: mono, fontSize: 12, color: ink, padding: '4px 0 4px 10px', borderLeft: `2px solid ${rule}`, marginBottom: 4 }}
              >
                <span style={{ color: live }}>{e.type}</span> · {e.label}
                <span style={{ color: mute }}> — {fmtDate(e.timestamp)}</span>
                {e.detail && <div style={{ color: mute }}>{e.detail}</div>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Related notes">
        {rLoading ? (
          <Hint>loading…</Hint>
        ) : links.length === 0 ? (
          <Hint>No linked notes.</Hint>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {links.map((l) => (
              <li key={l.noteId} style={{ fontFamily: mono, fontSize: 12, color: ink, padding: '3px 0' }}>
                <span style={{ color: mute }}>
                  {l.direction === 'inbound' ? '←' : '→'} {l.linkType}:{' '}
                </span>
                {l.title || l.noteId}
                {l.confidence != null && <span style={{ color: mute }}> ({Math.round(l.confidence * 100)}%)</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function NoteModal({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  // Resolve the opened note's sibling chunks (same source) so the popup shows the
  // whole document — summary + full-note chunk navigator — exactly like the
  // in-page Notes reader, instead of just the single chunk that was clicked.
  const opened = useNote(noteId);
  const all = useNotes({ limit: 10000, sort: 'created_at', order: 'asc' });
  const parts = useMemo<NotePart[] | undefined>(() => {
    const src = opened.data?.source;
    if (!src || !all.data) return undefined;
    const sibs = all.data.items.filter((n) => n.source === src);
    if (sibs.length <= 1) return undefined;
    sibs.sort((a, b) => partNum(a.title) - partNum(b.title));
    return sibs.map((n) => ({ id: n.id, title: n.title ?? null }));
  }, [opened.data, all.data]);
  const primaryId = parts && parts.length > 0 ? parts[0].id : noteId;

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
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(28,24,18,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          background: 'var(--color-lit-bg)',
          border: `1px solid ${rule}`,
          maxWidth: '78ch',
          width: '100%',
          boxShadow: '0 16px 56px rgba(0,0,0,0.28)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 16,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontFamily: mono,
            fontSize: 12,
            color: mute,
            zIndex: 1,
          }}
        >
          esc ✕
        </button>
        <div style={{ padding: '28px 32px', maxHeight: '84vh', overflowY: 'auto' }}>
          <NoteViewer noteId={primaryId} parts={parts} />
        </div>
      </div>
    </div>
  );
}

export default NoteViewer;
