// 고객의 계약(lease) 정보 — 월이용료·보증금·청소비·납부일·납부방식·입주일·거주기간 등.
// 표시 전용. 납입일 변경·편집은 페이지(/tenants?tenantId=X) 에서.

import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { Section, Grid, Item } from './Section'

type Lease = {
  status: string
  rentAmount: number
  depositAmount: number
  cleaningFee: number
  dueDay: string | null
  paymentTiming: string
  moveInDate: Date | string | null
  moveOutDate: Date | string | null
  expectedMoveOut: Date | string | null
  inquiryAt: Date | string | null
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
const calcStayPeriod = (moveIn: Date | string | null, end?: Date | string | null) => {
  if (!moveIn) return '—'
  const start = new Date(moveIn)
  const finish = end ? new Date(end) : new Date()
  const months = (finish.getFullYear() - start.getFullYear()) * 12 + (finish.getMonth() - start.getMonth())
  if (months < 1) {
    const days = Math.max(0, Math.floor((finish.getTime() - start.getTime()) / 86400000))
    return `${days}일`
  }
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (years > 0 && rem > 0) return `${years}년 ${rem}개월`
  if (years > 0) return `${years}년`
  return `${months}개월`
}

export function TenantContractInfo({ lease }: { lease: Lease }) {
  const isPending = ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CANCELLED'].includes(lease.status)
  return (
    <Section title="계약 정보">
      <Grid>
        <Item label="월 이용료" value={<MoneyDisplay amount={lease.rentAmount} />} />
        <Item label="보증금"   value={<MoneyDisplay amount={lease.depositAmount} />} />
        <Item label="청소비"   value={<MoneyDisplay amount={lease.cleaningFee} />} />
        <Item label="납부일"   value={fmtDueDay(lease.dueDay)} />
        <Item label="납부방식" value={PT_LABEL[lease.paymentTiming] ?? lease.paymentTiming} />
        <Item
          label={isPending ? '입주 희망일' : '입주일'}
          value={fmtDate(lease.moveInDate)}
        />
        {!['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(lease.status) && lease.inquiryAt && (
          <Item label="입실 문의 일시" value={fmtDateTime(lease.inquiryAt)} />
        )}
        {!isPending && (
          <Item label="거주기간" value={calcStayPeriod(lease.moveInDate, lease.moveOutDate ?? undefined)} />
        )}
        {lease.expectedMoveOut && <Item label="퇴실 예정일" value={fmtDate(lease.expectedMoveOut)} />}
        {lease.moveOutDate && <Item label="퇴실일" value={fmtDate(lease.moveOutDate)} />}
      </Grid>
    </Section>
  )
}
