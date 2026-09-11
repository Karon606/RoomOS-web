import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { cookies } from 'next/headers'
import { after } from 'next/server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { getDashboardData } from './getDashboardData'
import { getPaymentMethods } from '@/app/(app)/settings/actions'
import { applyScheduledRents } from '@/app/(app)/room-manage/actions'
import { resolveMonthParam } from '@/lib/monthParam'
import { getFloorPlan } from '@/app/(app)/floor-plan/actions'
import FloorPlanWidget from '@/app/(app)/floor-plan/FloorPlanWidget'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

// ── 페이지 ────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { propertyId } = await requirePropertyAccess()

  const { month, tab } = await searchParams
  // 월 해석은 정본 하나로 — 잠긴 화면이라 미래 월은 이번 달로 끌어내린다(lib/monthParam).
  const targetMonth = resolveMonthParam(month)
  // 어느 탭을 열고 있는지는 주소가 정본이다(수납 관리·지출 관리와 같은 문법).
  // 종전에는 탭이 클라 상태뿐이라 홈에서 지출 관리로 갔다 돌아오면 늘 '현황'이었고,
  // 재무 탭을 가리키는 딥링크를 만들 수단 자체가 없었다. 모르는 값은 기본 탭으로 떨군다.
  const initialTab = tab === 'finance' || tab === 'tenants' || tab === 'ai' ? tab : 'overview'

  // 예약 인상/인하 적용일 경과분 동기화 — 어느 페이지로 들어와도 7/1 인상이 baseRent·rentAmount 에 반영되게
  // (호실관리 미방문 시 리스트·표시가 옛값으로 남는 것 방지). 실패해도 페이지는 정상 노출.
  after(() => applyScheduledRents().catch(() => {}))   // 인상 적용 영속화는 응답 후 — 청구 표시는 billForLeaseMonth(scheduledRent)가 이미 정확

  const [dashboardData, paymentMethods, floorPlanData] = await Promise.all([
    getDashboardData(propertyId, targetMonth),
    getPaymentMethods(),
    getFloorPlan(),
  ])

  return (
    <div className="space-y-3.5">

      {/* ── 평면 배치도 (켠 경우 표시. 한 번도 만든 적 없으면 발견용 빈 상태 CTA) ─── */}
      {(floorPlanData == null || floorPlanData.showOnDashboard) && (() => {
        const rooms = dashboardData.rooms.map(r => ({ id: r.roomNo, roomNo: r.roomNo }))
        const roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }> = {}
        dashboardData.rooms.forEach(r => {
          // 집계 제외 방(창고·사무실)은 배치도에서도 공실로 칠하지 않는다(신고 9d844226)
          roomStatuses[r.roomNo] = { isVacant: r.isVacant && !r.vacancyExcluded, tenantName: r.tenantName ?? undefined }
        })
        return (
          <FloorPlanWidget
            floorPlanData={floorPlanData}
            rooms={rooms}
            roomStatuses={roomStatuses}
          />
        )
      })()}

      {/* ── 대시보드 ──────────────────────────────────────────── */}
      <DashboardClient data={dashboardData} targetMonth={targetMonth} paymentMethods={paymentMethods} initialTab={initialTab} />

    </div>
  )
}
