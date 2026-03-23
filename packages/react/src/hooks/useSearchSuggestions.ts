import { useState, useCallback, useRef, useEffect } from 'react'
import { useFortemiContext } from '../FortemiProvider.js'

interface Suggestion {
  text: string
  source: 'vocabulary' | 'history'
}

const VOCAB_LIMIT = 500
const MAX_SUGGESTIONS = 10

export function useSearchSuggestions(history: string[] = []) {
  const { db } = useFortemiContext()
  const vocabRef = useRef<{ word: string; ndoc: number }[] | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)

  // Load vocabulary once on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await db.query<{ word: string; ndoc: number }>(
          `SELECT word, ndoc FROM ts_stat('SELECT tsv FROM note WHERE deleted_at IS NULL')
           ORDER BY ndoc DESC LIMIT $1`,
          [VOCAB_LIMIT],
        )
        if (!cancelled) {
          vocabRef.current = result.rows
        }
      } catch {
        // ts_stat may fail on empty tables — degrade gracefully
        if (!cancelled) {
          vocabRef.current = []
        }
      }
    })()
    return () => { cancelled = true }
  }, [db])

  const getSuggestions = useCallback((prefix: string) => {
    const trimmed = prefix.trim().toLowerCase()
    if (!trimmed) {
      setSuggestions([])
      return
    }

    setLoading(true)
    const results: Suggestion[] = []

    // History matches first (most relevant)
    for (const entry of history) {
      if (entry.toLowerCase().startsWith(trimmed) && entry.toLowerCase() !== trimmed) {
        results.push({ text: entry, source: 'history' })
        if (results.length >= MAX_SUGGESTIONS) break
      }
    }

    // Vocabulary matches
    if (results.length < MAX_SUGGESTIONS && vocabRef.current) {
      for (const { word } of vocabRef.current) {
        if (word.startsWith(trimmed) && word !== trimmed) {
          // Avoid duplicates with history
          if (!results.some((r) => r.text.toLowerCase() === word)) {
            results.push({ text: word, source: 'vocabulary' })
            if (results.length >= MAX_SUGGESTIONS) break
          }
        }
      }
    }

    setSuggestions(results)
    setLoading(false)
  }, [history])

  const clearSuggestions = useCallback(() => setSuggestions([]), [])

  /** Refresh the vocabulary cache (e.g. after creating new notes) */
  const refreshVocabulary = useCallback(async () => {
    try {
      const result = await db.query<{ word: string; ndoc: number }>(
        `SELECT word, ndoc FROM ts_stat('SELECT tsv FROM note WHERE deleted_at IS NULL')
         ORDER BY ndoc DESC LIMIT $1`,
        [VOCAB_LIMIT],
      )
      vocabRef.current = result.rows
    } catch {
      // Degrade gracefully
    }
  }, [db])

  return { suggestions, loading, getSuggestions, clearSuggestions, refreshVocabulary }
}
