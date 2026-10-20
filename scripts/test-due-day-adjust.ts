// 납입일 변경 조정 행 판정·메모·수정 진리표. DB 불필요, lib/dueDayAdjust 순수 함수 고정. 실행: npx tsx scripts/test-due-day-adjust.ts
//
// 왜 필요한가(신고 df82ce57, 2026-10-20). 513호 추가납부 조정 행 −128,333 을 운영자가 −130,000 으로 고치려다
// 금액 칸이 부호를 지워 +130,000 이 됐다. 같은 사고가 504호(10-05)에도 있었다. 조정 행은 부호가 뜻이고
// 메모 앞머리가 기계 키라, 그 둘을 지키는 판정을 여기서 글자까지 못박는다.
import {
  DUE_DAY_ADJUST_PREFIX, isDueDayAdjust, dueDayBeforeChange, parseDueDayAdjustMemo, buildDueDayAdjustMemo,
  dueDayAdjustLabel, dueDayAdjustKindOf, planDueDayAdjustEdit, planDueDayAdjustCreate, paymentEditGuard,
  dueDayAdjustSignMismatch, dueDayAdjustWhere, notDueDayAdjustWhere,
  DUE_DAY_ADJUST_NOT_ADJUST, DUE_DAY_ADJUST_UNREADABLE, DUE_DAY_ADJUST_AMOUNT_INVALID, DUE_DAY_ADJUST_NOTE_INVALID,
  DUE_DAY_ADJUST_EDIT_ELSEWHERE, PAYMENT_PREFIX_RESERVED, PAYMENT_NEGATIVE_REFUSED, dueDayAdjustOverCap,
} from '../lib/dueDayAdjust'

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

// ── 감사 축: 메모 방향과 부호 ────────────────────────────────────────
eq('513 지금 상태(+130,000 추가납부)는 불일치', dueDayAdjustSignMismatch({ memo: M513, actualAmount: 130000 }), '메모는 추가납부인데 금액이 +130,000원입니다')
eq('정상 추가납부는 일치', dueDayAdjustSignMismatch({ memo: M418, actualAmount: -80000 }), null)
eq('과입금 음수는 불일치', dueDayAdjustSignMismatch({ memo: '[납입일변경] 15일→5 변경, 일할 100,000원 (과입금)', actualAmount: -100000 }), '메모는 과입금인데 금액이 −100,000원입니다')
eq('과입금 양수는 일치', dueDayAdjustSignMismatch({ memo: '[납입일변경] 15일→5 변경, 일할 100,000원 (과입금)', actualAmount: 100000 }), null)
eq('추가납부 0원은 불일치', dueDayAdjustSignMismatch({ memo: M513, actualAmount: 0 }), '메모는 추가납부인데 금액이 0원입니다')
eq('일반 행은 판정 안 함', dueDayAdjustSignMismatch({ memo: '보증금', actualAmount: -1 }), null)
eq('방향 글자 없는 조정 메모는 판정 안 함', dueDayAdjustSignMismatch({ memo: '[납입일변경] 13만원', actualAmount: 130000 }), null)

console.log(`\n납입일 변경 조정 진리표: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
