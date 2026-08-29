// 프리즘 셸 액션 행이 세 면에서 한 골격을 지키는지 보는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 이 행은 정본이 없는 자리라 세 면이 각자 문법을 만들었고, 그 드리프트가 신고로
// 돌아왔다(2026-08-29 — "입주자 정보에는 보증금 영수증 버튼이 없네", "수납정보에는 수정버튼이
// 없어"). 골격을 코드로 못 박지 않으면 다음 사람이 또 자기 문법을 만든다.
//
// 세 축을 본다.
//
//   ⓐ flex-wrap 이 없다. 종전에는 버튼이 늘면 조용히 접혔다. 접히면 기기마다 버튼 자리가
//     달라져 근육 기억이 안 서고, 더 나쁘게는 **파괴적 버튼의 자리가 설계가 아니라 레이아웃
//     계산 결과**가 된다. 아이폰 폭에서 세 줄로 접혀 푸터가 226px, 본문이 38px 만 남아 입력칸이
//     물리적으로 안 들어간 적이 있다. wrap 은 안전망이 아니라 은폐 장치다.
//
//   ⓑ 한 면에 Btn 이 셋을 넘지 않는다. ⓐ가 접힘을 막으니 넷째가 서면 넘쳐서 티가 나야 하는데,
//     티가 나는 것은 실기에서다. 여기서 먼저 잡는다. 넷이 필요해지면 시트로 보낼 일이지
//     줄을 늘릴 일이 아니다.
//
//   ⓒ 수납 면의 서류 문이 **이 면이 열어 둔 계약**(shownLeaseId)을 싣는다. 601호 창고 수납을
//     보다 누른 문이 509호 거주 계약의 서류를 뽑으면, 받지도 않은 돈의 종이가 나간다.
//     이 사고는 2026-08-13 에 한 번 봉합했다 — 그때 없던 그물을 지금 세운다.
//
// 실행: node scripts/check-prism-action-row.mjs
import { readFileSync } from 'node:fs'

const FILE = 'components/entity-modal/EntityModal.tsx'
const src = readFileSync(FILE, 'utf8')
const lineAt = (i) => src.slice(0, i).split('\n').length

// 푸터의 액션 구역만 본다 — 본문·시트의 Btn 은 이 규칙 대상이 아니다.
const start = src.indexOf('<div className="space-y-2">')
const end = src.indexOf('<PrismNavBar')
if (start < 0 || end < 0 || end <= start) {
  console.error(`[프리즘 액션 행] ${FILE} 에서 푸터 액션 구역을 못 찾았다. 셸 구조가 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  process.exit(1)
}
const footer = src.slice(start, end)

const marks = [...footer.matchAll(/\{kind === '(room|tenant|payment)' &&/g)]
const blocks = marks.map((m, i) => ({
  kind: m[1],
  at: start + m.index,
  body: footer.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : footer.length),
}))

const violations = []
const seen = new Set(blocks.map(b => b.kind))
for (const k of ['room', 'tenant', 'payment']) {
  if (!seen.has(k)) violations.push(`${FILE} — '${k}' 면의 액션 행이 없다. 세 면은 같은 골격을 쓴다.`)
}

for (const b of blocks) {
  const ln = lineAt(b.at)

  // ⓐ
  if (/flex-wrap/.test(b.body)) {
    violations.push(`${FILE}:${ln} — '${b.kind}' 면 액션 행에 flex-wrap 이 있다. 접힘을 숨긴다.`)
  }

  // ⓑ
  const btns = (b.body.match(/<Btn[\s>]/g) ?? []).length
  if (btns > 3) {
    violations.push(`${FILE}:${ln} — '${b.kind}' 면 액션 행의 버튼이 ${btns}개다(상한 3). 넷째는 시트로 보낸다.`)
  }

  // ⓒ — 수납 면 서류 문이 계약을 싣는지.
  if (b.kind === 'payment') {
    if (!/setDocSheetLease\(shownLeaseId\)/.test(b.body)) {
      violations.push(`${FILE}:${ln} — 수납 면 서류 문이 shownLeaseId 를 안 싣는다. 보고 있는 계약과 나가는 종이가 하나여야 한다.`)
    }
  }
}

console.log(`[프리즘 액션 행] 면 ${blocks.length}개 검사 · 축 ⓐ wrap 금지 · ⓑ 버튼 3개 상한 · ⓒ 수납 면 서류 문의 계약 지목 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  세 면은 [좌: 파괴적] ... [우: 서류·수정] 한 골격을 쓴다.')
  console.error('  버튼이 더 필요하면 줄을 늘리지 말고 서류 시트로 보낸다.')
  process.exit(1)
}
