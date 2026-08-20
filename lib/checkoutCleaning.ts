// 퇴실 자동 청소의 예정일을 정하는 규칙 정본 — 퇴실 경로 둘이 이 답 하나를 함께 쓴다.
//
// 종전에는 `ensureCheckoutCleaning` 이 `kstYmdStr()`(저장 버튼을 누른 날)을 그대로 박았다.
// 그래서 만들어진 **다음 날부터** 캘린더에 '예정일 경과'로 떴다(422호가 그 사례). 날짜 정본은
// 제대로 쓰고 있었으니 하루 밀림이 아니라, **애초에 오늘이 예정일이 아니라는 것**이 문제였다.
//
// 규칙은 하나다 — 기본 예정일은 **퇴실 다음 날**이되, 그날이 이미 지났으면 오늘로 당긴다.
//   퇴실일 다음 날인 이유. 방이 비는 것은 퇴실일이지만 그날 안에 짐이 다 빠지는지는 저장하는
//   시점에 알 수 없고, 맡기는 청소는 방을 모아 도느라 대개 다음 날 이후다. 무엇보다 **틀리는
//   방향의 값이 다르다** — 기본값이 하루 늦으면 그날 치우고 완료로 적으면 그만이고(캘린더는
//   완료 건을 완료일에 그린다) 눈에 남는 손해가 없다. 하루 이르면 퇴실마다 다음 날 아침에
//   거짓 지연이 뜨고, 지연 표시가 매번 거짓이면 **진짜 늦은 청소도 함께 안 보이게 된다.**
//   오늘로 당기는 이유. 뒤늦게 퇴실을 처리하는 경우(퇴실일이 이미 과거) 퇴실 다음 날을 그대로
//   쓰면 예정이 태어나자마자 '경과'가 된다. 아무도 약속한 적 없는 날을 어겼다고 말하는 셈이다.
//
// 예정일은 방의 상태가 아니라 **약속**이다. "언제부터 더러운가"는 leaseTerm.moveOutDate 가
// 이미 갖고 있고, 이 칸은 "언제 하기로 했나"라서 지연이 뜻을 가지려면 사람이 정한 날이어야 한다.
// 그래서 기본값은 제안일 뿐이고 퇴실 미니폼에서 고칠 수 있다.

const DAY_MS = 86400000
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// UTC 자정끼리의 덧셈이라 실행 환경 시간대도 서머타임도 끼어들 여지가 없다(lib/moveCalendar 와 같은 문법).
const atUtc = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`)
const addDays = (ymd: string, n: number): string => new Date(atUtc(ymd) + n * DAY_MS).toISOString().slice(0, 10)

/**
 * 'YYYY-MM-DD' 로 읽히고 **실제로 있는 날**인 값만 통과. 아니면 null.
 *
 * 모양 검사만으로는 부족하다 — `2026-02-31` 은 정규식도 Date.parse 도 통과하는데 굴러서
 * 3월 3일이 되고, 평년의 `2026-02-29` 는 3월 1일이 된다. 퇴실일은 사람 손으로 들어오는 값이라
 * 이 모양이 실제로 온다. 되돌려 적어 같은 글자가 나오는지까지 봐야 굴러간 날이 걸린다.
 */
function normYmd(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().slice(0, 10)
  if (!YMD_RE.test(s)) return null
  const t = Date.parse(`${s}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString().slice(0, 10) === s ? s : null
}

/**
 * 퇴실 청소 예정일의 기본값. 퇴실 다음 날이되 이미 지났으면 오늘.
 *
 * 문자열 비교로 대소를 재는 것은 'YYYY-MM-DD' 가 자리수 고정 영벌림이라 사전순이 곧 시간순이기
 * 때문이다. Date 를 만들지 않으므로 실행 환경 시간대가 답에 섞일 길이 없다.
 */
export function defaultCheckoutCleaningYmd(
  moveOutYmd: string | null | undefined,
  todayYmd: string,
): string {
  const out = normYmd(moveOutYmd)
  // 퇴실일을 못 읽으면 기댈 것이 오늘뿐이다. 방은 이미 비어 있다.
  if (!out) return todayYmd
  const after = addDays(out, 1)
  return after > todayYmd ? after : todayYmd
}

/**
 * 운영자 입력을 얹은 최종 예정일. 세 갈래를 **말이 다른 세 값**으로 가른다.
 *   undefined  호출부가 값을 안 보냈다(이 흐름을 아직 안 지나는 경로) — 기본값 규칙을 쓴다.
 *   null·빈칸  운영자가 '미정'으로 두었다 — 날짜 없는 예정을 만든다.
 *   'YYYY-MM-DD'  운영자가 고른 날.
 *
 * 못 읽는 값이 오면 '미정'이 아니라 **기본값**으로 떨어진다. 빈칸은 운영자의 뜻이지만
 * 깨진 문자열은 사고라서, 그것을 뜻으로 읽으면 화면에서 고른 날짜가 조용히 사라진다.
 */
export function resolveCheckoutCleaningYmd(
  input: string | null | undefined,
  moveOutYmd: string | null | undefined,
  todayYmd: string,
): string | null {
  if (input === undefined) return defaultCheckoutCleaningYmd(moveOutYmd, todayYmd)
  if (input === null || input.trim() === '') return null
  return normYmd(input) ?? defaultCheckoutCleaningYmd(moveOutYmd, todayYmd)
}
