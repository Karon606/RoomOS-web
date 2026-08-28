// 모달 기하 회귀 — 실행: npx tsx scripts/test-modal-viewport.ts
//
// 여기서 고정하는 것 셋(실측 2026-08-29).
//   · **팬이 얼마든 띠 크기는 같다** — top + bottom 의 합이 상수라야 패널이 밀려도 안 줄어든다.
//   · **위 여백에도 상한이 있다** — 아래에만 0 하한이 있고 위에 짝이 없어서, 어긋난 스냅샷 한 장에
//     패널이 내려가며 작아졌다. 32px 만 넘어도 발동한다.
//   · **불가능값은 버리고 직전 값을 유지한다** — 0 으로 떨구면 레이아웃이 통째로 흔들린다.
import { overlayInsets, usableVvHeight, MIN_VV_HEIGHT } from '../lib/modalViewport'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// 아이폰 16 Pro 실측 — 402x874, safe-area 59/34. 키보드가 열리면 띠가 538 이 된다.
const H = 874
const band = (height: number, offsetTop: number) => overlayInsets({ innerHeight: H, height, offsetTop })

// ── 팬 불변 ────────────────────────────────────────────────────────
// 이 셋의 top+bottom 이 같아야 오버레이 content box 가 같고, 패널이 밀려도 안 줄어든다.
for (const pan of [0, 150, 336]) {
  const r = band(538, pan)
  eq(`키보드 열림 · 팬 ${pan} 의 합은 상수`, r.top + r.bottom, H - 538)
}
eq('키보드 닫힘은 인셋이 없다', band(874, 0), { top: 0, bottom: 0 })
// 자동완성 바까지 올라온 경우.
for (const pan of [0, 408]) {
  const r = band(466, pan)
  eq(`자동완성 바 · 팬 ${pan} 의 합은 상수`, r.top + r.bottom, H - 466)
}

// ── 위 여백 상한 ───────────────────────────────────────────────────
// offsetTop 이 innerHeight - height 를 넘는 스냅샷. 종전에는 top 만 자라 패널을 깎았다.
eq('정상 범위에서는 상한이 안 걸린다', band(538, 336).top, 336)
eq('경계값도 그대로', band(538, 336).top, H - 538)
eq('넘으면 상한으로 자른다', band(538, 436).top, H - 538)
eq('많이 넘어도 상한', band(538, 530).top, H - 538)
// 상한이 걸려도 합은 절대 커지지 않는다 — content box 가 깎이는 일이 없다.
for (const pan of [436, 530, 900]) {
  const r = band(538, pan)
  eq(`오버팬 ${pan} 에서도 합이 안 커진다`, r.top + r.bottom <= H - 538, true)
}
eq('음수 팬은 0 으로', band(538, -50).top, 0)

// ── 띠 높이 위생 ───────────────────────────────────────────────────
eq('정상값은 그대로', usableVvHeight(538, 0), 538)
eq('반올림한다', usableVvHeight(537.6, 0), 538)
// 찢어진 스냅샷 — 0 으로 떨구지 않고 직전 값을 유지한다.
eq('불가능값이면 직전 값 유지', usableVvHeight(80, 538), 538)
eq('0 이 와도 직전 값 유지', usableVvHeight(0, 538), 538)
// 열림 첫 프레임부터 오염된 경우 — null 을 내고 호출부가 100dvh 폴백을 쓴다(과보정 안 함).
eq('직전 값이 없으면 null', usableVvHeight(80, 0), null)
eq('경계값은 받아들인다', usableVvHeight(MIN_VV_HEIGHT, 0), MIN_VV_HEIGHT)
eq('경계 아래는 버린다', usableVvHeight(MIN_VV_HEIGHT - 1, 300), 300)

console.log(`\n모달 기하 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
