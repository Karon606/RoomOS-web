export default function AppLoading() {
  return (
    <div className="space-y-3.5 animate-pulse">
      <div className="h-8 w-48 rounded-lg" style={{ background: 'var(--warm-border)' }} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl h-24" style={{ background: 'var(--warm-border)' }} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5">
        <div className="rounded-xl h-72" style={{ background: 'var(--warm-border)' }} />
        <div className="flex flex-col gap-3.5">
          <div className="rounded-xl flex-1 h-32" style={{ background: 'var(--warm-border)' }} />
          <div className="rounded-xl flex-1 h-32" style={{ background: 'var(--warm-border)' }} />
        </div>
      </div>
    </div>
  )
}
