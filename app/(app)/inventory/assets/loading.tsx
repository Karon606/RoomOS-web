// 재고관리(비품·자재) 전환 즉시 표시되는 로딩 스켈레톤.
// 동적 라우트라 loading.tsx 가 있어야 부분 프리페치 + 전환 즉시 응답이 됨(탭 렉 해결).
// 실제 화면과 같은 골격(탭 → 제목 → 버튼 줄 → 검색)으로 자리를 잡아 전환 점프를 없앤다.
// 패딩은 AppShell 것만 사용(이중 패딩 금지). 자재 탭은 월 개념이 없어 월셀렉터 자리도 없음.
export default function Loading() {
  return (
    <div className="space-y-4">
      {/* §24 탭 모형 — ViewTabs와 동일 치수 */}
      <div className="inline-flex rounded-[10px] border border-[var(--warm-border)] overflow-hidden bg-[var(--cream)] text-sm font-semibold">
        <span className="px-4 py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center text-[var(--warm-mid)]">소모품·부식</span>
        <span className="px-4 py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center border-l border-[var(--warm-border)] bg-[var(--coral)] text-[var(--cream)]">비품·자재</span>
      </div>
      {/* 제목 + 버튼 줄 + 검색 자리 */}
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-md bg-[var(--cream)] animate-pulse" />
        <div className="flex gap-2">
          <div className="h-11 w-16 rounded-lg bg-[var(--cream)] animate-pulse" />
          <div className="h-11 w-28 rounded-lg bg-[var(--cream)] animate-pulse" />
        </div>
        <div className="h-10 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
      </div>
      <div className="space-y-2 pt-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}
