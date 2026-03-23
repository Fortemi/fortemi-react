import { useState, useCallback } from 'react'

const HISTORY_KEY = 'fortemi:search-history'
const MAX_HISTORY = 50

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string') : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(loadHistory)

  const addEntry = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    setHistory((prev) => {
      const updated = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, MAX_HISTORY)
      saveHistory(updated)
      return updated
    })
  }, [])

  const removeEntry = useCallback((query: string) => {
    setHistory((prev) => {
      const updated = prev.filter((q) => q !== query)
      saveHistory(updated)
      return updated
    })
  }, [])

  const clearHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY)
    setHistory([])
  }, [])

  return { history, addEntry, removeEntry, clearHistory }
}
