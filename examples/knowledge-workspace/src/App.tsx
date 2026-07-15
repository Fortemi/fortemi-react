import { Suspense, lazy } from 'react'
import { ThemeToggle } from '@fortemi/examples-shared/ui'
import { LoadingBlock } from './app/Spinner'

const KnowledgeWorkspace = lazy(() => import('./app/FortemiApp'))

export default function App() {
  return (
    <main className="page-shell">
      <ThemeToggle floating />
      <header className="product-bar">
        <a className="brand" href="https://fortemi.com" aria-label="Fortemi home">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>Fortemi</span>
        </a>
        <a className="docs-link" href="https://docs.fortemi.com">Documentation</a>
      </header>

      <article className="workspace-page">
        <header className="workspace-intro">
          <p className="eyebrow">Complete browser application</p>
          <h1>Your knowledge, ready to work.</h1>
          <p className="lede">
            Search a research corpus, read source material, capture notes, and add semantic and AI capabilities only when the work calls for them.
          </p>
          <div className="trust-row" aria-label="Workspace status">
            <span><i className="status-dot" /> Local-first</span>
            <span>Shard-backed reader</span>
            <span>Private by default</span>
          </div>
        </header>

        <section className="workspace" aria-label="Fortemi knowledge workspace">
          <Suspense fallback={<LoadingBlock message="Opening the knowledge workspace..." />}>
            <KnowledgeWorkspace />
          </Suspense>
        </section>
      </article>
    </main>
  )
}
