// 작업 비용을 시공비와 자재 몫으로 가르는 정본 — 화면과 백필이 같은 규칙을 쓴다.
//
// 두 성질이 섞여 있다(운영자 확인 2026-08-25, knowledge/domain-room-work).
//   · **시공비** — 그 방 때문에 이번에 새로 지불한 공임.
//   · **자재 몫** — 이미 사둔 재료 중 그 방에 쓴 분량. 돈은 **살 때 이미** 나갔고, 그 지출을
//     방별로 쪼갠 행이다(allocationGroupId). 새로 나간 돈이 아니다.
//
// 왜 allocationGroupId 로 안 가르나. 그 칸은 '쪼갰다'는 사실만 말한다 — 실측하면 공임인
// '벽지도배'도 15건 중 5건이 묶음 소속이다. 쪼갬 여부와 돈의 성질은 다른 축이다.
//
// 그래서 **품목 이름**으로 가른다. 운영자가 쓰는 말이 곧 기준이다 — '시공'·'하리'(현장 용어)가
// 공임이고, '벽지도배'는 자재를 따로 안 사고 한 줄로 적은 도배 공임이다. '도배+장판'은 상세를
// 나눠 적기 전 시기의 한 줄이라 공임으로 본다.
//
// **한계를 알고 쓴다.** 종류도 품목명도 자유 입력이라 이 규칙이 새 이름을 다 맞힐 수는 없다.
// 못 알아본 것은 자재로 센다 — 공임으로 세면 "이번에 나간 돈"을 부풀려 말하게 되고, 그쪽이
// 더 나쁜 거짓이다.
const LABOR_RE = /시공|하리|벽지도배|도배\+장판/

export function isLaborItem(label: string | null | undefined, detail?: string | null): boolean {
  return LABOR_RE.test(`${label ?? ''} ${detail ?? ''}`)
}

export type WorkCostSplit = { labor: number; material: number; total: number }

/** 작업에 걸린 지출들을 시공비·자재 몫으로 가른다. */
export function splitWorkCost(
  expenses: readonly { amount: number; itemLabel?: string | null; detail?: string | null }[],
): WorkCostSplit {
  let labor = 0, material = 0
  for (const e of expenses) {
    if (isLaborItem(e.itemLabel, e.detail)) labor += e.amount
    else material += e.amount
  }
  return { labor, material, total: labor + material }
}
