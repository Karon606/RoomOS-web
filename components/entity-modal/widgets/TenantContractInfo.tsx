// 고객의 계약(lease) 정보 — 월이용료·보증금·청소비·납부일·납부방식·입주일·거주기간 등.
// 표시 전용. 납입일 변경·편집은 페이지(/tenants?tenantId=X) 에서.

import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { Section, Grid, Item } from './Section'
import { fmtStayPeriod } from '@/lib/stayPeriod'
import { kstYmdStr, splitKstDateTime } from '@/lib/kstDate'
import { fmtDateKor } from '@/lib/fmtDate'

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
  tourDate?: Date | string | null                    // 투어 예정일 — 문의 단계에서만 값이 있다
  tourTime?: string | null                           // 투어 예정 시각 'HH:MM'(KST) — null=시간 미정
  moveInFlexible?: boolean | null                    // 입주 희망일 조절 가능 여부 — null=미확인(매칭 날짜 게이트 입력)
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
// 일시 표기 — 날짜·시각 모두 KST 정본으로 뽑는다. 로컬 게터를 쓰면 서버(UTC) 렌더가 9시간 어긋나고
// 그 값이 폼 프리필로 돌아가 저장 때마다 +9h 가 붙는 래칫이 된다(신고 54bce9c5).
const fmtDateTime = (d: Date | string | null) => {
  if (!d) return '—'
  const { ymd, hm } = splitKstDateTime(d)
  if (!ymd) return '—'
  const [h, m] = hm.split(':').map(Number)
  const ampm = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${fmtDateKor(d)} ${ampm} ${h12}:${String(m).padStart(2, '0')}`
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
// 투어 예정 한 줄 — 날짜에 시각이 있으면 붙인다. 시각은 'HH:MM'(KST) 문자열이라 날짜와 달리
// 시간대 변환이 없다. 오전/오후 표기는 형제(입실 문의 일시)와 같은 문법이다.
const fmtTourAt = (d: Date | string | null | undefined, hm: string | null | undefined) => {
  if (!d) return '—'
  const base = fmtDate(d as Date | string)
  if (!hm) return base
  const [h, m] = hm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return base
  return `${base} ${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`
}

export function TenantContractInfo({ lease }: { lease: Lease }) {
  const isPending = ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CANCELLED'].includes(lease.status)
  // 아직 들어오기 전(또는 끝난) 계약인가 — 문의 일시·투어 예정일이 뜨는 조건 한 벌.
  // 거주 단계에 투어 예정일을 남기면 이미 지난 약속이 앞으로의 일정처럼 읽힌다.
  const isLead = !['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(lease.status)
  return (
    <Section title="계약 정보">
      <Grid>
        {/* 좌우상하 순서: 금액류 → 납부방식·문의 일시 → 입주 희망일·퇴실 예정일(나란히) → 연락 알림일 (운영자 확정 2026-07-10) */}
        <Item label={lease.isShortTerm ? '이용료' : '월 이용료'} value={<MoneyDisplay amount={lease.rentAmount} />} />
        <Item label="보증금"   value={<MoneyDisplay amount={lease.depositAmount} />} />
        <Item label="청소비"   value={<MoneyDisplay amount={lease.cleaningFee} />} />
        {/* 거주 전 상태는 납부일 항목 숨김 — 아직 정해지지 않은 값(운영자 지적 2026-07-30).
            단기도 숨김 — 입주월 1회 전액 청구라 '매월 N일'이 성립하지 않는다. */}
        {!isPending && !lease.isShortTerm && <Item label="납부일" value={fmtDueDay(lease.dueDay)} />}
        <Item label="납부방식" value={PT_LABEL[lease.paymentTiming] ?? lease.paymentTiming} />
        {/* 문의 일시 · 투어 예정일 · 입주 희망일 — 리드가 걸어온 순서 그대로 선다.
            종전에는 문의 일시와 입주일이 삼항 한 벌로 얽혀 사이에 줄을 넣을 자리가 없었다.
            조건을 쪼개기만 한 것이라 그려지는 항목은 종전과 같다(입주일 줄은 늘 선다).
            투어 예정일은 입력해 두고도 열람에 없던 값이다(신고 91b72261). */}
        {isLead && lease.inquiryAt && <Item label="입실 문의 일시" value={fmtDateTime(lease.inquiryAt)} />}
        {isLead && lease.tourDate && <Item label="투어 예정일" value={fmtTourAt(lease.tourDate, lease.tourTime)} />}
        <Item label={isPending ? '입주 희망일' : '입주일'} value={fmtDate(lease.moveInDate)} />
        {/* 일정 조절 — 매칭 날짜 게이트가 읽는 값. 미확인이면 '확인 전'이라고 말한다(빈 값으로 두면
            물어본 적 없는 것과 '불가'가 화면에서 같아 보인다). 거주 단계에는 쓰이지 않아 그리지 않는다. */}
        {isPending && lease.status !== 'CANCELLED' && lease.moveInDate && (
          <Item label="일정 조절"
            value={lease.moveInFlexible === true ? '가능' : lease.moveInFlexible === false ? '불가 (이 날짜만)' : '확인 전'} />
        )}
        {isPending && lease.expectedMoveOut && <Item label="퇴실 예정일" value={fmtDate(lease.expectedMoveOut)} />}
        {/* 연락 알림일 — 이 날부터 홈·종에 '연락할 때' 알림(운영자 요청 2026-07-10: 상세에 보여야 안심) */}
        {isPending && lease.status !== 'CANCELLED' && lease.moveInDate && (() => {
          const lead = lease.property?.contactLeadDays ?? 14
          const base = lease.contactAlertDate ? new Date(lease.contactAlertDate) : (() => {
            const d = new Date(lease.moveInDate as string | Date); d.setDate(d.getDate() - lead); return d
          })()
          const today = new Date(kstYmdStr() + 'T00:00:00')
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
