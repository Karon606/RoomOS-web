// 모달 기하 회귀 — 실행: npx tsx scripts/test-modal-viewport.ts
//
// 여기서 고정하는 것 셋(실측 2026-08-29).
//   · **팬이 얼마든 띠 크기는 같다** — top + bottom 의 합이 상수라야 패널이 밀려도 안 줄어든다.
//   · **위 여백에도 상한이 있다** — 아래에만 0 하한이 있고 위에 짝이 없어서, 어긋난 스냅샷 한 장에
//     패널이 내려가며 작아졌다. 32px 만 넘어도 발동한다.
//   · **불가능값은 버리고 직전 값을 유지한다** — 0 으로 떨구면 레이아웃이 통째로 흔들린다.
//   · **아래 여백에도 상한이 있다** — 위만 잠겨 있어서, offsetTop 이 음수로 오거나 height 가 작게
//     찢어져 오면 bottom 이 무한정 자랐다. content box 가 화면 위쪽 짧은 띠로 쪼그라들고
//     items-center 가 그 안에서 가운데를 잡아 패널이 위로 붙어 눌렸다(신고 bf0a6fff, 09-16).
//   · **인셋도 높이와 같은 관문을 지난다** — 그 관문이 높이에만 걸려 있어서 찢어진 스냅샷이
//     인셋으로만 새어 들어왔다. 정본 bandHeight 하나가 이 프레임의 띠 높이를 정한다.
import { overlayInsets, usableVvHeight, shouldWriteVvHeight, resumeAllowsShrink, bandHeight, MIN_VV_HEIGHT } from '../lib/modalViewport'

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

// ── 아래 여백 상한(신고 bf0a6fff) ──────────────────────────────────
// 위 상한의 거울상이다. 종전에는 bottom 에 0 하한만 있고 상한이 없어서, 반대 방향으로 어긋난
// 스냅샷이 오면 bottom 만 자라 content box 가 위쪽 짧은 띠로 쪼그라들었다.
eq('음수 팬에서 아래 여백이 합을 넘지 않는다', band(538, -50).bottom, H - 538)
eq('음수 팬에서도 합은 상수', band(538, -50).top + band(538, -50).bottom, H - 538)
for (const pan of [-1, -50, -400]) {
  const r = band(538, pan)
  eq(`음수 팬 ${pan} 에서도 합이 안 커진다`, r.top + r.bottom <= H - 538, true)
  eq(`음수 팬 ${pan} 의 아래 여백에 상한`, r.bottom <= H - 538, true)
}
// 두 항 모두 [0, 합] 안에 있다 — 주석이 선언한 불변식을 양쪽 끝에서 다 강제한다.
for (const [h, pan] of [[538, 0], [538, 336], [538, 900], [538, -900], [466, 408], [874, 0], [900, 0]]) {
  const r = band(h, pan)
  const span = Math.max(0, H - h)
  eq(`[${h},${pan}] 두 항이 [0, 합] 안에`, r.top >= 0 && r.bottom >= 0 && r.top <= span && r.bottom <= span, true)
}

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

// ── 크기 쓰기 방향 ─────────────────────────────────────────────────
// 두 증상이 반대 방향이라 한쪽만 막으면 다른 쪽이 터진다. 이 비대칭을 여기서 고정한다.
{
  const w = shouldWriteVvHeight
  // 팬 중 작아지는 값 — 오염이다. 드래그할수록 창이 작아지던 원인.
  eq('팬에서 줄어드는 값은 안 쓴다', w(400, 538, false), false)
  // 팬 중 커지는 값 — 복구다. 앱에서 돌아와 작게 찍힌 것이 여기서 씻긴다.
  eq('팬에서 커지는 값은 쓴다', w(874, 400, false), true)
  eq('팬에서 같은 값은 쓴다(무해)', w(538, 538, false), true)
  // 키보드가 열려 띠가 진짜 줄 때는 resize 가 온다 — 그 길이 막히면 안 된다.
  eq('resize 면 줄어드는 값도 쓴다', w(538, 874, true), true)
  eq('resize 면 커지는 값도 쓴다', w(874, 538, true), true)
  // 아직 한 번도 못 읽었으면 무엇이든 받는다(첫 프레임).
  eq('첫 값은 무조건 쓴다', w(300, 0, false), true)
}

// ── 복귀 재동기화 · 낡은 스냅샷 ────────────────────────────────────
// 앱 전환·잠금·bfcache 에서 돌아온 직후 프레임의 vv 는 아직 옛 값을 낸다. 재동기화는 두 패스를
// 도는데(그 자리 + rAF), 종전에는 첫 패스도 줄이는 값을 받아 낡은 한 장이 그대로 박혔다
// (신고 2026-09-08 — 짧은 창·어긋난 인셋으로 모달 조각만 뜨던 자리).
{
  const r = resumeAllowsShrink
  eq('복귀 첫 패스는 포커스가 있어도 축소를 안 받는다', r(1, true), false)
  eq('복귀 첫 패스는 포커스가 없으면 더욱 아니다', r(1, false), false)
  eq('두 번째 패스 + 편집 포커스면 축소를 받는다', r(2, true), true)
  // 아무 칸에도 안 서 있으면 키보드가 없다 — 그때 오는 작은 띠는 실재가 아니라 낡은 값이다.
  eq('두 번째 패스라도 포커스가 없으면 안 받는다', r(2, false), false)

  // 합성 — 훅이 실제로 부르는 모양 그대로(shouldWriteVvHeight 의 fromResize 자리에 넣는다).
  const w = shouldWriteVvHeight
  eq('낡은 작은 값은 첫 패스에서 안 박힌다', w(400, 874, r(1, true)), false)
  eq('두 번째 패스 + 포커스면 진짜 축소가 들어온다', w(538, 874, r(2, true)), true)
  eq('포커스 없는 복귀에서는 두 패스 다 안 줄인다', w(400, 874, r(2, false)), false)
  // 복원(커지는 값)은 8-29 규칙대로 패스·포커스와 무관하게 통과한다 — 이 관문이 복구를 막으면
  // 앱에서 돌아와 짧게 남던 창이 되살아난다.
  eq('커지는 값은 첫 패스에서도 들어온다', w(874, 400, r(1, false)), true)
  eq('커지는 값은 두 번째 패스에서도 들어온다', w(874, 400, r(2, false)), true)

  // **8-29 봉합 불변** — 이 관문은 복귀 경로에만 얹힌다. vv 의 resize·scroll 경로는 그대로다.
  eq('vv resize 는 여전히 축소를 받는다', w(538, 874, true), true)
  eq('팬(scroll)은 여전히 축소를 안 받는다', w(400, 538, false), false)
  eq('팬에서 커지는 값은 여전히 받는다', w(874, 400, false), true)
}

// ── 한 관문 · 높이와 인셋이 같은 값을 쓴다(신고 bf0a6fff) ──────────
// 종전에는 이 관문이 패널 높이에만 걸렸고 오버레이 인셋은 vv.height 를 날것으로 썼다.
// **보호가 한쪽에만 걸린 값 쌍은 언젠가 갈린다.** 여기서 그 쌍을 붙여 둔다.
{
  const b = bandHeight
  // 관문 자체 — usableVvHeight 와 shouldWriteVvHeight 를 한 번에 지난다.
  eq('정상값은 그대로 통과', b(538, 874, true), 538)
  eq('아직 못 읽었으면 null(호출부가 폴백)', b(80, 0, true), null)
  eq('찢어진 스냅샷은 직전 유효값으로 답한다', b(80, 538, true), 538)
  eq('팬의 축소는 직전 유효값으로 답한다', b(400, 538, false), 538)
  eq('팬의 확대는 새 값으로 답한다', b(874, 538, false), 874)
  eq('resize 의 축소는 새 값으로 답한다', b(538, 874, true), 538)
  // **거부를 0 이 아니라 직전 값으로 답하는 것이 요점이다.** 0 으로 답하면 인셋이 폭발한다.
  eq('거부 답이 0 이 아니다', b(80, 538, false) !== 0, true)

  // 합성 — 훅이 실제로 부르는 모양 그대로. 찢어진 스냅샷 한 장이 인셋으로 못 샌다.
  const insetsVia = (height: number, lastGood: number, allowShrink: boolean, offsetTop: number) => {
    const h = b(height, lastGood, allowShrink)
    return h == null ? null : overlayInsets({ innerHeight: H, height: h, offsetTop })
  }
  // 종전 결함의 재현값 — 띠가 90 으로 찢어져 오면 날것으로는 bottom 이 784 까지 자랐다.
  eq('날것이면 아래 인셋이 폭발한다(종전)', overlayInsets({ innerHeight: H, height: 90, offsetTop: 0 }).bottom, H - 90)
  eq('관문을 지나면 직전 띠 그대로', insetsVia(90, 538, true, 0), { top: 0, bottom: H - 538 })
  eq('관문을 지나면 합도 직전 띠 기준', insetsVia(90, 538, false, 200), { top: 200, bottom: H - 538 - 200 })
  eq('첫 프레임부터 찢어졌으면 안 쓴다', insetsVia(90, 0, true, 0), null)
  // 팬 불변 — 같은 띠 안에서 팬만 달라지면 합이 상수다(인셋이 관문을 지난 뒤에도 유지).
  for (const pan of [0, 150, 336]) {
    const r = insetsVia(400, 538, false, pan)!
    eq(`관문 뒤 팬 ${pan} 의 합은 상수`, r.top + r.bottom, H - 538)
  }
}

console.log(`\n모달 기하 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
