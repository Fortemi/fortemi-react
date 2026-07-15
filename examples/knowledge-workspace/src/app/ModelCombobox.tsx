// src/components/fortemi/ModelCombobox.tsx
//
// Searchable model picker for the provider path of the LLM setup. Replaces a
// native <datalist>, which had three problems for large catalogs (OpenRouter
// lists hundreds of models):
//   1. A datalist filters by substring of the *input value*, so a pre-filled
//      default model id (e.g. "openai/gpt-4o-mini") silently limited the list to
//      OpenAI models — the list looked biased and small.
//   2. Password-manager extensions overlay the secure key field and obscure the
//      native dropdown.
//   3. Native datalist rendering is unmanageable at hundreds of entries.
//
// This is a self-contained combobox: a closed field shows the selected id; the
// open panel has its OWN search box (starts empty → the full list, chat models
// first) over a scrollable, capped, filterable list. Any id can still be typed
// and used verbatim ("Use …"), so custom/unlisted models work. The search input
// carries data-*-ignore attributes so password managers leave it (and the panel)
// alone.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProviderModel } from './llmSetup';

const mono = 'var(--font-family-lit-mono)';
const ink = 'var(--color-lit-ink)';
const mute = 'var(--color-lit-ink-mute)';
const rule = 'var(--color-lit-rule)';
const live = 'var(--color-lit-accent-live)';
const bg = 'var(--color-lit-bg)';
const bgDeep = 'var(--color-lit-bg-deep)';

const MAX_ROWS = 200;

type ModelsState = 'idle' | 'loading' | 'loaded' | 'error';

const fieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1ch',
  padding: '9px 11px',
  fontFamily: mono,
  fontSize: 13,
  textAlign: 'left',
  color: ink,
  background: bgDeep,
  border: `1px solid ${rule}`,
  cursor: 'pointer',
};

export function ModelCombobox({
  value,
  onChange,
  models,
  state,
  error,
  placeholder = 'Select or type a model id',
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  models: ProviderModel[] | null;
  state: ModelsState;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => models ?? [], [models]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? list.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) : list),
    [list, q],
  );
  const shown = filtered.slice(0, MAX_ROWS);
  // Offer the typed text as a usable custom id when it doesn't already match one.
  const showCustom = query.trim().length > 0 && !filtered.some((m) => m.id.toLowerCase() === q);
  const customIndex = showCustom ? shown.length : -1;
  const rowCount = shown.length + (showCustom ? 1 : 0);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset the search to empty (full list) each time the panel opens, and focus it.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHi(0);
    const id = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const pick = (id: string) => {
    const trimmed = id.trim();
    if (trimmed) onChange(trimmed);
    setOpen(false);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, Math.max(0, rowCount - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hi === customIndex) pick(query);
      else if (shown[hi]) pick(shown[hi].id);
      else if (showCustom) pick(query);
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{ ...fieldStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? value : <span style={{ color: mute }}>{placeholder}</span>}
        </span>
        <span style={{ color: mute, flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 1100, // above any password-manager field overlay
            background: bg,
            border: `1px solid ${rule}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
          }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHi(0);
            }}
            onKeyDown={onSearchKey}
            placeholder="Search models, or type a model id…"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '9px 11px',
              fontFamily: mono,
              fontSize: 13,
              color: ink,
              background: bgDeep,
              border: 'none',
              borderBottom: `1px solid ${rule}`,
              outline: 'none',
            }}
          />
          <div role="listbox" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {state === 'loading' && <Info>Looking up available models…</Info>}
            {state === 'error' && (
              <Info>Couldn’t list models{error ? ` (${error})` : ''} — type an id above and pick “Use …”.</Info>
            )}
            {state === 'idle' && list.length === 0 && <Info>Enter the base URL and key to list models, or type an id above.</Info>}

            {showCustom && (
              <Row active={hi === customIndex} onClick={() => pick(query)}>
                <span style={{ color: live }}>Use “{query.trim()}”</span>
              </Row>
            )}
            {shown.map((m, i) => (
              <Row key={m.id} active={i === hi} selected={m.id === value} onClick={() => pick(m.id)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.id}</span>
                {!m.chat && (
                  <span style={{ fontSize: 10, color: mute, border: `1px solid ${rule}`, padding: '0 4px', flexShrink: 0 }}>
                    embed
                  </span>
                )}
              </Row>
            ))}
            {filtered.length > MAX_ROWS && <Info>+{filtered.length - MAX_ROWS} more — refine your search</Info>}
            {state === 'loaded' && filtered.length === 0 && !showCustom && <Info>No models match.</Info>}
          </div>
          {state === 'loaded' && list.length > 0 && (
            <div style={{ fontFamily: mono, fontSize: 11, color: mute, padding: '6px 11px', borderTop: `1px solid ${rule}` }}>
              {q ? `${filtered.length} of ${list.length}` : `${list.length}`} model{list.length === 1 ? '' : 's'} · chat first
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: mono, fontSize: 11, color: mute, padding: '8px 11px', lineHeight: 1.5 }}>{children}</div>;
}

function Row({
  active,
  selected,
  onClick,
  children,
}: {
  active?: boolean;
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1ch',
        width: '100%',
        textAlign: 'left',
        padding: '7px 11px',
        fontFamily: mono,
        fontSize: 12.5,
        color: selected ? live : ink,
        background: active ? bgDeep : 'transparent',
        border: 'none',
        borderLeft: selected ? `2px solid ${live}` : '2px solid transparent',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export default ModelCombobox;
