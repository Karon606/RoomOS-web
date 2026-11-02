// 보관 위치 열림 판정 정본(lib/locationOpen) 진리표 — 두 축 열림·서브트리 닫기·다시 사용 조상 조건·새 기본 창고·목적지 기본값. DB 불필요.
//
// 이 판정이 틀리면 값 대조로는 안 보인다. 수량은 내내 맞고, 사용 중지한 창고가 허브 폴백·옮기기 목적지에 다시 뜨거나
// 기본 창고 없이 닫혀 미리 고르기가 비는 모양으로만 드러난다. 그래서 경우를 박제한다.
import { isOpenLocation, isOpenLink, closeTargetIds, closedAncestorOf, newDefaultProblem, defaultDestinationId, type ClosableRow } from '../lib/locationOpen'

let pass = 0
const fails: string[] = []
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else fails.push(`${label}: 기대 ${w} / 실제 ${g}`)
}

const D = '2026-10-28T00:00:00.000Z'
// 4층 ─ 415호 창고(기본 창고) ─ 상단·하단(하단은 이미 닫힘) / 4층 사무실 / 603호 창고 / 옥상(닫힘) ─ 물탱크
const rows: ClosableRow[] = [
  { id: 'f4', parentId: null, name: '4층', sortOrder: 0 },
  { id: 'w415', parentId: 'f4', name: '415호 창고', sortOrder: 0, isHub: true },
  { id: 'top', parentId: 'w415', name: '상단', sortOrder: 0 },
  { id: 'bot', parentId: 'w415', name: '하단', sortOrder: 1, closedAt: '2026-10-01T00:00:00.000Z' },
  { id: 'off', parentId: 'f4', name: '사무실', sortOrder: 1 },
  { id: 'w603', parentId: null, name: '603호 창고', sortOrder: 1 },
  { id: 'roof', parentId: null, name: '옥상', sortOrder: 2, closedAt: D },
  { id: 'tank', parentId: 'roof', name: '물탱크', sortOrder: 0, closedAt: D },
]

// ── ① 두 축 열림 ─────────────────────────────────────────────────────
eq('①-1 위치 열림', isOpenLocation({ closedAt: null }), true)
eq('①-2 위치 닫힘', isOpenLocation({ closedAt: D }), false)
eq('①-3 링크·위치 다 열림', isOpenLink({ closedAt: null }, { closedAt: null }), true)
eq('①-4 품목이 숨김', isOpenLink({ closedAt: D }, { closedAt: null }), false)
eq('①-5 위치 사용 중지(링크는 열림)', isOpenLink({ closedAt: null }, { closedAt: D }), false)
eq('①-6 칸이 없으면(undefined) 열림', isOpenLink({}, {}), true)

// ── ② 서브트리 함께 닫기 ─────────────────────────────────────────────
eq('②-1 415 를 닫으면 자기·상단(하단은 이미 닫힘)', closeTargetIds(rows, 'w415').sort(), ['top', 'w415'])
eq('②-2 4층을 닫으면 열린 자손 전부', closeTargetIds(rows, 'f4').sort(), ['f4', 'off', 'top', 'w415'])
eq('②-3 잎 하나', closeTargetIds(rows, 'off'), ['off'])
eq('②-4 없는 id', closeTargetIds(rows, 'nope'), [])

// ── ③ 다시 사용은 조상이 열려 있을 때만 ──────────────────────────────
eq('③-1 루트는 늘 가능', closedAncestorOf(rows, 'roof'), null)
eq('③-2 닫힌 부모 아래 자식은 불가(부모 id)', closedAncestorOf(rows, 'tank'), 'roof')
eq('③-3 열린 조상 아래 닫힌 칸은 가능', closedAncestorOf(rows, 'bot'), null)

// ── ④ 새 기본 창고(결정 4) ───────────────────────────────────────────
const closing415 = closeTargetIds(rows, 'w415')
eq('④-1 기본 창고를 닫는데 새 창고가 없으면 필수', newDefaultProblem(rows, closing415, null), 'required')
eq('④-2 새 창고가 열린 바깥 위치면 통과', newDefaultProblem(rows, closing415, 'w603'), null)
eq('④-3 새 창고가 닫는 서브트리 안이면 거부', newDefaultProblem(rows, closing415, 'top'), 'invalid')
eq('④-4 새 창고가 이미 닫힌 위치면 거부', newDefaultProblem(rows, closing415, 'roof'), 'invalid')
eq('④-5 기본 창고가 아닌 곳을 닫으면 필요 없음', newDefaultProblem(rows, ['off'], null), null)
eq('④-6 없는 id 는 거부', newDefaultProblem(rows, ['off'], 'nope'), 'invalid')

// ── ⑤ 목적지 기본값 ─────────────────────────────────────────────────
eq('⑤-1 새 기본 창고가 있으면 그것', defaultDestinationId(rows, closing415, 'w603'), 'w603')
eq('⑤-2 기본 창고가 아닌 곳을 닫으면 지금 기본 창고', defaultDestinationId(rows, ['off'], null), 'w415')
eq('⑤-3 기본 창고를 닫는데 새 창고를 안 골랐으면 빈 값', defaultDestinationId(rows, closing415, null), '')

if (fails.length) {
  for (const f of fails) console.error(`FAIL  ${f}`)
  console.error(`\n[위치 열림 정본] 통과 ${pass} / 실패 ${fails.length}`)
  process.exit(1)
}
console.log(`[위치 열림 정본] 통과 ${pass} / 실패 0`)
