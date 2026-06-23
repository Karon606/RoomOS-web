// 재고관리(비품·자재) 전환 즉시 표시되는 로딩 스켈레톤.
// 동적 라우트라 loading.tsx 가 있어야 부분 프리페치 + 전환 즉시 응답이 됨(탭 렉 해결).
export default function Loading() {
  return (
    <div className="space-y-5 px-4 sm:px-6 py-5">
      <div className="inline-flex rounded-xl border border-[var(--warm-border)] overflow-hidden text-sm font-medium">
        <span className="px-4 py-2 bg-[var(--canvas)] text-[var(--warm-mid)]">소모품·부식</span>
        <span className="px-4 py-2 bg-[var(--coral)] text-white">비품·자재</span>
      </div>
      <div className="h-6 w-44 rounded-md bg-[var(--cream)] animate-pulse" />
      <div className="space-y-2 pt-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}
