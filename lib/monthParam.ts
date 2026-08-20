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

/**
 * 입퇴실 캘린더의 **트랙 위치** 키. 형제 여덟 화면의 `?month=` 와 뜻이 다르다.
 *
 * 형제의 month 는 **조회 장부 월**이다 — 값이 바뀌면 다른 행이 조회되고 화면 내용이 교체된다.
 * 캘린더의 것은 **이미 받아 온 한 문서 안에서 지금 보고 있는 자리**다. 데이터는 그대로고
 * 뷰포트만 움직인다. 한 키를 공유한 것이 범주 오류였고, 그래서 하단 내비·사이드바가
 * 스크롤 위치를 '조회 월'로 오해해 링크마다 복사했다(그 결과 캘린더를 7월로 끌면 홈·지출·재고·
 * 내보내기·프리즘 수납 면이 전부 7월 장부를 열었다).
 *
 * 키 이름에 'month' 를 넣지 않은 이유가 그것이다 — 이름이 형제 키를 닮으면 다음 사람이
 * resolveMonthParam 에 먹이거나 BottomNav 옆에 한 줄 더 붙인다. `focus` 도 쓸 수 없다
 * (lib/useFocusSection 이 알림 딥링크로 점유하고 **소진**한다 — 그 키를 쓰면 조용히 지워진다).
 */
export const TRACK_MONTH_KEY = 'at'

/**
 * 앞 키가 비면 뒤 키로 떨어지는 해석 — 서버와 월 셀렉터가 이 한 벌을 함께 쓴다.
 * 사슬이 두 벌이 되면 라벨과 조회가 다른 달을 가리키는 병이 그대로 재발한다.
 */
export function resolveMonthChain(
  primary: string | null | undefined,
  fallback: string | null | undefined,
  opts?: { allowFuture?: boolean },
): string {
  return resolveMonthParam(primary || fallback, opts)
}

/**
 * 캘린더 트랙 위치의 해석 정본.
 *
 * `?at=` 이 없으면 `?month=` 로 떨어진다 — 홈 '이달 입퇴실 N건'이 `?tab=moves&month=` 로
 * 들어오기 때문이다. 이 사슬이 있어야 딥링크로 착지한 트랙과 셀렉터 라벨이 같은 달을 가리킨다.
 * `?month=` 는 **고쳐 쓰지 않는다** — 그 값은 홈에서 정당하게 실려 온 조회 장부 월이고,
 * 지우면 캘린더를 거쳐 지출로 넘어갈 때 보던 달을 잃는다. 두 값이 함께 사는 것이 정상이다.
 */
export function resolveTrackMonth(
  at: string | null | undefined,
  month: string | null | undefined,
): string {
  return resolveMonthChain(at, month, { allowFuture: true })
}
