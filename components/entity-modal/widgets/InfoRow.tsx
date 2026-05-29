// Prism 공용 표시 한 줄 — 라벨(왼쪽) · 값(오른쪽). 모든 entity body 위젯 공통.

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[var(--warm-border)]/50 last:border-0 gap-4">
      <span className="text-xs text-[var(--warm-muted)] shrink-0">{label}</span>
      <span className="text-sm text-[var(--warm-dark)] text-right">{value}</span>
    </div>
  )
}
