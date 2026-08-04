// 'use server' 파일이 async 함수 아닌 것을 내보내는지 검사 — 읽기 전용, 위반 시 exit 1.
//
// 2026-08-05 에 앱 전체가 멈췄다. cleaningActions.ts 가 'use server' 인데 상수를 함께 export 했고,
// Next 가 그 모듈에 런타임 가드를 심는다 —
//   A "use server" file can only export async functions, found object. (E352)
// 그 모듈을 **처음 require 하는 순간** 던지는데, Next 는 한 라우트의 서버 액션을 진입 모듈 하나에
// 모으므로 그 라우트의 액션이 **하나도 안 남는다.** EntityModalProvider 가 (app) 레이아웃에 있어서
// (app) 아래 모든 화면의 조회·저장·수정·삭제가 전부 500 이 됐다.
//
// **빌드로는 못 잡는다.** 컴파일 에러가 아니라 런타임 가드다. tsc 도 타입 문제가 아니라 못 잡는다.
// 그리고 잠복한다 — 그 상수를 아무도 import 안 하면 액션 진입 모듈에 안 들어가 조용하다.
// 실제로 한 커밋 전에 들어와 다음 커밋에서 터졌다. 그래서 import 여부와 무관하게 **모양만** 본다.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['app', 'components', 'lib']

// 주석을 지우되 줄 번호는 보존한다. '://' 는 URL 이라 줄 주석으로 보지 않는다.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

// 파일 위에 한국어 헤더 주석이 붙는 순간 1행 검사는 무력해진다.
// 주석·빈 줄을 걷어낸 **첫 유효 줄**로 판정한다.
function isServerActionFile(src) {
  for (const line of strip(src).split('\n')) {
    const t = line.trim()
    if (!t) continue
    return /^['"]use server['"];?$/.test(t)
  }
  return false
}

// 재수출 중 같은 파일 안에서 async 함수로 해소되는 것만 통과시킨다.
// import 를 재수출하는 것은 모양을 확인할 수 없으므로 여기 명단에 사유와 함께 올려야 통과한다.
const REEXPORT_ALLOW = new Set([
  // lib/role.ts 의 async getMyRole 을 그대로 다시 내보낸다. 인자 없는 역할 조회다.
  'app/(app)/settings/actions.ts|getMyRole',
])

const violations = []
const files = ROOTS.flatMap(r => walk(r))
if (files.length === 0) violations.push('검사 대상 파일이 0개 — 스캔 경로가 어긋났다')

let checked = 0
for (const f of files) {
  const raw = readFileSync(f, 'utf8')
  if (!isServerActionFile(raw)) continue
  checked++
  const src = strip(raw)
  const at = i => src.slice(0, i).split('\n').length

  // 허용 — export async function
  // 허용 — export const 이름 = async (…) / async function / 래퍼(async …)  (cache(async function …) 형태)
  // 허용 — export type / interface
  const reDecl = /^export\s+(async\s+function|function|const|let|var|enum|default|type|interface|class)\b/gm
  let m
  while ((m = reDecl.exec(src))) {
    const kind = m[1]
    const line = at(m.index)
    if (kind === 'async function' || kind === 'type' || kind === 'interface') continue
    if (kind === 'function') {
      violations.push(`${f}:${line} 이 async 가 아닌 function 을 내보낸다 — 그 라우트의 서버 액션이 전부 죽는다`)
      continue
    }
    if (kind === 'const') {
      // 초기화식이 async 함수이거나 래퍼가 감싼 async 함수면 통과한다
      const rest = src.slice(m.index, src.indexOf('\n', m.index + 200) + 1 || m.index + 200)
      if (/=\s*(async\s*\(|async\s+function|[A-Za-z_$][\w$]*\s*\(\s*async\s*(\(|function))/.test(rest)) continue
      violations.push(`${f}:${line} 이 값(const)을 내보낸다 — 'use server' 파일은 async 함수만 내보낼 수 있다. 값은 별도 모듈로 가른다`)
      continue
    }
    violations.push(`${f}:${line} 이 ${kind} 를 내보낸다 — 'use server' 파일은 async 함수만 내보낼 수 있다`)
  }

  // export * from — 모양을 확인할 수 없다
  for (const mm of src.matchAll(/^export\s+\*\s+from\b/gm)) {
    violations.push(`${f}:${at(mm.index)} 이 export * 를 쓴다 — 무엇이 나가는지 확인할 수 없다. 이름을 적어 내보낸다`)
  }

  // export { a, b } — type 키워드가 없으면 값 재수출이다
  for (const mm of src.matchAll(/^export\s+\{([^}]*)\}(\s*from\s*['"][^'"]+['"])?/gm)) {
    const body = mm[1]
    const names = body.split(',').map(x => x.trim()).filter(Boolean)
    for (const n of names) {
      if (/^type\s/.test(n)) continue
      const bare = n.split(/\s+as\s+/)[0].trim()
      // 같은 파일 안에서 async 함수로 해소되면 통과
      if (new RegExp(`\\basync\\s+function\\s+${bare}\\b`).test(src)) continue
      if (REEXPORT_ALLOW.has(`${f}|${bare}`)) continue
      violations.push(`${f}:${at(mm.index)} 이 ${bare} 를 재수출한다 — async 함수인지 확인할 수 없다. 이 파일에서 async 로 감싸거나 명시 허용에 사유와 함께 올린다`)
    }
  }
}

if (violations.length) {
  console.error(`\n[서버 액션 내보내기] 검사 ${checked}개 / 위반 ${violations.length}건`)
  for (const v of violations) console.error('  - ' + v)
  console.error("\n  'use server' 파일은 async 함수만 내보낼 수 있다. 빌드는 통과하고 그 모듈을 처음 부를 때 터진다.")
  console.error('  터지면 그 라우트의 서버 액션이 전부 죽는다 — 조회뿐 아니라 저장·수정·삭제까지.')
  process.exit(1)
}
console.log(`[서버 액션 내보내기] 검사 ${checked}개 / 위반 0건`)
