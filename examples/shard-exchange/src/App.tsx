// EX-13 · shard-exchange
//
// Two independent Fortémi instances in one page — each its own PGlite database,
// keyed by a distinct `archiveName`. Instance A seeds notes and exports a
// Knowledge Shard; instance B imports those bytes with a chosen conflict
// strategy. This is the poor-man's-sync transport: no server, no protocol —
// just a portable `.shard` handed from one database to another.

import { useState } from 'react'
import { ThemeToggle } from '@fortemi/examples-shared/ui'
import { FortemiProvider } from '@fortemi/react'
import type { ConflictStrategy } from '@fortemi/core'
import { SourceInstance } from './SourceInstance.js'
import { TargetInstance } from './TargetInstance.js'

export function App() {
  const [shard, setShard] = useState<Uint8Array | null>(null)
  const [strategy, setStrategy] = useState<ConflictStrategy>('skip')

  return (
    <main className="page">
      <ThemeToggle floating />
      <header>
        <h1>EX-13 · shard-exchange</h1>
        <p className="lede">
          Two independent databases in one tab. Instance&nbsp;A exports a{' '}
          <code>.shard</code>; instance&nbsp;B imports the bytes with a conflict strategy. A shard is
          the whole sync transport — export here, import there, no server in between.
        </p>
      </header>

      {/*
        Two live databases on one page. Each FortemiProvider runs in WORKER
        execution mode so its PGlite engine lives in its own Worker realm: the
        PGlite WASM module is fetched-and-compiled once per realm, side-stepping
        the single-page "already read Response" collision that main-mode incurs
        when a second in-page instance tries to re-compile the shared WASM
        Response. The shard export/import path is pure SQL, so it works
        identically over the worker's query/exec/transaction surface.
      */}
      <section className="exchange">
        <FortemiProvider persistence="memory" archiveName="source" executionMode="worker">
          <SourceInstance onExport={setShard} exported={shard != null} />
        </FortemiProvider>

        <FortemiProvider persistence="memory" archiveName="target" executionMode="worker">
          <TargetInstance shard={shard} strategy={strategy} onStrategy={setStrategy} />
        </FortemiProvider>
      </section>
    </main>
  )
}
