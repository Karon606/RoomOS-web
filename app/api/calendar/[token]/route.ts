// 캘린더 구독(.ics) 피드 — 구글/애플/아웃룩에서 webcal 로 구독하면 납부예정·퇴실예정 자동 동기화(읽기전용).
// 토큰만으로 접근(공개) — 캘린더 앱은 쿠키 없이 가져가므로 비밀 토큰이 보안.
import prisma from '@/lib/prisma'
import { isCheckoutNoBillingMonthFor, billForLeaseMonth } from '@/lib/billing'
import { shouldShowTourEvent } from '@/lib/tourFeed'
import { dueDateForMonth, isDeferredForMonth, resolveDueRaw } from '@/lib/dueDate'
import { fmtRoomNo } from '@/lib/roomNo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const ymd = (y: number, m: number, d: number) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`
const fmtRoom = (no?: string | null) => (no ? (fmtRoomNo(no, '')) : '')
// 금액을 만/억 단위 한글 표기 — 1,503,500 → '150만3500원', 1,500,000 → '150만원'
const manWon = (n: number): string => {
  if (n < 10000) return `${n}원`
  const eok = Math.floor(n / 100000000)
  const man = Math.floor((n % 100000000) / 10000)
  const rest = n % 10000
  return `${eok ? `${eok}억` : ''}${man ? `${man}만` : ''}${rest ? rest : ''}원`
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cleanToken = (token || '').replace(/\.ics$/i, '')
  const property = await prisma.property.findUnique({
    where: { calendarToken: cleanToken },
    select: { id: true, name: true, contactLeadDays: true },
  })
  if (!property) return new Response('Not found', { status: 404 })

  const leases = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: {
      id: true, dueDay: true, rentAmount: true, expectedMoveOut: true, status: true, isShortTerm: true, moveInDate: true,
      // 납부일 임시조정 — 없으면 미뤄둔 날짜가 피드에 반영되지 않는다(신고 998bff27)
      overrideDueDay: true, overrideDueDayMonth: true, overrideDueDayReason: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true,
      // 예약 인상 — 인상 적용월 이상은 room.scheduledRent 로 청구한다(스케줄러가 baseRent 로
      // 옮기기 전까지의 예약값). 캘린더가 이걸 안 봐서 외부로 나가는 일정에 인상 전 금액이 찍혔다(A페이즈 P2).
      room: { select: { roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
      tenant: { select: { name: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })

  // 납입 여부 — 이미 낸 달은 '납부 예정' 대신 실제 입금일에 '납입완료'로 표시(운영자 요청 2026-07-10).
  // 구독 캘린더는 피드를 주기적으로 다시 가져가므로, 납입되는 순간부터 예정 이벤트는 자동으로 사라진다.
  const now = new Date(Date.now() + 9 * 3600000) // KST
  const ty = now.getUTCFullYear(), tm = now.getUTCMonth() + 1
  // 지난달부터 — 납부일을 이번 달 이후로 미뤄둔 지난달 청구가 달이 바뀌는 순간 사라지지 않도록(신고 998bff27).
  // 지난달분은 아래 루프에서 '유예로 이번 달 이후에 걸린 건'만 이벤트로 나간다(과거 미납 전량 노출 아님).
  const monthStrs: string[] = []
  for (let i = -1; i < 6; i++) { let y = ty, m = tm + i; while (m > 12) { m -= 12; y += 1 }; while (m < 1) { m += 12; y -= 1 } monthStrs.push(`${y}-${String(m).padStart(2, '0')}`) }
  const pays = await prisma.paymentRecord.findMany({
    // 청구 조정 전표(payDate=조작 시각, 실입금 아님)는 '납입완료' 판정·표시 날짜에서 제외
    where: { propertyId: property.id, targetMonth: { in: monthStrs }, isDeposit: false, isPrevOwner: false, isBillingAdjust: false },
    select: { leaseTermId: true, targetMonth: true, actualAmount: true, payDate: true },
  })
  // 청구 락 — 그 달 record 의 **최댓값**이 청구액이다(합계가 아니다).
  // 조정 전표(isBillingAdjust)도 락 계산에는 들어간다 — 위 pays 는 표시·완납 판정용이라 제외하므로
  // 락은 따로 조회한다. 이걸 안 보면 이미 확정된 과거 청구가 캘린더에서만 다른 금액으로 나간다.
  const lockRows = await prisma.paymentRecord.findMany({
    where: { propertyId: property.id, targetMonth: { in: monthStrs }, isDeposit: false, isPrevOwner: false },
    select: { leaseTermId: true, targetMonth: true, expectedAmount: true },
  })
  const lockedMap = new Map<string, number>()
  for (const r of lockRows) {
    const k = `${r.leaseTermId}|${r.targetMonth}`
    const cur = lockedMap.get(k) ?? 0
    if (r.expectedAmount > cur) lockedMap.set(k, r.expectedAmount)
  }

  const paidMap = new Map<string, { sum: number; lastPay: Date }>()
  for (const r of pays) {
    const k = `${r.leaseTermId}|${r.targetMonth}`
    const cur = paidMap.get(k) ?? { sum: 0, lastPay: r.payDate }
    cur.sum += r.actualAmount
    if (r.payDate > cur.lastPay) cur.lastPay = r.payDate
    paidMap.set(k, cur)
  }
  const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T000000Z`

  const lines: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//stayeum//calendar//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc('스테이음 · ' + (property.name || '영업장'))}`, 'X-WR-TIMEZONE:Asia/Seoul',
  ]
  const ev = (uid: string, y: number, m: number, d: number, summary: string, desc: string) => {
    const start = ymd(y, m, d)
    const end = new Date(y, m - 1, d + 1)
    lines.push(
      'BEGIN:VEVENT', `UID:${uid}@stayeum`, `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${ymd(end.getFullYear(), end.getMonth() + 1, end.getDate())}`,
      `SUMMARY:${esc(summary)}`, ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
      // 당일 오전 9시 알림(운영자 지정 2026-07-10) — 종일 이벤트 시작(자정)+9시간. 구글은 구독 알람 무시, 애플은 지원.
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER;RELATED=START:PT9H', 'END:VALARM',
      'END:VEVENT',
    )
  }
  // 시각 지정 이벤트(1시간짜리) — KST "HH:MM" 을 UTC 로 환산해 Z 표기. 알림은 시작 1시간 전.
  // 구글은 구독 캘린더 알람을 무시하지만 애플은 지원(위 종일 이벤트 9시 알림과 같은 정책).
  const evTimed = (uid: string, y: number, m: number, d: number, hhmm: string, summary: string, desc: string) => {
    const [hh, mi] = hhmm.split(':').map(Number)
    const startUtc = new Date(Date.UTC(y, m - 1, d, hh - 9, mi))          // KST-9h = UTC
    const endUtc = new Date(startUtc.getTime() + 3600000)
    const z = (dt: Date) => `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}T${String(dt.getUTCHours()).padStart(2, '0')}${String(dt.getUTCMinutes()).padStart(2, '0')}00Z`
    lines.push(
      'BEGIN:VEVENT', `UID:${uid}@stayeum`, `DTSTAMP:${dtstamp}`,
      `DTSTART:${z(startUtc)}`, `DTEND:${z(endUtc)}`,
      `SUMMARY:${esc(summary)}`, ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-PT1H', 'END:VALARM',
      'END:VEVENT',
    )
  }

  for (const l of leases) {
    const room = fmtRoom(l.room?.roomNo)
    const who = [room, l.tenant.name].filter(Boolean).join(' ')
    // 퇴실 예정일 — 단기는 ACTIVE에도 발행(연장으로 거주중 복귀 시 D-1 자동 전환 전까지
    // 새 퇴실일이 외부 캘린더에서 사라지는 공백 방지, 2026-07-20)
    if ((l.status === 'CHECKOUT_PENDING' || (l.status === 'ACTIVE' && l.isShortTerm)) && l.expectedMoveOut) {
      const mo = new Date(l.expectedMoveOut)
      ev(`checkout-${l.id}`, mo.getFullYear(), mo.getMonth() + 1, mo.getDate(), `${who} 퇴실 예정`, '')
    }
    // 납부 예정일 — 이번 달부터 6개월. 퇴실 달 이후는 제외.
    if (l.rentAmount > 0 && l.dueDay) {
      const moMonth = l.expectedMoveOut ? (() => { const d = new Date(l.expectedMoveOut); return d.getFullYear() * 100 + d.getMonth() + 1 })() : null
      // i = -1 은 지난달 — 납부일을 이번 달 이후로 미뤄둔 건만 통과시킨다(아래 skipPast).
      const thisMonthStart = new Date(ty, tm - 1, 1)
      for (let i = -1; i < 6; i++) {
        let y = ty, m = tm + i
        while (m > 12) { m -= 12; y += 1 }
        while (m < 1) { m += 12; y -= 1 }
        if (moMonth && y * 100 + m > moMonth) break
        const monthStr = `${y}-${String(m).padStart(2, '0')}`
        if (i < 0) {
          // 지난달: 조정된 납부일이 이번 달 1일 이후에 걸린 경우에만 남긴다
          const moved = l.overrideDueDayMonth === monthStr ? dueDateForMonth(l, monthStr) : null
          if (!moved || moved < thisMonthStart) continue
        }
        // 단기 입주자 — 1개월 미만 거주라 매월 반복 일정 무의미(운영자 지시 2026-07-10).
        // 입주한 달만 표시하고, 퇴실 처리(status 변경)되면 피드에서 자동 소멸.
        if (l.isShortTerm) {
          const mi = l.moveInDate ? new Date(l.moveInDate) : null
          const miMonth = mi ? `${mi.getFullYear()}-${String(mi.getMonth() + 1).padStart(2, '0')}` : null
          if (!miMonth || monthStr !== miMonth) continue
        }
        // 납부일 — 정본(lib/dueDate)이 3포맷·임시조정을 함께 푼다. 미뤄졌으면 미뤄진 날짜가 나온다.
        const dueDate = dueDateForMonth(l, monthStr)
        if (!dueDate) continue
        const dy = dueDate.getFullYear(), dm = dueDate.getMonth() + 1, day = dueDate.getDate()
        // 퇴실월: 퇴실일이 납부일 이전이면 그 기간 미사용 → 청구 없음(이용료 일정 생략)
        if (isCheckoutNoBillingMonthFor(l, l.expectedMoveOut, monthStr, dueDate)) continue
        // 청구액은 billForLeaseMonth 정본을 쓴다. 종전에는 여기서 자기 규칙(일할 > 할인가)을 만들어
        // **예약 인상과 락인, 단기 이중청구 차단이 전부 빠져** 있었다(A페이즈 P2).
        // 캘린더는 외부로 나가는 문서라 금액이 틀리면 그대로 상대방에게 간다.
        const amount = billForLeaseMonth(l, monthStr, lockedMap.get(`${l.id}|${monthStr}`) ?? null)
        if (amount <= 0) continue
        const paid = paidMap.get(`${l.id}|${monthStr}`)
        if (paid && paid.sum >= amount) {
          // 이미 납입 완료 — 예정 이벤트 대신 실제 입금일에 완료 표시(다음 동기화 때 예정은 사라짐)
          const pd = paid.lastPay
          ev(`rent-paid-${l.id}-${monthStr}`, pd.getFullYear(), pd.getMonth() + 1, pd.getDate(), `${who} 납입완료`, `이용료 ${manWon(amount)} 입금 확인`)
        } else if (isDeferredForMonth(l, monthStr)) {
          // 미뤄둔 건 — 같은 달에 두 건이 나란히 뜰 수 있으므로 귀속월과 사유를 문구로 승격.
          // DTSTART 는 조정된 날짜(dy/dm), UID 는 귀속월 유지라 구독 캘린더가 같은 이벤트를 옮긴다.
          const orig = resolveDueRaw(l.dueDay, y, m)
          const from = orig ? `${orig.getMonth() + 1}월 ${orig.getDate()}일` : null
          const desc = ['납부 예정일', from ? `${from}에서 ${dm}월 ${day}일로 조정` : null, l.overrideDueDayReason]
            .filter(Boolean).join(' · ')
          ev(`rent-${l.id}-${monthStr}`, dy, dm, day, `${who} ${m}월분 이용료 ${manWon(amount)}`, desc)
        } else {
          ev(`rent-${l.id}-${monthStr}`, dy, dm, day, `${who} 이용료 ${manWon(amount)}`, '납부 예정일')
        }
      }
    }
  }

  // 투어 일정 — 시간이 있으면 시각 지정(1시간 전 알림), 없으면 종일(9시 알림). (운영자 요청 86ceb645)
  // 표시 판정은 lib/tourFeed.ts shouldShowTourEvent 정본 — 제외 목록 방식이라 날짜 갈래 경계 구멍이 없다
  // (신고 ba74b5cd: 당일 투어 + 당일 거주중 전환이 종전 OR 두 갈래 사이 틈에 떨어져 소실).
  // 기록을 지우는 정본 경로는 폼에서 투어일 비우기.
  const todayKstUtc = new Date(Date.UTC(ty, tm - 1, now.getUTCDate()))
  const todayYmd = todayKstUtc.toISOString().slice(0, 10)
  const tourLeases = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, tourDate: { not: null } },
    select: {
      id: true, status: true, tourDate: true, tourTime: true, isShortTerm: true,
      room: { select: { roomNo: true } }, tenant: { select: { name: true } },
      // '투어 전 취소' 판정 — 최근 CANCELLED 전이의 fromStatus (TenantClient 188행과 동일 정본 패턴)
      statusLogs: { where: { deletedAt: null, toStatus: 'CANCELLED' }, orderBy: { changedAt: 'desc' }, take: 1, select: { fromStatus: true } },
    },
  })
  for (const l of tourLeases) {
    if (!l.tourDate) continue
    if (!shouldShowTourEvent({
      status: l.status,
      tourYmd: l.tourDate.toISOString().slice(0, 10),
      lastCancelFrom: l.statusLogs[0]?.fromStatus ?? null,
      todayYmd,
    })) continue
    const who = [fmtRoom(l.room?.roomNo), l.tenant.name].filter(Boolean).join(' ')
    const td = new Date(l.tourDate)
    const y = td.getUTCFullYear(), m = td.getUTCMonth() + 1, d = td.getUTCDate()   // @db.Date = 그 날짜의 UTC 자정
    const summary = `${who} 투어${l.isShortTerm ? ' (단기)' : ''}`
    if (l.tourTime && /^\d{2}:\d{2}$/.test(l.tourTime)) evTimed(`tour-${l.id}`, y, m, d, l.tourTime, summary, '투어 예정')
    else ev(`tour-${l.id}`, y, m, d, summary, '투어 예정 (시간 미정)')
  }

  // 잠재고객 연락 알림일 — 문의·투어·미확정 예약, 입주 희망일이 아직 안 지난 건
  const leadDays = property.contactLeadDays ?? 14
  const contactLeases = await prisma.leaseTerm.findMany({
    where: {
      propertyId: property.id, status: { in: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'] },
      reservationConfirmedAt: null, moveInDate: { not: null, gte: new Date(Date.UTC(ty, tm - 1, now.getUTCDate())) },
    },
    select: { id: true, moveInDate: true, contactAlertDate: true, isShortTerm: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } },
  })
  for (const l of contactLeases) {
    if (!l.moveInDate) continue
    const who = [fmtRoom(l.room?.roomNo), l.tenant.name].filter(Boolean).join(' ')
    const base = l.contactAlertDate ? new Date(l.contactAlertDate) : (() => { const d = new Date(l.moveInDate); d.setDate(d.getDate() - leadDays); return d })()
    const mi = new Date(l.moveInDate)
    ev(`contact-${l.id}`, base.getFullYear(), base.getMonth() + 1, base.getDate(),
      `${who} 연락${l.isShortTerm ? ' (단기)' : ''}`,
      `입주 희망 ${mi.getMonth() + 1}/${mi.getDate()} — 빈방 가능 여부 안내 연락`)
    ev(`wishin-${l.id}`, mi.getFullYear(), mi.getMonth() + 1, mi.getDate(), `${who} 입주 희망일`, '')
  }

  lines.push('END:VCALENDAR')
  // ICS 는 CRLF 권장
  const body = lines.join('\r\n')
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="stayeum.ics"',
      // 캘린더 앱이 다시 가져갈 때 항상 최신본을 받도록(CDN 캐시 방지)
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  })
}
