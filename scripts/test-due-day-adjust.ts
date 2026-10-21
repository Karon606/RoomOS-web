// 납입일 변경 조정 행 판정·메모·수정 진리표. DB 불필요, lib/dueDayAdjust 순수 함수 고정. 실행: npx tsx scripts/test-due-day-adjust.ts
//
// 왜 필요한가(신고 df82ce57, 2026-10-20). 513호 추가납부 조정 행 −128,333 을 운영자가 −130,000 으로 고치려다
// 금액 칸이 부호를 지워 +130,000 이 됐다. 같은 사고가 504호(10-05)에도 있었다. 조정 행은 부호가 뜻이고
// 메모 앞머리가 기계 키라, 그 둘을 지키는 판정을 여기서 글자까지 못박는다.
import {
  DUE_DAY_ADJUST_PREFIX, isDueDayAdjust, dueDayBeforeChange, parseDueDayAdjustMemo, buildDueDayAdjustMemo,
  dueDayAdjustLabel, dueDayAdjustDisplayLabel, dueDayAdjustKindOf, planDueDayAdjustEdit, planDueDayAdjustCreate, paymentEditGuard,
  dueDayAdjustSignMismatch, dueDayAdjustWhere, notDueDayAdjustWhere, paymentMemoGuard,
  DUE_DAY_ADJUST_NOT_ADJUST, DUE_DAY_ADJUST_UNREADABLE, DUE_DAY_ADJUST_AMOUNT_INVALID, DUE_DAY_ADJUST_NOTE_INVALID,
  DUE_DAY_ADJUST_EDIT_ELSEWHERE, PAYMENT_PREFIX_RESERVED, PAYMENT_NEGATIVE_REFUSED, dueDayAdjustOverCap,
  dueDayAdjustsFrom, withDueDayAdjusts, type BillingDueDayAdjust,
  dueDayAdjustDisplayMemo, dueDayAdjustMonthStatus, dueDayAdjustMonthSums, dueDayAdjustStatusChip,
} from '../lib/dueDayAdjust'
import { billForLeaseMonth, firstMonthRule, firstMonthRuleDueDay, firstMonthAdjustExposure, type BillingLeaseFields } from '../lib/billing'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fails.push(`${name}\n    기대 ${w}\n    실제 ${g}`)
}

// 운영 DB 에 있는 조정 메모 셋(2026-10-20 읽기 실측). 빌더가 같은 글자를 내야 한다.
const M513 = '[납입일변경] 9일→20 변경, 일할 128,333원 (추가납부)'
const M418 = '[납입일변경] 2일→8 변경, 일할 80,000원 (추가납부)'
const M504 = '[납입일변경] 1일→6 변경, 일할 78,333원 (추가납부)'

// ── 판정 ─────────────────────────────────────────────────────────────
eq('조정 메모는 조정 행', isDueDayAdjust(M513), true)
eq('null 은 아님', isDueDayAdjust(null), false)
eq('빈 문자열은 아님', isDueDayAdjust(''), false)
eq('일반 메모는 아님', isDueDayAdjust('2026년 9월분 채우고 남은 금액'), false)
eq('앞머리가 중간에 있으면 아님(앞머리만 기계 키)', isDueDayAdjust('메모 [납입일변경] 9일→20'), false)
eq('Prisma 조각: 조정 행만', dueDayAdjustWhere(), { memo: { startsWith: DUE_DAY_ADJUST_PREFIX } })
eq('Prisma 조각: 조정 행 빼기는 null 메모를 살린다', notDueDayAdjustWhere(), { AND: [{ OR: [{ memo: null }, { NOT: { memo: { startsWith: DUE_DAY_ADJUST_PREFIX } } }] }] })

// ── 변경 전 납부일 복원(종전 정규식 네 사본과 같은 결과) ──────────────
eq('9일→20 의 전 값 9', dueDayBeforeChange(M513), 9)
eq('2일→8 의 전 값 2', dueDayBeforeChange(M418), 2)
eq('협의 조각이 붙어도 9', dueDayBeforeChange('[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)'), 9)
eq("전 값 '?' 는 못 읽음", dueDayBeforeChange('[납입일변경] ?일→20 변경, 일할 1원 (추가납부)'), null)
eq("전 값 '말일' 은 종전처럼 못 읽음(말일일→)", dueDayBeforeChange('[납입일변경] 말일일→20 변경, 일할 1원 (추가납부)'), null)
eq('조정 행이 아니면 null', dueDayBeforeChange('9일→20'), null)
eq('null 이면 null', dueDayBeforeChange(null), null)

// ── 메모 빌더·파서 ───────────────────────────────────────────────────
eq('513 메모 글자 동일', buildDueDayAdjustMemo({ from: '9', to: '20', ruleAmount: 128333, agreedAmount: null, kind: 'extra', note: '' }), M513)
eq('418 메모 글자 동일', buildDueDayAdjustMemo({ from: '2', to: '8', ruleAmount: 80000, agreedAmount: null, kind: 'extra', note: '' }), M418)
eq('504 메모 글자 동일', buildDueDayAdjustMemo({ from: '1', to: '6', ruleAmount: 78333, agreedAmount: null, kind: 'extra', note: '' }), M504)
eq('협의값 = 규칙값이면 협의 조각 없음', buildDueDayAdjustMemo({ from: '9', to: '20', ruleAmount: 128333, agreedAmount: 128333, kind: 'extra', note: '' }), M513)
eq('협의값 다르면 둘 다 남음', buildDueDayAdjustMemo({ from: '9', to: '20', ruleAmount: 128333, agreedAmount: 130000, kind: 'extra', note: '' }), '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)')
eq('과입금·설명', buildDueDayAdjustMemo({ from: '15', to: '5', ruleAmount: 100000, agreedAmount: null, kind: 'refund', note: '현금 정산' }), '[납입일변경] 15일→5 변경, 일할 100,000원 (과입금) 현금 정산')
eq('파서: 513', parseDueDayAdjustMemo(M513), { from: '9', to: '20', ruleAmount: 128333, agreedAmount: null, kind: 'extra', note: '' })
eq('파서: 협의·설명', parseDueDayAdjustMemo('[납입일변경] 말일일→20 변경, 일할 128,333원, 협의 130,000원 (과입금) 원단위 절삭'),
  { from: '말일', to: '20', ruleAmount: 128333, agreedAmount: 130000, kind: 'refund', note: '원단위 절삭' })
eq('파서: 손으로 고친 옛 모양은 null', parseDueDayAdjustMemo('[납입일변경] 13만원으로 협의'), null)
eq('파서: 일반 메모 null', parseDueDayAdjustMemo('보증금'), null)
eq('라벨: 기계 키 뺀 앞부분', dueDayAdjustLabel(M513), '9일→20 변경, 일할 128,333원 (추가납부)')
eq('표시: 방향 조각을 뗀다', dueDayAdjustDisplayLabel('[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부) 원단위 절삭'), '9일→20 변경, 일할 128,333원, 협의 130,000원 원단위 절삭')
eq('표시: 과입금 조각도 뗀다', dueDayAdjustDisplayLabel('[납입일변경] 15일→5 변경, 일할 100,000원 (과입금)'), '15일→5 변경, 일할 100,000원')
eq('방향: 음수는 추가로 받을 금액', dueDayAdjustKindOf(-1), 'extra')
eq('방향: 양수는 돌려줄 금액', dueDayAdjustKindOf(1), 'refund')
eq('방향: 0 은 없음', dueDayAdjustKindOf(0), null)

// ── 조정 행 수정(신고 진리표) ────────────────────────────────────────
const cur513 = { memo: M513 }
eq('추가로 받을 금액 130000 입력은 −130,000 저장 + 메모에 규칙·협의 둘 다',
  planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 130000, note: '' }, 350000),
  { ok: true, actualAmount: -130000, memo: '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)' })
eq('돌려줄 금액 130000 입력은 +130,000 저장 + 메모 방향도 과입금',
  planDueDayAdjustEdit(cur513, { direction: 'refund', amount: 130000, note: '' }, 350000),
  { ok: true, actualAmount: 130000, memo: '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (과입금)' })
eq('규칙값 그대로면 메모가 원래 글자로 돌아감',
  planDueDayAdjustEdit({ memo: '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)' }, { direction: 'extra', amount: 128333, note: '' }, 350000),
  { ok: true, actualAmount: -128333, memo: M513 })
eq('설명은 뒤에만 붙고 앞머리는 그대로',
  planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 130000, note: '  원단위\n절삭  ' }, 350000),
  { ok: true, actualAmount: -130000, memo: '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부) 원단위 절삭' })
eq('설명에 기계 키를 넣으면 거절', planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 1, note: '[납입일변경] 1일→2' }, 350000), { ok: false, error: DUE_DAY_ADJUST_NOTE_INVALID })
eq('설명 101자는 거절', planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 1, note: 'ㄱ'.repeat(101) }, 350000), { ok: false, error: DUE_DAY_ADJUST_NOTE_INVALID })
eq('0원 거절', planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 0, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID })
eq('음수 금액 칸 거절(방향은 세그먼트가 정한다)', planDueDayAdjustEdit(cur513, { direction: 'extra', amount: -130000, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID })
eq('소수 거절', planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 1.5, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID })
eq('방향 이상값 거절', planDueDayAdjustEdit(cur513, { direction: 'minus' as 'extra', amount: 1, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID })
eq('자릿수 실수(1,300,000) 거절', planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 1300000, note: '' }, 350000), { ok: false, error: dueDayAdjustOverCap(350000) })
eq('상한 경계 350,000 은 통과', planDueDayAdjustEdit(cur513, { direction: 'extra', amount: 350000, note: '' }, 350000).ok, true)
eq('일반 행은 이 문으로 못 고침', planDueDayAdjustEdit({ memo: '보증금' }, { direction: 'extra', amount: 1, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_NOT_ADJUST })
eq('보증금 행 거절', planDueDayAdjustEdit({ memo: M513, isDeposit: true }, { direction: 'extra', amount: 1, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_NOT_ADJUST })
eq('조정 전표 거절', planDueDayAdjustEdit({ memo: M513, isBillingAdjust: true }, { direction: 'extra', amount: 1, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_NOT_ADJUST })
eq('읽을 수 없는 메모는 거절', planDueDayAdjustEdit({ memo: '[납입일변경] 13만원으로 협의' }, { direction: 'extra', amount: 1, note: '' }, 350000), { ok: false, error: DUE_DAY_ADJUST_UNREADABLE })

// ── 납입일 변경이 만들 조정 행(협의 금액 칸, 승인 범위 C) ─────────────
eq('협의 없음: 메모·금액이 종전과 같다',
  planDueDayAdjustCreate({ fromDue: '9', toDue: '20', adjustAmount: -128333, rentAmount: 350000 }),
  { ok: true, actualAmount: -128333, memo: M513, isPaid: false })
eq('협의 130,000: 방향은 규칙대로 음수, 메모에 둘 다',
  planDueDayAdjustCreate({ fromDue: '9', toDue: '20', adjustAmount: -128333, agreedAmount: 130000, rentAmount: 350000 }),
  { ok: true, actualAmount: -130000, memo: '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)', isPaid: false })
eq('과입금 규칙 + 원단위 절삭 협의 99,990: 양수·완납',
  planDueDayAdjustCreate({ fromDue: '15', toDue: '5', adjustAmount: 100000, agreedAmount: 99990, rentAmount: 300000 }),
  { ok: true, actualAmount: 99990, memo: '[납입일변경] 15일→5 변경, 일할 100,000원, 협의 99,990원 (과입금)', isPaid: true })
eq('협의값 = 규칙값이면 협의 조각 없음', planDueDayAdjustCreate({ fromDue: '9', toDue: '20', adjustAmount: -128333, agreedAmount: 128333, rentAmount: 350000 }).ok && (planDueDayAdjustCreate({ fromDue: '9', toDue: '20', adjustAmount: -128333, agreedAmount: 128333, rentAmount: 350000 }) as { memo: string }).memo, M513)
eq('전 납부일 없음은 ?', (planDueDayAdjustCreate({ fromDue: null, toDue: '20', adjustAmount: -1, rentAmount: 1 }) as { memo: string }).memo, '[납입일변경] ?일→20 변경, 일할 1원 (추가납부)')
eq('협의 0 거절', planDueDayAdjustCreate({ fromDue: '9', toDue: '20', adjustAmount: -128333, agreedAmount: 0, rentAmount: 350000 }), { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID })
eq('협의 음수 거절', planDueDayAdjustCreate({ fromDue: '9', toDue: '20', adjustAmount: -128333, agreedAmount: -130000, rentAmount: 350000 }), { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID })
eq('협의 자릿수 실수 거절', planDueDayAdjustCreate({ fromDue: '9', toDue: '20', adjustAmount: -128333, agreedAmount: 1300000, rentAmount: 350000 }), { ok: false, error: dueDayAdjustOverCap(350000) })

// ── 일반 수정 문(updatePayment) 거절 ─────────────────────────────────
eq('조정 행은 전용 문으로(부호 뒤집기 포함 전부)', paymentEditGuard({ currentMemo: M513, nextMemo: M513, nextAmount: 130000 }), DUE_DAY_ADJUST_EDIT_ELSEWHERE)
eq('조정 행 메모 앞머리 지우기도 전용 문으로', paymentEditGuard({ currentMemo: M513, nextMemo: '13만원 협의', nextAmount: 130000 }), DUE_DAY_ADJUST_EDIT_ELSEWHERE)
eq('일반 행 음수 거절', paymentEditGuard({ currentMemo: null, nextMemo: undefined, nextAmount: -130000 }), PAYMENT_NEGATIVE_REFUSED)
eq('일반 행에 기계 키 메모 거절(조정 행 위조 차단)', paymentEditGuard({ currentMemo: null, nextMemo: M513, nextAmount: 1 }), PAYMENT_PREFIX_RESERVED)
eq('일반 행 메모 중간의 기계 키도 거절(앞머리 판정과 contains 가 같게)', paymentEditGuard({ currentMemo: null, nextMemo: '메모 [납입일변경]', nextAmount: 1 }), PAYMENT_PREFIX_RESERVED)
eq('일반 행 0원은 통과', paymentEditGuard({ currentMemo: null, nextMemo: undefined, nextAmount: 0 }), null)
eq('일반 행 양수 통과', paymentEditGuard({ currentMemo: '보증금', nextMemo: '보증금', nextAmount: 50000 }), null)

// ── 수납 생성 문 메모 검사 ──────────────────────────────────────────
eq('수납 등록 메모 앞머리 기계 키 거절', paymentMemoGuard('[납입일변경] 9일→20 변경, 일할 1원 (추가납부)'), PAYMENT_PREFIX_RESERVED)
eq('수납 등록 메모 중간 기계 키도 거절', paymentMemoGuard('현금 [납입일변경]'), PAYMENT_PREFIX_RESERVED)
eq('일반 메모 통과', paymentMemoGuard('2026년 10월분 채우고 남은 금액'), null)
eq('빈 메모 통과', paymentMemoGuard(undefined), null)

// ── 감사 축: 메모 방향과 부호 ────────────────────────────────────────
eq('513 지금 상태(+130,000 추가납부)는 불일치', dueDayAdjustSignMismatch({ memo: M513, actualAmount: 130000 }), '메모는 추가납부인데 금액이 +130,000원입니다')
eq('정상 추가납부는 일치', dueDayAdjustSignMismatch({ memo: M418, actualAmount: -80000 }), null)
eq('과입금 음수는 불일치', dueDayAdjustSignMismatch({ memo: '[납입일변경] 15일→5 변경, 일할 100,000원 (과입금)', actualAmount: -100000 }), '메모는 과입금인데 금액이 −100,000원입니다')
eq('과입금 양수는 일치', dueDayAdjustSignMismatch({ memo: '[납입일변경] 15일→5 변경, 일할 100,000원 (과입금)', actualAmount: 100000 }), null)
eq('추가납부 0원은 불일치', dueDayAdjustSignMismatch({ memo: M513, actualAmount: 0 }), '메모는 추가납부인데 금액이 0원입니다')
eq('일반 행은 판정 안 함', dueDayAdjustSignMismatch({ memo: '보증금', actualAmount: -1 }), null)
eq('방향 글자 없는 조정 메모는 판정 안 함', dueDayAdjustSignMismatch({ memo: '[납입일변경] 13만원', actualAmount: 130000 }), null)

// ── 입주달 이중 셈 봉합(운영자 승인 2026-10-20 방안 2) ─────────────────
// 입주달에 납입일을 바꾸면 첫 달 규칙(firstMonthGap)이 바꾼 뒤 납부일로 앞 구간을 다시 재 조정 행과 같은 날수를 두 번 셌다.
// 엔진은 조건이 셋 다 참일 때만 바꾸기 전 납부일로 잰다(lib/billing firstMonthRuleDueDay 주석의 진리표).
{
  const adj = (targetMonth: string, memo: string, seqNo = 2): BillingDueDayAdjust => ({ targetMonth, memo, seqNo })
  const lease = (o: Partial<BillingLeaseFields> = {}): BillingLeaseFields => ({
    rentAmount: 350000, status: 'ACTIVE', dueDay: '20', moveInDate: '2026-10-09', isShortTerm: false, dueDayAdjusts: [], ...o,
  })
  const M513_AGREED = '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)'
  const R513 = adj('2026-10', M513)

  // 1. 입주달 변경 + 락 없음. 종전 478,333 이 350,000 으로(조정 행이 11일치를 센다).
  eq('봉합 1 입주달 변경·락 없음: 만월만', billForLeaseMonth(lease({ dueDayAdjusts: [R513] }), '2026-10', null), 350000)
  eq('봉합 1 대조 조정 행 없으면 종전(첫 달 규칙 그대로)', billForLeaseMonth(lease(), '2026-10', null), 478333)
  // 2. 락이 있으면 락이 이긴다(513 운영 지금 상태, 결과 불변).
  eq('봉합 2 락 350,000', billForLeaseMonth(lease({ dueDayAdjusts: [R513] }), '2026-10', 350000), 350000)
  eq('봉합 2 락 478,333 도 그대로(락은 손대지 않는다)', billForLeaseMonth(lease({ dueDayAdjusts: [R513] }), '2026-10', 478333), 478333)
  // 3. 입주달이 아닌 달의 조정 행은 보지 않는다(종전).
  eq('봉합 3 다른 달 조정 행: 입주달 종전', billForLeaseMonth(lease({ dueDayAdjusts: [adj('2026-11', M513)] }), '2026-10', null), 478333)
  eq('봉합 3 다른 달 조정 행: 그 달은 만월', billForLeaseMonth(lease({ dueDayAdjusts: [adj('2026-11', M513)] }), '2026-11', null), 350000)
  // 4. 돌려줄 금액 방향(25일 입주, 25일에서 5일). 종전 일할 11일치만 128,333 위에 돌려줄 233,333 이 또 붙었다.
  const back = lease({ moveInDate: '2026-10-25', dueDay: '5' })
  eq('봉합 4 과입금 방향: 만월(돌려줄 금액이 그 몫을 센다)', billForLeaseMonth({ ...back, dueDayAdjusts: [adj('2026-10', '[납입일변경] 25일→5 변경, 일할 233,333원 (과입금)')] }, '2026-10', null), 350000)
  eq('봉합 4 대조 종전', billForLeaseMonth(back, '2026-10', null), 128333)
  // 5. 조정 행을 지우면(소프트삭제) 첫 달 규칙이 그 기간의 원천으로 돌아온다.
  eq('봉합 5 소프트삭제 행은 고르지 않는다', dueDayAdjustsFrom([{ ...R513, deletedAt: new Date() }]), [])
  eq('봉합 5 지운 뒤 종전', billForLeaseMonth(lease({ dueDayAdjusts: dueDayAdjustsFrom([{ ...R513, deletedAt: new Date() }]) }), '2026-10', null), 478333)
  // 6. 협의 금액 행도 같은 기간이다(금액만 다르다).
  eq('봉합 6 협의 금액 행', billForLeaseMonth(lease({ dueDayAdjusts: [adj('2026-10', M513_AGREED)] }), '2026-10', null), 350000)
  // 7. 바꾸기 전에도 첫 달 규칙이 돌던 계약(5일 입주, 20일에서 25일). 바꾸기 전 앞 구간 15일은 남고 바꿈 5일만 조정 행이 센다.
  const pre = lease({ moveInDate: '2026-10-05', dueDay: '25' })
  eq('봉합 7 앞 구간 일부만 조정 행', billForLeaseMonth({ ...pre, dueDayAdjusts: [adj('2026-10', '[납입일변경] 20일→25 변경, 일할 58,333원 (추가납부)')] }, '2026-10', null), 350000 + 175000)
  eq('봉합 7 대조 종전(20일치 전부)', billForLeaseMonth(pre, '2026-10', null), 350000 + 233333)
  // 8. 두 번 바꿈(9→20, 20→25)이 이어지면 첫 행의 바꾸기 전 납부일.
  const chain = [adj('2026-10', M513, 2), adj('2026-10', '[납입일변경] 20일→25 변경, 일할 58,333원 (추가납부)', 3)]
  eq('봉합 8 이어진 사슬', billForLeaseMonth(lease({ dueDay: '25', dueDayAdjusts: chain }), '2026-10', null), 350000)
  eq('봉합 8 seqNo 순으로 읽는다(배열 순서 무관)', billForLeaseMonth(lease({ dueDay: '25', dueDayAdjusts: [...chain].reverse() }), '2026-10', null), 350000)
  // 9. 사슬 끝이 지금 납부일과 다르면(그 뒤 입주자 수정 폼으로 또 바꿈) 같은 날수가 아니다. 종전.
  eq('봉합 9 사슬 끝 불일치: 종전', billForLeaseMonth(lease({ dueDay: '25', dueDayAdjusts: [R513] }), '2026-10', null), 350000 + 186666)
  // 10. 사슬이 끊기면 종전.
  eq('봉합 10 사슬 끊김: 종전', billForLeaseMonth(lease({ dueDay: '25', dueDayAdjusts: [R513, adj('2026-10', '[납입일변경] 15일→25 변경, 일할 116,666원 (추가납부)', 3)] }), '2026-10', null), 350000 + 186666)
  // 11. 메모를 못 읽으면 종전.
  eq('봉합 11 못 읽는 메모: 종전', billForLeaseMonth(lease({ dueDayAdjusts: [adj('2026-10', '[납입일변경] 13만원')] }), '2026-10', null), 478333)
  // 12. 바꾸기 전 납부일이 없던 계약('?')은 규칙 무발동.
  eq('봉합 12 바꾸기 전 납부일 없음', firstMonthRuleDueDay(lease({ dueDayAdjusts: [adj('2026-10', '[납입일변경] ?일→20 변경, 일할 1원 (추가납부)')] })), null)
  eq('봉합 12 청구는 만월', billForLeaseMonth(lease({ dueDayAdjusts: [adj('2026-10', '[납입일변경] ?일→20 변경, 일할 1원 (추가납부)')] }), '2026-10', null), 350000)
  // 13. '말일' 에서 바꾼 메모('말일일→')도 읽는다. 9/30 입주는 말일과 같은 날이라 무발동.
  const eom = lease({ moveInDate: '2026-09-30', dueDay: '10' })
  eq('봉합 13 말일에서 바꿈', billForLeaseMonth({ ...eom, dueDayAdjusts: [adj('2026-09', '[납입일변경] 말일일→10 변경, 일할 116,666원 (과입금)')] }, '2026-09', null), 350000)
  eq('봉합 13 대조 종전', billForLeaseMonth(eom, '2026-09', null), 116666)
  // 14. 단기는 첫 달 규칙 밖(종전).
  eq('봉합 14 단기 무관', billForLeaseMonth(lease({ isShortTerm: true, dueDayAdjusts: [R513] }), '2026-10', null), 350000)
  // 15. 판정 함수. 조정 행 없으면 지금 납부일.
  eq('봉합 15 조정 행 없으면 지금 납부일', firstMonthRuleDueDay(lease()), '20')
  eq('봉합 15 입주달 조정 행이면 바꾸기 전', firstMonthRuleDueDay(lease({ dueDayAdjusts: [R513] })), '9')
  // 16. 513 재현. 10월 수납을 지우고 다시 등록하면 엔진이 청구를 세우고(savePayment 의 락), 조정 행이 더해진다.
  const bill = billForLeaseMonth(lease({ dueDayAdjusts: [adj('2026-10', M513_AGREED)] }), '2026-10', null)
  eq('봉합 16 513 재등록 청구(락으로 박힐 값)', bill, 350000)
  eq('봉합 16 513 받을 돈 = 청구 + 추가로 받을 금액', bill - (-130000), 480000)
  eq('봉합 16 480,000 을 받으면 미납 0', bill - (480000 + -130000), 0)
  // 17. 지도에 없는 계약은 빈 배열.
  eq('봉합 17 withDueDayAdjusts 기본값', withDueDayAdjusts([{ id: 'a' }], new Map([['b', [R513]]])), [{ id: 'a', dueDayAdjusts: [] }])
  // 18. 입력 누락은 실행 중에도 멈춘다(scripts 는 tsc 밖이라 필수 칸이 안 걸린다).
  const noAdj = { rentAmount: 350000, status: 'ACTIVE', dueDay: '20', moveInDate: '2026-10-09' } as unknown as BillingLeaseFields
  let thrown = ''
  try { billForLeaseMonth(noAdj, '2026-12', 350000) } catch (e) { thrown = (e as Error).message }
  eq('봉합 18 조정 행 입력 없으면 락 갈래여도 멈춘다', thrown.includes('dueDayAdjusts'), true)
  thrown = ''
  try { firstMonthRuleDueDay(noAdj) } catch (e) { thrown = (e as Error).message }
  eq('봉합 18 판정 함수도 멈춘다', thrown.includes('dueDayAdjusts'), true)
  // 19. 떨어진 이유.
  eq('봉합 19 사슬 끝 불일치 이유', firstMonthRule(lease({ dueDay: '25', dueDayAdjusts: [R513] })), { due: '25', fallback: 'chain-end' })
  eq('봉합 19 사슬 끊김 이유', firstMonthRule(lease({ dueDay: '25', dueDayAdjusts: [R513, adj('2026-10', '[납입일변경] 15일→25 변경, 일할 116,666원 (추가납부)', 3)] })).fallback, 'chain-gap')
  eq('봉합 19 못 읽음 이유', firstMonthRule(lease({ dueDayAdjusts: [adj('2026-10', '[납입일변경] 13만원')] })).fallback, 'unreadable')
  eq('봉합 19 봉합되면 이유 없음', firstMonthRule(lease({ dueDayAdjusts: [R513] })), { due: '9', fallback: null })
  // 20. 감사 규칙 10 판정(firstMonthAdjustExposure).
  const X = (l: BillingLeaseFields, locked: number | null, cutoff: string | null = '2026-04') => firstMonthAdjustExposure(l, { moveInMonthLocked: locked, cutoffMonth: cutoff })
  eq('감사 10 봉합된 입주달 조정은 알리지 않음', X(lease({ dueDayAdjusts: [R513] }), null), null)
  eq('감사 10 사슬 끝 불일치는 락이 있어도 알림', X(lease({ dueDay: '25', dueDayAdjusts: [R513] }), 350000), 'chain-end')
  eq('감사 10 다른 달 조정 + 입주달 락 없음 = 알림', X(lease({ dueDayAdjusts: [adj('2026-11', M513)] }), null), 'other-month')
  eq('감사 10 다른 달 조정 + 입주달 락 있음 = 조용', X(lease({ dueDayAdjusts: [adj('2026-11', M513)] }), 350000), null)
  eq('감사 10 다른 달 조정 + 입주달이 인수 전 = 조용(418호 모양)', X(lease({ dueDayAdjusts: [adj('2026-11', M513)] }), null, '2026-11'), null)
  eq('감사 10 다른 달 조정이 입주달 청구를 안 바꾸면 조용', X(lease({ dueDay: '9', dueDayAdjusts: [adj('2026-11', M513)] }), null), null)
  eq('감사 10 단기는 조용', X(lease({ isShortTerm: true, dueDay: '25', dueDayAdjusts: [R513] }), null), null)
  eq('감사 10 조정 행 없으면 조용', X(lease(), null), null)
}

// ── 받았는지 상태(표시 전용, 2026-10-21 운영자 '받을 금액 자리에 받았다는 표시가 없다') ─────────────
// 판정은 그 달 완납 정본식과 같은 근거다. 남은 조정분 = min(max(0, 청구 − 그 달 전체 합), 그 달 추가분 합). 행 isPaid 는 안 본다.
{
  const D = (y: string) => new Date(`${y}T03:00:00Z`)
  const row = (targetMonth: string, actualAmount: number, memo: string | null = null, payDate = '2026-10-07', isPrevOwner = false) =>
    ({ targetMonth, actualAmount, memo, isPrevOwner, payDate: D(payDate) })
  const A513 = '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)'
  const st = (rows: ReturnType<typeof row>[], bill: number, month: string, dueYmd: string | null, todayYmd: string, cutoff: Date | null = null) => {
    const s = dueDayAdjustMonthSums(rows, cutoff).get(month)
    return s ? dueDayAdjustMonthStatus({ bill, monthTotal: s.total, extraTotal: s.extra, dueYmd, todayYmd }) : null
  }
  // 513호 10월 운영 DB 실측(2026-10-21 읽기). 청구 350,000, 350,000(10-07) + 조정 −130,000 + 130,000(10-20). 조정 행 isPaid=false 였다.
  const r513 = [row('2026-10', 350000), row('2026-10', -130000, A513, '2026-10-20'), row('2026-10', 130000, '2026년 10월분', '2026-10-20')]
  eq('상태 513 10월 수납 완료', st(r513, 350000, '2026-10', '2026-10-20', '2026-10-21'), { kind: 'paid' })
  eq('상태 513 합: 전체 350,000 · 추가분 130,000', dueDayAdjustMonthSums(r513, null).get('2026-10'), { total: 350000, extra: 130000 })
  // 418호 5월 운영 DB 실측. 청구 400,000, 조정 −80,000(05-05) + 80,000 + 400,000(05-11).
  const r418 = [row('2026-05', -80000, M418, '2026-05-05'), row('2026-05', 80000, null, '2026-05-11'), row('2026-05', 400000, null, '2026-05-11')]
  eq('상태 418 5월 수납 완료', st(r418, 400000, '2026-05', '2026-05-08', '2026-10-21'), { kind: 'paid' })
  // 받은 돈 350,000 만(조정분 하나도 안 받음). 납부일 지남이면 미수납, 안 지났으면 수납 전.
  const r350 = [row('2026-10', 350000), row('2026-10', -130000, A513, '2026-10-20')]
  eq('상태 350k 납부일 지남 = 미수납', st(r350, 350000, '2026-10', '2026-10-20', '2026-10-21'), { kind: 'unpaid' })
  eq('상태 350k 납부일 당일 = 수납 전', st(r350, 350000, '2026-10', '2026-10-20', '2026-10-20'), { kind: 'before' })
  // 400,000 받음: 조정분 중 50,000 만 받음, 80,000 부족.
  const r400 = [row('2026-10', 400000), row('2026-10', -130000, A513, '2026-10-20')]
  eq('상태 400k 일부 = 부족 80,000', st(r400, 350000, '2026-10', '2026-10-20', '2026-10-21'), { kind: 'short', remaining: 80000 })
  eq('칩 부족 글자', dueDayAdjustStatusChip({ kind: 'short', remaining: 80000 }), { label: '부족 80,000원', tone: 'warning' })
  // 0원 받음: 이용료도 조정분도 다 남음(남은 조정분은 추가분 합으로 막힌다).
  const r0 = [row('2026-10', -130000, A513, '2026-10-20')]
  eq('상태 0원 납부일 지남 = 미수납', st(r0, 350000, '2026-10', '2026-10-20', '2026-10-21'), { kind: 'unpaid' })
  // 미래 달은 납부일이 안 왔다.
  eq('상태 미래 달 = 수납 전', st([row('2026-12', -130000, A513, '2026-10-20')], 350000, '2026-12', '2026-12-20', '2026-10-21'), { kind: 'before' })
  eq('상태 납부일 모름 = 수납 전', st(r0, 350000, '2026-10', null, '2026-10-21'), { kind: 'before' })
  // 돌려줄 금액만 있는 달은 상태가 없다(칩 없음).
  eq('상태 돌려줄 금액만 = null', st([row('2026-10', 350000), row('2026-10', 100000, '[납입일변경] 15일→5 변경, 일할 100,000원 (과입금)')], 350000, '2026-10', '2026-10-05', '2026-10-21'), null)
  // 조정 행 2개(같은 달). 추가분 합 180,000. 400,000 받으면 남은 = min(350,000 − 220,000, 180,000) = 130,000 → 부족.
  const r2 = [row('2026-10', 400000), row('2026-10', -130000, A513, '2026-10-20'), row('2026-10', -50000, '[납입일변경] 20일→25 변경, 일할 50,000원 (추가납부)', '2026-10-21')]
  eq('상태 조정 행 2개 일부 = 부족 130,000', st(r2, 350000, '2026-10', '2026-10-25', '2026-10-26'), { kind: 'short', remaining: 130000 })
  eq('상태 조정 행 2개 다 받음 = 수납 완료', st([...r2, row('2026-10', 130000)], 350000, '2026-10', '2026-10-25', '2026-10-26'), { kind: 'paid' })
  // 양도인 행·인수 전 입금은 뺀다(귀속월 선택지와 같은 방식). 인수 전 130,000 은 이 원장의 수납이 아니다.
  const rPre = [row('2026-10', 350000, null, '2026-10-07'), row('2026-10', -130000, A513, '2026-10-20'), row('2026-10', 130000, null, '2026-10-01')]
  eq('상태 인수 전 입금은 뺀다 = 미수납', st(rPre, 350000, '2026-10', '2026-10-20', '2026-10-21', D('2026-10-05')), { kind: 'unpaid' })
  eq('상태 양도인 행은 뺀다 = 미수납', st([...r350, row('2026-10', 130000, null, '2026-10-20', true)], 350000, '2026-10', '2026-10-20', '2026-10-21'), { kind: 'unpaid' })
  eq('합: 조정 행 없는 달은 안 낸다', dueDayAdjustMonthSums([row('2026-09', 350000)], null).size, 0)
  eq('합: 지운 조정 행은 안 센다', dueDayAdjustMonthSums([{ ...row('2026-10', -130000, A513), deletedAt: D('2026-10-21') }], null).size, 0)
  eq('칩 넷', [dueDayAdjustStatusChip({ kind: 'paid' }), dueDayAdjustStatusChip({ kind: 'before' }), dueDayAdjustStatusChip({ kind: 'unpaid' })],
    [{ label: '수납 완료', tone: 'success' }, { label: '수납 전', tone: 'neutral' }, { label: '미수납', tone: 'warning' }])
  // 표시 메모(§29 값 전환 표기). 저장 글자는 그대로다.
  eq('표시 메모 513', dueDayAdjustDisplayMemo(A513), '9일 → 20일 변경, 일할 128,333원, 협의 130,000원')
  eq('표시 메모 418', dueDayAdjustDisplayMemo(M418), '2일 → 8일 변경, 일할 80,000원')
  eq('표시 메모 말일·설명', dueDayAdjustDisplayMemo('[납입일변경] 말일일→말일 변경, 일할 1,000원 (과입금) 현금 정산'), '말일 → 말일 변경, 일할 1,000원 현금 정산')
  eq('표시 메모 옛 모양은 종전 표시', dueDayAdjustDisplayMemo('[납입일변경] 13만원으로 협의'), '13만원으로 협의')
}

console.log(`\n납입일 변경 조정 진리표: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
