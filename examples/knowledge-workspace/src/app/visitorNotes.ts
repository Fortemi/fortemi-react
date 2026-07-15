// src/components/fortemi/visitorNotes.ts
//
// Persist the visitor's OWN notes across reloads. The full corpus stays in-memory
// (re-imported per session — fast; persisting the whole PGlite DB to idb/opfs
// makes the import crawl because every row is written to disk). What a visitor
// actually wants kept is the handful of notes THEY added, so we store just those
// in localStorage and re-insert them after the corpus mounts.
//
// We capture content at creation (NoteSummary from the list doesn't carry it) and
// update the title as the enrichment pipeline writes it, so a returning visitor
// sees their note with the AI-generated title intact.

const KEY = 'fortemi-visitor-notes';

export type StoredVisitorNote = {
  /** Unique per note (`visitor:<id>`), also the doc grouping key + display source. */
  source: string;
  content: string;
  title: string | null;
  tags: string[];
  createdAt: string; // ISO; preserves add-order on restore
};

export function loadStoredNotes(): StoredVisitorNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as StoredVisitorNote[]) : [];
    return Array.isArray(arr) ? arr.filter((n) => n && typeof n.source === 'string' && typeof n.content === 'string') : [];
  } catch {
    return [];
  }
}

function writeAll(notes: StoredVisitorNote[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    /* storage full / unavailable — non-fatal, persistence just won't survive */
  }
}

/** Add or replace a stored note (keyed by source). Called when a note is created. */
export function upsertStoredNote(note: StoredVisitorNote): void {
  const all = loadStoredNotes().filter((n) => n.source !== note.source);
  all.push(note);
  writeAll(all);
}

/** Update a stored note's title as enrichment writes it. No-op if unchanged/absent. */
export function setStoredNoteTitle(source: string, title: string | null): void {
  const all = loadStoredNotes();
  const i = all.findIndex((n) => n.source === source);
  if (i < 0 || all[i].title === title) return;
  all[i] = { ...all[i], title };
  writeAll(all);
}
