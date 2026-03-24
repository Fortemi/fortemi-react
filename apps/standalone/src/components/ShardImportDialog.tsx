/**
 * ShardImportDialog — import a .shard archive into the knowledge base.
 */

import { useState, useRef, type DragEvent } from 'react'
import { useImportShard, type ImportProgress } from '@fortemi/react'
import type { ConflictStrategy, ImportResult } from '@fortemi/core'

export function ShardImportDialog() {
  const { importShard, isImporting, progress, error, result } = useImportShard()
  const [strategy, setStrategy] = useState<ConflictStrategy>('skip')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    await importShard(file, strategy)
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
  }

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Import Knowledge Shard</h4>
      <p style={{ color: '#666', fontSize: 12, margin: '0 0 12px' }}>
        Import a .shard archive exported from fortemi (browser or server).
      </p>

      {/* Conflict strategy */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>On duplicate records:</div>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['skip', 'replace', 'error'] as const).map((s) => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="radio"
                name="conflict-strategy"
                checked={strategy === s}
                onChange={() => setStrategy(s)}
                disabled={isImporting}
              />
              {s === 'skip' ? 'Skip' : s === 'replace' ? 'Replace' : 'Abort'}
            </label>
          ))}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragOver ? '#4a9eff' : '#ccc'}`,
          borderRadius: 8,
          padding: 24,
          textAlign: 'center',
          cursor: isImporting ? 'default' : 'pointer',
          marginBottom: 12,
          background: isDragOver ? '#f0f7ff' : '#fafafa',
          transition: 'all 0.2s',
        }}
      >
        <div style={{ fontSize: 13, color: '#666' }}>
          {isImporting ? 'Importing...' : 'Drop .shard file here or click to browse'}
        </div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
          Accepts .shard files (gzip tar archives)
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".shard"
          onChange={handleFileInput}
          style={{ display: 'none' }}
          disabled={isImporting}
        />
      </div>

      {/* Progress */}
      {progress && <ImportProgressBar progress={progress} />}

      {/* Error */}
      {error && (
        <div style={{ background: '#fce8e6', color: '#c5221f', padding: 8, borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          Import failed: {error.message}
        </div>
      )}

      {/* Result */}
      {result && <ImportResultSummary result={result} />}
    </div>
  )
}

function ImportProgressBar({ progress }: { progress: ImportProgress }) {
  const labels: Record<string, string> = {
    reading: 'Reading file...',
    unpacking: 'Unpacking archive...',
    validating: 'Validating checksums...',
    importing: 'Importing data...',
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

function ImportResultSummary({ result }: { result: ImportResult }) {
  const color = result.success ? '#137333' : '#c5221f'
  const bg = result.success ? '#e6f4ea' : '#fce8e6'

  return (
    <div style={{ background: bg, borderRadius: 4, padding: 12, fontSize: 12, marginBottom: 8 }}>
      <div style={{ color, fontWeight: 500, marginBottom: 4 }}>
        {result.success ? 'Import successful' : 'Import failed'}
      </div>

      {result.success && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', color: '#333' }}>
          <span>Notes:</span><span>{result.counts.notes}</span>
          <span>Collections:</span><span>{result.counts.collections}</span>
          <span>Tags:</span><span>{result.counts.tags}</span>
          <span>Links:</span><span>{result.counts.links}</span>
          {result.counts.embeddings > 0 && (
            <>
              <span>Embeddings:</span><span>{result.counts.embeddings}</span>
            </>
          )}
          <span>Duration:</span><span>{Math.round(result.duration_ms)}ms</span>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div style={{ marginTop: 8, color: '#f5a623' }}>
          {result.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      {result.errors.length > 0 && (
        <div style={{ marginTop: 8, color: '#c5221f' }}>
          {result.errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  )
}
