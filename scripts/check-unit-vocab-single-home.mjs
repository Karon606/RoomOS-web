// 단위 어휘가 다시 여러 곳으로 흩어지는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 규칙으로 세우는가. 종전에는 지출 폼과 규격 마법사가 각자 어휘를 들고 있었고, 마법사에는
// "지출 폼과 동일 집합에서 — 새 표기를 만들지 않아 데이터 파편화 방지" 라는 주석까지 달려
// 있었다. 그런데 실제로는 이미 어긋나 있었다. **주석은 지켜지지 않는다.**
//
// 어긋나면 무슨 일이 생기나. 마법사가 수량으로 저장하던 '장·매·알·권' 이 지출 폼 목록에는
// 없어서, 저장 후 그 지출을 다시 열면 단위 칸이 '직접 입력' 으로 떨어졌다. 더 나쁜 것은
// 재고 매칭이 글자 그대로 비교한다는 점이다 — 어휘가 갈리면 구매가 잔량에서 통째로 빠진다.
//
// 판정 축 둘. 하나만 보면 오탐이 난다.
//   ⓐ 정본을 참조하는가 — DEFAULT_*_UNITS 를 안 쓰기 시작하면 어휘가 다시 갈라진 것이다.
//   ⓑ 목록을 통째로 베꼈는가 — 정본이 열대여섯 개라 통째 복제는 반드시 여덟을 넘는다.
//      그룹별 부분집합(bag 그룹의 ['g','kg','매','개','인분'])은 정당하고 여섯을 안 넘는다.
//
// 실행: node scripts/check-unit-vocab-single-home.mjs
import { readFileSync } from 'node:fs'

const HOME = 'lib/unitOptions.ts'
const WATCH = [
  'app/(app)/finance/FinanceClient.tsx',
  'components/ui/SpecWizard.tsx',
]
const UNIT_WORDS = ['kg', 'g', 'ml', 'L', 'cm', 'mm', '개', '박스', '롤', '팩', '봉', '컵', '매', '장']
const BULK = 8

const violations = []
for (const f of WATCH) {
  const src = readFileSync(f, 'utf8')
  if (!/DEFAULT_(SPEC|QTY)_UNITS/.test(src)) {
    violations.push(`${f} — 정본(DEFAULT_*_UNITS)을 안 쓴다. 어휘를 제 파일에 다시 들고 있는 것이다`)
  }
  for (const m of src.matchAll(/\[([^[\]]{10,600})\]/g)) {
    const items = [...m[1].matchAll(/'([^']{1,6})'/g)].map(x => x[1])
    if (items.length < BULK) continue
    if (items.filter(u => UNIT_WORDS.includes(u)).length < 4) continue
    const line = src.slice(0, m.index).split('\n').length
    violations.push(`${f}:${line} — 단위 목록을 통째로 나열했다(${items.length}개): ${items.slice(0, 8).join(', ')}…`)
  }
}

console.log(`[단위 어휘 단일 정본] 감시 ${WATCH.length}개 파일 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error(`  어휘는 ${HOME} 하나에 둔다. 그룹별 부분집합이 정말 필요하면 그 목록에서 골라 쓸 것.`)
  process.exit(1)
}
