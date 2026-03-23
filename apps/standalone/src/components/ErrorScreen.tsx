interface ErrorScreenProps {
  error: string
}

export function ErrorScreen({ error }: ErrorScreenProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <h1>fortemi</h1>
      <div style={{
        background: '#fee',
        border: '1px solid #fcc',
        borderRadius: 8,
        padding: 16,
        maxWidth: 400,
        marginTop: 16,
      }}>
        <p style={{ color: '#c00', margin: 0 }}>Failed to initialize</p>
        <p style={{ color: '#666', fontSize: 14, marginTop: 8 }}>{error}</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}
      >
        Retry
      </button>
    </div>
  )
}
