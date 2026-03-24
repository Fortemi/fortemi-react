/**
 * ShardBackupSection — compact export/import for example apps, scoped by app tag.
 */

import { useState, useRef, type DragEvent } from 'react'
import { useExportShard, useImportShard } from '@fortemi/react'
import type { ConflictStrategy } from '@fortemi/core'

interface ShardBackupSectionProps {
  /** The app tag to scope export (e.g. 'app:research') */
  appTag: string
  /** Human-readable app name (e.g. 'Research Papers') */
  appName: string
}

export function ShardBackupSection({ appTag, appName }: ShardBackupSectionProps) {
  const { exportShard, isExporting, error: exportError } = useExportShard()
  const { importShard, isImporting, result } = useImportShard()
  const [isDragOver, setIsDragOver] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setExportSuccess(false)
    try {
      await exportShard({ tag: appTag })
      setExportSuccess(true)
    } catch {
      // captured by hook
    }
  }

  const handleFile = async (file: File) => {
    await importShard(file, 'skip' as ConflictStrategy)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  const busy = isExporting || isImporting

  return (
    <details style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, marginBottom: 16, background: '#f8f9fa' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666', userSelect: 'none' }}>
        Backup &amp; Restore {appName}
      </summary>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Export */}
        <button
          onClick={handleExport}
          disabled={busy}
          style={{
            padding: '5px 12px',
            background: busy ? '#ccc' : '#4a9eff',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: busy ? 'default' : 'pointer',
            fontSize: 12,
          }}
        >
          {isExporting ? 'Exporting...' : `Export ${appName}`}
        </button>

        {/* Import drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => !busy && fileInputRef.current?.click()}
          style={{
            border: `1px dashed ${isDragOver ? '#4a9eff' : '#bbb'}`,
            borderRadius: 4,
            padding: '5px 12px',
            cursor: busy ? 'default' : 'pointer',
            fontSize: 12,
            color: '#666',
            background: isDragOver ? '#f0f7ff' : 'transparent',
            transition: 'all 0.2s',
          }}
        >
          {isImporting ? 'Importing...' : 'Drop .shard or click to import'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".shard"
            onChange={handleFileInput}
            style={{ display: 'none' }}
            disabled={busy}
          />
        </div>
      </div>

      {/* Feedback */}
      {exportSuccess && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#137333' }}>
          Exported! Check your downloads folder.
        </div>
      )}
      {exportError && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#c5221f' }}>
          Export failed: {exportError.message}
        </div>
      )}
      {result && (
        <div style={{ marginTop: 6, fontSize: 11, color: result.success ? '#137333' : '#c5221f' }}>
          {result.success
            ? `Imported ${result.counts.notes} notes, ${result.counts.links} links (${Math.round(result.duration_ms)}ms)`
            : `Import failed: ${result.errors[0]}`
          }
          {result.warnings.length > 0 && (
            <span style={{ color: '#f5a623', marginLeft: 6 }}>
              ({result.warnings.length} warning{result.warnings.length > 1 ? 's' : ''})
            </span>
          )}
        </div>
      )}

      <div style={{ marginTop: 6, fontSize: 10, color: '#aaa' }}>
        Export includes only notes tagged <code>{appTag}</code> and their links.
      </div>
    </details>
  )
}
