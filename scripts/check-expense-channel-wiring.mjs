// 구매처·쇼핑몰 배선 감지망(verify:fast). 읽기 전용 소스 검사, 위반 시 exit 1. 실행: node scripts/check-expense-channel-wiring.mjs
//
// 왜 (2026-10-19 운영자 승인, 신고 a0636f36). 규칙 진리표(test-expense-channel)는 순수 함수만 본다. 판정이 맞아도 저장 경로가
// 안 부르면 아무 일도 안 일어나고, 한 경로만 빠지면 그 경로로 들어온 행만 칸을 잃는다(분할 복제가 칸을 잃던 클래스와 같다).
// 그래서 저장·도구·표시 자리가 정본을 실제로 부르는지 모양으로 본다. 축은 열둘이다.
//   ⓐ 스키마·마이그레이션 두 칸(멱등 SQL) ⓑ 등록 저장(머리 쇼핑몰·배송비 두 갈래·품목별 구매처·합류 검사)
//   ⓒ 수정 저장(부재 보존·주문 전체 적용·다품목 새 행) ⓓ 소급 제한과 적용취소 ⓔ 번호 지도·자동완성에서 쇼핑몰 이름 제외
//   ⓕ 구매처 이름 변경·합치기·비우기(쇼핑몰 이름 막기·적용취소)와 쇼핑몰로 옮기기·지정·같은 주문 적용
//   ⓖ 주문 묶기·사후 배송비 묶기(쇼핑몰 갈림 막기·묶기 적용취소) ⓗ 같은 주문번호 제안은 같은 쇼핑몰만
//   ⓘ 일괄 수정·홈 승인·소모품 구매 수정 ⓙ 표시·검색·엑셀 ⓚ 폼(칸 순서·자리표시·서비스 숨김·품목별 구매처 접힌 줄)
//   ⓛ **구매처를 쇼핑몰 자리에 대신 쓰는 표현 금지**(정본 lib/expenseChannel 과 카드 명세 이름 statementName 만 예외)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)
const read = f => { try { return readFileSync(f, 'utf8') } catch { violations.push(`${f}. 파일을 못 읽었다(못 읽으면 통과가 아니라 위반이다)`); return '' } }
/** (export )?(async )?function 이름( 부터 다음 최상위 function·export 직전까지. */
function region(src, name) {
  const at = src.search(new RegExp(`(^|\\n)(export )?(async )?function ${name}\\(`))
  if (at < 0) return null
  const ends = [src.indexOf('\nexport ', at + 2), src.indexOf('\nasync function ', at + 2), src.indexOf('\nfunction ', at + 2)].filter(i => i > 0)
  return src.slice(at, ends.length ? Math.min(...ends) : undefined)
}
function must(file, src, fn, checks) {
  const body = fn ? region(src, fn) : src
  if (body == null) { violations.push(`${file}. ${fn} 를 못 찾았다. 이름이 바뀌었으면 이 그물도 함께 고친다`); return }
  for (const [re, msg] of checks) if (!re.test(body)) violations.push(`${file}${fn ? ` ${fn}` : ''}. ${msg}`)
}

// ── ⓐ 스키마·마이그레이션 ────────────────────────────────────────
{
  const schema = read('prisma/schema.prisma')
  const exp = schema.slice(schema.indexOf('model Expense {'), schema.indexOf('model ExpenseOrder {'))
  if (!/\n\s+channel\s+String\?/.test(exp)) violations.push('prisma/schema.prisma. Expense.channel(널 허용 글자)이 없다')
  const prop = schema.slice(schema.indexOf('model Property {'), schema.indexOf('@@map("properties")'))
  if (!/\n\s+channelOptions\s+String\?/.test(prop)) violations.push('prisma/schema.prisma. Property.channelOptions 가 없다')
  const sql = read('prisma/migrate_expense_channel.sql')
  if (!/ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "channel" TEXT/.test(sql)) violations.push('prisma/migrate_expense_channel.sql. expenses.channel 을 멱등(IF NOT EXISTS)으로 더하지 않는다')
  if (!/ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "channelOptions" TEXT/.test(sql)) violations.push('prisma/migrate_expense_channel.sql. properties."channelOptions" 를 멱등으로 더하지 않는다')
  if (!/lock_timeout/.test(sql)) violations.push('prisma/migrate_expense_channel.sql. 잠금 시간 제한(lock_timeout)이 없다')
}

const FA = 'app/(app)/finance/actions.ts'
const fa = strip(read(FA))

// ── ⓑ 등록 ───────────────────────────────────────────────────────
must(FA, fa, 'addExpense', [
  [/let channel = channelForSave\(formData\.get\('channel'\) as string, await loadChannelNames\(propertyId\)\)/, '머리 쇼핑몰 칸을 정본(channelForSave, 목록 표기 맞춤)으로 안 읽는다'],
  // 목록 덧붙이기는 저장(트랜잭션) 뒤이고, 실제로 쇼핑몰이 적힌 행이 있을 때만이다(구매처와 같은 이름이라 다 비었으면 안 쌓는다, 결정 A).
  [/const made = await prisma\.\$transaction\(ops\)\n(?:\s*\/\/[^\n]*\n)?\s+await noteChannel\(propertyId, \(made as \{ channel: string \| null \}\[\]\)\.some\(m => m\.channel\) \? channel : null\)[\s\S]*const made = await prisma\.\$transaction\(ops\)\n\s+await noteChannel\(propertyId, \(made as \{ channel: string \| null \}\[\]\)\.some\(m => m\.channel\) \? channel : null\)/, '목록 덧붙이기가 저장(트랜잭션) 뒤가 아니거나, 다 비운 쇼핑몰도 목록에 쌓는다(결정 A)'],
  [/const baseRow = \{[\s\S]{0,600}\n\s+channel:\s+rowChannel\(channel, vendor \|\| null\),\n/, '품목 행 바탕(baseRow)에 쇼핑몰이 없거나 구매처와 같은 이름을 비우지 않는다(결정 A)'],
  [/const iv = multiVendor \? itemVendorFor\(head, r\.it\.vendor, vendorToBiz\) : head[\s\S]{0,200}channel: rowChannel\(channel, iv\.vendor\)/, '다품목 행이 품목별 구매처 정본(itemVendorFor)을 안 거치거나 그 행 구매처 기준으로 쇼핑몰을 비우지 않는다(결정 A)'],
  [/const multiVendor = multiItems\.length >= 2/, '품목별 구매처가 다품목에만 서지 않는다'],
  [/const orderNames = \[\.\.\.new Set\(existing\.expenses\.map\(e => e\.channel\)[\s\S]{0,120}if \(headChannel && orderNames\.length > 0 && !orderNames\.includes\(headChannel\)\)/, '같은 주문 합류가 쇼핑몰이 다른 주문(이미 갈린 옛 주문·배송비 행 포함)을 막지 않는다'],
  [/if \(!channel && orderChannel\) channel = orderChannel/, '쇼핑몰을 비우고 합류할 때 그 주문의 쇼핑몰을 따르지 않는다'],
])
{
  // 별도 배송비 행(합배송)도 같은 결제라 같은 쇼핑몰이다. 그 create 블록 안에 쇼핑몰 칸이 있어야 한다.
  const b = region(fa, 'addExpense') ?? ''
  const at = b.indexOf('const shippingCreate = isOrderMode')
  const sc = at < 0 ? '' : b.slice(at, b.indexOf('if (multiItems) {', at))
  if (!/\n\s+channel:\s+rowChannel\(channel, vendor \|\| null\),/.test(sc)) violations.push(`${FA} addExpense. 별도 배송비 행이 쇼핑몰을 안 싣는다(구매처와 같은 이름이면 비움까지)`)
}
// ── ⓒ 수정 ───────────────────────────────────────────────────────
must(FA, fa, 'updateExpense', [
  [/const channelPresent = formData\.has\('channel'\)/, '쇼핑몰 칸 부재와 비움을 formData.has 로 가르지 않는다(form-clear-vs-absent)'],
  [/if \(channelPresent\) await noteChannel\(propertyId, selfChannel, existing\.channel\)/, '자동 추가에 이전 값(existing.channel)을 안 넘기거나 비운 값을 쓰지 않는다'],
  [/if \(channelPresent\) await noteChannel\(propertyId, \(multiResults as \{ channel: string \| null \}\[\]\)\.some\(m => m\.channel\) \? channel : null, existing\.channel\)/, '다품목 수정이 다 비운 쇼핑몰도 목록에 쌓는다(결정 A)'],
  [/\.\.\.\(channelPresent \? \{ channel: selfChannel \} : \{\}\)/, '단일 수정이 칸 부재에서도 쇼핑몰을 덮거나 구매처와 같은 이름을 비우지 않는다'],
  [/const selfChannel = rowChannel\(channel, vendor \|\| null\)/, '수정의 쇼핑몰이 정본(rowChannel)을 안 거친다(결정 A)'],
  [/if \(channelPresent && !channelToOrder && existing\.orderId && selfChannel && selfChannel !== existing\.channel\) \{[\s\S]{0,300}wouldSplitOrder\(\[\.\.\.sibs\.map\(s => s\.channel\), selfChannel\]\)\) return \{ ok: false, error: ORDER_CHANNEL_SPLIT_DENIED \}/, '수정이 한 주문 안 쇼핑몰을 가르는 저장을 거절하지 않는다(결정 B)'],
  [/channel: rowChannel\(channel, \(multiVendor \? itemVendorFor\(head, firstRow\.it\.vendor, vendorToBiz\) : head\)\.vendor\)/, '수정 다품목 첫 행이 그 행 구매처 기준으로 쇼핑몰을 비우지 않는다(결정 A)'],
  [/channel: rowChannel\(channel, \(multiVendor \? itemVendorFor\(head, r\.it\.vendor, vendorToBiz\) : head\)\.vendor\)/, '수정 다품목 새 행이 그 행 구매처 기준으로 쇼핑몰을 비우지 않는다(결정 A)'],
  [/formData\.get\('channelScope'\) === 'order'/, "수정 폼 '주문 전체에 적용' 답을 안 읽는다"],
  [/applyChannelToOrder\(propertyId, existing\.orderId!, id, channel\)/, '주문 전체 적용이 정본 도우미를 안 부른다'],
  [/\.\.\.\(multiVendor \? itemVendorFor\(head, firstRow\.it\.vendor, vendorToBiz\) : \{\}\)/, '수정 다품목 첫 행이 품목별 구매처를 안 거친다'],
  [/\.\.\.\(multiVendor \? itemVendorFor\(head, r\.it\.vendor, vendorToBiz\) : \{\}\)/, '수정 다품목 새 행이 품목별 구매처를 안 거친다'],
])
// 주문 전체 적용 도우미는 재무 수정 폼과 소모품 구매 수정이 한 벌로 쓴다(서버 전용 모듈, 'use server' 아님. 액션으로 드러나면 propertyId 를 남이 정한다).
const OCA = 'app/(app)/finance/orderChannelApply.ts'
const oca = strip(read(OCA))
if (/^\s*['"]use server['"]/.test(read(OCA))) violations.push(`${OCA}. 'use server' 파일이면 propertyId 를 받는 도우미가 액션으로 드러난다`)
must(OCA, oca, 'applyChannelToOrder', [
  [/signFieldUndo\(propertyId, 'channel-order'/, '주문 전체 적용이 적용취소 토큰을 안 낸다'],
  [/if \(r\.count === 1\) done\.push\(s\)/, '주문 전체 적용 토큰에 조건부 갱신이 실제로 바꾼 행만 싣지 않는다'],
  [/where: \{ propertyId, orderId, id: \{ not: selfId \} \}/, '주문 형제를 영업장 범위로 안 고른다'],
  [/after: rowChannel\(channel, s\.vendor\)/, '주문 전체 적용이 형제마다 그 행 구매처와 같은 이름을 비우지 않는다(결정 A)'],
])
// ── ⓓ 소급 ───────────────────────────────────────────────────────
must(FA, fa, 'backfillVendorBizNo', [
  [/bizBackfillAllowed\(vendor, bizNo, await loadChannelNames\(propertyId\)\)/, '쇼핑몰 목록 이름을 소급에서 빼지 않는다'],
  [/signFieldUndo\(propertyId, 'bizno-backfill'/, '소급이 바꾼 행 id 적용취소 토큰을 안 낸다'],
  [/AND "vendorBizNo" IS NULL\s+RETURNING "id"/, '소급 토큰이 실제로 채운 행(RETURNING)만 싣지 않는다'],
])
for (const fn of ['addExpense', 'updateExpense']) {
  const b = region(fa, fn) ?? ''
  for (const m of b.matchAll(/backfillVendorBizNo\(([^)]*)\)/g)) {
    if (!/^propertyId, vendor \|\| null, vendorBizNo$/.test(m[1].trim())) violations.push(`${FA} ${fn}. 소급에 머리 구매처가 아닌 값(${m[1]})을 넘긴다(품목별 구매처로는 소급 안 함)`)
  }
}
must(FA, fa, 'undoExpenseFieldChange', [
  [/await requireEdit\(\)/, '적용취소에 편집 권한 검사가 없다'],
  [/verifyUndoBody\(EXPENSE_FIELD_UNDO_KINDS\[u\.kind\], propertyId, canonicalExpenseFieldUndo\(body\), sig\)/, '적용취소가 용도 라벨별 서명을 안 본다'],
  [/where: \{ id: \{ in: u\.rows\.map\(r => r\.id\) \}, propertyId \}/, '적용취소가 영업장 범위로 행을 안 읽는다'],
  [/planExpenseFieldUndo\(u, now\)/, "적용취소가 '쓴 직후' 검사(planExpenseFieldUndo)를 안 거친다"],
])
// ── ⓔ 번호 지도·자동완성 ─────────────────────────────────────────
must(FA, fa, 'getVendorBizMap', [[/buildVendorBizMap\(rows, await loadChannelNames\(propertyId\)\)/, '번호 지도가 쇼핑몰 목록 이름을 빼지 않는다']])
must(FA, fa, 'getExpenseVendorSuggestions', [[/vendorSuggestionsWithoutChannels\(result, await loadChannelNames\(propertyId\)\)/, '구매처 자동완성이 쇼핑몰 목록 이름을 빼지 않는다']])
must(FA, fa, 'loadVendorToBiz', [[/buildVendorBizMap\(rows, await loadChannelNames\(propertyId\)\)\.vendorToBiz/, '품목별 구매처 번호 찾기가 정본 지도를 안 쓴다']])
// ── ⓕ 구매처 정리 ────────────────────────────────────────────────
must(FA, fa, 'renameVendor', [
  [/isChannelName\(oldName, channelNames\) \|\| isChannelName\(target, channelNames\)/, '쇼핑몰 목록 이름이 낀 이름 변경·합치기를 막지 않는다'],
  [/signFieldUndo\(propertyId, 'vendor-rename'/, '구매처 이름 변경·합치기·비우기가 적용취소 토큰을 안 낸다'],
  [/data: \{ vendor: target \|\| null \},/, '구매처 비우기가 구매처 이름만 비우지 않는다(사업자번호는 남긴다, 결정 C)'],
])
must(FA, fa, 'vendorChannelOp', [
  [/await requireEdit\(\)/, '쇼핑몰 정리에 편집 권한 검사가 없다'],
  [/where: \{ propertyId, vendor: \{ in: names \} \}/, '쇼핑몰 정리가 영업장 범위로 안 고른다'],
  [/h\.channel === null \|\| h\.channel === channel/, '쇼핑몰이 이미 다른 행을 덮는다'],
  [/signFieldUndo\(propertyId, kind, result\.rows\)/, '쇼핑몰 정리가 적용취소 토큰을 안 낸다'],
  [/if \(r\.count === 1\) rows\.push\(\{ id: h\.id, changes \}\)/, '쇼핑몰 정리 토큰에 실제로 바꾼 행만 싣지 않는다'],
  [/const after = rowChannel\(channel, kind === 'vendor-to-channel' \? null : h\.vendor\)/, '쇼핑몰 정리가 그 행 구매처와 같은 이름을 비우지 않는다(결정 A)'],
  [/if \(after && h\.orderId && splitOrder\.has\(h\.orderId\)\) \{ splitSkipped\+\+; continue \}/, '쇼핑몰 정리가 같은 주문에 다른 쇼핑몰이 있는 행을 건너뛰지 않는다(결정 B)'],
  [/\.filter\(s => !okIds\.has\(s\.id\)\)/, '쇼핑몰 정리의 갈림 판정이 실제로 쓸 행(ok)이 아니라 고른 행 전부를 뺀다(건너뛴 다른 쇼핑몰 행이 근거에서 빠진다)'],
])
{
  // 옮기기는 구매처 이름만 비운다(사업자번호를 토큰·쓰기에 싣지 않는다, 결정 C).
  const b = region(fa, 'vendorChannelOp') ?? ''
  if (/field: 'vendorBizNo'/.test(b)) violations.push(`${FA} vendorChannelOp. 쇼핑몰로 옮기기가 사업자번호를 비운다(결정 C, 이름만 비운다)`)
  const r = region(fa, 'renameVendor') ?? ''
  if (/vendorBizNo: null/.test(r)) violations.push(`${FA} renameVendor. 구매처 비우기가 사업자번호를 비운다(결정 C)`)
}
must(FA, fa, 'applyChannelToSameOrders', [
  [/verifyUndoBody\(EXPENSE_FIELD_UNDO_KINDS\[u\.kind\]/, '같은 주문 적용이 서명된 토큰에서만 행을 받지 않는다'],
  [/const sibs = all\.filter\(s => s\.channel === null && !split\.has\(s\.orderId!\) && rowChannel\(channel, s\.vendor\)\)/, '같은 주문 적용이 미기록 행만 고르지 않거나, 다른 쇼핑몰이 있는 주문·구매처와 같은 이름의 행을 거르지 않는다(결정 A·B)'],
])
// ── ⓖ 주문 묶기·배송비 묶기 ──────────────────────────────────────
must(FA, fa, 'mergeExpensesIntoOrder', [
  [/where: \{ orderId: \{ in: sourceOrderIds \}, propertyId \}, select: \{ channel: true \}/, '주문 묶기 갈림 검사에 배송비 행 쇼핑몰을 안 센다'],
  [/mergeChannelConflict\(\[\.\.\.selected, \.\.\.orderRows\]\)/, '주문 묶기가 쇼핑몰 갈림을 안 막는다'],
  [/signOrderMergeUndo\(propertyId/, '주문 묶기가 적용취소 토큰을 안 낸다'],
])
must(FA, fa, 'undoBatchUpdateExpenses', [
  [/await requireEdit\(\)/, '일괄 적용취소에 편집 권한 검사가 없다'],
  [/const u = parseBatchExpensesUndo\(raw\)/, '일괄 적용취소가 허용 칸 모양 검사를 안 거친다(화면에서 온 fields 를 그대로 쓴다)'],
  [/verifyUndoBody\(BATCH_EXPENSES_UNDO_DOMAIN, propertyId, canonicalBatchExpensesUndo\(body\), sig\)/, '일괄 적용취소가 서명을 안 본다'],
  [/planBatchExpensesUndo\(u, /, "일괄 적용취소가 '쓴 직후' 검사를 안 거친다"],
])
must(FA, fa, 'batchUpdateExpenses', [[/signedUndo = signBatchUndo\(propertyId, /, '일괄 수정 적용취소 토큰에 서명·쓴 직후 값을 안 싣는다']])
must(FA, fa, 'undoMergeExpensesIntoOrder', [
  [/await requireEdit\(\)/, '묶기 적용취소에 편집 권한 검사가 없다'],
  [/verifyUndoBody\(ORDER_MERGE_UNDO_DOMAIN/, '묶기 적용취소가 서명을 안 본다'],
  [/planOrderMergeUndo\(/, "묶기 적용취소가 '묶은 직후' 검사를 안 거친다"],
])
must(FA, fa, 'attachShippingToOrder', [
  [/mergeChannelConflict\(\[\.\.\.expenses, \.\.\.orderRows\]\)/, '사후 배송비 묶기가 쇼핑몰 갈림을 안 막는다'],
])
{
  // 사후 배송비 행은 새로 만들 때도, 이미 있는 배송비 행을 고칠 때도 그 주문의 쇼핑몰을 싣는다(두 자리 다).
  const b = region(fa, 'attachShippingToOrder') ?? ''
  if (!/channel:\s+rowChannel\(orderChannel, rep\.vendor\),/.test(b) || !/\.\.\.\(orderChannel \? \{ channel: rowChannel\(orderChannel, existingShip\.vendor\) \} : \{\}\)/.test(b)) violations.push(`${FA} attachShippingToOrder. 사후 배송비 행(새로 만들기·고치기)이 그 주문의 쇼핑몰을 안 싣거나 미기록일 때 null 로 덮는다`)
  if (!/where: \{ orderId: existingOrderId, propertyId \}, select: \{ channel: true \}/.test(b)) violations.push(`${FA} attachShippingToOrder. 갈림 검사에 이미 있는 배송비 행을 안 센다`)
}
// ── ⓗ 같은 주문번호 제안 ─────────────────────────────────────────
must(FA, fa, 'findOrderByExternalNo', [[/orders\.find\(o => chOf\(o\) === want\) \?\? orders\.find\(o => chOf\(o\) === null\)/, '쇼핑몰이 정해져 있을 때 같은 쇼핑몰, 없으면 미기록 옛 주문을 고르지 않는다(다른 쇼핑몰만 빼야 한다, 신고 4f9fb398 퇴행)']])
must('lib/channelOptions.ts', strip(read('lib/channelOptions.ts')), 'appendChannelOption', [
  [/const name = normalizeChannel\(raw\)/, '목록 덧붙이기가 정본 정규화를 안 거친다'],
  [/NOT EXISTS[\s\S]*lower\(btrim\(t\.v\)\) = lower\(/, '목록 덧붙이기가 한 문장 조건부가 아니거나 같은 열쇠 검사가 없다(동시 저장에서 한쪽이 지워진다)'],
])
// ── ⓘ 일괄 수정·홈 승인·소모품 구매 수정 ─────────────────────────
must(FA, fa, 'batchUpdateExpenses', [
  [/const changingChannel = 'channel' in data/, '일괄 수정에 쇼핑몰 칸이 없다'],
  [/if \(touchesChannel\(t\)\) fields\.channel = t\.channel/, '일괄 수정 적용취소 스냅샷에 쇼핑몰이 없다'],
  [/const channelAfterOf = \(t: [^)]*\) => rowChannel\(changingChannel \? channelValue : t\.channel, vendorAfterOf\(t\)\)/, '일괄 수정의 쇼핑몰이 행마다 그 행 구매처 기준으로 비우지 않는다(결정 A)'],
  [/if \(wouldSplitOrder\(\[\.\.\.mine\.map\(channelAfterOf\), \.\.\.rest\]\)\) return \{ ok: false, error: ORDER_CHANNEL_SPLIT_DENIED \}/, '일괄 수정이 한 주문 안 쇼핑몰을 가르는 쓰기를 거절하지 않는다(결정 B)'],
  [/for \(const s of siblingsToSet\) undo\.rows\.push\(\{ id: s\.id, fields: \{ channel: s\.channel \} \}\)/, "일괄 수정 '함께 적용' 형제가 적용취소 스냅샷에 안 실린다"],
  [/if \(t\.isShipping && !onlyChannel\)/, '쇼핑몰만 바꾸는 일괄이 배송비 행을 뺀다(한 결제 = 한 쇼핑몰)'],
])
{
  const PR = 'app/(app)/dashboard/pendingReceipt.ts'
  const pr = strip(read(PR))
  must(PR, pr, 'approvePendingReceipt', [
    [/const channel = rowChannel\(channelForSave\(final\.channel, await loadChannelNames\(propertyId\)\), final\.vendor\?\.trim\(\) \|\| null\)/, '홈 승인이 쇼핑몰을 정본(목록 표기·구매처와 같으면 비움)으로 안 싣는다(결정 A)'],
    [/vendorBizNo: normalizeBizNo\(final\.vendorBizNo \?\? null\),/, '홈 승인이 구매처가 비면 사업자번호를 버린다(결정 C, 번호는 남긴다)'],
  ])
  const card = read('components/dashboard/PendingReceiptSection.tsx')
  if (!/\(!vendor\.trim\(\) \|\| vendor\.trim\(\) === \(row\.inferredVendor \?\? ''\)\.trim\(\)\) \? row\.inferredVendorBizNo/.test(card)) violations.push('components/dashboard/PendingReceiptSection.tsx. 인식 번호를 구매처를 다른 이름으로 고쳤을 때만 빼지 않는다(비운 경우는 싣는다, 결정 C)')
  if (!/channelSameAsVendor\(channel, vendor\) &&/.test(card)) violations.push('components/dashboard/PendingReceiptSection.tsx. 쇼핑몰이 상호명과 같을 때 비워 두라는 안내가 없다(결정 A)')
  const IA = 'app/(app)/inventory/actions.ts'
  must(IA, strip(read(IA)), 'updateExpenseFromInventory', [
    [/channelNext !== undefined \? \{ channel: channelNext \} : \{\}/, '소모품 구매 수정이 쇼핑몰 칸 부재를 지키지 않는다'],
    [/const channelNext = channelWanted !== undefined \? rowChannel\(channelWanted, vendorAfter\) : undefined/, '소모품 구매 수정의 쇼핑몰이 정본(rowChannel)을 안 거친다(결정 A)'],
    [/if \(channelNext !== undefined && channelNext && channelNext !== e\.channel && e\.orderId && !channelToOrder\) \{[\s\S]{0,300}wouldSplitOrder\(\[\.\.\.sibs\.map\(x => x\.channel\), channelNext\]\)[\s\S]{0,200}error: ORDER_CHANNEL_SPLIT_DENIED/, '소모품 구매 수정이 한 주문 안 쇼핑몰을 가르는 저장을 거절하지 않는다(결정 B)'],
    [/applyChannelToOrder\(propertyId, e\.orderId!, id, channelWanted \?\? null\)/, "소모품 구매 수정 '주문 전체에 적용' 이 정본 도우미를 안 부른다"],
  ])
  const IC = 'app/(app)/inventory/InventoryClient.tsx'
  const ic = read(IC)
  if (!/if \(!res\.ok && res\.orderSplit\) \{[\s\S]{0,700}confirmLabel: '주문 전체에 적용'[\s\S]{0,400}channelToOrder: true/.test(ic)) violations.push(`${IC} PurchaseEditForm. 주문 갈림을 [주문 전체에 적용 / 취소] 로 묻고 다시 보내지 않는다(결정 B)`)
  if (!/channelSameAsVendor\(channel, vendor\) &&/.test(ic)) violations.push(`${IC} PurchaseEditForm. 쇼핑몰이 구매처와 같을 때 안내가 없다(결정 A)`)
}
// ── ⓙ 표시·검색·엑셀 ─────────────────────────────────────────────
{
  const FC = 'app/(app)/finance/FinanceClient.tsx'
  const fc = read(FC)
  if ((fc.match(/externalOrderCaption\(/g) ?? []).length < 4) violations.push(`${FC}. 주문 캡션·묶음 모달 부제·상세 주문 줄이 쇼핑몰 이름 규칙(externalOrderCaption)을 안 쓴다`)
  if (/쇼핑몰 \$\{e\.order(\?)?\.externalOrderNo\}|· 쇼핑몰 \{detailExp\.order\.externalOrderNo\}/.test(fc)) violations.push(`${FC}. 주문번호 앞에 낱말 '쇼핑몰'을 고정으로 쓰는 옛 캡션이 남았다`)
  if (!/<DetailRow label="쇼핑몰"\s+value=\{detailExp\.channel\} \/>\}\n\s+\{detailExp\.vendor && <DetailRow label="구매처"/.test(fc)) violations.push(`${FC}. 지출 상세에 '쇼핑몰' 줄이 구매처 위에 없다`)
  if (!/orderSellerLabel\(nonShip\)/.test(fc)) violations.push(`${FC}. 주문별 보기 판매처 요약이 정본(orderSellerLabel)을 안 쓴다`)
  if (!/\$\{e\.channel \?\? ''\}/.test(fc)) violations.push(`${FC}. 목록 즉석 검색이 쇼핑몰을 안 찾는다`)
  if (!/\{ channel:\s+\{ contains: q, mode: 'insensitive' \} \}/.test(fa)) violations.push(`${FA}. 과거 구매 검색(searchExpenses)이 쇼핑몰을 안 찾는다`)
  if (!/\{ channel: \{ contains: q, mode: 'insensitive' \} \}/.test(read('app/(app)/search/actions.ts'))) violations.push('app/(app)/search/actions.ts. 전역 검색이 쇼핑몰을 안 찾는다')
  if (!/'쇼핑몰':\s+e\.channel \?\? '',\n\s+'구매처':/.test(strip(read('app/api/export/route.ts')))) violations.push("app/api/export/route.ts. 엑셀 '쇼핑몰' 열이 '구매처' 바로 앞에 없다")
  for (const [f, re] of [
    ['app/(app)/inventory/assets/AssetsClient.tsx', /channelVendorLabel\(it\.channel, it\.vendor\)/],
    ['app/(app)/inventory/InventoryClient.tsx', /channelVendorLabel\(entry\.channel, entry\.vendor\)/],
    ['app/(app)/card-settlement/CardSettlementClient.tsx', /statementName\(item\)/],
  ]) if (!re.test(read(f))) violations.push(`${f}. 한 줄 요약 자리가 쇼핑몰 먼저 규칙을 안 쓴다`)
}
// ── ⓚ 폼 ─────────────────────────────────────────────────────────
{
  const FC = 'app/(app)/finance/FinanceClient.tsx'
  const fc = read(FC)
  if (/name="vendor"[^>]*placeholder="예: 쿠팡/.test(fc)) violations.push(`${FC}. 구매처 자리표시에 쿠팡이 남았다(쿠팡은 쇼핑몰 자리다)`)
  if ((fc.match(/placeholder="예: 다이소, 철물24"/g) ?? []).length < 2) violations.push(`${FC}. 등록·수정 폼 구매처 자리표시가 '예: 다이소, 철물24' 가 아니다`)
  const add = fc.indexOf('name="vendor" value={addExpVendor}'), addBiz = fc.indexOf('name="vendorBizNo" inputMode="numeric" value={addExpBizNo}'), addCh = fc.indexOf('name="channel" value={addExpChannel}'), addNo = fc.indexOf('name="externalOrderNo"')
  if (!(add > 0 && add < addBiz && addBiz < addCh && addCh < addNo)) violations.push(`${FC}. 등록 폼 머리 칸 순서가 구매처 · 사업자등록번호 · 쇼핑몰 · 쇼핑몰 주문번호가 아니다`)
  if (!/\{!addIsService && \(\s*<div className="space-y-1\.5">\s*<label[^>]*>쇼핑몰 <span[^>]*>\(선택 · 비우면 구매처와 같음\)/.test(fc)) violations.push(`${FC}. 등록 폼 쇼핑몰 칸이 서비스·무형에서 안 숨거나 안내('선택 · 비우면 구매처와 같음')가 없다`)
  if (!/\{!detailExp\.excludeFromInventory && \(\s*<div className="space-y-1\.5">\s*<label[^>]*>쇼핑몰 /.test(fc)) violations.push(`${FC}. 수정 폼 쇼핑몰 칸이 없거나 서비스·무형에서 안 숨는다`)
  if (!/결제대행사\(예: 네이버파이낸셜\)는 구매처에도 쇼핑몰에도 적지 않습니다\./.test(fc)) violations.push(`${FC}. 결제대행사 안내 문장이 없다`)
  if (!/const vendorAllowed = allowMulti && items\.length >= 2/.test(fc) || !/구매처 따로 입력/.test(fc)) violations.push(`${FC}. 품목별 구매처 접힌 줄이 다품목에서만 서지 않는다`)
  if (!/vendor: list\.length >= 2 && x\.vendor\?\.trim\(\) \? x\.vendor\.trim\(\) : undefined/.test(fc)) violations.push(`${FC}. 저장으로 보내는 품목 목록이 품목별 구매처를 다품목·빈 글자 규칙으로 안 거른다`)
  if (!/placeholder:text-\[var\(--ink-m\)\][^']*\[appearance:textfield\]/.test(fc)) violations.push(`${FC}. 품목 카드 입력(smallNum) 자리표시 대비가 정본(--ink-m)이 아니다`)
  if (!/channelSplitAgainst\(expenses\.filter\(x => x\.orderId === detailExp\.orderId && x\.id !== detailExp\.id\), next\)/.test(fc)) violations.push(`${FC}. 수정 폼이 주문 속 쇼핑몰 갈림을 묻지 않는다`)
}
{
  const ec = strip(read('lib/expenseChannel.ts'))
  if (!/export function channelKey\(v: string \| null \| undefined\): string \{\s*return key\(v\)\.toLowerCase\(\)/.test(ec)) violations.push('lib/expenseChannel.ts. 쇼핑몰 이름 열쇠(channelKey)가 라틴 대소문자를 접지 않는다')
  if (!/channelNames\.some\(c => channelKey\(c\) === k\)/.test(ec)) violations.push('lib/expenseChannel.ts. isChannelName 이 정본 열쇠(channelKey)로 견주지 않는다')
}
{
  // 분할 복제 유실 장부 그물이 배포 시각을 미리 박지 않고(배포 전 옛 코드 조각이 푸시를 막는다), 생긴 뒤 손댄 조각을 오류로 세지 않는가.
  const CF = 'scripts/check-clone-field-loss.ts'
  const cf = strip(read(CF))
  if (!/const DEPLOYED_AT: Date \| null = process\.env\.CLONE_LOSS_DEPLOYED_AT \? new Date\(process\.env\.CLONE_LOSS_DEPLOYED_AT\) : null/.test(cf)) violations.push(`${CF}. 배포 시각을 코드에 미리 박았다(배포 전 운영 조각이 오류가 되어 푸시를 막는다). 배포 뒤 환경 변수나 상수로 적는다`)
  if (!/Math\.abs\(r\.updatedAt\.getTime\(\) - r\.createdAt\.getTime\(\)\) < UNTOUCHED_MS/.test(cf)) violations.push(`${CF}. 생긴 뒤 손대지 않은 조각만 오류로 세지 않는다(정당한 수정이 푸시를 막는다)`)
  const lf = strip(read('lib/cloneFieldLoss.ts'))
  if (!/unitBasis: new Date\('2026-07-03T19:49:06\+09:00'\)/.test(lf) || !/if \(since && origin\.createdAt < since\) continue/.test(lf)) violations.push('lib/cloneFieldLoss.ts. 칸이 생기기 전 원행(단가 기준 07-03 전)의 값을 유실 근거로 쓴다(없는 기록을 지어낸다)')
}
{
  // 구매처 관리: 서버가 거부하는 동작(쇼핑몰 목록 이름의 저장·합치기)은 숨기고 같은 자리에 상태 캡션, 까닭은 서버 문장과 한 벌(검수 2026-10-20).
  const FC = 'app/(app)/finance/FinanceClient.tsx'
  const fc = strip(read(FC))
  const vm = region(fc, 'VendorManageModal') ?? ''
  if (!/r\.isChannel \? \(\s*<>[\s\S]{0,600}?<span className="shrink-0 whitespace-nowrap[^"]*">쇼핑몰 이름<\/span>\s*<button[^>]*onClick=\{\(\) => openChannelSheet\(r\.vendor\)\}[^>]*>쇼핑몰로<\/button>/.test(vm)) violations.push(`${FC} VendorManageModal. 쇼핑몰 목록 이름 행이 저장·합치기를 숨기고 '쇼핑몰 이름' 캡션과 '쇼핑몰로' 행 동작을 세우지 않는다`)
  if (!/\{!selMode && !r\.isChannel && \(/.test(vm)) violations.push(`${FC} VendorManageModal. 쇼핑몰 목록 이름 행에 비움이 남았다`)
  if (!/const canMerge = picked\.length >= 2 && !picked\.some\(x => x\.isChannel\)/.test(vm) || !/\{canMerge && \(/.test(vm)) violations.push(`${FC} VendorManageModal. 알약 합치기가 하나만 골랐거나 쇼핑몰 이름이 섞여도 선다(서버가 거부하는 동작)`)
  if (!/targets: picked\.filter\(x => !x\.isChannel\)/.test(vm)) violations.push(`${FC} VendorManageModal. 합치기 시트 후보에 쇼핑몰 목록 이름이 남는다`)
  if (!/\{VENDOR_CHANNEL_LOCKED\}/.test(vm) || !/return \{ ok: false, error: VENDOR_CHANNEL_LOCKED \}/.test(fa)) violations.push(`${FC}·${FA}. 막는 까닭이 화면과 서버에서 한 벌(VENDOR_CHANNEL_LOCKED)이 아니다`)
  if (!/className="flex-1 basis-32 min-w-\[8rem\]/.test(vm)) violations.push(`${FC} VendorManageModal. 구매처 이름 칸이 좁은 폭에서 0 까지 눌린다(최소 8rem)`)
  if (/'미기록'|>미기록</.test(fc)) violations.push(`${FC}. 화면 문장에 '미기록' 낱말이 남았다(운영자 말로 풀어 쓴다, splitSiblingsText)`)
  if ((fc.match(/결제대행사\(예: 네이버파이낸셜\)는 구매처에도 쇼핑몰에도 적지 않습니다\./g) ?? []).length < 2) violations.push(`${FC}. 등록·수정 폼 두 곳에 결제대행사 안내가 없다`)
  const bm = region(fc, 'BatchEditExpensesModal') ?? ''
  if (!/type="checkbox" checked=\{clearChannel\}/.test(bm) || !/쇼핑몰 비우기<\/span>/.test(bm)) violations.push(`${FC} BatchEditExpensesModal. 쇼핑몰 비우기가 호실 일괄 편집과 같은 체크박스 문법이 아니다`)
  const pr = read('components/dashboard/PendingReceiptSection.tsx')
  if (!/>쇼핑몰 \(선택 · 비우면 상호명과 같음\)<\/label>/.test(pr) || !/list=\{`pr-channels-\$\{row\.id\}`\}/.test(pr)) violations.push('components/dashboard/PendingReceiptSection.tsx. 홈 승인 카드 쇼핑몰 칸에 보이는 라벨·datalist 가 없다')
}
// ── ⓛ 구매처를 쇼핑몰 자리에 대신 쓰지 않는다 ─────────────────────
{
  const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (n === 'node_modules' || n.startsWith('.')) continue; if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(n)) out.push(p) } return out }
  const files = [...walk('app'), ...walk('components'), ...walk('lib')].filter(f => f !== 'lib/expenseChannel.ts')
  // 쇼핑몰 값 자리에 구매처를 끼워 넣는 모양: channel ?? vendor · channel || vendor · channel: …vendor · channel = …vendor
  const BAD = [
    /\bchannel[\w?.()]*\s*(\?\?|\|\|)\s*[\w?.()]*\bvendor\b/,
    /\bchannel\s*:\s*[\w?.()]*\bvendor\b/,
    /\bchannel\s*=\s*[\w?.()]*\bvendor\b/,
  ]
  for (const f of files) {
    const lines = strip(readFileSync(f, 'utf8')).split('\n')
    lines.forEach((ln, i) => {
      if (/statementName/.test(ln)) return   // 카드 명세 이름(쇼핑몰, 없으면 구매처)은 승인된 표시 자리다
      for (const re of BAD) if (re.test(ln)) violations.push(`${f}:${i + 1}. 구매처를 쇼핑몰 자리에 대신 쓴다. 비운 쇼핑몰은 미기록이다(lib/expenseChannel). 표시는 channelVendorLabel 을 쓴다`)
    })
  }
}

// ── 운영자 결정 2026-10-20 A·B·C 화면 ───────────────────────────────
{
  const FC = 'app/(app)/finance/FinanceClient.tsx'
  const fc = read(FC)
  if (/altLabel: '이 건만 바꾸기'/.test(fc)) violations.push(`${FC} 수정 폼. '이 건만 바꾸기' 갈래가 남았다(결정 B, 주문 전체에 적용 / 취소만)`)
  if (/altLabel: '고른 것만'/.test(fc)) violations.push(`${FC} 일괄 편집. '고른 것만' 갈래가 남았다(결정 B)`)
  // 2026-10-22 2차: 같은 옵션 덩이에 카테고리 '목록에 추가' 체크(addCategoryToList)가 함께 실린다.
  if (!/batchUpdateExpenses\(selectedIds, data, \{ \.\.\.\(withSiblings \? \{ channelToOrders: true \} : \{\}\), addCategoryToList: categoryToList \}\)/.test(fc)) violations.push(`${FC} 일괄 편집. '함께 적용' 을 서버 한 번(channelToOrders)으로 보내지 않는다`)
  if ((fc.match(/ORDER_CHANNEL_SPLIT_TAIL/g) ?? []).length < 3) violations.push(`${FC}. 주문 갈림 물음에 '먼저 주문에서 빼라' 안내가 없다(결정 B)`)
  for (const [state, v] of [['addExpChannel', 'addExpVendor'], ['editExpChannel', 'editExpVendor'], ['channel', 'vendor']]) {
    if (!new RegExp(`channelSameAsVendor\\(${state}, ${v}\\) &&`).test(fc)) violations.push(`${FC}. 쇼핑몰 칸(${state})이 구매처와 같을 때 비워 두라는 안내가 없다(결정 A)`)
  }
  if (!/const next = rowChannel\(channelForSave\(String\(fd\.get\('channel'\)/.test(fc)) violations.push(`${FC} 수정 폼. 갈림 물음이 구매처와 같은 이름을 비운 값으로 보지 않는다(결정 A)`)
  // 재검수 2026-10-20 화면 넷: 인라인 경고 문장·알약 카운트 정본 문법·창 제목 갈래·꼬리 문장 조건
  if (!/저장할 때 \{next \? '주문 전체에 적용할지' : '주문 전체의 쇼핑몰을 비울지'\} 묻습니다\./.test(fc)) violations.push(`${FC} 수정 폼. 인라인 갈림 경고가 '주문 전체에 비우기할지' 꼴이다`)
  if (!/<SelectionPillBar count=\{sel\.size\} unit="곳" compactNarrow /.test(fc) || !/max-\[359px\]:hidden/.test(read('components/ui/inventory/SelectionPillBar.tsx'))) violations.push(`${FC} 구매처 관리 알약. 카운트가 정본 'N곳 선택' 문법이 아니거나 좁은 폭 줄임이 없다`)
  if (!/title=\{chMode === 'move' \? '쇼핑몰로 옮기기' : '쇼핑몰 지정'\}/.test(fc)) violations.push(`${FC} 쇼핑몰 창. 제목이 갈래(옮기기·지정)를 따르지 않는다`)
  if (/[^?] ' ' \+ ORDER_CHANNEL_SPLIT_TAIL,/.test(fc) || !/split\.names\.length \? ' ' \+ ORDER_CHANNEL_SPLIT_TAIL : ''/.test(fc) || !/named \? ` \$\{ORDER_CHANNEL_SPLIT_TAIL\}` : ''/.test(fc)) violations.push(`${FC}. '먼저 주문에서 빼라' 꼬리가 다른 이름의 형제가 없을 때도 붙는다`)
  if (/구매처와 사업자등록번호가 비워집니다|구매처와 사업자등록번호를 비웁니다/.test(fc)) violations.push(`${FC} 구매처 관리. 비우기·옮기기 문구가 사업자번호도 비운다고 말한다(결정 C)`)
}

if (violations.length) {
  console.error(`[구매처·쇼핑몰 배선] 위반 ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log('[구매처·쇼핑몰 배선] 위반 0건')
