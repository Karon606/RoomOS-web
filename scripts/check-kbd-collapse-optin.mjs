// 키보드 접힘이 저장 수단을 삼키는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 무엇을 막는가. `collapseFooterOnKeyboard` 는 키보드가 올라온 동안 모달 푸터를 통째로 감춘다.
// 그 자리가 **이동 표면**일 때만 옳다(엔티티 셸의 액션·탭처럼, 눌러 봐야 지금 쓰는 글을 버리는
// 것들). 푸터에 저장·보내기가 있는 모달에 켜면 글을 쓰는 동안 커밋 수단이 사라진다 —
// v2.0 §27.1 "폼형(2필드 이상/텍스트) = 저장 버튼 상시 노출(조건부 등장 금지)" 정면 위반이다.
//
// 그래서 기본값이 off 이고 켜는 곳은 손에 꼽아야 한다. 이 그물은 켠 곳이 늘어날 때 사람이
// 한 번 더 보게 만든다. 늘리는 것 자체가 금지는 아니고, 그 푸터가 정말 이동 표면인지
// 확인하고 아래 ALLOW 에 근거와 함께 적으라는 뜻이다.
//
// 실행: node scripts/check-kbd-collapse-optin.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 켜도 되는 곳 — 푸터가 이동 표면이고 커밋 수단이 본문 안에 있는 모달.
const ALLOW = new Set([
  // 액션 여섯(서류·수정·삭제)과 탭 셋뿐이라 커밋 수단이 아예 없다. 요청 등록의 '등록'은
  // 본문 카드 안에 있어(TenantRequestsTab) 접어도 안 사라지고, 오히려 접어야 화면에 들어온다.
  'components/entity-modal/EntityModal.tsx',
])

const ROOTS = ['app', 'components']
function walk(p) {
  const out = []
  for (const n of readdirSync(p)) {
    const f = join(p, n)
    const st = statSync(f)
    if (st.isDirectory()) out.push(...walk(f))
    else if (/\.tsx$/.test(f)) out.push(f)
  }
  return out
}

const violations = []
let found = 0
for (const root of ROOTS) {
  for (const f of walk(root)) {
    const src = readFileSync(f, 'utf8')
    // 정의부(Modal 자신)는 제외 — prop 선언과 래퍼 클래스가 여기 있다.
    if (f === 'components/ui/Modal.tsx') continue
    if (!src.includes('collapseFooterOnKeyboard')) continue
    found++
    if (!ALLOW.has(f)) {
      violations.push(`${f} — 푸터 접힘을 켰다. 그 푸터에 저장·보내기가 있으면 §27.1 위반이다`)
    }
  }
}

console.log(`[키보드 접힘 옵트인] 켠 곳 ${found}개 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  푸터가 이동 표면(눌러야 지금 쓰는 글을 버리는 것뿐)인지 확인하고,')
  console.error('  맞으면 scripts/check-kbd-collapse-optin.mjs 의 ALLOW 에 근거와 함께 적을 것.')
  process.exit(1)
}
