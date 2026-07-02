// 홈(대시보드) 전환 즉시 표시되는 스켈레톤 (§23.6 · §16 · §18③).
// 실제 레이아웃 모양 그대로 — 기간 셀렉터 → KPI 그리드 → 탭 → 차트 블록. 스피너 단독 금지.
// delayed-fallback: 300ms 안에 끝나는 전환에선 아예 안 보임(§18.3).
import { Skeleton } from '@/components/ui/Skeleton'

export default function DashboardLoading() {
  return (
    // 패딩은 AppShell 것만 사용(이중 패딩 금지) — 리듬도 실제 홈(space-y-3.5)과 동일
    <div className="delayed-fallback space-y-3.5" aria-busy="true" aria-label="불러오는 중">
      {/* 기간 셀렉터 행 */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>

      {/* KPI 그리드 — 실제와 동일 형태(§23.5 반응형) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-[var(--cream)] border border-[var(--warm-border)] p-4 space-y-2.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* 탭 바(현황/재무/입주자/AI) */}
      <div className="flex gap-2">
        {['t1', 't2', 't3', 't4'].map(t => <Skeleton key={t} className="h-8 w-16" />)}
      </div>

      {/* 본문 — 차트/리스트 2블록 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {['c1', 'c2'].map(c => (
          <div key={c} className="rounded-2xl bg-[var(--cream)] border border-[var(--warm-border)] p-5 h-48 flex items-center justify-center">
            <Skeleton className="h-28 w-28 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
