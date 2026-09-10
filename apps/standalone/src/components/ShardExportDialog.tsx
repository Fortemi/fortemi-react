/**
 * ShardExportDialog — export knowledge data as a .shard archive.
 */

import { useState } from 'react'
import { useExportShard, type ExportProgress } from '@fortemi/react'

export function ShardExportDialog() {
  const { exportShard, isExporting, progress, error, report } = useExportShard()
  const [success, setSuccess] = useState(false)

  const handleExport = async () => {
    setSuccess(false)
    try {
      await exportShard()
      setSuccess(true)
    } catch {
      // Error captured by hook
    }
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Export Knowledge Shard</h4>
      <p style={{ color: '#666', fontSize: 12, margin: '0 0 12px' }}>
        Profile: 1.2.0/core-v1. Notes, collections, tags, templates, and links.
        Attachments: references only; file bytes are excluded.
        Embeddings, revision history, and advanced graph data are outside this profile.
      </p>

      {report && report.losses.length > 0 && (
        <div role="status" style={{ fontSize: 12, marginBottom: 12 }}>
          <strong>Export omissions and changes</strong>
          <ul style={{ paddingLeft: 20 }}>
            {report.losses.map((loss, index) => <li key={index}>{loss.message}</li>)}
          </ul>
        </div>
      )}

      {progress && (
        <ProgressBar progress={progress} />
      )}

      {error && (
        <div role="alert" style={{ background: '#fce8e6', color: '#c5221f', padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          Export failed: {error.message}
        </div>
      )}

      {success && (
        <div style={{ background: '#e6f4ea', color: '#137333', padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          core-v1 export complete. Attachment bytes excluded.
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
