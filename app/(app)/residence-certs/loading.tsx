// 실거주 확인서 전환 즉시 표시되는 로딩 스켈레톤 — 탭 전환 렉·빈 화면 방지(ID-21).
export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-7 w-32 rounded-md bg-[var(--cream)] animate-pulse" />
      <div className="space-y-2">
        <div className="h-5 w-28 rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="h-9 w-full rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-5 w-24 rounded-md bg-[var(--cream)] animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}
