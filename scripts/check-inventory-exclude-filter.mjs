// 잔량 정본의 expense 질의가 '재고 제외' 필터를 잃지 않았는지 본다(소스 가드).
//
// 왜 소스 가드인가. 2026-09-11 탐침에서 `app/(app)/inventory/overview.ts` 의
// `excludeFromInventory: false` 를 지웠더니 재고 대조 셋(개요·원장·시점)이 **전부 초록으로
// 지나갔다.** 그 셋은 같은 코드 경로를 서로 견주거나 내부 정합을 보기 때문에, 필터가 통째로
// 빠지면 양쪽이 똑같이 틀려서 차이가 안 난다. 오늘 만든 대시보드 대조는 잡았지만 그것은 기준
// JSON 이 있어야 돌아 상시 그물이 못 된다.
//
// 그래서 규칙을 소스에서 못박는다. **잔량 정본에서 prisma.expense 를 만지는 함수는 그 몸통에
// `excludeFromInventory` 를 갖는다.** 지금 네 함수(sumPurchases·resolveUnitHint·resolveSpecHint·
// dedupSameDay)가 전부 그렇고, 하나라도 잃으면 재고 제외로 등록한 지출이 잔량에 섞인다.
//
// 한계는 정직하게 적는다. 이 가드는 필터의 '존재'만 보지 '의미'는 못 본다. 값을 true 로 뒤집거나
// 조건을 다른 곳으로 옮기는 변경은 못 잡는다. 그 몫은 데이터 대조가 져야 하는데, 지금 그 자리가
// 비어 있다는 사실 자체를 이 파일이 증언한다.
//
// 실행: node scripts/check-inventory-exclude-filter.mjs
import { readFileSync } from 'node:fs'

const FILE = 'app/(app)/inventory/overview.ts'
const FLAG = 'excludeFromInventory'

// 주석을 걷는다 — 설명 글자가 검사를 통과시키면 안 된다(이 저장소에서 실제로 한 번 뚫렸다).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

const raw = readFileSync(FILE, 'utf8')
const src = stripComments(raw)

// 함수 경계로 잘라 'expense 를 만지는 함수'와 'FLAG 를 가진 함수'를 짝짓는다.
const starts = [...src.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)].map(m => ({ at: m.index, name: m[1] }))
starts.push({ at: src.length, name: '(끝)' })

const violations = []
let touched = 0

for (let i = 0; i < starts.length - 1; i++) {
  const body = src.slice(starts[i].at, starts[i + 1].at)
  const queries = (body.match(/prisma\.expense\./g) ?? []).length
  if (queries === 0) continue
  touched++
  if (!body.includes(FLAG)) {
    violations.push(
      `${FILE} — ${starts[i].name}() 가 expense 를 ${queries}회 조회하는데 ${FLAG} 필터가 없다. ` +
      '재고 제외로 등록한 지출이 잔량에 섞인다(재고 대조 셋은 이 결손을 못 잡는다).',
    )
  }
}

// 함수가 통째로 사라지거나 질의가 다른 파일로 옮겨간 경우도 잡는다.
if (touched === 0) {
  violations.push(`${FILE} — expense 를 조회하는 함수를 하나도 못 찾았다. 잔량 정본이 옮겨갔다면 이 가드의 대상도 함께 옮겨라.`)
}

if (violations.length > 0) {
  console.error(`[재고 제외 필터] 위반 ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log(`[재고 제외 필터] 위반 0건 (expense 를 만지는 함수 ${touched}개 전부 필터 보유)`)
