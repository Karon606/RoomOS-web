export default function AppLoading() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
      <div
        className="w-8 h-8 rounded-full border-[3px] animate-spin"
        style={{
          borderColor: 'var(--warm-border)',
          borderTopColor: 'var(--coral)',
        }}
      />
    </div>
  )
}
