// 위치 이동·숨김 이관 점검의 StockCheck.create data 를 조립하는 순수함수.
import { kstYmdStr, ymdToDbDate } from '@/lib/kstDate'

// breakdown 전체(0 포함)를 담아 새 baseline 을 만든다.
// ⚠️ 부분 breakdown 을 만들면 total != byLoc 합 불변식이 깨진다. transferLocationStock·closeItemLocation 공유.
//
// `measuredLocationId` 는 **그 자리에서 직접 센 위치 하나**다(위치별 점검 패널의 '다른 곳으로',
// 2026-09-15). 그 행만 실측(`carried: false`)이고 나머지는 표식을 안 찍는다(null).
// ⚠️ 이동 행에 `carried: true` 를 찍으면 안 된다 — 이동 행은 이월도 실측도 아닌 '이월 + 델타' 라,
//   이월로 선언하는 순간 planCheckPropagation 이 파생식으로 덮어써 옮긴 델타를 지운다.
// 표식 없음(null)은 '문을 열어 두는' 것이 아니다 — planCheckPropagation 의 휴리스틱은 저장값이
// 파생식(직전 + 입수 − 차감)과 같을 때만 이월로 보는데, 이동 행은 옮긴 N 만큼 달라 항상 실측
// 판정이 난다. 그래서 그 행은 **첫 전파에서 carried: false 로 확정**된다(lib/stockLedger 314~325).
// 델타 행을 planner 가 '옮김' 으로 알아보는 표현은 아직 없다(knowledge/open-issues.md 후속).
export function transferCheckCreateData(
  trackedItemId: string,
  breakdown: Map<string, number>,
  memo: string,
  measuredLocationId?: string,
) {
  const entries = [...breakdown.entries()]
  const total = entries.reduce((s, [, q]) => s + Math.max(0, q), 0)
  return {
    trackedItemId,
    // 오늘(KST)의 @db.Date 표현(lib/kstDate 정본). 종전 `new Date()` 는 서버 UTC 날짜라 KST 00~09시에
    // 만든 이동 점검이 어제 날짜로 박혀 (date desc, createdAt desc) 정렬에서 같은 날 폼 점검 뒤로
    // 밀렸다 — 토스트는 완료인데 장부에는 이동이 안 보인다. createStockCheck 가 받는 축과 같게 맞춘다.
    date: ymdToDbDate(kstYmdStr()),
    remainingQty: total,   // 행 합 — 실측이 없으면 총량 불변(이동은 소모가 아님)
    memo,
    locationBreakdown: {
      create: entries.map(([storageLocationId, q]) => ({
        storageLocationId,
        remainingQty: Math.max(0, q),
        ...(storageLocationId === measuredLocationId ? { carried: false } : {}),
      })),
    },
  }
}
