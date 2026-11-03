// 열린 오버레이 표식 진리표 — 실행: npx tsx scripts/test-overlay-presence.ts
//
// 고정하는 것: 열 때마다 하나씩 세고 표식(data-overlay-open)에 수를 찍는다 · 닫으면 줄고 0 이면 표식을 지운다 ·
// 같은 닫기를 두 번 불러도 한 번만 준다(React 개발 모드 이중 정리) · 차례가 섞여도(먼저 연 것을 먼저 닫음) 수가 맞는다.
// 이 표식이 거짓으로 남으면 셸 화면에서 오류신고 버튼이 키보드 뒤로 숨고, 거짓으로 비면 모달 발끝 주 버튼을 덮는다.
import { overlayOpened, overlayOpenCount, OVERLAY_OPEN_ATTR, toastShown, toastOpenCount, TOAST_OPEN_ATTR, pillShown, pillOpenCount, PILL_OPEN_ATTR, nextCount } from '../lib/overlayPresence'

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

// 클램프 경로를 직접 시험한다(정리 순서가 어긋나도 음수로 안 내려간다).
eq('클램프 0 에서 닫힘', nextCount(0, -1), 0)
eq('클램프 1 에서 닫힘', nextCount(1, -1), 0)
eq('열림', nextCount(2, 1), 3)

// 토스트 표식은 오버레이와 따로 센다(같은 수를 쓰면 토스트만 떠도 신고 버튼이 셸 키보드 자리에서 내려간다).
const t = toastShown()
eq('토스트 표식', [toastOpenCount(), attrs.get(TOAST_OPEN_ATTR), overlayOpenCount(), attrs.get(OVERLAY_OPEN_ATTR) ?? null], [1, '1', 0, null])
const o = overlayOpened()
eq('오버레이와 토스트 함께', [attrs.get(OVERLAY_OPEN_ATTR), attrs.get(TOAST_OPEN_ATTR)], ['1', '1'])
t(); t()
eq('토스트 내림(두 번 불러도 한 번)', [toastOpenCount(), attrs.get(TOAST_OPEN_ATTR) ?? null, attrs.get(OVERLAY_OPEN_ATTR)], [0, null, '1'])
o()
eq('토스트 표식 이름', TOAST_OPEN_ATTR, 'data-toast-open')

// 알약 표식도 따로 센다(모달 안 알약 둘이 겹쳐 서는 경우 포함). 셸 알약은 표식을 열지 않는다(SelectionPillBar aboveModal 조건, 그물이 지킨다).
const p1 = pillShown(), p2 = pillShown()
eq('알약 둘', [pillOpenCount(), attrs.get(PILL_OPEN_ATTR), attrs.get(TOAST_OPEN_ATTR) ?? null], [2, '2', null])
p1(); p2()
eq('알약 다 내림', [pillOpenCount(), attrs.get(PILL_OPEN_ATTR) ?? null], [0, null])
eq('알약 표식 이름', PILL_OPEN_ATTR, 'data-pill-open')

console.log(`[열린 오버레이 표식] ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
