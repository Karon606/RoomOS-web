// '입실 예약 전환' 미니폼의 '바로 예약 확정' 값 진리표(신고 507e1a0d 안 A) · 실행: npx tsx scripts/test-reserve-transition.ts
//
// 고정하는 것.
//   · 제출 값 · 체크하면 확정 시각(오늘)을 함께 싣고, 안 하면 확정 칸을 아예 안 싣는다(서버 '안 보냄 = 그대로').
//   · 화면 선검사 · 체크했는데 입주 희망일이 비면 서버와 같은 문장으로 막는다.
//   · 적용취소 값 · 전환 전 상태·입주 희망일로 한 호출에 되돌리고, 확정했으면 확정도 같은 호출에서 지운다(반쪽 없음).
//     조절 여부(moveInFlexible)도 되살린다. 기대값(expect)은 이 전환이 쓴 값이고 서버가 대조한다(§27.1 CAS, 독립 검수 B1).
//     투어 대기·투어 완료 어느 쪽에서 왔든 그 상태로 돌아가고, 조사가 맞는다.
import { reserveSubmitFields, reserveConfirmDenial, reserveUndo, reserveDoneToast } from '../lib/reserveTransition'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

eq('체크 안 함', reserveSubmitFields('2026-11-20', false, '2026-11-02'), { moveInDate: '2026-11-20' })
eq('체크 안 함은 확정 칸을 안 싣는다', 'reservationConfirmedAt' in reserveSubmitFields('2026-11-20', false, '2026-11-02'), false)
eq('체크함', reserveSubmitFields('2026-11-20', true, '2026-11-02'), { moveInDate: '2026-11-20', reservationConfirmedAt: '2026-11-02' })

eq('체크 + 날짜 없음은 막힘', reserveConfirmDenial('', true), '예약 확정에는 입주 희망일이 필요합니다.')
eq('체크 + 날짜 있음', reserveConfirmDenial('2026-11-20', true), null)
eq('체크 안 함 + 날짜 없음은 화면이 안 막는다(종전 전환 그대로)', reserveConfirmDenial('', false), null)

eq('투어 완료에서 확정까지 한 것 되돌리기', reserveUndo({ status: 'TOUR_DONE', moveInYmd: '2026-11-15', moveInFlexible: true }, { moveInYmd: '2026-11-20', confirmedYmd: '2026-11-02' }), {
  toStatus: 'TOUR_DONE',
  fields: { moveInDate: '2026-11-15', moveInFlexible: true, reservationConfirmedAt: null },
  // 확정은 리드에서 빼며 조절 여부를 접는다. 그래서 전환 뒤 기대값은 null 이다.
  expect: { status: 'RESERVED', reservationConfirmedAt: '2026-11-02', moveInDate: '2026-11-20', moveInFlexible: null },
  toast: '입실 예약 전환과 예약 확정을 적용취소했습니다 · 투어 완료로 복귀',
})
eq('투어 대기에서 전환만 한 것 되돌리기', reserveUndo({ status: 'WAITING_TOUR', moveInYmd: null, moveInFlexible: false }, { moveInYmd: '2026-11-20', confirmedYmd: null }), {
  toStatus: 'WAITING_TOUR',
  fields: { moveInDate: null, moveInFlexible: false },
  // 확정 안 한 예약은 리드라 조절 여부가 그대로다. 기대값의 확정 칸은 null(그사이 '예약 확정' 을 눌렀으면 거부).
  expect: { status: 'RESERVED', reservationConfirmedAt: null, moveInDate: '2026-11-20', moveInFlexible: false },
  toast: '입실 예약 전환을 적용취소했습니다 · 투어 대기로 복귀',
})
eq('전환만 했으면 확정 칸을 안 싣는다', 'reservationConfirmedAt' in reserveUndo({ status: 'TOUR_DONE', moveInYmd: null, moveInFlexible: null }, { moveInYmd: '2026-11-20', confirmedYmd: null }).fields, false)
eq('기대값은 늘 실린다(확정 칸 포함)', 'reservationConfirmedAt' in reserveUndo({ status: 'TOUR_DONE', moveInYmd: null, moveInFlexible: null }, { moveInYmd: '2026-11-20', confirmedYmd: null }).expect, true)
eq('희망일이 없던 계약은 희망일을 비운다', reserveUndo({ status: 'TOUR_DONE', moveInYmd: null, moveInFlexible: null }, { moveInYmd: '2026-11-20', confirmedYmd: '2026-11-02' }).fields.moveInDate, null)

eq('성공 문장 확정', reserveDoneToast(true), '입실 예약 전환 · 예약 확정 완료')
eq('성공 문장 전환만', reserveDoneToast(false), '입실 예약 전환 완료')

console.log(`[입실 예약 전환 · 바로 예약 확정] 통과 ${pass} / 실패 ${fails.length}`)
if (fails.length) { for (const f of fails) console.error('  ' + f); process.exit(1) }
