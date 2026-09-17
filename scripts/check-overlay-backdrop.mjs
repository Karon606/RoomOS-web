// 모달 막(백드롭)의 존재·불투명도·z 순서를 보는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 세웠나(2026-09-16, 신고 bf0a6fff — 같은 병의 네 번째 재현). 이 저장소에는 오버레이를 보는
// 그물이 둘 있었는데 **막 자체를 보는 그물은 하나도 없었다.** check-kbd-canonical 은 키보드 정본
// 호출만, check-overlay-resume-resync 는 퇴장 타이머와 등장 마감 호출만 봤다. 그래서 막이
// 25~30% 로만 칠해진 채 화면을 덮고 조작을 먹는 사고가 네 번 나는 동안, 두 그물은 네 번 다
// 초록이었다. 막은 "있는가"만이 아니라 "제 불투명도에 닿는가"와 "패널 아래 있는가"까지 맞아야
// 제 노릇을 한다. 그 셋을 여기서 본다.
//
// 대상 — **다이얼로그 꼴** 전체 화면 오버레이. 판정은 파일이 아니라 **태그 하나하나**에 건다.
// fixed inset-0 을 단 태그가 (ㄱ) 등장 모션 클래스를 달았거나 (ㄴ) aria-modal 을 달았거나
// (ㄷ) 키보드 정본(useVisibleBand)에 넘긴 overlayRef 를 달았으면 다이얼로그다. 셋 다 **의도의
// 선언**이라 판정이 순환하지 않는다("막이 있으면 다이얼로그, 다이얼로그는 막이 있어야 한다"로
// 접히면 축 하나가 통째로 무력해진다). 드롭다운 바깥클릭 층·날짜피커·스플래시·사진 뷰어는
// 대상이 아니다 — 그쪽은 막이 없는 것이 정상이고, 같은 파일 안에 섞여 있어도 걸리지 않는다.
//
// 실행: node scripts/check-overlay-backdrop.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['components', 'app']
const CSS = 'app/globals.css'

// 알려진 공백 — 사유와 함께 올린다(check-kbd-canonical 의 ALLOW 와 같은 문법).
// 조용한 공백보다 낫다. 파일이 더 이상 걸리지 않으면 "목록에서 내려라"고 빨개진다.
const KNOWN_GAPS = new Map([
  ['components/ui/inventory/MergeSheet.tsx|불투명도',
    '등장이 정본 모션이 아니라 setTimeout(10ms) + transition-opacity 토글이고 마감 정본이 아예 없다. '
    + '딤은 absolute inset-0 로 전면을 덮고 onClick 에 닫기가 걸려 있어, 전이가 중간에 멎으면 옅은 막이 '
    + '화면을 덮고 조작을 먹는다 — 신고 bf0a6fff 와 같은 증상이다. 여덟 중 유일하게 animationend 도 '
    + 'visibilitychange 도 안 듣는 자리라 회복 경로가 없다. 곡선·길이가 바뀌므로 웹디자이너 패스 대상(운영자 결정 대기)'],
])

function walk(p, out = []) {
  for (const n of readdirSync(p)) {
    const f = join(p, n)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (f.endsWith('.tsx')) out.push(f)
  }
  return out
}
// 주석을 걷고 본다 — 설명 주석이 코드와 같은 낱말을 쓰므로 원문 그대로 보면 처리를 빼도 통과한다.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

/** 인덱스 pos 를 품은 JSX 여는 태그의 원문. 못 찾으면 null(= 위반으로 센다). */
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

/** 이 태그가 막을 칠하는가 — 클래스든 인라인이든, 색이 실제로 실려 있는가. */
const PAINTS_DIM = /bg-black\/|bg-white\/|bg-\[rgba\(|bg-\[#|bg-\[var\(--(canvas|cream|ink)\)\]|background:\s*['"]?(rgba?\(|var\(|#)/

// 농도의 **값**을 대조하는 자리 — 존재만 보면 bg-black/5 도 통과한다(독립 검수 2026-09-17).
// 전 화면에 값을 못 박을 수는 없다(시트·라이트박스는 제 농도가 따로 있다). 가이드가 숫자까지
// 정해 둔 정본 한 자리에만 건다 — v2.0 §13 "backdrop rgba 검정 70%(모드 불변)".
const CANON_DIM = new Map([
  ['components/ui/Modal.tsx', { re: /\bbg-black\/70\b/, what: 'bg-black/70(가이드 v2.0 §13 검정 70%, 모드 불변)' }],
])

/**
 * 이 태그가 쓰는 층 토큰들. 클래스가 변수로 들어오는 자리(Modal 의 `${zClass}`)는 그 변수의
 * 선언까지 따라가 읽는다 — 태그만 보면 정본을 지키는 코드가 위반으로 잡힌다.
 */
function zTokens(tag, src) {
  const direct = [...tag.matchAll(/var\(--z-([\w-]+)\)/g)].map(m => m[1])
  if (direct.length > 0) return direct
  const out = []
  for (const m of tag.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
    const at = src.search(new RegExp(`\\b(?:const|let|var)\\s+${m[1]}\\s*=`))
    if (at < 0) continue
    // 선언 한 문장 — 괄호가 균형을 이룰 때까지 줄을 늘려 잡는다(긴 삼항이 여러 줄에 걸친다).
    let end = at, depth = 0
    for (let i = at; i < src.length; i++) {
      const c = src[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === '\n' && depth <= 0) { end = i; break }
      end = i
    }
    out.push(...[...src.slice(at, end).matchAll(/var\(--z-([\w-]+)\)/g)].map(t => t[1]))
  }
  return out
}

/**
 * 여는 태그 `tag` 의 **서브트리가 끝나는 인덱스.** 자기 닫힘이면 태그 끝이다.
 *
 * 왜 세나(독립 검수 2026-09-17). 자식 딤을 "뒤에 오는 것 아무거나"로 고르면 한 파일의 앞
 * 오버레이가 뒤쪽 다른 컴포넌트의 딤을 빌려 통과한다. 같은 이름의 여는·닫는 태그를 세되
 * 자기 닫힘(`/>`)은 깊이를 안 올린다.
 */
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
  return src.length                                     // 짝을 못 찾으면 파일 끝까지(종전과 같은 넓이)
}

const violations = []
const gapsSeen = new Set()
const gap = (key, msg) => {
  if (KNOWN_GAPS.has(key)) { gapsSeen.add(key); return }
  violations.push(msg)
}

// ── 0) 층 토큰이 실재하는가 ────────────────────────────────────────
// z-[var(--z-오타)] 는 조용히 z-index 를 잃는다(auto 로 떨어져 막이 뒤로 간다). 화면에는
// 아무 오류도 안 뜨므로 눈으로는 절대 못 잡는 회귀다.
let known = new Set()
try {
  const css = readFileSync(CSS, 'utf8')
  known = new Set([...css.matchAll(/--z-([\w-]+)\s*:/g)].map(m => m[1]))
  if (known.size === 0) violations.push(`${CSS} — 층 토큰(--z-*) 선언이 하나도 없다. 오버레이가 전부 층을 잃는다`)
} catch {
  violations.push(`${CSS} 를 읽을 수 없음 — 층 토큰 정본이 사라졌다`)
}

// ── 1~3) 다이얼로그 꼴 오버레이 전수 ───────────────────────────────
const files = [...walk(ROOTS[0]), ...walk(ROOTS[1])]
let overlays = 0
for (const f of files) {
  const raw = readFileSync(f, 'utf8')
  if (!raw.includes('fixed inset-0')) continue
  const src = strip(raw)

  // 이 파일이 키보드 정본에 넘긴 overlayRef 이름들 — 다이얼로그 판정의 셋째 신호.
  const overlayRefs = new Set(
    [...src.matchAll(/useVisibleBand\(\s*\{([^}]*)\}/g)].flatMap(m => {
      const named = /\boverlayRef\s*:\s*([A-Za-z_$][\w$]*)/.exec(m[1])
      if (named) return [named[1]]
      return /(^|[{,\s])overlayRef\s*(,|$)/.test(m[1]) ? ['overlayRef'] : []
    }),
  )

  // 이 파일의 자식 딤 — absolute inset-0 로 전면을 덮으며 색을 칠하는 형제 층(MergeSheet·전역 검색).
  const childDims = []
  for (const m of src.matchAll(/absolute inset-0/g)) {
    const t = enclosingTag(src, m.index)
    if (t && PAINTS_DIM.test(t.text)) childDims.push(t)
  }

  for (const m of src.matchAll(/fixed inset-0/g)) {
    const root = enclosingTag(src, m.index)
    if (!root) {
      violations.push(`${f} — fixed inset-0 을 단 태그를 잘라낼 수 없다. 못 읽으면 통과가 아니라 위반이다`)
      continue
    }
    // 다이얼로그 꼴인가 — 의도를 선언한 신호 셋 중 하나.
    const isDialog = /anim-(overlay|panel)-in/.test(root.text)
      || /aria-modal/.test(root.text)
      || [...overlayRefs].some(r => new RegExp(`ref=\\{\\s*${r}\\s*\\}`).test(root.text))
    if (!isDialog) continue
    overlays++
    const at = `${f}:${src.slice(0, root.start).split('\n').length}`

    // (1) 존재 — 제 몸에 칠하거나, **제 서브트리 안의** 자식 딤이 대신 칠한다.
    //
    // 종전에는 `d.start > root.start` 하나로 골랐다(독립 검수 2026-09-17). 그러면 한 파일에
    // 오버레이가 둘일 때 앞 오버레이가 **뒤쪽 다른 컴포넌트의 딤**을 빌려 통과한다 — 막이 없는
    // 오버레이가 초록으로 남는 자리다. 여는 태그의 닫는 짝까지 세어 서브트리로 가둔다.
    const selfDim = PAINTS_DIM.test(root.text)
    const rootEnd = subtreeEnd(src, root)
    const dim = selfDim ? root : childDims.find(d => d.start > root.start && d.end <= rootEnd)
    if (!dim) {
      gap(`${f}|존재`, `${at} — 다이얼로그 오버레이인데 막을 칠하는 자리가 없다. 뒤 목록이 그대로 비친다(가이드 §08 오버레이 층)`)
      continue
    }
    // (1-b) 농도의 값 — 가이드가 숫자까지 정해 둔 정본 한 자리에만 건다.
    const canon = CANON_DIM.get(f)
    if (canon && !canon.re.test(dim.text)) {
      violations.push(`${at} — 정본 모달의 막 농도가 ${canon.what} 이 아니다. 존재만 보던 축은 bg-black/5 도 통과시켰다`)
    }

    // (2) 불투명도 — **막의 색은 기본 스타일이 진다.** 모션이나 토글만으로 불투명도가 올라오면,
    // 그것이 도중에 멎는 순간 막이 중간값에 굳어 화면을 덮고 조작을 먹는다(신고 bf0a6fff 의 옅어짐).
    // 등장 모션을 얹는 것은 좋다 — 다만 그때는 정본 마감(useSettleEntrance)이 함께 있어야 한다.
    const animated = /anim-(overlay|panel)-in/.test(dim.text)
    const toggled = /opacity-0\b/.test(dim.text)
    if ((animated || toggled) && !/useSettleEntrance\(/.test(src)) {
      gap(`${f}|불투명도`, `${at} — 막의 불투명도가 ${animated ? '등장 모션' : '토글'}에만 실려 있는데 마감 정본(useSettleEntrance)이 없다. 모션이 중간에 멎으면 옅은 막이 화면에 남는다`)
    }

    // (3) z 순서 — 층 토큰을 쓰고, 그 토큰이 실재하고, 자식 딤이면 패널이 그 위에 선다.
    const tokens = zTokens(root.text, src)
    if (tokens.length === 0) {
      gap(`${f}|z`, `${at} — 층 토큰(var(--z-*)) 없이 섰다. 생 z 값은 §08 층 순서 밖이라 다음 오버레이와 싸운다`)
    }
    for (const t of tokens) {
      if (!known.has(t)) violations.push(`${at} — 없는 층 토큰 --z-${t}. z-index 가 조용히 사라져 막이 패널 뒤로 간다`)
    }
    if (!selfDim) {
      // 딤이 형제면 뒤에 오는 패널이 stacking 을 세워야 한다. relative 가 없으면 나중에 그린
      // 딤이 패널을 덮어 클릭이 전부 배경으로 간다.
      const after = src.slice(dim.end, rootEnd)
      const panel = enclosingTag(after, after.search(/<[A-Za-z]/) + 1)
      if (!panel || !/\brelative\b/.test(panel.text)) {
        gap(`${f}|z`, `${at} — 형제 딤 바로 뒤 패널에 relative 가 없다. 딤이 패널을 덮어 조작이 배경으로 샌다`)
      }
    }
  }
}

// ── 4) 등장 모션이 시작 상태를 붙잡지 않는가 ───────────────────────
// 이 절이 이번 신고의 급소다. .anim-*-in 은 **안 돌면 아무 일도 안 일어나는 클래스**여야 한다.
// 기본 규칙에 opacity: 0 을 두거나 fill-mode 로 시작 프레임을 붙잡으면, 모션이 멎는 순간
// 그 투명한 첫 프레임이 영구 상태가 된다 — 걷어낼 마감이 있어도 이미 늦다.
try {
  const css = readFileSync(CSS, 'utf8')
  for (const cls of ['anim-overlay-in', 'anim-panel-in']) {
    const m = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css)
    if (!m) { violations.push(`${CSS} — .${cls} 규칙이 없다. 등장 모션 정본이 사라졌다`); continue }
    const body = m[1]
    if (/opacity\s*:\s*0/.test(body)) {
      violations.push(`${CSS} — .${cls} 가 기본 규칙에서 opacity 0 을 건다. 모션이 안 돌거나 멎으면 그대로 안 보이는 채 굳는다`)
    }
    if (/\b(backwards|both)\b/.test(body)) {
      violations.push(`${CSS} — .${cls} 가 fill-mode 로 시작 프레임을 붙잡는다. 멎은 모션이 투명한 첫 프레임에 영구히 굳는다`)
    }
    // **모션이 실제로 돌긴 하는가**(독립 검수 2026-09-17). 위 둘은 "멎었을 때 안 굳는가"를
    // 보는데, 그 반대쪽에는 게이트가 하나도 없었다 — 등장이 통째로 사라져도 화면 말고는
    // 아무도 모른다. 특히 마감 정본의 즉시 제거 가지가 잘못 발동하면 앱의 **모든** 모달
    // 페이드가 조용히 없어지는데 종전 게이트는 한 줄도 안 변했다.
    const shorthand = /animation\s*:\s*([\w-]+)\s+([\d.]+)(ms|s)\b/.exec(body)
    if (!shorthand) {
      violations.push(`${CSS} — .${cls} 에 '이름 + 길이' 꼴 animation 선언이 없다. 등장 모션이 사라져도 게이트가 안 변한다`)
      continue
    }
    const [, name, num, unit] = shorthand
    if ((unit === 's' ? Number(num) * 1000 : Number(num)) <= 0) {
      violations.push(`${CSS} — .${cls} 의 모션 길이가 ${num}${unit} 다. 0 이면 등장이 없는 것과 같다`)
    }
    if (!new RegExp(`@keyframes\\s+${name}\\b`).test(css)) {
      violations.push(`${CSS} — @keyframes ${name} 이 없다. 클래스는 서 있는데 도는 것이 없다`)
    }
    // 이름 규약 `.anim-X { animation: X ... }` — 마감 정본(lib/useSettleEntrance)이 클래스에서
    // 'anim-' 만 떼어 이 이름으로 "지금 도는가"를 묻는다. 어긋나면 늘 "안 돌고 있다"로 답해
    // 등장 클래스가 첫 프레임에 즉시 걷히고 페이드가 조용히 사라진다.
    const want = cls.replace(/^anim-/, '')
    if (name !== want) {
      violations.push(`${CSS} — .${cls} 가 @keyframes ${name} 을 쓴다. 마감 정본은 'anim-' 만 뗀 '${want}' 로 묻는다 — 어긋나면 등장이 즉시 걷혀 페이드가 사라진다`)
    }
  }
  // 모션 축소 설정에서는 클래스가 통째로 무동작이어야 한다 — 그 무동작이 곧 '끝 상태'다.
  const guarded = /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\.anim-overlay-in[\s\S]*?\.anim-panel-in/.test(css)
  if (!guarded) {
    violations.push(`${CSS} — 등장 모션이 prefers-reduced-motion: no-preference 안에 없다. 모션 축소 사용자에게 클래스가 실제로 돌아 버린다`)
  }
} catch { /* 위 0) 에서 이미 신고됨 */ }

// ── 5) 목록 케케묵음 ───────────────────────────────────────────────
for (const k of KNOWN_GAPS.keys()) {
  if (!gapsSeen.has(k)) violations.push(`${k} — 알려진 공백 목록에 있는데 더 이상 걸리지 않는다. 목록에서 내릴 것`)
}

console.log(`\n[모달 막] 다이얼로그 오버레이 ${overlays}개 검사 / 알려진 공백 ${KNOWN_GAPS.size}건 / 위반 ${violations.length}건`)
for (const k of gapsSeen) console.log(`  · 알려진 공백 ${k} — ${KNOWN_GAPS.get(k)}`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  막은 있는 것만으로 부족하다 — 제 농도에 닿고, 패널 아래 서야 한다.')
  console.error('  본보기: components/ui/Modal.tsx 의 bg-black/70 + anim-overlay-in + useSettleEntrance.')
  process.exit(1)
}
