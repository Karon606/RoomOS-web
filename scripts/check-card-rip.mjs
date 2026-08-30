// 카드 좌측 립이 '정상 상태'에 되살아나는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 좌측 컬러 립은 지금 AI 가 만든 화면의 표식처럼 읽힌다. 모든 카드에 립을 다는
// 순간 그것은 정보가 아니라 장식이 되고, 정작 주의가 필요한 카드가 안 도드라진다.
// 2026-08-25 정비에서 공실 카드의 기본 립을 걷어 냈고(§29 "정상 상태 카드 립 0"), 지금은
// 연체·소진 임박 같은 **주의 상태에만** 선다.
//
// 그런데 그 규칙을 지키는 그물이 없었다. 알약 쪽은 check-pill-text 가 지키는데 립은 비어 있어,
// 다음 사람이 카드를 하나 더 만들면서 무조건 립을 달면 아무도 못 잡는다.
//
// 무엇을 보는가. 카드 컴포넌트에서 **조건 없이** 붙는 좌측 립을 잡는다.
//   · 클래스 문자열에 border-l-[Npx]/border-l-N 이 삼항·논리곱 없이 박혀 있으면 위반.
//   · style 객체에 borderLeftWidth 가 삼항 없이 박혀 있으면 위반.
// 조건부(삼항·&&)는 통과시킨다 — 주의 상태에만 서는 것이 규칙이고, 그 조건이 무엇인지까지
// 코드로 판정하는 것은 이 그물의 일이 아니다(그건 디자이너 패스가 본다).
//
// 사이드바의 활성 메뉴 표시선은 카드가 아니다. 대상은 카드 컴포넌트뿐이다.
//
// 실행: node scripts/check-card-rip.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 카드로 부르는 것들 — 이름에 Card 가 들어가는 컴포넌트 파일.
const ROOTS = ['components', 'app']
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (/Card\.tsx$/.test(name)) files.push(full)
  }
}
for (const r of ROOTS) walk(r)

const violations = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    // 조건부면 통과 — 삼항이나 논리곱이 같은 줄에 있으면 상태가 가른다는 뜻이다.
    const conditional = /\?|&&/.test(line)
    if (conditional) return
    // \b 를 쓰면 안 된다 — border-l-[3px] 는 ']' 로 끝나 뒤가 공백이면 단어 경계가 안 선다(역주입 실측).
    if (/border-l-(\[\d+px\]|[1-8](?![\w-]))/.test(line)) {
      violations.push(`${f}:${i + 1} — 조건 없이 서는 좌측 립. 주의 상태에만 세운다(§29).`)
    }
    if (/borderLeftWidth\s*:/.test(line)) {
      violations.push(`${f}:${i + 1} — 조건 없이 서는 borderLeftWidth. 주의 상태에만 세운다(§29).`)
    }
  })
}

console.log(`[카드 립] 카드 컴포넌트 ${files.length}개 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  좌측 립은 주의를 뜻한다. 모든 카드에 달면 정보가 아니라 장식이 되고,')
  console.error('  정작 주의가 필요한 카드가 안 도드라진다(§29 시각 지문 점검).')
  process.exit(1)
}
