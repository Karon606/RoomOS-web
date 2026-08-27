// 작업 비용을 시공비와 자재비로 가르는 정본 — 화면과 백필이 같은 규칙을 쓴다.
//
// 두 성질이 섞여 있다(운영자 확인 2026-08-25, knowledge/domain-room-work).
//   · **시공비** — 그 방 때문에 이번에 새로 지불한 공임.
//   · **자재비** — 이미 사둔 재료 중 그 방에 쓴 분량. 돈은 **살 때 이미** 나갔고, 그 지출을
//     방별로 쪼갠 행이다(allocationGroupId). 새로 나간 돈이 아니다.
//
// 왜 allocationGroupId 로 안 가르나. 그 칸은 '쪼갰다'는 사실만 말한다 — 실측하면 공임인
// '벽지도배'도 15건 중 5건이 묶음 소속이다. 쪼갬 여부와 돈의 성질은 다른 축이다.
//
// 그래서 **품목 이름**으로 가른다. 운영자가 쓰는 말이 곧 기준이다 — '시공'·'돌출부'가 공임이고,
// '벽지도배'는 자재를 따로 안 사고 한 줄로 적은 도배 공임이다. '도배+장판'은 상세를 나눠 적기
// 전 시기의 한 줄이라 공임으로 본다.
//
// '하리'는 종전에 쓰던 현장 용어다(운영자 지시 2026-08-27 로 '돌출부'로 바꿨고 지출 29건을
// 백필했다). **판정에는 남겨 둔다** — 뺐다가 누가 옛 말로 적으면 공임이 조용히 자재로 세어져
// 그 방 투자금이 틀린 채로 굳는다. 표시에는 안 쓰고 알아듣기만 한다.
//
// **한계를 알고 쓴다.** 종류도 품목명도 자유 입력이라 이 규칙이 새 이름을 다 맞힐 수는 없다.
// 못 알아본 것은 자재로 센다 — 공임으로 세면 "이번에 나간 돈"을 부풀려 말하게 되고, 그쪽이
// 더 나쁜 거짓이다.
const LABOR_RE = /시공|돌출부|하리|벽지도배|도배\+장판/

/**
 * 이 지출이 공임(시공·서비스)인가.
 *
 * **작업에 걸린 지출은 글자를 안 보고 무조건 공임이다**(운영자 확정 2026-08-27).
 *   "작업 캘린더로 들어오는건 말그대로 작업이니까 모두 시공, 서비스로 보면 돼. (…)
 *    지출을 통해서 들어온다면 거기에 선택하면 이건 자재가 아니라 시공, 서비스인거야.
 *    이러면 명확하지? 용어에 상관없이."
 *
 * 이 축이 위 글자 판정의 취약점을 없앤다. 종전에는 새 작업 종류가 생길 때마다 그 종류의
 * 말을 LABOR_RE 에 더해야 했다 — '실리콘 시공'은 걸리는데 '실리콘'·'실리콘 작업'은 자재로
 * 세어졌고, 종류가 자유 입력이라 말을 다 맞힐 수가 없었다. 작업에 건다는 것은 운영자가
 * "이건 시공이다"라고 선언한 것이라, 그 선언이 글자보다 강한 근거다.
 *
 * 글자 판정은 **작업에 안 걸린 지출**에만 남는다(지출만 적고 작업을 안 만든 경우).
 */
export function isLaborItem(
  label: string | null | undefined,
  detail?: string | null,
  costKind?: string | null,
): boolean {
  // 운영자가 표식을 세웠으면 글자를 안 본다. 이것이 '용어에 상관없이'의 실체다.
  if (costKind === 'LABOR') return true
  if (costKind === 'MATERIAL') return false
  return LABOR_RE.test(`${label ?? ''} ${detail ?? ''}`)
}

export type WorkCostSplit = { labor: number; material: number; total: number }

/** 작업에 걸린 지출들을 시공비·자재비로 가른다. 표식(costKind)이 있으면 그것이 글자보다 강하다. */
export function splitWorkCost(
  expenses: readonly { amount: number; itemLabel?: string | null; detail?: string | null; costKind?: string | null }[],
): WorkCostSplit {
  let labor = 0, material = 0
  for (const e of expenses) {
    if (isLaborItem(e.itemLabel, e.detail, e.costKind)) labor += e.amount
    else material += e.amount
  }
  return { labor, material, total: labor + material }
}
