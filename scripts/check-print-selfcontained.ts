// 발급 서류가 자기 힘만으로 그려지는지 검사 — 읽기 전용, 위반 시 exit 1 (2026-08-10, 신고 0aed3bdd).
//
// 계약서 PDF 는 헤드리스 크로미움이 그린다. 그 크로미움에는 쿠키도 없고, 네트워크는 있어도
// 믿을 수 없다. 그래서 두 가지가 참이어야 발급이 안정적이다.
//   축 1 — 렌더할 HTML 에 외부 참조가 0 건이다. 하나라도 있으면 헤드리스가 그것을 받으러 나가고,
//          받지 못하면 이미지가 빈칸으로 나오거나(신고 e7c09f2d) 대기가 늘어진다.
//          이 사실이 참이라야 route 의 setContent 대기 조건 'load' 가 정당하다 — networkidle0 을
//          되돌리는 대신 여기서 전제를 지킨다.
//   축 2 — 폰트 파일이 서버리스 함수 번들에 들어 있다. 안 들어 있으면 콜드 스타트마다 jsdelivr 로
//          외부 fetch 를 탄다. 계약서 라우트가 정확히 그 상태였고(next.config 의 fonts 포함이
//          rent-receipt 에만 붙어 있었다) 간헐 실패의 절반이 거기서 나왔다.
//
// regression-nets.md 원칙대로 결함을 찾지 않고 **고친 정본이 다시 사라지는지**를 지킨다.
// 실제로 PDF 가 나오는지는 정적으로 판정할 수 없다. 그건 실기가 맡는다(loop.md 1번).
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { buildContractPrintHtml, type PrintContractData } from '../lib/contractPrintHtml'
import { DEFAULT_CONTRACT_TEMPLATE, resolveDisposalConsent } from '../lib/contract'

const violations: string[] = []

// ── 축 1. 발급 HTML 외부 참조 0 ────────────────────────────────────────────
// 더미 데이터로 실제 빌더를 부른다. 템플릿 문자열을 눈으로 훑는 검사는 조건 분기 하나만 놓쳐도
// 통과하므로, 이미지 슬롯(로고·도장·서명·동의서 서명)을 전부 채운 결과물을 본다.
const DUMMY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const dummy: PrintContractData = {
  template: DEFAULT_CONTRACT_TEMPLATE,
  businessInfo: { name: '검사영업장', registrationNo: '000-00-00000', ceoName: '검사대표', address: '검사 주소 1층' },
  phone: '010-0000-0000',
  contractNo: '20260810-001',
  logoImageUrl: DUMMY_PNG,
  stampImageUrl: DUMMY_PNG,
  refundClauseInContract: true,
  disposalConsent: resolveDisposalConsent({ enabled: true }),
  disposalSignatureImageDataUrl: DUMMY_PNG,
  tenant: { name: '검사입실자', birthdate: '1990-01-01', gender: '남', job: '회사원', primaryPhone: '010-0000-0000' },
  lease: {
    moveInDate: '2026-08-01', expectedMoveOut: '2026-09-01',
    rentAmount: 450000, depositAmount: 200000, cleaningFee: 20000,
    dueDay: '1', roomNo: '520', registrationStatus: '미신고',
  },
  smoking: '비흡연',
  emergencyContactText: '검사보호자 / 010-0000-0000 / 부',
  signDate: '2026년 8월 10일',
  disposalSignDate: '2026년 8월 10일',
  signatureImageDataUrl: DUMMY_PNG,
  pretendardBase64: 'ZHVtbXk=',   // 실제 폰트 바이트는 필요 없다. data URL 로 들어가는지만 본다
}

const html = buildContractPrintHtml(dummy)
// src=/href= 의 값과 CSS url() 의 값. 둘 다 data: 로 시작해야 한다.
for (const [re, what] of [
  [/(?:src|href)="(?!data:)([^"]*)"/g, 'src/href'],
  [/url\((?!data:)([^)]*)\)/g, 'CSS url()'],
] as const) {
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const line = html.slice(0, m.index).split('\n').length
    violations.push(`발급 HTML ${line}행의 ${what} 가 외부 참조다: ${m[1].slice(0, 80)} — 헤드리스 크로미움은 쿠키가 없어 이것을 못 받는다. lib/google-drive 의 driveImageDataUrl 로 바이트를 임베드한다`)
  }
}
// 폰트가 통째로 빠지는 회귀도 잡는다. 위 두 축은 '없으면' 조용히 통과한다.
if (!html.includes('url(data:font/')) {
  violations.push('발급 HTML 에 임베드 폰트가 없다 — @sparticuz chromium 에는 한글 폰트가 없어 계약서가 통째로 두부가 된다')
}

// ── 축 2. 폰트 번들 명단 대조 ──────────────────────────────────────────────
// public/fonts 의 실제 파일명을 읽는 모듈을 '폰트 소비자' 로 본다. 파일명은 코드에 문자열로 박혀
// 있으므로 정확히 판정된다. 그 모듈을 (전이적으로) 부르는 API 라우트는 반드시 번들에 폰트를 넣어야 한다.
const FONT_FILE_RE = /Pretendard(?:Variable\.woff2|-Regular\.ttf|-Bold\.ttf)/

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

// import 문의 모듈 경로를 파일로 푼다. 외부 패키지는 null(따라가지 않는다).
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('./') || spec.startsWith('../')) base = join(fromFile, '..', spec)
  else return null
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand)) return cand
  }
  return null
}

// 라우트에서 시작해 로컬 import 를 전이적으로 따라가며 폰트 파일명을 찾는다.
function usesFont(entry: string): boolean {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const f = queue.shift()!
    if (seen.has(f)) continue
    seen.add(f)
    let src: string
    try { src = readFileSync(f, 'utf8') } catch { continue }
    if (FONT_FILE_RE.test(src)) return true
    const re = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const next = resolveLocal(m[1], f)
      if (next) queue.push(next)
    }
  }
  return false
}

const routes = walk('app/api').filter(f => /(^|\/)route\.tsx?$/.test(f))
if (routes.length === 0) violations.push('app/api 에서 route 파일을 하나도 못 찾았다 — 경로가 어긋났다. 축 2 는 판정 불가다')

// next.config.ts 의 outputFileTracingIncludes 를 라우트별 문자열 목록으로 읽는다.
const nextConfig = readFileSync('next.config.ts', 'utf8')
const includesBlock = nextConfig.match(/outputFileTracingIncludes\s*:\s*\{([\s\S]*?)\n {2}\}/)
if (!includesBlock) {
  violations.push('next.config.ts 에서 outputFileTracingIncludes 블록을 읽지 못했다. 대조가 건너뛰어졌다 — 감지망을 고쳐야 한다')
}
const fontBundled = new Set<string>()
if (includesBlock) {
  const entryRe = /'([^']+)'\s*:\s*\[([\s\S]*?)\]/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(includesBlock[1]))) {
    if (/public\/fonts/.test(m[2])) fontBundled.add(m[1])
  }
}

const needFont = new Set<string>()
for (const route of routes) {
  if (!usesFont(route)) continue
  // app/api/contract/generate/route.ts → /api/contract/generate
  needFont.add('/' + route.replace(/^app\//, '').replace(/\/route\.tsx?$/, ''))
}
for (const r of needFont) {
  if (!fontBundled.has(r)) {
    violations.push(`${r} 는 public/fonts 의 폰트를 읽는데 next.config.ts 의 outputFileTracingIncludes 에 './public/fonts/**' 가 없다 — 배포본 번들에 폰트가 없어 콜드 스타트마다 외부 CDN 을 탄다`)
  }
}
for (const r of fontBundled) {
  if (!needFont.has(r)) {
    violations.push(`${r} 는 outputFileTracingIncludes 에 public/fonts 를 넣어 두었는데 폰트 파일을 읽는 코드가 없다 — 명단이 낡았거나 폰트 읽기가 사라졌다. 둘 중 무엇인지 확인하고 명단을 맞춘다`)
  }
}

if (violations.length) {
  console.error(`\n[발급 서류 자립] 라우트 ${routes.length}개 / 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  console.error('\n  헤드리스 크로미움은 외부에서 아무것도 못 받는다고 가정한다(신고 e7c09f2d · 0aed3bdd).')
  process.exit(1)
}
console.log(`[발급 서류 자립] 발급 HTML 외부 참조 0건 · 폰트 소비 라우트 ${needFont.size}개 전부 번들 포함 / 위반 0건`)
