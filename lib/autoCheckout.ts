// 퇴실 예정 자동 전환의 판정 정본 — '언제 거주중에서 퇴실 예정으로 바꾸는가'를 한 곳에서 정한다.
//
// 무엇을 푸는가 (운영자 오더 2026-08-28). 종전에는 단기 입실자만, 그것도 **퇴실 하루 전**에
// 바뀌었다. 그래서 일반 계약은 사람이 손으로 바꾸지 않으면 영영 안 바뀌고, 바꿔 두면 퇴실일까지
// 계속 '퇴실 예정'으로 떠 있었다(522호는 넉 달을 그렇게 서 있었다). 새 입실자를 물색하고 청소
// 일정을 잡으려면 그보다 일찍 알아야 하고, 얼마나 일찍인지는 사는 기간에 따라 다르다.
//   · 한 달 이하로 사는 사람 — 퇴실 일주일 전
//   · 그보다 오래 사는 사람 — 퇴실 한 달 전
//
// **'한 달'은 달력으로 센다.** 30일로 못 박으면 안 된다는 것이 운영자 확정이다(2026-08-28) —
// 윤달이 있고 달마다 30일·31일이 갈린다. 10/19 퇴실이면 9/19 에 바뀌지 9/19 나 9/20 을
// 계산기가 정하지 않는다.
//
// **판정 축이 둘인 이유.** isShortTerm 은 파생값이 아니라 운영자가 켜는 체크박스이고, 그 뜻도
// '단기'가 아니라 '호실 표준가 자동입력을 하지 마라'다(schema.prisma). 그래서 한 축만 보면
// 양쪽으로 어긋난다.
//   · 기간만 보면 — 체크는 켰는데 45일 사는 사람이 30일 리드를 받아 입주 보름째부터 퇴실 예정.
//   · 플래그만 보면 — 체크를 안 켠 3주 손님이 30일 리드를 받아 입주 첫날부터 퇴실 예정.
// 둘 중 하나라도 짧으면 짧게 본다. 짧게 봐서 생기는 손해는 '일주일 전에 알았다'뿐이고, 길게 봐서
// 생기는 손해는 '한 달 내내 퇴실 예정으로 떠 있다'라 무게가 다르다.
//
// 이 파일은 순수 함수만 둔다. 크론과 화면 문구가 **같은 함수**를 불러야 "9/19 에 자동으로
// 바뀝니다"라고 적어 놓고 다른 날 바뀌는 일이 없다.

import { isWithinOneCalendarMonth } from './shortStay'

/** 영업장별 리드 설정. 값이 없으면 앱 기본을 쓴다. */
export type CheckoutLeadPolicy = {
  /** 한 달 이하 거주자의 리드(일). 기본 7. */
  shortDays?: number | null
  /** 그 밖의 거주자의 리드(달력 개월). 기본 1. */
  normalMonths?: number | null
}

export const DEFAULT_SHORT_LEAD_DAYS = 7
export const DEFAULT_NORMAL_LEAD_MONTHS = 1

export type AutoCheckoutLease = {
  isShortTerm: boolean
  /** 'YYYY-MM-DD' — 없으면 전환 시점을 정할 수 없다. */
  expectedMoveOut: string | null
  /** 'YYYY-MM-DD' — 없으면 기간 축을 못 세우고 플래그만 본다. */
  moveInDate: string | null
}

/** 이 계약을 짧게 보는가 — 두 축 중 하나라도 짧으면 짧다. */
export function checkoutLeadKind(lease: AutoCheckoutLease): 'short' | 'normal' {
  if (lease.isShortTerm) return 'short'
  if (!lease.moveInDate || !lease.expectedMoveOut) return 'normal'
  return isWithinOneCalendarMonth(lease.moveInDate, lease.expectedMoveOut) ? 'short' : 'normal'
}

/** 날짜에서 달력 N개월 뺀 날 — 그 달에 같은 날짜가 없으면 말일로 당긴다(3/31 에서 한 달 전은 2/28). */
export function minusCalendarMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1 - months, 1))
  const ay = anchor.getUTCFullYear()
  const am = anchor.getUTCMonth()
  const lastDay = new Date(Date.UTC(ay, am + 1, 0)).getUTCDate()
  return new Date(Date.UTC(ay, am, Math.min(d, lastDay))).toISOString().slice(0, 10)
}

function minusDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
}

/**
 * 이 계약이 퇴실 예정으로 바뀔 날 — 퇴실일이 없으면 null.
 *
 * 입주일보다 앞서면 입주일로 당긴다. 입주도 안 한 사람이 퇴실 예정으로 서는 일은 없어야 한다.
 */
export function autoCheckoutFlipYmd(
  lease: AutoCheckoutLease,
  policy: CheckoutLeadPolicy = {},
): string | null {
  if (!lease.expectedMoveOut) return null
  const kind = checkoutLeadKind(lease)
  const flip = kind === 'short'
    ? minusDays(lease.expectedMoveOut, policy.shortDays ?? DEFAULT_SHORT_LEAD_DAYS)
    : minusCalendarMonths(lease.expectedMoveOut, policy.normalMonths ?? DEFAULT_NORMAL_LEAD_MONTHS)
  if (lease.moveInDate && flip < lease.moveInDate) return lease.moveInDate
  return flip
}

/** 오늘 기준으로 전환할 때가 됐는가 — 크론과 화면이 같은 답을 쓴다. */
export function autoCheckoutDue(
  lease: AutoCheckoutLease,
  todayYmd: string,
  policy: CheckoutLeadPolicy = {},
): boolean {
  const flip = autoCheckoutFlipYmd(lease, policy)
  return flip != null && flip <= todayYmd
}
