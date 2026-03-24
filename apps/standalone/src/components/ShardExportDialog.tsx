/**
 * ShardExportDialog — export knowledge data as a .shard archive.
 */

import { useState } from 'react'
import { useExportShard, type ExportProgress } from '@fortemi/react'

export function ShardExportDialog() {
  const { exportShard, isExporting, progress, error } = useExportShard()
  const [includeEmbeddings, setIncludeEmbeddings] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleExport = async () => {
    setSuccess(false)
    try {
      await exportShard({ includeEmbeddings })
      setSuccess(true)
    } catch {
      // Error captured by hook
    }
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Export Knowledge Shard</h4>
      <p style={{ color: '#666', fontSize: 12, margin: '0 0 12px' }}>
        Export all notes, collections, tags, and links as a portable .shard archive
        compatible with the fortemi server.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 12, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={includeEmbeddings}
          onChange={(e) => setIncludeEmbeddings(e.target.checked)}
          disabled={isExporting}
        />
        <span>
          Include embeddings
          <span style={{ color: '#999', marginLeft: 4 }}>(can significantly increase file size)</span>
        </span>
      </label>

      {progress && (
        <ProgressBar progress={progress} />
      )}

      {error && (
        <div style={{ background: '#fce8e6', color: '#c5221f', padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          Export failed: {error.message}
        </div>
      )}

      {success && (
        <div style={{ background: '#e6f4ea', color: '#137333', padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          Export complete. Check your downloads folder.
        </div>
      )}

      <button
        onClick={handleExport}
        disabled={isExporting}
        style={{
          padding: '6px 16px',
          background: isExporting ? '#ccc' : '#4a9eff',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: isExporting ? 'default' : 'pointer',
          fontSize: 12,
        }}
      >
        {isExporting ? 'Exporting...' : 'Export Shard'}
      </button>
    </div>
  )
}

function ProgressBar({ progress }: { progress: ExportProgress }) {
  const labels: Record<string, string> = {
    querying: 'Querying data...',
    serializing: 'Serializing...',
    compressing: 'Compressing...',
    downloading: 'Preparing download...',
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
        {labels[progress.phase] ?? progress.phase}
      </div>
      <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div
          style={{
            background: '#4a9eff',
            height: '100%',
            width: `${progress.percent}%`,
            transition: 'width 0.3s',
          }}
        />
      </div>
    </div>
  )
}
