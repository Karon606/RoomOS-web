// 퇴실 자동 청소의 예정일 규칙 정본 — 퇴실 경로 둘이 이 답 하나를 함께 쓴다.
//
// **날짜를 앱이 정하지 않는다.** 운영자가 적은 날이 곧 예정일이고, 안 적으면 예정일이 없다.
//
// 종전에는 `kstYmdStr()`(저장 버튼을 누른 날)을 박았고, 그 뒤 한동안 '퇴실 다음 날' 을 기본값으로
// 제안했다. 둘 다 걷었다 — 운영자 확정(2026-08-21): "청소 예정일은 자동으로 잡아줄 필요가 없어.
// 내가 입력하면 그 날짜가 예정일인거야. 퇴실 당일에도 청소할 수 있는거고 퇴실 전에 청소도
// 필요하면 하는거지."
//
// 그래서 퇴실일과의 대소도 재지 않는다. 퇴실 전 청소가 정당한 일정이라 이르다고 막을 근거가 없다.
// 예정일은 방의 상태가 아니라 **약속**이다. "언제부터 비는가"는 leaseTerm.moveOutDate 가 이미
// 갖고 있고, 이 칸은 "언제 하기로 했나"다. 아무도 약속한 적 없는 날을 앱이 적어 두면 그 다음 날
// 아침의 '예정일 경과' 가 거짓이 되고, 지연 표시가 매번 거짓이면 진짜 늦은 청소도 함께 안 보인다.

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

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
 * 운영자 입력을 예정일로 읽는다. 읽히는 날짜가 아니면 전부 '미정'(null).
 *
 *   'YYYY-MM-DD'  운영자가 적은 날. 퇴실일보다 이르든 늦든 그대로 쓴다.
 *   null·빈칸     안 적었다 — 날짜 없는 예정을 만든다.
 *   undefined     호출부가 이 흐름을 아직 안 지난다 — 역시 날짜를 지어내지 않는다.
 *   깨진 값       사고다. 지어낸 날을 적느니 미정으로 둔다(사람이 나중에 적으면 된다).
 *
 * 날짜 없는 예정도 예정이다 — 청소 목록·배지·'청소 필요 N실' 에는 남고 캘린더에만 안 선다.
 */
export function resolveCheckoutCleaningYmd(input: string | null | undefined): string | null {
  if (input === undefined || input === null) return null
  return normYmd(input)
}
