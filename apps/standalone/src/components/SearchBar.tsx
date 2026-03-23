import { useState, useRef, useEffect } from 'react'

interface SearchBarProps {
  onSearch: (query: string) => void
}

export function SearchBar({ onSearch }: SearchBarProps) {
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

  return (
    <input
      ref={inputRef}
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search notes... (Ctrl+K)"
      style={{
        flex: 1,
        padding: '8px 12px',
        border: '1px solid #ddd',
        borderRadius: 6,
        fontSize: 14,
      }}
    />
  )
}
