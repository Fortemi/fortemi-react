interface LoadingScreenProps {
  message: string
}

export function LoadingScreen({ message }: LoadingScreenProps) {
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
        width: 200,
        height: 4,
        background: '#e0e0e0',
        borderRadius: 2,
        overflow: 'hidden',
        marginTop: 16,
      }}>
        <div style={{
          width: '60%',
          height: '100%',
          background: '#4a9eff',
          borderRadius: 2,
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      </div>
      <p style={{ color: '#666', marginTop: 12, fontSize: 14 }}>{message}</p>
    </div>
  )
}
