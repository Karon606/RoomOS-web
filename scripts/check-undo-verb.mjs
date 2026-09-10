// §16 적용취소 동사 감지망 — 버튼은 '적용취소'인데 토스트만 '되돌렸습니다'로 갈리는 것을 잡는다.
//
// 왜 필요한가. §16 이 라벨을 '적용취소' 하나로 못박은 뒤에도 결과 토스트는 옛 동사로 남아 있었다.
// 같은 동작을 누를 때와 끝났을 때 두 단어로 부르면 운영자는 다른 일이 일어난 줄 안다.
// 정리한 자리는 형식이 하나다 — "{목적어}를 적용취소했습니다 · {복귀}".
//
// 두 층으로 본다. GUARDED 는 이미 고친 자리라 옛 동사가 되살아나면 붉게 선다(exit 1).
// 그 밖의 파일은 목록(info)으로만 찍는다 — 같은 짝이 보이는 자리를 다음 정비가 알아보게 두되,
// 문장 판정까지 이 그물이 대신하지는 않는다.
//
// 실행: node scripts/check-undo-verb.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 고친 자리와, 그 자리에서 되살아나면 안 되는 옛 문장.
const GUARDED = {
  // 확인창 둘 다 본다 — '자동값으로'(표시값 오버라이드)와 '공통 템플릿으로'(본문 오버라이드).
  // 둘 다 입주자별로 얹은 것을 무르는 동작이라 §16 이 같은 라벨을 요구한다.
  'app/contract/[tenantId]/ContractView.tsx': ['자동값으로 되돌렸습니다', '보관용으로 바뀐 것을 되돌렸습니다', "confirmLabel: '되돌리기'"],
  'components/doc/FieldOverrideListModal.tsx': ['자동값으로 되돌렸습니다'],
  'app/(app)/settings/DocVariablesPanel.tsx': ['을(를) 되돌렸습니다'],
  'app/(app)/dashboard/DashboardClient.tsx': ['이사를 되돌렸습니다'],
  'components/tenant/MoveRoomNowButton.tsx': ['이사를 되돌렸습니다'],
  'app/(app)/inventory/InventoryClient.tsx': ['입수 기록을 되돌렸습니다'],
}

const violations = []
for (const [f, olds] of Object.entries(GUARDED)) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const old of olds) {
      if (line.includes(old)) violations.push(`${f}:${i + 1} — 옛 동사 '${old}'. §16 형식은 "…를 적용취소했습니다 · …".`)
    }
  })
}

// 완료 직후 토스트의 적용취소(§16 진입점 1) — 청소·작업 두 행이 같은 한 벌이라야 한다.
//
// 왜 문장만 안 보고 배선까지 보는가. 여기서 재는 것은 '동사'가 아니라 '길이 있는가'다.
// 액션 블록을 통째로 지워도 옛 동사가 안 생기므로 위 GUARDED 로는 안 걸리고, 형제 그물
// check-work-link-wiring 은 import 줄의 이름에 걸려 초록으로 통과했다(2026-09-11 역주입 실측).
const ROW_UNDO = {
  'components/cleaning/CleaningRowBody.tsx': ['reopenCleaning', '청소'],
  'components/work/RoomWorkRowBody.tsx': ['reopenRoomWork', '작업'],
}
const DONE_SENTENCE = '완료를 적용취소했습니다 · 예정으로 복귀'
for (const [f, [action, what]] of Object.entries(ROW_UNDO)) {
  // 주석은 안 본다 — "적용취소가 있다"고 적힌 설명이 검사를 통과시키면 그물이 아니라 장식이다.
  const s = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  if (!/label: '적용취소'/.test(s)) {
    violations.push(`${f} — ${what} 완료 직후 토스트에 적용취소 액션이 없다(§16 진입점 1).`)
  }
  if (!new RegExp(`label: '적용취소'[\\s\\S]{0,200}${action}\\(`).test(s)) {
    violations.push(`${f} — 그 적용취소 액션이 ${action}() 를 부르지 않는다. 되돌릴 길이 이름만 남는다.`)
  }
  if (!s.includes(DONE_SENTENCE)) {
    violations.push(`${f} — 되돌린 뒤 결과 토스트 '${DONE_SENTENCE}' 가 없다(§16 "적용취소 후에도 결과 토스트").`)
  }
}

// 별건 목록 — 라벨 '적용취소' 와 토스트 '되돌렸습니다' 가 한 파일에 같이 있는 자리.
const others = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (!/\.tsx?$/.test(name) || GUARDED[full]) continue
    const src = readFileSync(full, 'utf8')
    if (src.includes("label: '적용취소'") && src.includes('되돌렸습니다')) others.push(full)
  }
}
for (const r of ['components', 'app']) walk(r)

console.log(`[적용취소 동사] 동사 ${Object.keys(GUARDED).length}곳 · 완료 직후 진입점 ${Object.keys(ROW_UNDO).length}곳 검사 / 위반 ${violations.length}건`)
if (others.length > 0) {
  console.log('  (별건) 라벨 적용취소 + 토스트 되돌렸습니다 가 같이 있는 파일:')
  for (const f of others) console.log(`    · ${f}`)
}
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  누를 때와 끝났을 때를 두 단어로 부르면 운영자는 다른 일이 일어난 줄 안다(§16).')
  process.exit(1)
}
