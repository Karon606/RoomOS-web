// 완료 처리 날짜 정본 — '언제 완료했나'를 정하는 값 결정(쓰기)과 미래 거부(가드)를 한 자리에 모은다.
//
// 왜 있나 (운영자 지시 2026-09-17)
//   "어제 완료한건데 어제날짜로 완료했다고 입력할 방법이 없네? 뭔가를 완료처리하고 처리 날짜가
//   기록되는 건은 항상 날짜를 수동으로 입력할 수 있게 해줘. 당연히 디폴트는 현재시간 기준이지만"
//
//   종전에는 완료 처리 경로마다 `new Date()` 를 즉발로 박았다. **클릭한 순간이지 일어난 날이
//   아니다.** 현금영수증 발행일에서 이미 한 번 진단한 병과 같은 클래스이고(2026-08-24),
//   보증금 정산일에서 또 한 번 나왔다(2026-09-03). 세 번째라 자리를 하나로 모은다.
//
// 규칙은 현금영수증 선례 그대로다(lib/cashReceipt resolveCashReceiptIssuedAt).
//   1. 운영자가 고른 날짜가 있고 오늘 이하면 **그 날**이다.
//   2. 없으면 **기존 값을 지킨다.** 이것이 급소다 — 다른 칸만 고쳐 재저장했는데 날짜가 오늘로
//      밀리면 그 값으로 세는 합계·주기가 소리 없이 움직인다.
//   3. 기존 값도 없으면 지금이다(디폴트는 현재시간이라는 운영자 문장 그대로).
//
// 미래는 어디서 막나. 값 결정 함수는 **폴백하지 않는다** — 미래를 조용히 오늘로 바꾸면 운영자가
// 고른 날과 저장된 날이 갈리고, 그 어긋남은 아무 화면에도 안 뜬다. 부르는 쪽이 assertNotFuture 로
// 먼저 거부하고, 화면은 DatePicker maxDate 로 애초에 못 고르게 막는다. 두 겹이다.
import { kstYmdStr, kstDateTimeToUtc, ymdToDbDate } from './kstDate'

/**
 * 이 값이 앉을 칸의 타입. 같은 '2026-09-16' 이 칸에 따라 다른 Date 로 가야 한다.
 *
 *   'date'      — `@db.Date`. 저장 정본이 **UTC 자정**이다(ymdToDbDate). 날짜부만 잘려 저장된다.
 *   'timestamp' — 시각까지 있는 칸. 사람이 보는 달력은 KST 라 **KST 자정**이어야 한다
 *                 (kstDateTimeToUtc). UTC 자정을 넣으면 KST 오전 9시가 되어, 그 값을 KST 달로
 *                 읽는 집계에서 경계일이 밀린다.
 */
export type CompletionColumn = 'date' | 'timestamp'

export type CompletionDateInput = {
  /** 운영자가 고른 완료일 'YYYY-MM-DD'(KST). 비었으면 아래 폴백. */
  picked?: string | null
  /** 이미 박혀 있는 값. 날짜를 안 넘기는 재저장 경로에서 이것을 지킨다. */
  existing?: Date | null
  /** 이 값이 앉을 칸. 기본은 타임스탬프다(완료 시각 칸이 더 흔하다). */
  column?: CompletionColumn
  /** KST 오늘 'YYYY-MM-DD'. 테스트 주입용 — 안 주면 실제 오늘. */
  today?: string
  /** '지금'. 테스트 주입용 — 안 주면 실제 지금. */
  now?: Date
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * 완료 시각을 정한다. **미래는 여기서 안 막는다** — 부르기 전에 assertNotFuture 로 거부한다.
 *
 * 그래도 미래가 들어오면 기존 값·지금으로 떨어뜨린다. 가드를 빠뜨린 경로가 미래를 박는 것보다는
 * 낫다는 마지막 방어선이고, 가드가 제 일을 하면 이 가지는 안 탄다.
 */
export function resolveCompletionAt(input: CompletionDateInput): Date {
  const today = input.today ?? kstYmdStr()
  const raw = (input.picked ?? '').slice(0, 10)
  if (YMD.test(raw) && raw <= today) {
    const at = input.column === 'date' ? ymdToDbDate(raw) : kstDateTimeToUtc(raw)
    if (at && !Number.isNaN(at.getTime())) return at
  }
  return input.existing ?? input.now ?? new Date()
}

/**
 * 고른 날짜가 미래인가. 미래면 거부 사유를 돌려준다 — 부르는 쪽이 저장을 멈추고 그 말을 띄운다.
 *
 * 왜 거부인가(운영자 확정 2026-09-17). 아직 하지 않은 일을 완료로 적을 수는 없다. 조용히 오늘로
 * 바꾸는 폴백은 더 나쁘다 — 운영자가 고른 날과 저장된 날이 갈리는데 화면은 아무 말도 안 한다.
 *
 * 빈 값·형식이 어긋난 값은 **미래가 아니다.** 여기서는 통과시키고 값 결정이 폴백을 고른다
 * (형식 검증까지 이 함수가 겸하면 '안 고름'과 '잘못 고름'이 같은 에러가 되어 말이 어긋난다).
 */
export function assertNotFuture(
  ymd: string | null | undefined,
  today: string = kstYmdStr(),
): { ok: true } | { ok: false; reason: string } {
  const raw = (ymd ?? '').slice(0, 10)
  if (!YMD.test(raw)) return { ok: true }
  if (raw <= today) return { ok: true }
  return { ok: false, reason: `완료일이 미래입니다(${raw}). 아직 하지 않은 일은 완료로 기록할 수 없습니다.` }
}
