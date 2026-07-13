// EX-13 · shard-exchange
//
// Two independent Fortémi instances in one page — each its own PGlite database,
// keyed by a distinct `archiveName`. Instance A seeds notes and exports a
// Knowledge Shard; instance B imports those bytes with a chosen conflict
// strategy. This is the poor-man's-sync transport: no server, no protocol —
// just a portable `.shard` handed from one database to another.

import { useState } from 'react'
import { FortemiProvider } from '@fortemi/react'
import type { ConflictStrategy } from '@fortemi/core'
import { SourceInstance } from './SourceInstance.js'
import { TargetInstance } from './TargetInstance.js'

export function App() {
  const [shard, setShard] = useState<Uint8Array | null>(null)
  const [strategy, setStrategy] = useState<ConflictStrategy>('skip')

  return (
    <main className="page">
      <header>
        <h1>EX-13 · shard-exchange</h1>
        <p className="lede">
          Two independent databases in one tab. Instance&nbsp;A exports a{' '}
          <code>.shard</code>; instance&nbsp;B imports the bytes with a conflict strategy. A shard is
          the whole sync transport — export here, import there, no server in between.
        </p>
      </header>

      <section className="exchange">
        <FortemiProvider persistence="memory" archiveName="source">
          <SourceInstance onExport={setShard} exported={shard != null} />
        </FortemiProvider>

        <FortemiProvider persistence="memory" archiveName="target">
          <TargetInstance shard={shard} strategy={strategy} onStrategy={setStrategy} />
        </FortemiProvider>
      </section>
    </main>
  )
}
