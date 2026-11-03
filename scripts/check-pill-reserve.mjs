// 선택 알약이 마지막 행을 덮는 것을 잡는 감지망(신고 e791b6f7, 가이드 §22) — 읽기 전용, 위반 시 exit 1.
//
// 알약은 fixed 라 스크롤러 끝을 덮는다. 서 있는 동안 정본 훅(lib/usePillReserve)이 실측 높이 + 12px 을 루트
// --pill-reserve 에 적고, 더하는 곳은 globals.css 한 곳(.app-main 두 규칙, 알약을 품은 모달 본문 끝)이다.
// 화면마다 여백을 따로 두면 숫자가 갈린다(계약서 화면 96px 하드코딩이 그 예였다).
//
// 실행: node scripts/check-pill-reserve.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
const read = f => { try { return readFileSync(f, 'utf8') } catch { violations.push(`${f}: 읽을 수 없음`); return '' } }

// ⓐ 정본 훅. 실측(ResizeObserver · offsetHeight), 간격 12, 루트에 쓰고 마지막이 내려가면 지운다.
{
  const src = strip(read('lib/usePillReserve.ts'))
  if (!/new ResizeObserver\(/.test(src) || !/\.offsetHeight/.test(src)) violations.push('lib/usePillReserve.ts: 알약 높이를 재지 않는다(ResizeObserver · offsetHeight)')
  if (!/PILL_RESERVE_GAP = 12\b/.test(src) || !/Math\.ceil\(max\) \+ PILL_RESERVE_GAP/.test(src)) violations.push('lib/usePillReserve.ts: 예약값이 실측 높이 + 12px 이 아니다')
  if (!/PILL_RESERVE_VAR = '--pill-reserve'/.test(src) || !/document\.documentElement/.test(src)) violations.push('lib/usePillReserve.ts: 루트 --pill-reserve 에 쓰지 않는다')
  if (!/removeProperty\(PILL_RESERVE_VAR\)/.test(src) || !/live\.delete\(key\)/.test(src)) violations.push('lib/usePillReserve.ts: 알약이 내려가도 예약을 안 지운다. 선택을 끝낸 화면 끝에 빈 자리가 남는다')
}

// ⓑ 알약 셸. 훅을 부르고, 모달 본문 규칙이 찾을 손잡이(data-pill-bar)와 바닥 변수(--pill-floor)를 쓴다.
{
  const src = strip(read('components/ui/inventory/SelectionPillBar.tsx'))
  if (!/usePillReserve\(barRef\)/.test(src)) violations.push('components/ui/inventory/SelectionPillBar.tsx: 서 있는 동안 높이를 예약하지 않는다(usePillReserve)')
  const tag = /<div ref=\{barRef\}[^>]*>/.exec(src)
  if (!tag || !/data-pill-bar=""/.test(tag[0])) violations.push('components/ui/inventory/SelectionPillBar.tsx: 바깥 상자에 data-pill-bar 가 없다. 모달 본문 끝 예약이 알약을 못 찾는다')
  if (!tag || !/bottom-\[var\(--pill-floor\)\]/.test(tag[0])) violations.push('components/ui/inventory/SelectionPillBar.tsx: 알약 바닥이 --pill-floor 가 아니다. 모달 본문 끝 예약과 바닥 숫자가 두 벌이 된다')
}

// ⓒ 더하는 곳(globals.css). .app-main 두 규칙 모두 --kbd-inset 과 따로 더하고, 알약을 품은 모달 본문 끝에 자리를 만든다.
{
  const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const mains = [...css.matchAll(/\.app-main \{([^}]*)\}/g)].map(m => m[1]).filter(b => /padding-bottom/.test(b))
  if (mains.length !== 2) violations.push(`app/globals.css: .app-main padding-bottom 규칙이 둘이 아니다(${mains.length})`)
  for (const b of mains) {
    if (!/var\(--kbd-inset, 0px\) \+ var\(--pill-reserve, 0px\)/.test(b)) violations.push('app/globals.css: .app-main 하단 여백에 --pill-reserve 가 --kbd-inset 과 따로 더해지지 않는다(한쪽 폭에서만 마지막 행이 가린다)')
  }
  if (!/:root \{ --pill-floor: 1rem; \}/.test(css) || !/--pill-floor: calc\(env\(safe-area-inset-bottom, 0px\) \+ 56px\)/.test(css)) violations.push('app/globals.css: 알약 바닥(--pill-floor)이 모바일 안전영역 + 56px · md 16px 가 아니다')
  const after = /\[data-modal-body\]:has\(\[data-pill-bar\]\)::after \{([^}]*)\}/.exec(css)
  if (!after || !/content: ''/.test(after[1]) || !/var\(--pill-reserve, 0px\) \+ var\(--pill-floor\) - max\(1rem, env\(safe-area-inset-bottom, 0px\)\)/.test(after[1])) violations.push('app/globals.css: 알약을 품은 모달 본문 끝 예약이 없거나 알약 바닥과 모달 바닥의 차이를 안 더한다')
  if (!/html\[data-kbd-open\] \[data-modal-body\]:has\(\[data-pill-bar\]\)::after \{ height: var\(--pill-reserve, 0px\); \}/.test(css)) violations.push('app/globals.css: 키보드가 선 동안의 모달 본문 끝 예약이 없다')
  // 판정 변수에 섞지 않는다. --kbd-inset 은 ViewportOffsetGuard 단일 소유다.
  if (/--kbd-inset:[^;]*pill/.test(css)) violations.push('app/globals.css: --kbd-inset 에 알약 몫을 섞었다(§30 단일 소유자)')
}

// ⓓ 모달 본문 손잡이.
if (!/<div ref=\{bodyRef\} className=\{`[^`]*`\} data-modal-body="">/.test(strip(read('components/ui/Modal.tsx')))) violations.push('components/ui/Modal.tsx: 본문에 data-modal-body 가 없다. 모달 안 알약의 끝 예약이 안 선다')

// ⓔ 계약서 원격 알약도 같은 정본(종전 96px 하드코딩 흡수).
{
  const src = read('app/contract/[tenantId]/ContractView.tsx')
  const code = strip(src)
  if (!/usePillReserve\(remotePillRef,/.test(code)) violations.push('app/contract/[tenantId]/ContractView.tsx: 원격 알약이 높이를 예약하지 않는다(usePillReserve)')
  const rule = /\.contract-shell\.has-pill \{([^}]*)\}/.exec(src)
  if (!rule || !/var\(--pill-reserve,/.test(rule[1]) || /96px/.test(rule[1])) violations.push('app/contract/[tenantId]/ContractView.tsx: .has-pill 여백이 실측 예약이 아니다(96px 하드코딩)')
}

// ⓕ 소비처가 제 손으로 알약 몫 여백을 두지 않는다. 알약을 그리는 파일에 --pill-reserve 를 쓰거나 has-pill 류 하드코딩이 서면 두 벌이다.
{
  const walk = p => readdirSync(p).flatMap(n => { const f = join(p, n); return statSync(f).isDirectory() ? walk(f) : /\.tsx$/.test(f) ? [f] : [] })
  for (const f of [...walk('app'), ...walk('components')]) {
    const src = strip(readFileSync(f, 'utf8'))
    if (!/<SelectionPillBar\b|<DocMultiShareBar\b/.test(src)) continue
    if (/--pill-reserve/.test(src)) violations.push(`${f}: 알약 소비처가 --pill-reserve 를 직접 쓴다. 더하는 곳은 globals.css 한 곳이다`)
    if (/\bhas-pill\b/.test(src)) violations.push(`${f}: 알약 소비처가 따로 여백 클래스를 둔다`)
  }
}

console.log(`[선택 알약 끝 예약] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
process.exit(violations.length ? 1 : 0)
