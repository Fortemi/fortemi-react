import { useState, useCallback } from 'react'
import { exportShardWithReport, type ExportOptions, type ShardCapabilityReport } from '@fortemi/core'
import { useFortemiContext } from '../FortemiProvider.js'

export interface ExportProgress {
  phase: 'querying' | 'serializing' | 'compressing' | 'downloading'
  percent: number
}

export function useExportShard() {
  const { db, blobStore } = useFortemiContext()
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [report, setReport] = useState<ShardCapabilityReport | null>(null)

  const doExport = useCallback(async (options?: ExportOptions): Promise<void> => {
    try {
      setIsExporting(true)
      setError(null)
      setReport(null)

      const selected = {
        ...options,
        profile: options?.profile ?? 'core-v1',
        schemaVersion: options?.schemaVersion ?? '1.2.0',
        blobStore: options?.blobStore ?? blobStore,
      } satisfies ExportOptions & { profile: string }
      if (selected.profile === 'core-v1' && (
        selected.includeEmbeddings || selected.embeddingSetIds !== undefined
        || selected.includeMaterializedSelectors
      )) {
        throw new Error('core-v1 does not support embedding or materialized-selector export options')
      }

      setProgress({ phase: 'querying', percent: 10 })
      setProgress({ phase: 'serializing', percent: 30 })
      const result = await exportShardWithReport(db, selected)
      setReport(result.capability_report)
      if (!result.success || !result.archive) {
        throw new Error(result.errors.join('; ') || 'Shard export did not produce an archive')
      }
      const archiveBytes = result.archive

      setProgress({ phase: 'compressing', percent: 70 })
      // Copy into a plain ArrayBuffer to satisfy Blob's type requirements
      const ab = new ArrayBuffer(archiveBytes.byteLength)
      new Uint8Array(ab).set(archiveBytes)
      const blob = new Blob([ab], { type: 'application/gzip' })

      setProgress({ phase: 'downloading', percent: 90 })
      // Trigger browser download
      const url = URL.createObjectURL(blob)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `fortemi-${selected.profile}-${timestamp}.shard`

      const a = document.createElement('a')
      try {
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
      } finally {
        a.remove()
        URL.revokeObjectURL(url)
      }

      setProgress({ phase: 'downloading', percent: 100 })
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsExporting(false)
      setProgress(null)
    }
  }, [db, blobStore])

  return { exportShard: doExport, isExporting, progress, error, report }
}
