// 스켈레톤 로더 — 콘텐츠가 로드되기 전, 자리만 잡는 반투명 박스가 살짝 깜빡(pulse).
// 페이지 이동 시 빈 화면 대신 "곧 뜬다"는 신호를 줘 답답함을 줄인다.
// Brand Guide 톤(cream-3 디바이더 색)으로 은은하게.

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--cream-3)]/60 ${className}`}
      aria-hidden="true"
    />
  )
}

// 카드 한 장 모양 스켈레톤 — 대시보드·방·재고 등 카드형 화면 공용.
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-7 w-20" />
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

// 목록형 자리표시 — 인라인 "불러오는 중…" 텍스트 금지(v2.0 §17)의 표준 대체. 시각 텍스트 없이 aria만.
export function SkeletonRows({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  )
}
