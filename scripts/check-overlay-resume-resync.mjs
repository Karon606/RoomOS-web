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

console.log(`[오버레이 복귀] 전체화면 오버레이 ${overlays}개 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error("  퇴장 마감을 벽시계로 두고 visibilitychange·pageshow 에서 다시 물을 것.")
  console.error('  본보기: components/brand/SplashController.tsx 의 exitAt·reconcile.')
  process.exit(1)
}
