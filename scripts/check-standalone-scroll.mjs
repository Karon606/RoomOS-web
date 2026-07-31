// AppShell 밖 단독 라우트가 스크롤 권한을 선언했는지 검사 — 읽기 전용, 위반 시 exit 1.
// globals.css 가 html·body 를 overflow:hidden 으로 잠그므로(iOS 헤더 보호), 셸 밖 페이지의 기본값은
// '스크롤 불가'다. 콘텐츠가 짧을 땐 무증상이라 리뷰를 통과하고, 몇 달 뒤 기능이 늘면 하단 버튼에
// 닿을 수 없게 된다(신고 000a22ed — 같은 페이지가 344001b 로 한 번 증상 패치된 뒤 재발).
// 두 정본 중 하나를 반드시 선언해야 한다.
//   A: 자체 스크롤러 — h-dvh/h-screen 컨테이너 + overflow-y-auto (셸형: AppShell·admin)
//   B: 문서 스크롤   — <DocumentScroll /> 마운트 (폼·문서형). styled-jsx 로 html/body 를 직접
//      오버라이드한 기존 2곳(contract·residence-cert)도 B 로 인정한다.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'

const APP = 'app'
// (app)·admin 은 자체 셸(A)이 보증, api 는 UI 없음
const EXCLUDED = [/^app\/\(app\)\//, /^app\/admin\//, /^app\/api\//]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}

const A_SHELL = /h-dvh|h-screen/
const A_SCROLLER = /overflow-y-auto/
const B_MARKER = /<DocumentScroll\b|html\s*,\s*body[^}]*overflow-y:\s*auto/
// 뷰포트 높이를 하한으로 잡는 루트 컨테이너 — 넘치면 잘리는 후보
const FULL_HEIGHT = /min-h-(screen|dvh)|minHeight:\s*['"]100(vh|dvh)['"]/

const violations = []
const pages = walk(APP).filter(p => /\/page\.tsx$/.test(p) && !EXCLUDED.some(re => re.test(p)))

for (const page of pages) {
  // 라우트 디렉토리의 모든 tsx + 상위 layout 들을 한 덩어리로 본다
  // (페이지가 뷰를 별도 컴포넌트로 분리하고 거기서 선언하는 경우가 정상 패턴)
  const dir = dirname(page)
  const sources = walk(dir)
  let cur = dir
  while (cur !== APP && cur !== '.') {
    cur = dirname(cur)
    const lay = join(cur, 'layout.tsx')
    try { statSync(lay); sources.push(lay) } catch { /* 없으면 건너뜀 */ }
  }
  const texts = sources.map(f => readFileSync(f, 'utf8'))
  const blob = texts.join('\n')

  const hasA = texts.some(t => A_SHELL.test(t) && A_SCROLLER.test(t))
  const hasB = B_MARKER.test(blob)
  if (hasA || hasB) continue
  if (!FULL_HEIGHT.test(blob)) continue   // 뷰포트를 채우지 않는 페이지는 대상 아님

  violations.push(`${relative('.', page)} — 스크롤 선언 없음(A: 자체 스크롤러 / B: <DocumentScroll /> 중 하나 필요)`)
}

console.log(`\n[단독 라우트 스크롤] 검사 ${pages.length}개 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) {
  console.log('\n  셸(app/(app), app/admin) 밖 페이지는 스크롤이 기본으로 꺼져 있다.')
  console.log('  폼·문서형이면 <DocumentScroll /> 을 마운트하면 된다(components/layout/DocumentScroll.tsx).')
  process.exit(1)
}
