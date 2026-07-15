export function Spinner({
  size = 16,
  color = 'var(--color-lit-accent-live)',
  track = 'var(--color-lit-rule)',
}: {
  size?: number
  color?: string
  track?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={track} strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}

export function LoadingBlock({ message }: { message: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <Spinner />
      <span>{message}</span>
    </div>
  )
}

export default Spinner
