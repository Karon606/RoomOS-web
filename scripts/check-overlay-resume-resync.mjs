// 화면 전체를 덮는 오버레이가 '돌아온 뒤 다시 묻기'를 빠뜨린 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 무엇을 막는가. 오버레이의 퇴장이 서로 다른 두 시계 위에 있으면(CSS transition 과 setTimeout)
// 백그라운드에 다녀오는 사이 그 창이 걸릴 때 오버레이가 중간 불투명도로 얼어붙는다. 화면은
// 막에 덮이고 조작은 통과하며, 페이지 시계가 다시 돌 때까지 안 걷힌다(운영자 실측 2026-08-28 —
// 크림색 막. 2026-06-12 에도 같은 클래스의 잔상 사고가 있었다, Work_log ⑥).
//
// 케이스를 하나씩 고치면 세 번째 오버레이가 같은 모양으로 태어난다. 그래서 규칙으로 막는다.
//   (가) 전체 화면 오버레이를 그리고 — fixed inset-0 + 상위 z 토큰
//   (나) **자기를 없애는 일을** 타이머에 맡기는데 — setTimeout 안에서 닫기·off·언마운트
//   (다) visibilitychange 도 pageshow 도 안 본다
// 셋이 겹치면 위반이다. 하나라도 빠지면 이 함정에 안 빠진다.
//
// (나)를 '타이머가 있는가'로 넓게 잡으면 등장 애니메이션 트리거(setShown(true), 10ms)와
// 검색 디바운스와 '연결이 느립니다' 캡션까지 걸린다. 실측으로 넷이 오탐이었다. 얼어붙는 것은
// **퇴장**뿐이다 — 등장이 멎으면 오버레이가 안 뜨고 말지 화면에 막이 남지 않는다.
//
// 실행: node scripts/check-overlay-resume-resync.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['components', 'app']
const Z_TOP = /--z-(loader|lightbox|toast|sysbar|confirm|modal)/

const EXIT = /onClose|onDismiss|\bgo\('off'\)|setOpen\(false\)|setMounted\(false\)|setVisible\(false\)|setShown\(false\)/

/** setTimeout(...) 호출의 인자 문자열만 뽑아 퇴장 낱말을 찾는다. */
function timerCallsExit(src) {
  let at = src.indexOf('setTimeout(')
  while (at !== -1) {
    let depth = 0
    let i = at + 'setTimeout'.length
    const start = i + 1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') { depth--; if (depth === 0) break }
    }
    if (EXIT.test(src.slice(start, i))) return true
    at = src.indexOf('setTimeout(', i)
  }
  return false
}

function walk(p) {
  const out = []
  for (const n of readdirSync(p)) {
    const f = join(p, n)
    const st = statSync(f)
    if (st.isDirectory()) out.push(...walk(f))
    else if (f.endsWith('.tsx')) out.push(f)
  }
  return out
}

const violations = []
let overlays = 0
for (const root of ROOTS) {
  for (const f of walk(root)) {
    const src = readFileSync(f, 'utf8')
    const isOverlay = src.includes('fixed inset-0') && Z_TOP.test(src)
    if (!isOverlay) continue
    overlays++
    // 퇴장을 타이머에 맡겼는가 — setTimeout 호출의 **인자 안에서만** 자기를 없애는 말을 찾는다.
    // 줄 단위로 훑으면 바로 아래의 무관한 setShown(false) 까지 걸린다(MergeSheet 오탐).
    // 괄호를 세어 호출 범위를 정확히 끊는다.
    const timed = timerCallsExit(src)
    if (!timed) continue
    // **등록**만 센다. 낱말만 보면 removeEventListener 한 줄이 남은 것으로도 통과해
    // 그물이 자기 결함을 못 잡는다(이 그물을 세울 때 실제로 그랬다).
    const resyncs = /addEventListener\(\s*'(visibilitychange|pageshow)'/.test(src)
    if (!resyncs) {
      violations.push(`${f} — 전체 화면 오버레이를 타이머로 걷는데 복귀 재동기가 없다`)
    }
  }
}

// ── 등장도 본다(2026-09-08) ────────────────────────────────────────
// 이 그물은 여태 **퇴장만** 봤다. 위에 "등장이 멎으면 오버레이가 안 뜨고 말지 화면에 막이 남지
// 않는다"고 적었는데, 그 전제가 참이 아닌 경로가 있었다 — 문서가 숨은 채(document.hidden)
// 마운트되면 등장 모션이 첫 프레임에서 굳는다. 그 첫 프레임이 막 opacity 0, 패널
// translateY(10px) scale(.97) 이라, 걷히는 것이 아니라 **거의 투명한 막**이 남는다. 뒤 목록이
// 비치고 제목이 앱 헤더 위로 겹쳐 보인 그 모습이다(신고 2026-09-08 "일부가 깨져보이는 현상").
//
// 규칙: 등장 모션 클래스를 붙이는 전체 화면 오버레이는 정본 훅(useSettleEntrance)으로 마감한다.
// 시간 추정으로 지우는 것은 이 그물이 막는 벽시계 퇴장과 같은 함정이라 여기서도 안 받는다.
// **주석을 지우고 본다.** 설명 주석이 코드와 같은 낱말을 쓰므로(이 절만 해도 document.hidden 을
// 두 번 적는다), 원문 그대로 보면 코드에서 처리를 빼도 설명만으로 통과한다 — 이 그물을 세울 때
// 역주입으로 실제로 그랬다. '://' 는 URL 이라 예외로 둔다.
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

//
// **호출 한 줄만 보면 그물이 아니다(2026-09-16, 신고 bf0a6fff — 네 번째 재현).** 이 절은 여태
// `useSettleEntrance(` 라는 글자가 파일 안에 있기만 하면 통과했다. ref 가 정말 그 등장 클래스를
// 단 엘리먼트에 붙었는지, 마감이 굳은 상태에서도 회복되는지는 아무도 안 봤다. 아래에서 셋을 본다.
//   (ㄱ) 배선 — 훅에 넘긴 ref 가 등장 클래스를 단 바로 그 엘리먼트에 붙어 있는가
//   (ㄴ) 굳은 상태 회복 — 정본이 붙는 시점에 "지금 돌고 있는가"를 묻는가(이벤트만 듣지 않는가)
//   (ㄷ) 벽시계 금지 — 마감 시점을 시간으로 추정하지 않는가(2026-09-08 결정)

/** 인덱스 pos 를 품은 JSX 여는 태그의 원문. 못 찾으면 null(= 위반으로 센다). */
function enclosingTag(src, pos) {
  let start = -1
  for (let i = pos; i >= 0; i--) {
    if (src[i] === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) { start = i; break }
  }
  if (start < 0) return null
  // 속성값에 화살표 함수가 살아 '>' 가 태그 안에 있다. 중괄호 깊이와 따옴표를 세며 진짜 닫는
  // '>' 를 찾는다(check-calendar-room-open 이 같은 함정을 겪고 조인 자리와 같은 문법).
  let depth = 0, quote = ''
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return src.slice(start, i + 1)
  }
  return null
}

/**
 * `useSettleEntrance(` **호출 전부**의 인자 원문과 그 범위. 괄호 깊이로 자른다.
 *
 * 종전에는 `indexOf` 로 **첫 호출 하나**만 봤다(독립 검수 2026-09-17). 한 파일이 오버레이를
 * 둘 이상 가지면 둘째부터는 배선이 어긋나 있어도 아무도 안 봤다 — 이 그물이 고치러 온 바로
 * 그 결함("호출 한 줄만 보면 그물이 아니다")의 같은 클래스다.
 * 못 자르는 호출이 하나라도 있으면 null 을 내고 호출부가 위반으로 센다.
 */
function hookCalls(src) {
  const out = []
  let at = src.indexOf('useSettleEntrance(')
  while (at >= 0) {
    const open = at + 'useSettleEntrance'.length
    let depth = 0, close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') { depth--; if (depth === 0) { close = i; break } }
    }
    if (close < 0) return null
    out.push({ args: src.slice(open + 1, close), start: at, end: close })
    at = src.indexOf('useSettleEntrance(', close)
  }
  return out
}

/** 객체 인자에서 키의 값 — 축약(`overlayRef`)과 명시(`overlayRef: ov`) 둘 다 읽는다. */
function argOf(obj, key) {
  const named = new RegExp(`\\b${key}\\s*:\\s*([A-Za-z_$][\\w$]*)`).exec(obj)
  if (named) return named[1]
  return new RegExp(`(^|[{,\\s])${key}\\s*(,|\\}|$)`).test(obj) ? key : null
}

// **오버레이인지는 안 묻는다**(독립 검수 2026-09-17). 종전에는 `fixed inset-0` 을 같이 요구해
// 전체 화면이 아닌 층은 그물 밖이었다 — 계약서 원격 알약(app/contract/[tenantId]/ContractView.tsx)
// 이 정확히 그 틈에 서 있었다. "등장 클래스를 쓰면 마감이 있어야 한다"는 규칙은 그 층이 화면을
// 덮는지와 무관하다. 멎으면 막이 남느냐 알약이 안 보이느냐로 증상만 달라진다.
const ENTRANCE = /anim-(overlay|panel)-in/
for (const root of ROOTS) {
  for (const f of walk(root)) {
    const src = stripComments(readFileSync(f, 'utf8'))
    if (!ENTRANCE.test(src)) continue
    if (!/useSettleEntrance\(/.test(src)) {
      violations.push(`${f} — 등장 모션을 붙여 놓고 마감이 없다. 숨은 채 뜨면 첫 프레임에 굳어 반투명 막이 남는다(lib/useSettleEntrance)`)
      continue
    }
    // (ㄱ) 배선 — 넘긴 ref 가 등장 클래스를 단 엘리먼트에 붙었는가. **호출도 태그도 전수**다.
    const calls = hookCalls(src)
    if (calls == null || calls.length === 0) {
      violations.push(`${f} — useSettleEntrance 의 인자를 읽을 수 없다. 못 읽으면 통과가 아니라 위반이다`)
      continue
    }
    // 클래스 이름을 바꿔 부르는 자리가 생기면 그 이름으로 본다(기본값은 정본과 같다).
    const clsOf = (args, key, dflt) => {
      const m = new RegExp(`\\b${key}\\s*:\\s*'([^']+)'`).exec(args)
      return m ? m[1] : dflt
    }
    // 어느 클래스를 어느 ref 가 맡았는가. 한 파일에 호출이 여럿이면 전부 모은다.
    const wired = new Map()
    const add = (cls, ref) => {
      if (!wired.has(cls)) wired.set(cls, new Set())
      if (ref) wired.get(cls).add(ref)
    }
    for (const { args } of calls) {
      add(clsOf(args, 'overlayClass', 'anim-overlay-in'), argOf(args, 'overlayRef'))
      add(clsOf(args, 'panelClass', 'anim-panel-in'), argOf(args, 'panelRef'))
    }
    // 이 파일이 실제로 붙인 등장 클래스들 — 훅 인자 안의 문자열 리터럴은 세지 않는다.
    const inCall = pos => calls.some(c => pos > c.start && pos < c.end)
    const used = new Map()
    for (const cls of new Set([...wired.keys(), 'anim-overlay-in', 'anim-panel-in'])) {
      const spots = []
      let at = src.indexOf(cls)
      while (at >= 0) {
        if (!inCall(at)) spots.push(at)
        at = src.indexOf(cls, at + cls.length)
      }
      if (spots.length > 0) used.set(cls, spots)
    }
    for (const [cls, spots] of used) {
      const refs = wired.get(cls)
      if (!refs || refs.size === 0) {
        violations.push(`${f} — 등장 클래스(${cls})를 붙였는데 훅에 그 층의 ref 를 안 넘긴다. 그 층의 모션은 영영 안 걷힌다`)
        continue
      }
      // **그 클래스를 단 태그 전부.** 종전에는 indexOf 로 첫 자리 하나만 봤다.
      for (const at of spots) {
        const tag = enclosingTag(src, at)
        if (tag == null) {
          violations.push(`${f} — ${cls} 를 단 태그를 잘라낼 수 없다. 못 읽으면 통과가 아니라 위반이다`)
          continue
        }
        if (![...refs].some(r => new RegExp(`ref=\\{\\s*${r}\\s*\\}`).test(tag))) {
          violations.push(`${f} — ${cls} 를 단 엘리먼트에 ref={${[...refs].join('|')}} 가 없다. 훅은 도는데 화면은 안 걷힌다(호출 한 줄만 보던 그물이 놓친 자리)`)
        }
      }
    }
  }
}
// 정본 자체가 살아 있는지 — 소비자만 검사하면 알맹이가 빠져도 전부 통과한다.
try {
  const hook = stripComments(readFileSync('lib/useSettleEntrance.ts', 'utf8'))
  if (!/addEventListener\(\s*'animationend'/.test(hook)) {
    violations.push('lib/useSettleEntrance.ts — animationend 를 안 듣는다. 모션이 끝난 것을 확인할 길이 없어진다')
  }
  // 마운트 시점의 생략 분기를 콕 집어 본다. 그냥 document.hidden 을 찾으면 복귀 쓸이의
  // `!document.hidden` 이 대신 걸려, 정작 생략을 빼도 통과한다(역주입으로 확인).
  if (!/if\s*\(\s*document\.hidden\s*\)/.test(hook)) {
    violations.push('lib/useSettleEntrance.ts — 숨은 채 마운트되는 경우를 안 본다. 그 자리가 이번 신고의 유력한 경로다')
  }
  if (!/addEventListener\(\s*'visibilitychange'/.test(hook)) {
    violations.push('lib/useSettleEntrance.ts — 복귀 쓸이가 없다. 숨은 사이 멎은 모션이 그대로 남는다')
  }
  // (ㄴ) **이벤트만 듣는 마감은 굳은 모션을 못 본다**(신고 bf0a6fff). 이펙트는 페인트 뒤에 돈다 —
  // 리스너가 붙기 전에 끝났거나 멎은 모션은 animationend 로도 visibilitychange 로도 안 온다.
  // 붙는 그 시점에 "지금 돌고 있는가"를 물어야 한다. 판정은 정본 lib/animationSettled 가 한다.
  if (!/runningAnimations\(/.test(hook)) {
    violations.push('lib/useSettleEntrance.ts — 붙는 시점에 "지금 돌고 있는가"를 안 묻는다. 이미 굳은 모션은 이벤트로 영영 안 온다(lib/animationSettled)')
  }
  // **묻되 이 모션만 묻는다**(독립 검수 2026-09-17). 이름을 안 넘기면 같은 엘리먼트에 붙은
  // 모든 도는 모션이 섞여, 무한히 도는 것(animate-pulse 류) 하나가 finished 를 영영 안 내준다 —
  // 굳은 모션을 고치러 온 코드가 정반대로 등장 클래스를 영영 못 걷는다.
  if (!/runningAnimations\([^)]*,\s*\[/.test(hook)) {
    violations.push('lib/useSettleEntrance.ts — runningAnimations 에 모션 이름을 안 넘긴다. 그 층의 무한 모션 하나에 등장 클래스가 영영 안 걷힌다')
  }
  // 이름 짓는 규약(클래스에서 anim- 만 뗀다)이 사라지면 위 물음이 늘 "안 돌고 있다"로 답해
  // 등장이 즉시 걷힌다 — 앱의 모든 모달 페이드가 조용히 사라진다. CSS 쪽 짝은
  // check-overlay-backdrop 이 진다(.anim-X { animation: X ... }).
  if (!/function motionName\(/.test(hook) || !/'anim-'/.test(hook)) {
    violations.push("lib/useSettleEntrance.ts — 등장 클래스에서 @keyframes 이름을 짓는 규약(motionName)이 사라졌다. 이름이 어긋나면 등장이 즉시 걷혀 페이드가 사라진다")
  }
} catch {
  violations.push('lib/useSettleEntrance.ts 를 읽을 수 없음 — 등장 마감 정본이 사라졌다')
}
// 수법 정본 — 계측(lib/viewportProbe)과 마감(lib/useSettleEntrance)이 같은 한 벌을 본다.
// 두 벌이 되면 한쪽만 고쳐진다(그 일이 실제로 2026-09-17 에 하루 간격으로 났다).
try {
  const canon = stripComments(readFileSync('lib/animationSettled.ts', 'utf8'))
  if (!/playState\s*===\s*'running'/.test(canon)) {
    violations.push("lib/animationSettled.ts — playState 로 '도는 중'을 안 가린다. 굳은 모션과 도는 모션을 구분할 길이 없어진다")
  }
  if (!/allSettled\(/.test(canon)) {
    violations.push('lib/animationSettled.ts — allSettled 가 아니다. 취소도 끝의 한 갈래인데 거부로 새면 마감이 영영 안 온다')
  }
  if (!/animationName/.test(canon)) {
    violations.push('lib/animationSettled.ts — animationName 으로 거르는 갈래가 사라졌다. 이름을 넘겨도 그 층의 모든 모션이 섞인다')
  }
  // 전이 갈래(2026-09-17 에 넓혔다 — MergeSheet 처럼 CSS 전이로 뜨는 막). 판정은 같은 정본이
  // 진다. 두 벌로 두면 한쪽만 고쳐진다.
  if (!/transitionProperty/.test(canon)) {
    violations.push('lib/animationSettled.ts — transitionProperty 로 CSS 전이를 가리는 갈래가 사라졌다. 전이로 뜨는 막의 회복이 @keyframes 모션과 섞인다')
  }
  // 굳은 쪽도 playState 로 가린다. 막 만들어진 전이(play-pending)도 명세상 이미 'running' 이라
  // 이 한 줄이 "이제 막 시작한 것까지 걷어 페이드가 통째로 사라지는" 창을 막는다 — 마감 정본의
  // 즉시 제거 가지가 잘못 발동하는 것과 같은 클래스의 사고다.
  if (!/playState\s*!==\s*'running'/.test(canon)) {
    violations.push("lib/animationSettled.ts — 굳은 전이를 playState 로 안 가린다. 막 시작한 전이까지 걷어 페이드가 사라진다")
  }
} catch {
  violations.push('lib/animationSettled.ts 를 읽을 수 없음 — 모션 마감 수법 정본이 사라졌다')
}
// (ㄷ) 벽시계 금지(2026-09-08 결정) — 마감 시점을 시간으로 추정하면 이 그물이 막는 함정으로
// 되돌아간다. 계측 쪽은 check-kbd-canonical 이 같은 단언을 진다.
for (const f of ['lib/useSettleEntrance.ts', 'lib/animationSettled.ts']) {
  let src = ''
  try { src = stripComments(readFileSync(f, 'utf8')) } catch { continue }
  if (/setTimeout\(|setInterval\(|Date\.now\(|performance\.now\(/.test(src)) {
    violations.push(`${f} — 벽시계로 마감한다. 시점은 "실제로 무엇이 끝났는가"로만 정한다(2026-09-08 결정)`)
  }
}

console.log(`[오버레이 복귀] 전체화면 오버레이 ${overlays}개 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error("  퇴장 마감을 벽시계로 두고 visibilitychange·pageshow 에서 다시 물을 것.")
  console.error('  본보기: components/brand/SplashController.tsx 의 exitAt·reconcile.')
  process.exit(1)
}
