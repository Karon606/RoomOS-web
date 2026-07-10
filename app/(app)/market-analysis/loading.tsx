// 시세 조사 전환 즉시 표시되는 로딩 스켈레톤 — 동적 라우트 전환 렉 해결(감사 D6).
// 실제 화면 골격(제목·버튼 → 표)으로 자리를 잡아 레이아웃 점프 방지. 패딩은 AppShell 것만.
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="h-7 w-36 rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="flex gap-2">
          <div className="h-9 w-20 rounded-md bg-[var(--cream)] animate-pulse" />
          <div className="h-9 w-24 rounded-md bg-[var(--cream)] animate-pulse" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}
