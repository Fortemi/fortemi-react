import { useState, useCallback } from 'react'
import { exportShard, type ExportOptions } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export interface ExportProgress {
  phase: 'querying' | 'serializing' | 'compressing' | 'downloading'
  percent: number
}

export function useExportShard() {
  const { db } = useFortemiContext()
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const doExport = useCallback(async (options?: ExportOptions): Promise<void> => {
    try {
      setIsExporting(true)
      setError(null)

      setProgress({ phase: 'querying', percent: 10 })
      // exportShard handles querying, serializing, and compressing internally
      setProgress({ phase: 'serializing', percent: 30 })
      const archiveBytes = await exportShard(db, options)

      setProgress({ phase: 'compressing', percent: 70 })
      // Copy into a plain ArrayBuffer to satisfy Blob's type requirements
      const ab = new ArrayBuffer(archiveBytes.byteLength)
      new Uint8Array(ab).set(archiveBytes)
      const blob = new Blob([ab], { type: 'application/gzip' })

      setProgress({ phase: 'downloading', percent: 90 })
      // Trigger browser download
      const url = URL.createObjectURL(blob)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `matric-shard-${timestamp}.shard`

      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setProgress({ phase: 'downloading', percent: 100 })
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsExporting(false)
      setProgress(null)
    }
  }, [db])

  return { exportShard: doExport, isExporting, progress, error }
}
