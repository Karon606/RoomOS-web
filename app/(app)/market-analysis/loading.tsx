// 시세 조사 전환 즉시 표시되는 로딩 스켈레톤 — 동적 라우트 전환 렉 해결(감사 D6).
// 실제 화면 골격(제목·버튼 → 표)으로 자리를 잡아 레이아웃 점프 방지. 패딩은 AppShell 것만.
// delayed-fallback: 300ms 안에 끝나는 전환은 스켈레톤을 띄우지 않는다 — 그 구간은 상단 진행바가 맡는다.
// 전 라우트 동일 규칙(F페이즈). 화면마다 다르면 "같은 링크인데 어떨 땐 뜨고 어떨 땐 안 뜬다"로 체감된다.
export default function Loading() {
  return (
    <div className="delayed-fallback space-y-4">
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
