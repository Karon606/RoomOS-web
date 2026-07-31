// 재고관리(비품·자재) 전환 즉시 표시되는 로딩 스켈레톤.
// 동적 라우트라 loading.tsx 가 있어야 부분 프리페치 + 전환 즉시 응답이 됨(탭 렉 해결).
// 실제 화면과 같은 골격(탭 → 월셀렉터 → 제목 → 버튼 줄 → 검색)으로 자리를 잡아 전환 점프를 없앤다.
// 패딩은 AppShell 것만 사용(이중 패딩 금지).
// delayed-fallback: 300ms 안에 끝나는 전환은 스켈레톤을 띄우지 않는다 — 그 구간은 상단 진행바가 맡는다.
// 전 라우트 동일 규칙(F페이즈). 화면마다 다르면 "같은 링크인데 어떨 땐 뜨고 어떨 땐 안 뜬다"로 체감된다.
export default function Loading() {
  return (
    <div className="delayed-fallback space-y-4">
      {/* v2.0 §25 탭 모형 — ViewTabs와 동일 치수 + 아랫줄 우측 월셀렉터 자리(v2.0 §25, 소모품과 동일) */}
      <div className="flex flex-col items-start gap-2 md:flex-row md:justify-between">
        <div className="inline-flex rounded-[10px] border border-[var(--warm-border)] overflow-hidden bg-[var(--cream)] text-sm font-semibold">
          <span className="px-4 py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center text-[var(--warm-mid)]">소모품·부식</span>
          <span className="px-4 py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center border-l border-[var(--warm-border)] bg-[var(--coral)] text-[var(--on-solid)]">비품·자재</span>
        </div>
        <div className="self-end md:self-auto h-9 w-32 rounded-md bg-[var(--cream)] animate-pulse" />
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
