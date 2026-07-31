// 실거주 확인서 작성 화면 로딩 — 셸 밖 라우트라 자체 loading 이 없으면 app/loading.tsx(전체화면 브랜드 스플래시)를
// 상속한다. 그건 콜드 부트용이라 한 번 뜨면 최소 1.4초를 채워, 목록에서 발급으로 넘어가는 앱 내부 이동에
// "앱을 다시 켰다"는 잘못된 신호를 준다(F페이즈, 디자이너 판정). 실제 폼 골격으로 자리만 잡는다.
// delayed-fallback: 300ms 안에 끝나면 아예 안 보임 — 셸 안 라우트와 같은 규칙.

function Bar({ className }: { className: string }) {
  return <div className={`rounded-md bg-[var(--cream)] animate-pulse ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-dvh bg-[var(--canvas)] flex flex-col items-center px-4 pt-6 pb-10">
      <div className="delayed-fallback w-full max-w-md space-y-4" aria-busy="true" aria-label="불러오는 중">
        {/* 상단 뒤로가기 · 자동값으로 */}
        <div className="flex items-center justify-between gap-2">
          <Bar className="h-4 w-32" />
          <Bar className="h-7 w-20" />
        </div>
        {/* 제목 · 안내 */}
        <div className="space-y-2">
          <Bar className="h-6 w-48" />
          <Bar className="h-3 w-full" />
        </div>
        {/* 대상월 셸 */}
        <Bar className="h-11 w-full" />
        {/* 입력 카드 */}
        <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Bar className="h-3 w-20" />
              <Bar className="h-10 w-full" />
            </div>
          ))}
        </div>
        {/* 액션 행 */}
        <div className="flex gap-2">
          <Bar className="h-11 flex-1" />
          <Bar className="h-11 flex-1" />
        </div>
      </div>
    </div>
  )
}
