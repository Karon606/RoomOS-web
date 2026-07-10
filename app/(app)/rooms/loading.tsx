// 수납 관리 전환 즉시 표시되는 로딩 스켈레톤 — 동적 라우트 전환 렉 해결(감사 D6).
// 실제 화면 골격(제목·월셀렉터 → 요약 → 목록)으로 자리를 잡아 레이아웃 점프 방지. 패딩은 AppShell 것만.
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="h-7 w-40 rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="h-9 w-32 rounded-md bg-[var(--cream)] animate-pulse" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
        ))}
      </div>
      <div className="h-10 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}
