// 늘 떠 있는 네비 링크는 미리 당겨오지 않는다 — Vercel Fluid Active CPU 회귀 감지망 (2026-09-22).
//
// 무슨 일이 있었나
//   하단 탭 7개가 화면에 상시로 떠 있는데 <Link> 에 prefetch 지정이 없었다. 기본값이면 링크가
//   화면에 들어오는 순간 Next 가 목적지를 서버에 미리 요청한다. 이 앱은 페이지가 전부 동적이고
//   (app) 레이아웃이 loading 경계 **위**에 있어, 미리 당겨오는 호출마다 Supabase 인증 확인과
//   Prisma 질의 넷이 돈다. 화면을 한 번 여는 데 서버 렌더가 여덟 번 돌았다.
//   실행 로그에 2초 안에 일곱 라우트가 cache=MISS 로 찍혀 있었다.
//   그렇게 Vercel 무료 한도의 Fluid Active CPU 4시간을 다 썼다(경고 메일 2026-09-22).
//   한도를 넘기면 프로젝트가 **자동 정지**된다 — 앱이 멎는다.
//
// 무엇을 보는가
//   상시 네비 두 자리(하단 탭·사이드바)의 <Link> 가 전부 prefetch={false} 인가.
//   화면에 늘 안 보이는 링크(모달 안, 목록 행)는 대상이 아니다 — 그것들은 애초에 뷰포트에
//   안 들어오거나 수가 적어 배수가 안 생긴다.
import { readFileSync } from 'node:fs'

const violations = []
const FILES = ['components/layout/BottomNav.tsx', 'components/layout/Sidebar.tsx']

// 주석을 걷되 줄 수는 보존한다. 주석에 든 낱말로 통과하는 길을 막는다.
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/(^|[^:\\])\/\/.*$/gm, (m, pre) => pre)

for (const f of FILES) {
  let src
  try { src = strip(readFileSync(f, 'utf8')) } catch {
    violations.push(`${f} — 읽을 수 없다. 자리가 옮겨졌으면 이 그물부터 고친다(침묵 통과 금지).`)
    continue
  }
  // 여는 <Link 부터 그 태그가 닫히는 > 까지를 한 덩어리로 본다.
  const opens = [...src.matchAll(/<Link\b/g)]
  if (opens.length === 0) {
    violations.push(`${f} — <Link> 가 하나도 없다. 마크업이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지).`)
    continue
  }
  for (const m of opens) {
    const start = m.index
    // 속성 안의 중괄호 깊이를 세며 태그 끝을 찾는다 — className={...} 안의 > 에 안 속게.
    let depth = 0, end = -1
    for (let i = start; i < src.length; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) { end = i; break }
    }
    if (end < 0) { violations.push(`${f} — <Link> 태그의 끝을 못 찾았다(침묵 통과 금지).`); continue }
    const tag = src.slice(start, end)
    if (!/prefetch=\{false\}/.test(tag)) {
      const line = src.slice(0, start).split('\n').length
      const href = (tag.match(/href=\{?([^\s}]+)/) ?? [])[1] ?? '?'
      violations.push(`${f}:${line} — <Link href=${href}> 에 prefetch={false} 가 없다. 상시 네비는 목적지를 미리 그려 CPU 를 배로 먹는다.`)
    }
  }
}

console.log(`[네비 미리 당겨오기] 파일 ${FILES.length}개 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  상시 네비 링크는 화면에 들어오는 순간 목적지를 서버에 미리 요청한다. 이 앱은')
  console.error('  페이지가 전부 동적이라 그 하나하나가 인증 확인과 Prisma 질의를 도는 진짜 렌더다.')
  process.exit(1)
}
