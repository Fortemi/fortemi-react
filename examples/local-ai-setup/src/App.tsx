// EX-12 · local-ai-setup
//
// Progressive AI enhancement, honestly gated. On mount the app DETECTS the
// hardware tier (WebGPU / WASM / WebNN / VRAM) and DISCOVERS local inference
// servers (Ollama, LM Studio) — both are pure probes, no download, instant.
// Embeddings are opt-in: `useCapabilitySetup({ autoEnable: [] })` registers the
// transformers.js loader but enables nothing, so the model downloads only when
// you click "Enable embeddings". Then the job queue runs embedding jobs for the
// notes you seed — the pipeline you can watch.

import { useMemo, useState } from 'react'
import {
  useFortemiContext,
  useGpuCapabilities,
  useInferenceCapabilities,
  useLocalDiscovery,
  useCapabilitySetup,
  useJobQueue,
  useNotes,
  useCreateNote,
} from '@fortemi/react'
import { seedNotes } from '@fortemi/examples-shared'
import { setupCapabilities } from './setup.js'

export function App() {
  const { capabilityManager } = useFortemiContext()
  const gpu = useGpuCapabilities()
  const inf = useInferenceCapabilities()
  const discovery = useLocalDiscovery({ interval: 0 })
  const { jobs } = useJobQueue(1500)
  const { data: notes, refresh } = useNotes({ limit: 50, sort: 'created_at', order: 'desc' })
  const { createNote } = useCreateNote()

  const [progress, setProgress] = useState<string>('')
  const [semanticOn, setSemanticOn] = useState(false)
  const [enabling, setEnabling] = useState(false)

  // Register the loader on mount; enable NOTHING (opt-in only → no download).
  const setup = useMemo(() => ({
    setup: (m: Parameters<typeof setupCapabilities>[0]) => setupCapabilities(m, setProgress),
    autoEnable: [] as never[],
  }), [])
  useCapabilitySetup(setup)

  const enableEmbeddings = async () => {
    setEnabling(true)
    try {
      await capabilityManager.enable('semantic')
      setSemanticOn(true)
    } catch (e) {
      setProgress(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setEnabling(false)
    }
  }

  const seed = async () => {
    for (const n of seedNotes.slice(0, 4)) {
      await createNote({ title: n.title, content: n.body, tags: n.tags })
    }
    await refresh()
  }

  const caps = inf.capabilities
  const yn = (b: boolean | undefined) => (b ? '✓' : '—')

  return (
    <main className="page wide">
      <header>
        <h1>EX-12 · local-ai-setup</h1>
        <p className="lede">
          Detect the hardware tier, discover local model servers, and <strong>opt in</strong> to an
          embedding model — nothing downloads until you ask. Detection and discovery are pure probes
          (instant, no download); the embedding model is fetched from the Hugging Face CDN only when
          you enable it.
        </p>
      </header>

      <section className="cards">
        <div className="card">
          <h2>Inference tier</h2>
          {inf.loading ? (
            <p className="muted">Detecting…</p>
          ) : caps ? (
            <ul className="kv">
              <li><span>Recommended tier</span><strong className={`tier tier-${caps.recommendedTier}`}>{caps.recommendedTier}</strong></li>
              <li><span>Estimated VRAM</span><b>{caps.estimatedVramMB} MB</b></li>
              <li><span>WebGPU</span><b>{yn(caps.webgpu)}</b></li>
              <li><span>WASM</span><b>{yn(caps.wasm)}</b></li>
              <li><span>WebNN</span><b>{yn(caps.webnn)}</b></li>
              <li><span>SharedArrayBuffer</span><b>{yn(caps.sharedArrayBuffer)}</b></li>
              <li><span>Chrome AI</span><b>{yn(caps.chromeAI)}</b></li>
            </ul>
          ) : (
            <p className="muted">{inf.error ? inf.error.message : 'Unavailable'}</p>
          )}
        </div>

        <div className="card">
          <h2>GPU</h2>
          {gpu.isDetecting ? (
            <p className="muted">Detecting…</p>
          ) : gpu.caps ? (
            <ul className="kv">
              <li><span>VRAM tier</span><strong className={`tier tier-${gpu.vramTier}`}>{gpu.vramTier}</strong></li>
              <li><span>Vendor</span><b>{gpu.caps.vendor || '—'}</b></li>
              <li><span>Architecture</span><b>{gpu.caps.architecture || '—'}</b></li>
              <li><span>WebGPU</span><b>{yn(gpu.caps.webgpuAvailable)}</b></li>
              <li><span>f16</span><b>{yn(gpu.caps.supportsF16)}</b></li>
            </ul>
          ) : (
            <p className="muted">{gpu.error ? gpu.error.message : 'No WebGPU'}</p>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Local servers</h2>
            <button className="ghost sm" onClick={discovery.refresh} disabled={discovery.discovering}>
              {discovery.discovering ? 'Scanning…' : 'Rescan'}
            </button>
          </div>
          {discovery.providers.length === 0 ? (
            <p className="muted">
              {discovery.discovering ? 'Scanning localhost…' : 'None found. Start Ollama or LM Studio, then Rescan.'}
            </p>
          ) : (
            <ul className="providers">
              {discovery.providers.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>
                  <span className="muted mono">{p.baseURL}</span>
                  <span className="chip small">{p.models.length} models</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="pipeline">
        <div className="row bar">
          <button onClick={enableEmbeddings} disabled={enabling || semanticOn}>
            {semanticOn ? '✓ Embeddings enabled' : enabling ? 'Enabling…' : 'Enable embeddings (opt-in)'}
          </button>
          <button className="ghost" onClick={seed}>Seed 4 notes</button>
          {progress && <span className="muted">{progress}</span>}
        </div>

        <div className="split">
          <div className="panel">
            <h3>Notes ({notes?.total ?? 0})</h3>
            <ul className="note-list">
              {notes?.items.map((n) => (
                <li key={n.id} className="note">{n.title ?? 'Untitled'}</li>
              ))}
              {!notes?.total && <li className="muted">Seed notes to enqueue pipeline jobs.</li>}
            </ul>
          </div>
          <div className="panel">
            <h3>Job pipeline ({jobs.length})</h3>
            <ul className="job-list">
              {jobs.map((j) => (
                <li key={j.id} className="job">
                  <span className={`badge s-${j.status}`}>{j.status}</span>
                  <span className="mono">{j.job_type}</span>
                  {j.required_capability && <span className="chip small">{j.required_capability}</span>}
                </li>
              ))}
              {jobs.length === 0 && (
                <li className="muted">
                  The server-compatible queue runs revision → title → embedding → tagging → linking.
                  Embedding jobs need the semantic capability enabled.
                </li>
              )}
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
