// 고객의 계약(lease) 정보 — 월이용료·보증금·청소비·납부일·납부방식·입주일·거주기간 등.
// 표시 전용. 납입일 변경·편집은 페이지(/tenants?tenantId=X) 에서.

import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { Section, Grid, Item } from './Section'
import { fmtStayPeriod } from '@/lib/stayPeriod'

type Lease = {
  status: string
  isShortTerm?: boolean   // 단기 — rentAmount가 월액이 아니라 체류 전체 사용료
  rentAmount: number
  depositAmount: number
  cleaningFee: number
  dueDay: string | null
  paymentTiming: string
  moveInDate: Date | string | null
  moveOutDate: Date | string | null
  expectedMoveOut: Date | string | null
  inquiryAt: Date | string | null
  contactAlertDate?: Date | string | null            // 연락 알림 시작일 지정(없으면 기본)
  property?: { contactLeadDays: number } | null      // 영업장 기본 리드타임
}

const PT_LABEL: Record<string, string> = { PREPAID: '선납', POSTPAID: '후납' }

const fmtDate = (d: Date | string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
}
const fmtDateTime = (d: Date | string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const hh = dt.getHours()
  const mm = dt.getMinutes()
  const ampm = hh < 12 ? '오전' : '오후'
  const hh12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]}) ${ampm} ${hh12}:${String(mm).padStart(2, '0')}`
}
const fmtDueDay = (dueDay: string | null) => {
  if (!dueDay) return '—'
  const n = parseInt(dueDay, 10)
  if (!isNaN(n)) return n >= 30 ? '매월 말일' : `매월 ${n}일`
  if (dueDay.includes('말')) return '매월 말일'
  return `매월 ${dueDay}일`
}
// 거주기간 표시 — lib/stayPeriod 정본(달력 기준 만 개월, 신고 f9803357) 위임
const calcStayPeriod = (moveIn: Date | string | null, end?: Date | string | null) => fmtStayPeriod(moveIn, end)

export function TenantContractInfo({ lease }: { lease: Lease }) {
  const isPending = ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CANCELLED'].includes(lease.status)
  return (
    <Section title="계약 정보">
      <Grid>
        {/* 좌우상하 순서: 금액류 → 납부방식·문의 일시 → 입주 희망일·퇴실 예정일(나란히) → 연락 알림일 (운영자 확정 2026-07-10) */}
        <Item label={lease.isShortTerm ? '이용료' : '월 이용료'} value={<MoneyDisplay amount={lease.rentAmount} />} />
        <Item label="보증금"   value={<MoneyDisplay amount={lease.depositAmount} />} />
        <Item label="청소비"   value={<MoneyDisplay amount={lease.cleaningFee} />} />
        <Item label="납부일"   value={fmtDueDay(lease.dueDay)} />
        <Item label="납부방식" value={PT_LABEL[lease.paymentTiming] ?? lease.paymentTiming} />
        {!['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(lease.status) && lease.inquiryAt
          ? <Item label="입실 문의 일시" value={fmtDateTime(lease.inquiryAt)} />
          : <Item label={isPending ? '입주 희망일' : '입주일'} value={fmtDate(lease.moveInDate)} />}
        {!['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(lease.status) && lease.inquiryAt && (
          <Item label={isPending ? '입주 희망일' : '입주일'} value={fmtDate(lease.moveInDate)} />
        )}
        {isPending && lease.expectedMoveOut && <Item label="퇴실 예정일" value={fmtDate(lease.expectedMoveOut)} />}
        {/* 연락 알림일 — 이 날부터 홈·종에 '연락할 때' 알림(운영자 요청 2026-07-10: 상세에 보여야 안심) */}
        {isPending && lease.status !== 'CANCELLED' && lease.moveInDate && (() => {
          const lead = lease.property?.contactLeadDays ?? 14
          const base = lease.contactAlertDate ? new Date(lease.contactAlertDate) : (() => {
            const d = new Date(lease.moveInDate as string | Date); d.setDate(d.getDate() - lead); return d
          })()
          const today = new Date(); today.setHours(0, 0, 0, 0)
          const eff = base < today ? today : base
          return (
            <Item label="연락 알림일"
              value={`${fmtDate(eff)}${lease.contactAlertDate ? ' (직접 지정)' : ` (희망일 ${lead}일 전)`}`} />
          )
        })()}
        {!isPending && (
          <Item label="거주기간" value={calcStayPeriod(lease.moveInDate, lease.moveOutDate ?? undefined)} />
        )}
        {!isPending && lease.expectedMoveOut && <Item label="퇴실 예정일" value={fmtDate(lease.expectedMoveOut)} />}
        {lease.moveOutDate && <Item label="퇴실일" value={fmtDate(lease.moveOutDate)} />}
      </Grid>
    </Section>
  )
}
