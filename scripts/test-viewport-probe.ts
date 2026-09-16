// 오류신고 계측 두 스냅샷 조립 회귀 — 실행: npx tsx scripts/test-viewport-probe.ts
//
// 여기서 고정하는 것(2026-09-17).
//   · 열었을 때 스냅샷이 없으면 종전과 **한 글자도 같은** 한 덩이다(옛 신고와 같은 눈으로 읽힌다).
//   · 둘이 같으면 한 덩이로 접는다 — 같은 일곱 줄을 두 번 읽히지 않는다.
//   · 둘이 다르면 **달라진 줄의 이름**을 짚는다. 이 한 줄이 이번 회차의 목적이다.
//     깨진 신고(bf0a6fff)와 멀쩡한 신고(be42800d)의 계측이 한 글자도 다르지 않았던 것은,
//     사진 앱 왕복이 visibilitychange 로 화면을 고쳐 놓은 뒤에야 쟀기 때문이다.
import { probeReport, probeAfterEntrance } from '../lib/viewportProbe'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; return }
  fails.push(`${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}

const SUBMIT = [
  'vv h=812 w=402 top=0 pageTop=0 scale=1',
  'inner h=812 w=402 dpr=3',
  'kbd-open=n',
  'vars kbd-inset=0px vvh=812px vv-top=0px vv-bottom=0px',
  'modal open=2 등장모션잔존=0',
  'focus BODY',
].join('\n')

// 신고 bf0a6fff 가 남겼어야 할 모습 — 열었을 때는 등장 모션이 굳어 있었다.
const OPENED_STUCK = SUBMIT.replace('등장모션잔존=0', '등장모션잔존=1')

eq('열었을 때가 없으면 제출 시점 한 덩이 그대로', probeReport(null, SUBMIT), SUBMIT)
eq('제출 계측이 비면(서버 렌더) 빈 문자열', probeReport(OPENED_STUCK, ''), '')
eq('둘이 같으면 한 덩이로 접는다', probeReport(SUBMIT, SUBMIT), `열었을 때·제출할 때 같음\n${SUBMIT}`)
eq('둘이 다르면 달라진 줄을 짚고 둘 다 편다',
  probeReport(OPENED_STUCK, SUBMIT),
  `열었을 때\n${OPENED_STUCK}\n제출할 때 (달라진 줄: modal)\n${SUBMIT}`)

// 여러 줄이 갈리면 전부 짚는다 — 키보드가 닫히며 띠가 되돌아온 경우.
const OPENED_KBD = SUBMIT
  .replace('vv h=812', 'vv h=416')
  .replace('kbd-open=n', 'kbd-open=y')
  .replace('kbd-inset=0px', 'kbd-inset=266px')
eq('달라진 줄이 여럿이면 이름을 모두 짚는다',
  probeReport(OPENED_KBD, SUBMIT).split('\n').find(l => l.startsWith('제출할 때')),
  '제출할 때 (달라진 줄: vv · kbd-open · vars)')

// 브라우저 밖에서는 아무것도 안 하고 취소 함수만 돌려준다(서버 렌더 안전).
{
  let called = false
  const cancel = probeAfterEntrance(() => { called = true })
  cancel()
  eq('브라우저 밖에서는 재지 않는다', called, false)
  eq('브라우저 밖에서도 취소 함수를 돌려준다', typeof cancel, 'function')
}

console.log(`\n[계측 두 스냅샷] 통과 ${pass}건 / 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
