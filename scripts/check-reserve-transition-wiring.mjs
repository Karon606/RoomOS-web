// 입실 예약 흐름 배선 감지(신고 507e1a0d 안 A) — 실행: node scripts/check-reserve-transition-wiring.mjs
//
// 지키는 것.
//   ⓐ 입실 예약 상태의 버튼 줄은 주 버튼이 하나다(§22). 확정 전에는 '예약 확정', 확정 뒤에는 '입실 처리' 가 주 버튼이다.
//   ⓑ '입실 예약 전환' 미니폼은 값을 lib/reserveTransition 에서 만든다(제출 reserveSubmitFields·선검사 reserveConfirmDenial,
//      성공 토스트의 적용취소 reserveUndo 를 runUndoAfter 로). 체크 칸 '바로 예약 확정' 은 캡션과 aria-describedby 로 잇는다.
//   ⓒ 입주자 수정 폼의 입실 예약 캡션이 동작과 반대로 말하지 않는다('확정을 체크하면 방을 잡는다' 류 금지).
//   ⓓ 상태 전환 서버는 점유에서 투어 단계로 물리면 그 방을 놓는다(적용취소 왕복이 공실을 되돌리는 근거).
//   ⓔ 토스트 적용취소는 기대값(expect)을 싣고, 서버는 쓰기 전에 대조하고 같은 조건의 updateMany 로 쓴다(§27.1 CAS, 독립 검수 B1).
//
// 그물은 주석을 안 본다 — 설명 글자가 걸리거나 통과시키지 않게 주석을 먼저 걷는다.
import { readFileSync } from 'node:fs'

const WIDGET = 'components/entity-modal/widgets/TenantStatusTransitions.tsx'
const FORM = 'app/(app)/tenants/TenantClient.tsx'
const SERVER = 'app/(app)/tenants/actions.ts'

const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function blockAfter(src, anchor) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  const open = src.indexOf('{', at + anchor.length - 1)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return null
}

const errs = []
const w = strip(readFileSync(WIDGET, 'utf8'))

// ⓐ 입실 예약 버튼 줄
const resvAt = w.indexOf("case 'RESERVED': return [")
const resvEnd = resvAt < 0 ? -1 : w.indexOf("case 'ACTIVE':", resvAt)
const resv = resvAt < 0 || resvEnd < 0 ? null : w.slice(resvAt, resvEnd)
if (!resv) errs.push(`ⓐ ${WIDGET} 입실 예약 전이 목록을 못 찾음`)
else {
  const fixedPrimary = (resv.match(/tone:\s*'primary'/g) ?? []).length
  if (fixedPrimary !== 1) errs.push(`ⓐ 입실 예약 줄에 고정 주 버튼이 ${fixedPrimary}개(확정 전 '예약 확정' 하나여야 한다)`)
  const moveIn = resv.match(/\{\s*key:\s*'moveIn'[^}]*\}/)
  if (!moveIn || !/tone:\s*confirmed\s*\?\s*'primary'\s*:\s*'secondary'/.test(moveIn[0])) errs.push("ⓐ '입실 처리' 는 확정 전 secondary, 확정 뒤 primary 여야 한다")
  if (!/key:\s*'unconfirm'[^}]*tone:\s*'secondary'/.test(resv)) errs.push("ⓐ '확정 적용취소' 는 secondary 여야 한다")
}

// ⓑ 미니폼 값과 적용취소
const submit = blockAfter(w, 'const submit = async () =>')
if (!submit) errs.push(`ⓑ ${WIDGET} submit 을 못 찾음`)
else {
  const br = blockAfter(submit, "if (active.def.key === 'reserve') {")
  if (!br || !/reserveConfirmDenial\(/.test(br) || !/reserveSubmitFields\(/.test(br)) errs.push('ⓑ 입실 예약 전환 제출이 reserveConfirmDenial·reserveSubmitFields 를 거치지 않는다')
}
const ok = blockAfter(w, "} else if (def.key === 'reserve') {")
if (!ok || !/reserveUndo\(/.test(ok) || !/runUndoAfter\(/.test(ok) || !/label:\s*'적용취소'/.test(ok)) errs.push('ⓑ 입실 예약 전환 성공 토스트에 reserveUndo 적용취소가 없다')
if (!/const runUndoAfter = \([\s\S]{0,600}?applyStatusTransition\(\{[^}]*\.\.\.\(u\.fields \?\? \{\}\)/.test(w)) errs.push('ⓑ runUndoAfter 가 적용취소 값(fields)을 싣지 않는다')
if (!/바로 예약 확정/.test(w)) errs.push("ⓑ 체크 칸 '바로 예약 확정' 이 없다")
if (!/checked=\{confirmNow\}[\s\S]{0,200}aria-describedby=\{confirmHintId\}/.test(w) || !/id=\{confirmHintId\}/.test(w)) errs.push('ⓑ 체크 칸과 캡션이 aria-describedby 로 이어지지 않는다')
if (!/applyStatusTransition\(\{ leaseTermId: lease\.id, tenantId, toStatus: u\.toStatus, \.\.\.\(u\.fields \?\? \{\}\), expect: u\.expect \}\)/.test(w)) errs.push('ⓔ runUndoAfter 가 기대값(expect)을 싣지 않는다')
if (!/expect:\s*NonNullable</.test(w)) errs.push('ⓔ runUndoAfter 의 expect 가 필수가 아니다(빠뜨린 적용취소가 대조 없이 돈다)')
{
  if (!/const undoable = base && \{ \.\.\.base, expect: \{ status: def\.toStatus/.test(w)) errs.push('ⓔ 기존 토스트 적용취소(UNDO_AFTER)가 기대값을 싣지 않는다')
}
if (!/dirty=\{[^}]*confirmNow/.test(w)) errs.push('ⓑ 체크 칸을 켠 미니폼이 dirty 로 잡히지 않는다')

// ⓒ 수정 폼 캡션
const f = strip(readFileSync(FORM, 'utf8'))
if (/방을 실제로 잡아/.test(f) || /입주 의사만 받은 상태/.test(f)) errs.push(`ⓒ ${FORM} 입실 예약 캡션이 종전 문장(확정해야 방을 잡는다)을 말한다`)
if (!/호실을 고르면 그 방은 바로 잡힙니다/.test(f)) errs.push(`ⓒ ${FORM} 입실 예약 캡션이 '호실을 고르면 그 방은 바로 잡힙니다' 를 말하지 않는다`)

// ⓓ 서버 공실
const srv = strip(readFileSync(SERVER, 'utf8'))
const fnAt = srv.search(/export async function applyStatusTransition\(/)
const fn = fnAt < 0 ? '' : srv.slice(fnAt, srv.indexOf('\nexport ', fnAt + 10))
if (!/const vac = roomVacantForStatus\(input\.toStatus\)\s*\?\?\s*\(\['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'\]\.includes\(lease\.status\) && \['WAITING_TOUR', 'TOUR_DONE'\]\.includes\(input\.toStatus\) \? true : null\)/.test(fn)) {
  errs.push('ⓓ applyStatusTransition 이 점유에서 투어 단계로 물릴 때 방을 놓지 않는다')
}

// ⓔ 서버 CAS
if (!/const casWhere = transitionExpectWhere\(input\.expect\)\s*\n\s*if \(casWhere && !transitionExpectHolds\(lease, casWhere\)\) return/.test(fn)) errs.push('ⓔ applyStatusTransition 이 쓰기 전에 기대값을 대조하지 않는다')
if (!/if \(casWhere\) \{[\s\S]{0,400}prisma\.leaseTerm\.updateMany\(\{ where: \{ id: input\.leaseTermId, propertyId, \.\.\.casWhere \}, data \}\)[\s\S]{0,120}count === 0\) return/.test(fn)) errs.push('ⓔ applyStatusTransition 의 적용취소 쓰기가 같은 조건 updateMany(0행 거부)가 아니다')
const rt = strip(readFileSync('lib/reserveTransition.ts', 'utf8'))
if (!/expect: \{ status: 'RESERVED', reservationConfirmedAt: wrote\.confirmedYmd, moveInDate: wrote\.moveInYmd, moveInFlexible: flexAfter \}/.test(rt)) errs.push('ⓔ reserveUndo 기대값이 전환이 쓴 네 칸(상태·확정·희망일·조절 여부)이 아니다')
if (!/moveInFlexible: prev\.moveInFlexible/.test(rt)) errs.push('ⓔ reserveUndo 가 조절 여부를 되돌리지 않는다(독립 검수 R1)')

console.log(`[입실 예약 흐름 배선] 축 ⓐ 주 버튼 하나 · ⓑ 바로 예약 확정 값·적용취소 · ⓒ 수정 폼 캡션 · ⓓ 투어 단계로 물리면 방을 놓음 · ⓔ 적용취소 기대값 대조 / 위반 ${errs.length}건`)
if (errs.length) { for (const e of errs) console.error('  ' + e); process.exit(1) }
