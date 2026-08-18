import { getTenants, getRoomsForSelect, getWishDateNotices } from './actions'
import { after } from 'next/server'
import { getPropertySettings, getMyRole, getShortStayPolicy } from '@/app/(app)/settings/actions'
import { applyScheduledRents } from '@/app/(app)/room-manage/actions'
import { kstYmdStr } from '@/lib/kstDate'
import { resolveMonthParam } from '@/lib/monthParam'
import TenantClient from './TenantClient'

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = resolveMonthParam(month)   // 기본 조회월은 KST · 잠긴 화면이라 미래 월은 이번 달로(lib/monthParam)

  // 예약 인상/인하 적용일이 지난 호실은 진입 시 baseRent·rentAmount 동기화(호실관리 미방문 시 리스트가 옛값으로 남는 것 방지).
  after(() => applyScheduledRents().catch(() => { /* 적용 실패해도 페이지는 정상 노출 */ }))   // 응답 후 실행 — 표시값은 billForLeaseMonth가 scheduledRent 반영

  // 예약자(RESERVED)는 사용자가 명시적으로 "입실 처리"를 누를 때만 거주중으로 전환됨.
  // 입주 희망일 도래만으로 자동 전환하지 않는다.
  const [tenants, rooms, settings, myRole, shortStay, wishDateNoticeLeaseIds] = await Promise.all([
    getTenants(),
    getRoomsForSelect(),
    getPropertySettings(),
    getMyRole(),
    getShortStayPolicy(),   // 단기 카드 '(N주)' 표기용 계약 단위(unitDays) + 단기 예약금 처리(reservationMode)
    getWishDateNotices(),   // 희망한 방이 전부 날짜에서 빠진 계약 — 카드에 사유를 붙일 대상(홈 알림과 같은 판정)
  ])
  return (
    <TenantClient
      initialTenants={tenants}
      rooms={rooms}
      targetMonth={targetMonth}
      today={kstYmdStr()}
      defaultDeposit={settings?.defaultDeposit ?? null}
      defaultCleaningFee={settings?.defaultCleaningFee ?? null}
      contactLeadDays={settings?.contactLeadDays ?? 14}
      propertyReservationDepositMode={settings?.reservationDepositMode ?? null}
      myRole={myRole}
      shortStayUnitDays={shortStay.unitDays}
      shortStayReservationMode={shortStay.reservationMode}
      shortStayDeposit={shortStay.deposit}
      wishDateNoticeLeaseIds={wishDateNoticeLeaseIds}
    />
  )
}
