// ?month= 를 화면 규칙(미래 허용 여부)에 맞춰 조회·표시용 'YYYY-MM' 하나로 해석하는 정본

import { kstMonthStr } from './kstDate'

const MONTH_RE = /^\d{4}-\d{2}$/

/**
 * 보고 있는 월의 해석 정본.
 *
 * 미래 월이 본론인 화면은 입퇴실 캘린더 하나뿐이다(운영자 2026-08-18: "미래달을 보는 건
 * 어디까지나 호실관리 입퇴실에서만이야"). 나머지 화면은 아직 오지 않은 달을 열 이유가 없는데,
 * 월은 URL ?month= 를 타고 화면 사이를 옮겨 다닌다 — 하단 내비·사이드바가 링크마다 현재 월을
 * 붙여 주기 때문이다(BottomNav·Sidebar). 그래서 입퇴실에서 9월을 보다가 홈을 누르면 9월
 * 장부가 열렸다.
 *
 * 봉합은 링크가 아니라 **해석**에 둔다. 링크마다 막으면 북마크·뒤로가기·직접 입력·딥링크가
 * 그대로 새고, 새로 생기는 링크마다 같은 방어를 또 적어야 한다. 해석이 한 벌이면 어느 길로
 * 들어오든 같은 규칙을 딛는다.
 *
 * 잠긴 화면(allowFuture 아님)은 미래를 이번 달로 끌어내리고, 형식이 어긋난 값도 이번 달로
 * 돌린다. URL 자체는 손대지 않는다 — 고쳐 쓰면 입퇴실로 되돌아갔을 때 보고 있던 달을 잃는다.
 *
 * 오늘의 기준은 항상 KST 다(lib/kstDate). 서버 로컬(Vercel=UTC)로 재면 매월 1일 00~09시에
 * 서버와 기기가 다른 '이번 달'을 들어 표시와 조회가 갈린다.
 */
export function resolveMonthParam(
  month: string | null | undefined,
  opts?: { allowFuture?: boolean },
): string {
  const today = kstMonthStr()
  if (!month || !MONTH_RE.test(month)) return today
  if (!opts?.allowFuture && month > today) return today
  return month
}
