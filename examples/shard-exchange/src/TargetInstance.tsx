// Instance B — starts empty and imports the shard bytes from instance A.

import { useState } from 'react'
import type { ConflictStrategy, ImportResult } from '@fortemi/core'
import { useNotes, useImportShard } from '@fortemi/react'

const STRATEGIES: ConflictStrategy[] = ['skip', 'replace', 'error']

export function TargetInstance({
  shard,
  strategy,
  onStrategy,
}: {
  shard: Uint8Array | null
  strategy: ConflictStrategy
  onStrategy: (s: ConflictStrategy) => void
}) {
  const { data, refresh } = useNotes({ limit: 100, sort: 'created_at', order: 'asc' })
  const { importShard, isImporting } = useImportShard()
  const [result, setResult] = useState<ImportResult | null>(null)

  const doImport = async () => {
    if (!shard) return
    // The hook reads a File; wrap the in-memory bytes handed over from instance A.
    // Copy into a fresh ArrayBuffer to satisfy File's BlobPart typing.
    const ab = new ArrayBuffer(shard.byteLength)
    new Uint8Array(ab).set(shard)
    const file = new File([ab], 'exchange.shard', { type: 'application/gzip' })
    const res = await importShard(file, strategy)
    setResult(res)
    await refresh()
  }

  const nonZero = result ? Object.entries(result.counts).filter(([, v]) => v > 0) : []

  return (
    <div className="instance">
      <h2>Instance B · target</h2>
      <p className="muted">A separate empty database ({data?.total ?? 0} notes).</p>
      <div className="row">
        <label className="muted">
          On conflict{' '}
          <select value={strategy} onChange={(e) => onStrategy(e.target.value as ConflictStrategy)}>
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <button onClick={doImport} disabled={!shard || isImporting}>
          {isImporting ? 'Importing…' : '← Import shard'}
        </button>
      </div>

      {!shard && <p className="muted report">Export from instance A first.</p>}

      {result && (
        <div className="report">
          <strong>{result.success ? 'Imported' : 'Import failed'}</strong> in {result.duration_ms} ms
          <div className="chips">
            {nonZero.map(([k, v]) => (
              <span key={k} className="chip small">{k.replace(/_/g, ' ')}: {v}</span>
            ))}
          </div>
          {result.warnings.length > 0 && (
            <p className="muted">{result.warnings.length} warning(s)</p>
          )}
        </div>
      )}

      <ul className="note-list">
        {data?.items.map((n) => (
          <li key={n.id} className="note">{n.title ?? 'Untitled'}</li>
        ))}
      </ul>
    </div>
  )
}
