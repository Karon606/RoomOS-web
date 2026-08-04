// 서류 화면의 손가락 확대가 다시 죽는지 검사 — 읽기 전용, 위반 시 exit 1.
//
// 이 결함은 재발이다. 운영자 신고 원문 "예전에 같은 이유로 고쳤는데 재발했다".
// 6/26 에 계약서 핀치줌을 허용했는데도 글씨가 안 커졌다. 원인이 두 겹이었다.
//   1) 종이 배율 계산이 window.innerWidth 를 읽었다. iOS 에서 그 값은 visual viewport 폭이라
//      핀치로 2배 확대하면 절반이 되고 resize 가 뜬다. 그 값으로 배율을 다시 잡으니
//      브라우저가 키운 만큼 종이가 작아져 **확대가 코드에 상쇄됐다.**
//   2) 나머지 서류 셋은 라우트 viewport 선언 자체가 없어 루트의 userScalable:false 를 물려받았다.
//      계약서만 되던 이유는 그 진입점만 순수 a 태그였기 때문이다 — iOS 는 소프트 내비에서
//      viewport meta 교체를 반영하지 않아 선언이 있어도 무동작이 된다.
//
// regression-nets.md 원칙대로 결함을 찾지 않고 **고친 정본이 다시 사라지는지**를 지킨다.
// 실제로 확대되는지는 정적으로 판정할 수 없다. 그건 아이폰 실기가 맡는다(loop.md 1번).
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// 확대가 열려 있어야 하는 서류 라우트. 목록은 여기가 정본이고, 파일이 없으면 위반이다.
const ZOOM_ROUTES = [
  'app/contract/[tenantId]',
  'app/residence-cert/[tenantId]',
  'app/rent-receipt/[tenantId]',
  'app/doc/[fileId]',
]
// 소프트 내비로 들어가면 안 되는 경로(위 라우트의 URL 형태)
const ZOOM_PATHS = ['/contract/', '/residence-cert/', '/rent-receipt/', '/doc/']

// 주석을 지우되 줄 번호는 보존한다. 계약서 layout 주석에 userScalable:false 가 문자 그대로 있어
// 이 전처리가 없으면 축 1 이 바로 오작동한다. '://' 는 URL 이라 줄 주석으로 보지 않는다.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}

// 객체 리터럴을 중괄호 깊이로 잘라낸다. 파일 전체를 검색하면 다른 export 의 값이 섞인다.
function objectLiteralAfter(src, idx) {
  const open = src.indexOf('{', idx)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return null   // 짝이 안 맞는다 — 통과가 아니라 판정 불가다
}

const violations = []

// ── 축 1. 라우트 viewport 선언 ──────────────────────────────────────────────
for (const route of ZOOM_ROUTES) {
  const file = join(route, 'layout.tsx')
  let src
  try { src = strip(readFileSync(file, 'utf8')) } catch {
    violations.push(`${file} 를 읽을 수 없다. 검사할 수 없으므로 통과로 세지 않는다`)
    continue
  }
  const at = src.search(/export\s+const\s+viewport\b/)
  if (at < 0) {
    violations.push(`${file} 에 확대 허용 viewport 선언이 없다. 루트 layout 의 userScalable:false 를 그대로 물려받아 이 서류는 확대되지 않는다`)
    continue
  }
  const obj = objectLiteralAfter(src, at)
  if (!obj) {
    violations.push(`${file} 의 viewport 객체 경계를 읽지 못했다. 대조가 건너뛰어졌다. 감지망을 고쳐야 한다`)
    continue
  }
  if (!/userScalable\s*:\s*true/.test(obj)) {
    violations.push(`${file} 의 viewport 에 userScalable 이 true 가 아니다. 두 손가락 확대가 막힌다`)
  }
  const max = obj.match(/maximumScale\s*:\s*([\d.]+)/)
  if (!max || Number(max[1]) < 3) {
    violations.push(`${file} 의 viewport 에 maximumScale 이 3 미만이다. 8.7pt 조항을 읽을 만큼 못 키운다`)
  }
}

// ── 축 2. 확대를 상쇄하는 폭 읽기 ──────────────────────────────────────────
// 이 화면들이 폭을 볼 때는 layout viewport 여야 한다. 예외가 없으므로 통째로 금지한다.
// '배율 계산 안에서만' 으로 좁히면 호출 문맥 판정이 되어 거리 근사로 미끄러진다(실패유형 4).
const routeFiles = ZOOM_ROUTES.flatMap(r => walk(r))
if (routeFiles.length === 0) {
  violations.push('서류 라우트에서 검사 대상 파일을 하나도 못 찾았다 — 경로가 어긋났다')
}
for (const f of routeFiles) {
  const src = strip(readFileSync(f, 'utf8'))
  for (const [re, what] of [
    [/\bwindow\.innerWidth\b/, 'window.innerWidth'],
    [/\bvisualViewport\s*[?.]/, 'visualViewport'],
  ]) {
    const m = src.match(re)
    if (!m) continue
    const line = src.slice(0, src.indexOf(m[0])).split('\n').length
    violations.push(`${f}:${line} 이 ${what} 를 읽는다. iOS 에서 이 값은 핀치로 줄어들어, 화면 배율을 다시 계산하면 확대가 그대로 상쇄된다. document.documentElement.clientWidth 를 쓴다`)
  }
}

// ── 축 3. 확대 허용 라우트로 가는 소프트 내비 ──────────────────────────────
// **줄 단위로 보면 안 된다.** 이 저장소의 <Link> 는 여는 태그와 href 가 다른 줄에 있어
// 줄 검사가 그대로 통과했다(역주입 실측). 거리 근사도 금지다 — 무관한 짝을 묶는다(실패유형 4).
// 여는 태그 하나, 호출 인자 하나를 **구조로 잘라내** 그 안에서만 경로를 찾는다.
// 여는 태그는 중괄호로 깊이를 세고 '>' 에서 끝난다({} 안의 => 나 비교 연산에 안 걸린다).
// 호출 인자는 괄호로 깊이를 세고 그 짝에서 끝난다.
function sliceUntil(src, from, kind) {
  const [open, close, end] = kind === 'tag' ? ['{', '}', '>'] : ['(', ')', ')']
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === open) depth++
    else if (c === close && depth > 0) depth--
    else if (c === end && depth === 0) return src.slice(from, i + 1)
  }
  return null
}

const navFiles = ['app', 'components'].flatMap(r => walk(r))
  .filter(f => !ZOOM_ROUTES.some(r => f.startsWith(r + '/')))
for (const f of navFiles) {
  const src = strip(readFileSync(f, 'utf8'))
  const re = /<Link\b|(?:nav)?[Rr]outer\.(?:push|replace)\(/g
  let m
  while ((m = re.exec(src))) {
    const isTag = m[0] === '<Link'
    const chunk = sliceUntil(src, m.index + m[0].length, isTag ? 'tag' : 'call')
    if (chunk === null) {
      violations.push(`${f} — ${m[0]} 의 경계를 읽지 못했다. 대조가 건너뛰어졌다. 감지망을 고쳐야 한다`)
      continue
    }
    const hit = ZOOM_PATHS.find(p => chunk.includes(p))
    if (!hit) continue
    const line = src.slice(0, m.index).split('\n').length
    violations.push(`${f}:${line} 이 확대 허용 라우트(${hit})로 소프트 내비한다. iOS 가 viewport meta 교체를 반영하지 않아 확대가 무동작이 된다. 전체 페이지 이동(a 태그 또는 location.assign)으로 들어가야 한다`)
  }
}

if (violations.length) {
  console.error(`\n[서류 확대] 검사 ${ZOOM_ROUTES.length}라우트 / 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  console.error('\n  서류 미리보기는 손가락으로 확대되어야 한다(docs/document-screens-spec.md 규칙 확대·축소).')
  console.error('  선언과 상쇄 패턴만 검사한다. 실제로 확대되는지는 아이폰 실기로 확인한다.')
  process.exit(1)
}
console.log(`[서류 확대] 검사 ${ZOOM_ROUTES.length}라우트 · 파일 ${routeFiles.length}개 / 위반 0건`)
