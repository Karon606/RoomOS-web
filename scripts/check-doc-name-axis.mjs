// 이름 표기 두 축이 서로를 읽는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 이름이 비슷한 칸이 둘이다.
//   · Tenant.displayNameStyle — **카드**에 보여줄 이름(lib/displayName). 'nickname' | 'en'.
//   · Tenant.docNameStyle     — **발급 서류**에 찍을 이름의 사람 단위 기본값(lib/documentName).
// 둘은 다른 사실을 말한다. 카드에 별칭을 띄우는 것과 관청에 낼 종이의 성명은 같은 결정이 아니다.
// 한 축이 다른 축을 읽기 시작하면 카드 설정을 바꿨을 뿐인데 계약서 이름이 바뀐다. 2026-08-11 에
// 영문 계약서가 필요해 운영자가 Tenant.name 자체를 갈아엎어 앱 전체에서 한글 이름이 사라진 적이
// 있고, 이 그물은 그 사건이 칸 이름 혼동으로 재연되는 것을 막는다(2026-09-03 신설).
//
//   ⓐ 서류 경로에 displayNameStyle·displayName( 이 없다.
//   ⓑ 카드 경로에 docNameStyle 이 없다.
//   ⓒ resolveDocNameStyle 호출부는 전원 tenant 축을 넘긴다. 한 화면만 빠지면 그 서류에서만
//      사람 단위 설정이 무시되고, 같은 사람의 서류가 서로 다른 이름으로 나간다.
//
// 실행: node scripts/check-doc-name-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const read = f => readFileSync(f, 'utf8')
// 줄 수를 보존한다. `\s*` 는 m 플래그에서 줄바꿈을 먹어 줄번호가 밀린다.
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

// 서류 경로 — 발급 서류의 성명을 조립하거나 그리는 자리.
const DOC_ROOTS = ['app/contract', 'app/residence-cert', 'app/rent-receipt', 'app/api/contract']
const DOC_FILES = ['lib/documentName.ts', 'lib/contractData.ts', 'lib/contractPrintHtml.ts']
// 카드 경로 — 화면에 사람 이름을 띄우는 자리.
const CARD_FILES = ['lib/displayName.ts']

const walk = (dir, out) => {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const docFiles = DOC_FILES.filter(f => { try { statSync(f); return true } catch { return false } })
for (const r of DOC_ROOTS) walk(r, docFiles)
if (docFiles.length < 5) violations.push(`서류 경로 파일이 ${docFiles.length}개뿐이다. 경로가 바뀌었으면 이 그물도 같이 고쳐야 한다.`)

// ⓐ 서류가 카드 축을 읽는가.
for (const f of docFiles) {
  stripComments(read(f)).split('\n').forEach((line, i) => {
    if (/\bdisplayNameStyle\b|\bdisplayName\(/.test(line)) {
      violations.push(`${f}:${i + 1} 서류 경로가 카드 축(displayNameStyle)을 읽는다. 서류 성명은 lib/documentName 이 정한다.`)
    }
  })
}

// ⓑ 카드가 서류 축을 읽는가.
for (const f of CARD_FILES) {
  stripComments(read(f)).split('\n').forEach((line, i) => {
    if (/\bdocNameStyle\b/.test(line)) {
      violations.push(`${f}:${i + 1} 카드 축이 서류 축(docNameStyle)을 읽는다. 카드 이름은 lib/displayName 이 정한다.`)
    }
  })
}

// ⓓ 계약서는 **실제로 저장된 오버라이드**를 saved 로 넘긴다.
//    표시값 병합본(contractLeaseFields)의 nameStyle 자동값은 'ko' 라, 그것을 넘기면 1순위에서
//    늘 'ko' 로 끝나 이어받기·사람 단위·국적 추정이 한 번도 도달하지 못한다(긴급 신고 2026-09-03).
{
  const f = 'lib/contractData.ts'
  const src = stripComments(read(f))
  if (/saved: fields\?\.nameStyle/.test(src)) {
    violations.push(`${f} — 계약서가 병합값을 saved 로 넘긴다. 자동값 'ko' 때문에 표기 해석이 1순위에서 끝난다.`)
  }
  if (!/saved: asDocNameStyle\(fieldOverrides\.nameStyle\)/.test(src)) {
    violations.push(`${f} — 계약서의 saved 가 실제 저장된 오버라이드가 아니다.`)
  }
  // 해석한 값이 화면·PDF 가 읽는 자리(lease.nameStyle)까지 가는가.
  const leasePayload = src.match(/lease: lease && fields \? \{[\s\S]*?\n    \} : null/)
  if (!leasePayload) violations.push(`${f} — lease 페이로드를 못 찾았다. 구조가 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  else if (!/\n      nameStyle,/.test(leasePayload[0])) {
    violations.push(`${f} — 해석된 표기가 lease.nameStyle 에 안 실린다. 화면과 PDF 가 자동값 'ko' 를 읽는다.`)
  }
  // 고른 표기가 가지치기에 지워지지 않는가.
  const ov = stripComments(read('lib/contractFieldOverrides.ts'))
  if (!/if \(key === 'nameStyle'\) continue/.test(ov)) {
    violations.push(`lib/contractFieldOverrides.ts — nameStyle 이 자동값 가지치기에 걸린다. 외국인에게 '한글'을 고르면 선택이 지워진다.`)
  }
}

// ⓒ resolveDocNameStyle 호출부가 전원 tenant 축을 넘기는가.
const callers = walk('app', walk('lib', []))
let calls = 0
for (const f of callers) {
  const src = stripComments(read(f))
  for (const m of src.matchAll(/resolveDocNameStyle\(\{[\s\S]*?\n\s*\}\)/g)) {
    calls++
    if (!/\btenant:/.test(m[0])) {
      const line = src.slice(0, m.index).split('\n').length
      violations.push(`${f}:${line} resolveDocNameStyle 호출에 tenant 축이 없다. 이 서류만 사람 단위 설정을 무시한다.`)
    }
  }
}
if (calls === 0) violations.push('resolveDocNameStyle 호출을 하나도 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.')

console.log(`[이름 표기 두 축] 서류 ${docFiles.length}파일 · 호출 ${calls}곳 검사 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
if (violations.length > 15) console.error(`  ... 외 ${violations.length - 15}건`)
process.exit(violations.length > 0 ? 1 : 0)
