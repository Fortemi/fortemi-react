// EX-19 · dual-instance-sync
//
// Two in-browser instances start with *divergent* notes and converge by
// exchanging shards both ways. There is no server and no sync protocol — a
// bidirectional shard swap (export A → import B, export B → import A, with the
// `skip` conflict strategy) merges each side's set into the union. Run it twice
// and nothing changes: the exchange is idempotent, so the two databases are
// eventually consistent.

import { useCallback, useRef, useState } from 'react'
import { ThemeToggle } from '@fortemi/examples-shared/ui'
import { FortemiProvider } from '@fortemi/react'
import { seedNotes } from '@fortemi/examples-shared'
import { Instance, type SyncHandle } from './Instance.js'

// Deliberately divergent, with a deliberate overlap so `skip` has something to skip.
const LEFT_SLICE = [0, 1, 2, 3]
const RIGHT_SLICE = [3, 4, 5]
const UNION = new Set([...LEFT_SLICE, ...RIGHT_SLICE]).size

export function App() {
  const left = useRef<SyncHandle | null>(null)
  const right = useRef<SyncHandle | null>(null)
  const [leftCount, setLeftCount] = useState(0)
  const [rightCount, setRightCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [rounds, setRounds] = useState(0)

  const onLeftReady = useCallback((h: SyncHandle) => { left.current = h }, [])
  const onRightReady = useCallback((h: SyncHandle) => { right.current = h }, [])
  const onLeftCount = useCallback((total: number) => setLeftCount(total), [])
  const onRightCount = useCallback((total: number) => setRightCount(total), [])

  const sync = async () => {
    if (!left.current || !right.current) return
    setSyncing(true)
    try {
      // Bidirectional exchange, skip conflicts → both converge to the union.
      const a = await left.current.exportBytes()
      await right.current.importBytes(a)
      const b = await right.current.exportBytes()
      await left.current.importBytes(b)
      await left.current.refresh()
      await right.current.refresh()
      setRounds((r) => r + 1)
    } finally {
      setSyncing(false)
    }
  }

  const converged = rounds > 0 && leftCount === rightCount && leftCount === UNION

  return (
    <main className="page">
      <ThemeToggle floating />
      <header>
        <h1>EX-19 · dual-instance-sync</h1>
        <p className="lede">
          Two databases start out of sync — {seedNotes ? `${LEFT_SLICE.length} notes on A, ${RIGHT_SLICE.length} on B, sharing one` : ''}.
          A bidirectional shard swap (export ↔ import, <code>skip</code> on conflict) merges each into
          the union of {UNION}. It's idempotent: sync again and nothing changes.
        </p>
      </header>

      <div className="row sync-bar">
        <button onClick={sync} disabled={syncing}>
          {syncing ? 'Syncing…' : rounds === 0 ? 'Sync A ↔ B' : 'Sync again'}
        </button>
        <span className="muted">
          A: {leftCount} · B: {rightCount} · rounds: {rounds}
          {converged && ' · ✓ converged'}
        </span>
      </div>

      {/*
        Two live databases on one page → WORKER execution mode for each. Each
        PGlite engine gets its own Worker realm, so the WASM module is
        fetched-and-compiled once per realm and the second in-page instance can't
        hit the shared "already read Response" collision that main mode incurs.
        Sync is shard export/import (pure SQL), which works over the worker's
        query/exec/transaction surface.
      */}
      <section className="exchange">
        <FortemiProvider persistence="memory" archiveName="left" executionMode="worker">
          <Instance label="A" slice={LEFT_SLICE} onReady={onLeftReady} onCount={onLeftCount} />
        </FortemiProvider>
        <FortemiProvider persistence="memory" archiveName="right" executionMode="worker">
          <Instance label="B" slice={RIGHT_SLICE} onReady={onRightReady} onCount={onRightCount} />
        </FortemiProvider>
      </section>
    </main>
  )
}
