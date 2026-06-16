import { useState, useCallback } from 'react'
import {
  importShard,
  prefetchShard,
  fromPrefetched,
  isShardPrefetched,
  type ImportOptions,
  type ImportResult,
  type ConflictStrategy,
  type PrefetchOptions,
} from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export interface ImportProgress {
  phase: 'reading' | 'unpacking' | 'validating' | 'importing'
  percent: number
}

export function useImportShard() {
  const { db } = useFortemiContext()
  const [isImporting, setIsImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const runImport = useCallback(async (
    data: Uint8Array,
    strategy?: ConflictStrategy,
  ): Promise<ImportResult> => {
    const options: ImportOptions | undefined = strategy
      ? { conflictStrategy: strategy }
      : undefined
    setProgress({ phase: 'importing', percent: 70 })
    const importResult = await importShard(db, data, options)
    setResult(importResult)
    setProgress({ phase: 'importing', percent: 100 })
    return importResult
  }, [db])

  const doImport = useCallback(async (
    file: File,
    strategy?: ConflictStrategy,
  ): Promise<ImportResult> => {
    try {
      setIsImporting(true)
      setError(null)
      setResult(null)

      setProgress({ phase: 'reading', percent: 10 })
      const arrayBuffer = await file.arrayBuffer()
      const data = new Uint8Array(arrayBuffer)

      setProgress({ phase: 'unpacking', percent: 30 })
      setProgress({ phase: 'validating', percent: 50 })

      return await runImport(data, strategy)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsImporting(false)
      setProgress(null)
    }
  }, [runImport])

  /**
   * Import a shard from a static-asset URL (#181). When the bytes were already
   * warmed via {@link useShardPrefetch}/`prefetchShard`, no download happens —
   * the click is purely the index build. Otherwise the bytes are fetched first
   * (and SHA-verified if `prefetchOptions.expectedSha256` is given).
   */
  const importFromUrl = useCallback(async (
    url: string,
    strategy?: ConflictStrategy,
    prefetchOptions?: PrefetchOptions,
  ): Promise<ImportResult> => {
    try {
      setIsImporting(true)
      setError(null)
      setResult(null)

      let data: Uint8Array
      if (isShardPrefetched(url)) {
        data = fromPrefetched(url) // warm — skip the download
      } else {
        setProgress({ phase: 'reading', percent: 10 })
        const warm = await prefetchShard(url, prefetchOptions)
        data = warm.bytes
      }

      setProgress({ phase: 'validating', percent: 50 })
      return await runImport(data, strategy)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsImporting(false)
      setProgress(null)
    }
  }, [runImport])

  return { importShard: doImport, importFromUrl, isImporting, progress, error, result }
}
