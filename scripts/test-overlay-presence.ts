// 열린 오버레이 표식 진리표 — 실행: npx tsx scripts/test-overlay-presence.ts
//
// 고정하는 것: 열 때마다 하나씩 세고 표식(data-overlay-open)에 수를 찍는다 · 닫으면 줄고 0 이면 표식을 지운다 ·
// 같은 닫기를 두 번 불러도 한 번만 준다(React 개발 모드 이중 정리) · 차례가 섞여도(먼저 연 것을 먼저 닫음) 수가 맞는다.
// 이 표식이 거짓으로 남으면 셸 화면에서 오류신고 버튼이 키보드 뒤로 숨고, 거짓으로 비면 모달 발끝 주 버튼을 덮는다.
import { overlayOpened, overlayOpenCount, OVERLAY_OPEN_ATTR } from '../lib/overlayPresence'

// 표식은 부르는 순간에만 document 를 읽으므로 가짜 루트를 먼저 세워 두면 된다.
const attrs = new Map<string, string>()
;(globalThis as unknown as { document: unknown }).document = {
  documentElement: {
    setAttribute: (k: string, v: string) => { attrs.set(k, v) },
    removeAttribute: (k: string) => { attrs.delete(k) },
  },
}


let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else { fail++; console.error(`  FAIL ${name}: ${a} != ${e}`) }
}

eq('처음엔 표식 없음', [overlayOpenCount(), attrs.get(OVERLAY_OPEN_ATTR) ?? null], [0, null])
const a = overlayOpened()
eq('하나 열림', [overlayOpenCount(), attrs.get(OVERLAY_OPEN_ATTR)], [1, '1'])
const b = overlayOpened()
eq('둘 열림(형제 시트)', [overlayOpenCount(), attrs.get(OVERLAY_OPEN_ATTR)], [2, '2'])
a()
eq('먼저 연 것을 먼저 닫음', [overlayOpenCount(), attrs.get(OVERLAY_OPEN_ATTR)], [1, '1'])
a()
eq('같은 닫기 두 번은 한 번만', [overlayOpenCount(), attrs.get(OVERLAY_OPEN_ATTR)], [1, '1'])
b()
eq('다 닫으면 표식 지움', [overlayOpenCount(), attrs.get(OVERLAY_OPEN_ATTR) ?? null], [0, null])
b()
eq('0 아래로 안 내려감', overlayOpenCount(), 0)
eq('표식 이름', OVERLAY_OPEN_ATTR, 'data-overlay-open')

console.log(`[열린 오버레이 표식] ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
