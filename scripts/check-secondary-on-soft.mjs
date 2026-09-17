// --cream-soft 면 위에 secondary 버튼이 서는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 세웠나(2026-09-17, 독립 디자이너 검수). secondary 의 바탕은 --cream-soft 다
// (components/ui/Btn.tsx VARIANT_CLS). 그래서 면도 --cream-soft 면 **버튼과 면이 같은 토큰**이 되고,
// 둘을 가르는 것은 --warm-border 자국 하나뿐이다. 라이트에서는 그 보더가 #dccfbc 라 1.32:1 로
// 겨우 읽히지만, 다크에서 --warm-border 는 rgba(242,232,220,.08) 알파라 1.23:1 까지 내려간다.
// 면도 버튼도 --d-card-2 #261C14 로 **완전히 같은 색**이고 테두리는 거의 안 보인다 — 버튼이 면에
// 묻혀 사라진다. 돈이 보이는 화면(수납·보증금·정산)에서 7군데가 그 상태였다.
//
// 정본 처방은 variant="subtle" 이다(가이드 v2.0 §10). subtle 의 테두리는 --camel 40% 라 같은 면
// 위 대비가 다크에서 1.23:1 → 2.33:1 로 올라 버튼이 버튼으로 읽힌다. 면을 --cream 으로 올리는
// 길은 앞서 버렸다 — 다크에서 면 테두리가 8% 알파뿐이라 면이 카드와 같은 색이 되고
// "테두리로 면을 가른다"는 규칙이 무너진다.
//
// 대상 — **면을 칠하는 JSX 여는 태그의 서브트리.** 면은 태그에 직접 쓴 bg-[var(--cream-soft)] 이거나,
// 그 문자열을 품은 모듈 상수(panelFormStyles 의 formBoxCls 같은)를 className 으로 받은 자리다.
// hover:/active:/focus: 접두가 붙은 것은 면이 아니라 상태색이라 대상이 아니다.
//
// 실행: node scripts/check-secondary-on-soft.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['components', 'app']
// 접두가 없는 것만 면이다. hover:bg-[var(--cream-soft)](ghost 변형)는 상태색이라 뺀다.
const SOFT = /(?<![\w:[-])bg-\[var\(--cream-soft\)\]/g
// 버튼 쪽 — Btn/BtnLink 의 변형 속성과, Btn 을 못 쓰는 자리가 쓰는 정본 함수 btnClass 둘 다.
const SECONDARY = /variant\s*=\s*(?:"secondary"|'secondary'|\{\s*['"]secondary['"]\s*\})|btnClass\(\s*['"]secondary['"]/g

function walk(p, out = []) {
  for (const n of readdirSync(p)) {
    const f = join(p, n)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (f.endsWith('.tsx') || f.endsWith('.ts')) out.push(f)
  }
  return out
}

// 주석을 걷고 본다 — 이 파일 머리처럼 설명 주석이 코드와 같은 낱말을 쓰므로, 원문 그대로 보면
// 처리를 빼도 설명만으로 통과하거나 반대로 설명만으로 걸린다. '://' 는 URL 이라 예외로 둔다.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

/** 인덱스 pos 를 품은 JSX 여는 태그. 못 찾으면 null. */
function enclosingTag(src, pos) {
  let start = -1
  for (let i = pos; i >= 0; i--) {
    if (src[i] === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) { start = i; break }
  }
  if (start < 0) return null
  // 속성값에 화살표 함수가 살아 '>' 가 태그 안에 있다. 중괄호 깊이와 따옴표를 세며 진짜 닫는 '>' 를 찾는다.
  let depth = 0, quote = ''
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return { start, end: i, text: src.slice(start, i + 1) }
  }
  return null
}

/** 여는 태그 tag 의 **서브트리가 끝나는 인덱스.** 자기 닫힘이면 태그 끝이다. */
function subtreeEnd(src, tag) {
  if (/\/>\s*$/.test(tag.text)) return tag.end
  const name = /^<([A-Za-z][\w.:-]*)/.exec(tag.text)?.[1]
  if (!name) return tag.end
  const marks = []
  for (const m of src.matchAll(new RegExp(`<${name}(?=[\\s/>])`, 'g'))) marks.push({ at: m.index, open: true, end: m.index })
  for (const m of src.matchAll(new RegExp(`</${name}\\s*>`, 'g'))) marks.push({ at: m.index, open: false, end: m.index + m[0].length })
  marks.sort((a, b) => a.at - b.at)
  let depth = 0
  for (const mk of marks) {
    if (mk.at < tag.start) continue
    if (mk.open) {
      const t = enclosingTag(src, mk.at + 1)
      if (t && /\/>\s*$/.test(t.text)) continue        // 자기 닫힘은 깊이를 안 올린다
      depth++
    } else {
      depth--
      if (depth <= 0) return mk.end
    }
  }
  return src.length                                     // 짝을 못 찾으면 파일 끝까지
}

const files = ROOTS.flatMap(r => walk(r))
const sources = new Map(files.map(f => [f, strip(readFileSync(f, 'utf8'))]))

// ── 0) 면을 품은 모듈 상수 ─────────────────────────────────────────
// className={formBoxCls} 처럼 이름으로 오는 면. 이름만 보고 태그를 판정하려면 먼저 어느 이름이
// 면인지 알아야 한다. 이름은 저장소 전체에서 모은다 — 한 상수가 여러 파일에 쓰이는 것이
// 이 결함의 절반(7군데 중 셋이 formBoxCls 하나였다)이기 때문이다.
const softConsts = new Set()
for (const src of sources.values()) {
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(['"`])([\s\S]*?)\2/g)) {
    SOFT.lastIndex = 0
    if (SOFT.test(m[3])) softConsts.add(m[1])
  }
}
if (softConsts.size === 0) {
  console.error('\n[면 위 secondary] --cream-soft 를 품은 모듈 상수를 하나도 못 찾았다. 상수 경로가 통째로 안 보이면 이 그물은 직접 쓴 자리만 본다')
  process.exit(1)
}

// ── 1) 면의 서브트리 안에 secondary 가 있는가 ──────────────────────
const lineAt = (src, i) => src.slice(0, i).split('\n').length
const constRe = new Set([...softConsts].map(n => new RegExp(`(?<![\\w$])${n}(?![\\w$])`)))

const violations = []
let surfaces = 0
for (const [f, src] of sources) {
  if (!f.endsWith('.tsx')) continue
  const seen = new Set()
  const tags = []
  // (ㄱ) 태그에 직접 쓴 면
  for (const m of [...src.matchAll(SOFT)]) {
    const t = enclosingTag(src, m.index)
    // 태그 안에서 끝난 매치만 면이다. 객체 리터럴 안의 문자열(Btn.tsx 의 VARIANT_CLS)은
    // 앞쪽 제네릭(`Record<Variant, string>`)이 태그로 잡히는데, 그 태그는 매치보다 앞에서 닫힌다.
    if (!t || m.index > t.end || !/className|class=/.test(t.text)) continue
    if (!seen.has(t.start)) { seen.add(t.start); tags.push(t) }
  }
  // (ㄴ) 이름으로 받은 면
  for (const m of src.matchAll(/className\s*=\s*\{/g)) {
    const t = enclosingTag(src, m.index)
    if (!t || m.index > t.end) continue
    if (![...constRe].some(re => re.test(t.text))) continue
    if (!seen.has(t.start)) { seen.add(t.start); tags.push(t) }
  }
  for (const t of tags) {
    surfaces++
    const end = subtreeEnd(src, t)
    SECONDARY.lastIndex = 0
    for (const b of [...src.slice(t.end, end).matchAll(SECONDARY)]) {
      const at = t.end + b.index
      violations.push(
        `${f}:${lineAt(src, t.start)} 의 --cream-soft 면 안, ${f}:${lineAt(src, at)} 에 secondary 버튼이 섰다. `
        + '다크에서 면도 버튼도 --d-card-2 #261C14 로 같은 색이고 경계가 8% 알파 자국뿐이다(1.23:1) — subtle 로 갈 것',
      )
    }
  }
}

console.log(`\n[면 위 secondary] --cream-soft 면 ${surfaces}개 검사 / 면 상수 ${softConsts.size}개 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  가이드 v2.0 §10 — --cream-soft 면 위에는 secondary 를 두지 않는다. subtle 이 정본이다.')
  console.error('  본보기: app/(app)/settings/SettingsForm.tsx 의 번역 도구 줄(variant="subtle").')
  process.exit(1)
}
