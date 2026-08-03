// 앱 밖으로 나가면 돌아올 수 없는 이동을 잡는다 (신고 f12c265b·083239c3, 2026-08-04).
//
// public/manifest.json 이 display: standalone 이다. 홈화면 앱에는 주소창도 뒤로가기도 없다.
// 그래서 우리 마크업이 없는 목적지(PDF 응답 등)를 새 탭으로 열면 **편도**가 되고,
// 운영자는 앱을 껐다 켜야 한다. 실제로 서류 '보기'가 그랬다.
//
// 정확히 판정 가능한 축만 건다 — **앱 내부 경로를 새 탭으로 던지는 것**.
// 외부 호스트(https://…)는 정당한 이탈이라 대상이 아니고, 변수·Blob URL 은 정적 판정이 불가하다.
// 못 잡는 축까지 명단으로 억지로 덮으면 표가 코드와 갈린다(regression-nets.md 의 목록 이중화 사고).
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const violations = []
const ROOTS = ['app', 'components']

// 주석을 지우되 줄 번호는 보존한다 — 같은 문자열이 주석에 있어 통과한 전례가 있다(open.kakao.com).
// '://' 는 URL 이라 줄 주석으로 보지 않는다.
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

const files = ROOTS.flatMap(r => walk(r))
if (files.length === 0) {
  // 스캔이 0개면 통과가 아니라 위반이다 — 경로가 어긋난 채 '위반 0건'으로 넘어가면 그물이 없는 것과 같다
  violations.push('[소스] 검사 대상 파일이 0개 — 스캔 경로가 어긋났다')
}

for (const f of files) {
  const src = strip(readFileSync(f, 'utf8'))
  // target 속성 형태만 본다 — a.target === '_blank' 같은 비교문은 구조적으로 안 걸린다
  const re = /target\s*=\s*(?:["']_blank["']|\{\s*['"]_blank['"]\s*\})/g
  let m
  while ((m = re.exec(src))) {
    // 그 속성이 속한 JSX 여는 태그만 잘라낸다
    const open = src.lastIndexOf('<', m.index)
    const close = src.indexOf('>', m.index)
    if (open < 0 || close < 0) {
      violations.push(`[소스] ${f} — target="_blank" 의 태그 경계를 읽지 못했다. 대조가 건너뛰어졌다. 감지망을 고쳐야 한다`)
      continue
    }
    const tag = src.slice(open, close)
    // href 가 있고 태그 안에 '/' 로 시작하는 리터럴이 있으면 앱 내부 경로다.
    // href 바로 뒤만 보면 삼항식(`href={cond ? \`/a\` : \`/b\`}`)을 놓친다(역주입 실측).
    // 외부 URL 은 따옴표 다음이 'h'(https) 라 안 걸린다.
    if (/href/.test(tag) && /[`"']\/[a-zA-Z]/.test(tag)) {
      const line = src.slice(0, m.index).split('\n').length
      violations.push(`[소스] ${f}:${line} 이 앱 내부 경로를 새 탭으로 연다 — 홈화면 앱에는 주소창이 없어 돌아올 수 없다`)
    }
  }
}

// 서류 '보기' 정본이 앱 안 뷰어를 가리키는지 — 여기가 신고 원본이다
try {
  const vdb = strip(readFileSync('components/ui/ViewDocButton.tsx', 'utf8'))
  if (!/href=\{`\/doc\//.test(vdb)) {
    violations.push('[소스] ViewDocButton 이 앱 안 뷰어(/doc)를 가리키지 않는다 — 서류를 연 뒤 돌아올 길이 사라진다')
  }
  if (/target\s*=/.test(vdb)) {
    violations.push('[소스] ViewDocButton 에 target 이 되살아났다 — 앱 안 뷰어를 새 탭으로 열면 복귀 링크가 있어도 창이 갈린다')
  }
  const viewer = strip(readFileSync('app/doc/[fileId]/DocViewer.tsx', 'utf8'))
  if (!/<Link\s+href=\{back\.href\}/.test(viewer)) {
    violations.push('[소스] 서류 뷰어의 복귀 링크가 사라졌다 — 목적지는 앱 안인데 돌아갈 수단이 없다')
  }
} catch {
  violations.push('[소스] 서류 보기 정본(ViewDocButton·DocViewer) 을 읽을 수 없다 — 사라졌다')
}

if (violations.length) {
  console.error(`\n[앱 밖 이탈] 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log(`[앱 밖 이탈] 검사 ${files.length}개 / 위반 0건`)
