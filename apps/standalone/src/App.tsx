import { VERSION } from '@fortemi/core'
import { useFortemi } from './hooks/useFortemi'
import { LoadingScreen } from './components/LoadingScreen'
import { ErrorScreen } from './components/ErrorScreen'

export function App() {
  const state = useFortemi({ persistence: 'memory' })

  if (state.status === 'loading') {
    return <LoadingScreen message={state.message} />
  }

  if (state.status === 'error') {
    return <ErrorScreen error={state.error} />
  }

  return (
    <div>
      <h1>fortemi-browser</h1>
      <p>v{VERSION}</p>
      <p>Database ready (archive: {state.archiveManager.getCurrentArchiveName()})</p>
    </div>
  )
}
