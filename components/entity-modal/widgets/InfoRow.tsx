// Prism 공용 표시 한 줄 — 라벨(왼쪽) · 값(오른쪽). 모든 entity body 위젯 공통.

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[var(--warm-border)]/50 last:border-0 gap-4">
      <span className="text-xs text-[var(--warm-muted)] shrink-0">{label}</span>
      {/* 값이 길면 줄어들 수 있어야 한다. flex 자식의 기본 min-width:auto 가 없으면
          긴 이메일이 라벨을 밀거나 컨테이너 밖에서 잘린다(신고 d03a6c1f). */}
      <span className="text-sm text-[var(--warm-dark)] text-right min-w-0 [overflow-wrap:anywhere]">{value}</span>
    </div>
  )
}
