'use client'

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="p-6 rounded-2xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <h2 className="font-semibold text-red-500 mb-2">설정 페이지 오류</h2>
      <p className="text-sm mb-1" style={{ color: 'var(--warm-muted)' }}>{error.message}</p>
      {error.digest && (
        <p className="text-xs font-mono mb-3" style={{ color: 'var(--warm-muted)' }}>digest: {error.digest}</p>
      )}
      <button onClick={reset}
        className="px-4 py-2 text-sm text-white rounded-xl"
        style={{ background: 'var(--coral)' }}>
        다시 시도
      </button>
    </div>
  )
}
