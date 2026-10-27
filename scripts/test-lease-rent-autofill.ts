// 입주자 폼 월 이용료 자동 채움·안내 진리표. 실행: npx tsx scripts/test-lease-rent-autofill.ts
//
// 여기서 고정하는 것(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건).
//   · 저장된 금액이 있는 수정 폼은 호실·상태를 바꿔도 값을 덮지 않는다(418호 비거주 15만 원을 602호로 옮겨도 15만 원).
//   · 비거주 이용료가 빈 방은 어느 경우에도 기본 이용료로 대체하지 않는다(새 계약도).
//   · 자동 채움은 새 계약과 빈 칸에만 한다. 호실을 비우면 자동으로 채웠던 값만 비운다(오류신고 d3bd5717).
//   · 칸 아래 문장은 승인 계획 문장 그대로다(호실·금액은 실제 값).
import { nextRentOnChange, rentFieldCaption, roomStdRent, savedLeaseRent, nrRentEqualsBaseNotice, type RentRoom } from '../lib/leaseRentAutofill'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const R418: RentRoom = { id: 'r418', roomNo: '418', baseRent: 500000, nonResidentRent: 150000 }
const R602: RentRoom = { id: 'r602', roomNo: '602', baseRent: 30000, nonResidentRent: null }
const R602b: RentRoom = { ...R602, nonResidentRent: 150000 }
const R510: RentRoom = { id: 'r510', roomNo: '510', baseRent: 500000, nonResidentRent: null }

// ── 기준가 ───────────────────────────────────────────────────────────
eq('거주 기준가 = 기본 이용료', roomStdRent(R418, false), 500000)
eq('비거주 기준가 = 비거주 이용료', roomStdRent(R418, true), 150000)
eq('비거주 이용료 없는 방은 기준가 없음(기본 이용료로 대체 안 함)', roomStdRent(R602, true), null)

// ── 저장된 금액 ──────────────────────────────────────────────────────
eq('수정 폼 + 금액 = 저장값', savedLeaseRent({ id: 'L', rentAmount: 150000 }), 150000)
eq('새 계약 = 저장값 없음', savedLeaseRent({ rentAmount: 150000 }), null)
eq('수정 폼 + 0원 = 빈 칸으로 본다', savedLeaseRent({ id: 'L', rentAmount: 0 }), null)
eq('계약 없음', savedLeaseRent(null), null)

// ── 호실·상태를 바꿀 때 칸 값 ──────────────────────────────────────────
// 사건: 비거주 15만 원(418호)을 602호(비거주 이용료 없음)로
eq('사건: 저장된 비거주 15만 원을 비거주 이용료 없는 방으로 옮겨도 그대로', nextRentOnChange({ saved: 150000, current: 150000, room: R602, isNR: true }), { kind: 'keep' })
eq('저장된 거주 협의가 45만 원을 기본 50만 원 방으로 옮겨도 그대로', nextRentOnChange({ saved: 450000, current: 450000, room: R510, isNR: false }), { kind: 'keep' })
eq('저장된 금액 + 비거주로 상태만 바꿔도 그대로', nextRentOnChange({ saved: 500000, current: 500000, room: R418, isNR: true }), { kind: 'keep' })
eq('새 계약 빈 칸 + 방 고름 = 기본 이용료', nextRentOnChange({ saved: null, current: undefined, room: R510, isNR: false }), { kind: 'set', value: 500000 })
eq('새 계약 + 비거주 = 비거주 이용료', nextRentOnChange({ saved: null, current: 500000, room: R418, isNR: true }), { kind: 'set', value: 150000 })
eq('새 계약 + 비거주 + 비거주 이용료 없는 방 = 그대로(기본 이용료 대체 금지)', nextRentOnChange({ saved: null, current: 150000, room: R602, isNR: true }), { kind: 'keep' })
eq('새 계약 빈 칸 + 비거주 이용료 없는 방 = 빈 칸 그대로', nextRentOnChange({ saved: null, current: undefined, room: R602, isNR: true }), { kind: 'keep' })
// 독립 검수 B2: 등록 폼에서 거주로 602호를 골라 3만 원이 채워진 뒤 비거주로 바꾸면 그 3만 원이 비거주 금액으로 남았다.
eq('B2 거주로 채운 3만 원(자동)을 비거주로 바꾸면 비운다', nextRentOnChange({ saved: null, current: 30000, room: R602, isNR: true, autoFilled: 30000 }), { kind: 'set', value: undefined })
eq('B2 손으로 적은 값은 비거주로 바꿔도 그대로', nextRentOnChange({ saved: null, current: 150000, room: R602, isNR: true, autoFilled: 30000 }), { kind: 'keep' })
eq('B2 저장된 금액이면 자동값과 같아도 그대로', nextRentOnChange({ saved: 30000, current: 30000, room: R602, isNR: true, autoFilled: 30000 }), { kind: 'keep' })
eq('수정 폼인데 칸을 비웠으면 = 빈 칸이라 채운다', nextRentOnChange({ saved: 150000, current: undefined, room: R510, isNR: false }), { kind: 'set', value: 500000 })
eq('수정 폼인데 칸이 0 = 빈 칸이라 채운다', nextRentOnChange({ saved: 150000, current: 0, room: R418, isNR: true }), { kind: 'set', value: 150000 })
eq('새 계약 호실 비움 = 칸도 비움(d3bd5717)', nextRentOnChange({ saved: null, current: 500000, room: null, isNR: false }), { kind: 'set', value: undefined })
eq('저장된 금액 호실 비움 = 그대로', nextRentOnChange({ saved: 150000, current: 150000, room: null, isNR: true }), { kind: 'keep' })

// ── 칸 아래 한 줄(승인 계획 문장) ──────────────────────────────────────
const saved418 = { roomNo: '418', rent: 150000 }
eq('비거주 빈 방(값 있음)', rentFieldCaption({ saved: saved418, current: 150000, room: R602, isNR: true, changed: true, swap: null }),
  { kind: 'nr-missing', text: '602호에 비거주 이용료가 없어 지금 금액 150,000원을 그대로 둡니다 · 호실 관리에서 정하면 됩니다' })
eq('비거주 빈 방(빈 칸)', rentFieldCaption({ saved: null, current: undefined, room: R602, isNR: true, changed: false, swap: null })?.text,
  '602호에 비거주 이용료가 없어 칸을 비워 둡니다 · 호실 관리에서 정하면 됩니다')
eq('기준가 있음: 그대로 + 바꾸기', rentFieldCaption({ saved: saved418, current: 150000, room: { ...R602, nonResidentRent: 30000 }, isNR: true, changed: true, swap: null }),
  { kind: 'keep', text: '418호 150,000원 그대로입니다', actionLabel: '602호 기준 30,000원으로 바꾸기', value: 30000 })
eq('거주 협의가: 그대로 + 바꾸기', rentFieldCaption({ saved: { roomNo: '418', rent: 450000 }, current: 450000, room: R510, isNR: false, changed: true, swap: null }),
  { kind: 'keep', text: '418호 450,000원 그대로입니다', actionLabel: '510호 기준 500,000원으로 바꾸기', value: 500000 })
eq('바꾼 직후: 바꿨습니다 + 되살리기', rentFieldCaption({ saved: saved418, current: 30000, room: { ...R602, nonResidentRent: 30000 }, isNR: true, changed: true, swap: { from: 150000, to: 30000, roomId: 'r602', isNR: true } }),
  { kind: 'swapped', text: '602호 기준 30,000원으로 바꿨습니다', actionLabel: '150,000원 되살리기', value: 150000 })
eq('바꾼 뒤 손으로 고치면 되살리기 줄이 사라지고 그대로 줄로', rentFieldCaption({ saved: saved418, current: 40000, room: { ...R602, nonResidentRent: 30000 }, isNR: true, changed: true, swap: { from: 150000, to: 30000, roomId: 'r602', isNR: true } }),
  { kind: 'keep', text: '지금 금액 40,000원 그대로입니다', actionLabel: '602호 기준 30,000원으로 바꾸기', value: 30000 })
eq('바꾼 뒤 다른 방으로 가면 바꿨습니다 줄은 안 뜬다', rentFieldCaption({ saved: saved418, current: 30000, room: R510, isNR: false, changed: true, swap: { from: 150000, to: 30000, roomId: 'r602', isNR: true } })?.kind, 'keep')
eq('아무것도 안 바꿨으면 줄 없음(협의가여도)', rentFieldCaption({ saved: { roomNo: '510', rent: 450000 }, current: 450000, room: R510, isNR: false, changed: false, swap: null }), null)
eq('기준가와 같으면 줄 없음', rentFieldCaption({ saved: { roomNo: '418', rent: 500000 }, current: 500000, room: R510, isNR: false, changed: true, swap: null }), null)
eq('새 계약은 그대로 줄 없음(채움이 정답)', rentFieldCaption({ saved: null, current: 450000, room: R510, isNR: false, changed: true, swap: null }), null)
eq('호실 없음 = 줄 없음', rentFieldCaption({ saved: saved418, current: 150000, room: null, isNR: true, changed: true, swap: null }), null)
eq('602호에 비거주 15만 원을 정한 뒤엔 같은 금액이라 줄 없음', rentFieldCaption({ saved: saved418, current: 150000, room: R602b, isNR: true, changed: true, swap: null }), null)

// ── 저장 안내(거부 아님) ─────────────────────────────────────────────
eq('비거주 + 비거주 이용료 없음 + 기본 이용료와 같음 = 안내', nrRentEqualsBaseNotice({ status: 'NON_RESIDENT', isShortTerm: false, rentAmount: 30000, room: R602 }),
  '602호에 비거주 이용료가 없어 이 계약 이용료 30,000원이 기본 이용료와 같습니다. 비거주 금액이 맞는지 확인해 주세요.')
eq('비거주 15만 원 그대로 저장 = 안내 없음', nrRentEqualsBaseNotice({ status: 'NON_RESIDENT', isShortTerm: false, rentAmount: 150000, room: R602 }), null)
eq('비거주 이용료가 있는 방 = 안내 없음', nrRentEqualsBaseNotice({ status: 'NON_RESIDENT', isShortTerm: false, rentAmount: 500000, room: R418 }), null)
eq('거주 계약 = 안내 없음', nrRentEqualsBaseNotice({ status: 'ACTIVE', isShortTerm: false, rentAmount: 30000, room: R602 }), null)
eq('단기 = 안내 없음', nrRentEqualsBaseNotice({ status: 'NON_RESIDENT', isShortTerm: true, rentAmount: 30000, room: R602 }), null)

// 문장 규칙: em dash·화살표·느낌표 없음, 콜론으로 끝나지 않음
{
  const all = [
    rentFieldCaption({ saved: saved418, current: 150000, room: R602, isNR: true, changed: true, swap: null })?.text,
    nrRentEqualsBaseNotice({ status: 'NON_RESIDENT', isShortTerm: false, rentAmount: 30000, room: R602 }),
  ].join('\n')
  eq('문장에 em dash·화살표·느낌표 없음', /[—→!]/.test(all), false)
}

if (fails.length) {
  console.log(`[월 이용료 자동 채움 진리표] 통과 ${pass} / 실패 ${fails.length}`)
  for (const f of fails) console.log('  ' + f)
  process.exit(1)
}
console.log(`[월 이용료 자동 채움 진리표] 통과 ${pass} / 실패 0`)
