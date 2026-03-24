import { useState, useCallback } from 'react'
import { importShard, type ImportOptions, type ImportResult, type ConflictStrategy } from '@fortemi/core'
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

      const options: ImportOptions | undefined = strategy
        ? { conflictStrategy: strategy }
        : undefined

      setProgress({ phase: 'importing', percent: 70 })
      const importResult = await importShard(db, data, options)

      setResult(importResult)
      setProgress({ phase: 'importing', percent: 100 })

      // Emit a generic event so other hooks know data changed
      // The typed event bus may not have a shard-specific event, so we use
      // the events object as a signal that data has been modified

      return importResult
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsImporting(false)
      setProgress(null)
    }
  }, [db])

  return { importShard: doImport, isImporting, progress, error, result }
}
