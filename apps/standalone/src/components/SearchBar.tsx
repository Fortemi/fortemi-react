import { useState, useRef, useEffect } from 'react'

type SearchMode = 'auto' | 'text' | 'semantic' | 'hybrid'

interface SearchBarProps {
  onSearch: (query: string) => void
  onModeChange: (mode: SearchMode) => void
  mode: SearchMode
  semanticReady: boolean
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'text', label: 'Text' },
  { value: 'semantic', label: 'Semantic' },
  { value: 'hybrid', label: 'Hybrid' },
]

export function SearchBar({ onSearch, onModeChange, mode, semanticReady }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onSearch(query), 300)
    return () => clearTimeout(timerRef.current)
  }, [query, onSearch])

  // Ctrl+K / Cmd+K shortcut
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const isSemanticDisabled = (m: SearchMode) =>
    (m === 'semantic' || m === 'hybrid') && !semanticReady

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {MODES.map((m) => {
          const disabled = isSemanticDisabled(m.value)
          const active = mode === m.value
          return (
            <button
              key={m.value}
              onClick={() => !disabled && onModeChange(m.value)}
              disabled={disabled}
              title={
                disabled
                  ? 'Enable semantic capability in Settings'
                  : undefined
              }
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                borderRadius: 12,
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: active ? '#4a9eff' : '#f0f0f0',
                color: active ? 'white' : '#333',
                opacity: disabled ? 0.4 : 1,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {m.label}
            </button>
          )
        })}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search notes... (Ctrl+K)"
        style={{
          padding: '8px 12px',
          border: '1px solid #ddd',
          borderRadius: 6,
          fontSize: 14,
        }}
      />
    </div>
  )
}
