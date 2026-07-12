// 계약서 모아보기 전환 즉시 표시되는 로딩 스켈레톤 — 탭 전환 렉·빈 화면 방지(ID-21).
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-7 w-24 rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="h-4 w-3/4 rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="h-9 w-full rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="flex flex-wrap gap-2">
          <div className="h-8 w-28 rounded-md bg-[var(--cream)] animate-pulse" />
          <div className="h-8 w-32 rounded-md bg-[var(--cream)] animate-pulse" />
          <div className="h-8 w-24 rounded-md bg-[var(--cream)] animate-pulse" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}
