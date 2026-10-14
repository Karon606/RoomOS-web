// 현금영수증 발행 금액을 화면이 말하는 문장 정본. 수납 행 캡션·탭 메타·폼 힌트·확인창·토스트가 한 벌을 쓴다.
//
// 왜 한 파일인가(2026-10-13 422호 신고, 2단계 화면). 수납 행은 받은 금액 410,000 과 '10/12 발행'만
// 말했고 발행 줄은 420,000 이었다. 화면 어디에도 발행 금액이 없어 운영자가 410,000 발행으로 읽었다.
// 같은 사실을 수납 행·현금영수증 탭·입주자 수납 모달·수정 폼이 각자 문장으로 적으면 자리마다 말이
// 갈린다(실제로 수정 폼 힌트는 행 금액을, 등록 폼은 받은 금액을 기준으로 따로 적고 있었다). 그래서
// 짧은형(목록 캡션 '많음·적음')과 문장형(폼 '많습니다.·적습니다.')을 여기 한 곳에서 낸다.
//
// 기준은 **행 금액이 아니라 키(계약·입금일·수단)의 이용료 합**이다. 발행은 키 하나에 한 장이고 한 결제가
// 여러 달로 쪼개지면 같은 키에 행이 여럿이다. 행 금액과 비교하면 분할 결제마다 거짓 경보가 선다(결함 D12).
// 서버가 행마다 싣는 cashReceiptKey.rent 가 그 합이다(점검 (바)와 같은 정본 식).
//
// 단 **일부만 도장 찍힌 키는 도장 찍힌 몫과 견준다**(독립 검수 R-2, 2026-10-14). 발행 없이 받은 앞 입금은 뒤
// 입금의 발행이 덮지 않는 것이 정상 상태다(검수 R4b). 키 전체 합과 견주면 그 덮이지 않은 돈 때문에 '적음' 경고가
// 늘 선다. '같은 날 입금 N건'의 N 도 도장 찍힌 행 수다(행 캡션과 탭이 같은 기준).
//
// 차이 표시는 **다를 때만** 선다(운영자 결정 2026-08-25). 같으면 침묵이고, 침묵이 곧 '받은 금액 그대로
// 발행'이다. 경고색은 목록에만 쓰고 입력 폼은 쓰지 않는다(같은 결정). 이 파일은 문장만 내고 색은 tone 으로 넘긴다.
import { fmtWon } from './fmtMoney'
import { fmtMD } from './fmtDate'
import type { CashReceiptLineView } from './cashReceipt'

/** 행마다 서버가 싣는 키 정보(getPaymentsByLease 의 cashReceiptKey). 줄은 살아 있는 줄만이다. */
export type CashReceiptKeyView = { line: CashReceiptLineView | null; rent: number; rentRows: number; stampedRentRows: number; unstampedRent: number }

/**
 * 발행 금액과 견줄 받은 몫. 도장 찍힌 행이 있으면 키 합에서 도장 없는 이용료 행(아직 어느 영수증에도 안 든 돈)을
 * 뺀다. 다 찍혀 있으면 키 합 그대로다. 행 캡션·탭·수정 폼 힌트가 이 한 식을 쓴다.
 */
export function crCoveredRent(k: { rent: number; unstampedRent: number; stampedRentRows: number }): number {
  return k.stampedRentRows > 0 ? k.rent - k.unstampedRent : k.rent
}

/** 캡션 한 조각. strong 이면 숫자라 굵게·본문색으로 그린다. */
export type CrPart = { text: string; strong?: boolean }
/**
 * 수납 행 캡션. 덩이는 둘(긴 문장은 셋)이고 각 덩이는 한 줄로 붙어 다닌다(whitespace-nowrap). 아주 큰
 * 글자에서도 비교어와 금액이 갈라지지 않고 덩이 사이에서만 접힌다.
 *
 * 구분점(·)은 **앞 덩이 끝에 붙는다**(2026-10-14 웹디자이너 패스 R1). 뒤 덩이 머리에 두면 접혔을 때 둘째 줄이
 * '·' 로 시작해 앞 줄과 끊긴 낱말처럼 읽힌다. 한 줄에 다 서면 글자는 종전과 같다(crCaptionText 가 같은 문장을 낸다).
 *
 * 셋째 덩이가 생기는 자리는 둘이다(2026-10-14 하네스 실측). 320px·아주 크게(20px)에서 행 안쪽 폭이 200px 인데
 * '같은 날 입금 2건 합계보다 120,000원 적음' 한 덩이가 넘쳤다. 그래서 주어('같은 날 입금 2건')와
 * 비교('합계보다 120,000원 적음')를 가른다. 비교어·금액·많음/적음은 한 덩이로 남는다. 위험 문장도 '있고' 에서 가른다.
 */
export type CrCaption = { tone: 'warning' | 'muted' | 'danger'; chunks: CrPart[][] }

/** 캡션을 한 줄 글자로. 테스트와 화면 밖 대조용. */
export function crCaptionText(c: CrCaption): string {
  return c.chunks.map(ch => ch.map(p => p.text).join('')).join(' ')
}

/** 비교어. 짧은형은 목록, 문장형은 폼이다. 두 자리가 같은 낱말을 쓰게 한 함수에서 낸다. */
function gapWord(diff: number, form: 'short' | 'sentence'): string {
  if (form === 'short') return diff > 0 ? '많음' : '적음'
  return diff > 0 ? '많습니다.' : '적습니다.'
}

/**
 * 발행에 든 예외 몫의 낱말. 현금영수증 탭 발행 내역이 쓰는 낱말과 같다(받을 때 보증금·청소비는 발행
 * 대상이 아니라 예외다, 운영자 확정 2026-09-21). 몫 금액은 표에 없어(불리언만 저장) 숫자를 안 붙인다.
 */
export function crInclLabel(l: { inclDeposit: boolean; inclCleaning: boolean }): string {
  if (l.inclDeposit && l.inclCleaning) return '보증금·청소비 포함'
  if (l.inclDeposit) return '보증금 포함'
  if (l.inclCleaning) return '청소비 포함'
  return ''
}

/**
 * 수납 행 3번째 줄 캡션. 발행 표시가 있는 행에만, 발행 금액이 키의 이용료 합과 다를 때만 선다.
 *
 *   다름        '발행 금액 420,000원 · 받은 금액보다 10,000원 많음'(경고색)
 *               같은 키에 도장 찍힌 이용료 행이 2건 이상이면 '· 같은 날 입금 2건 합계보다 …'(그 키의 각 행에)
 *   같고 합산   '발행 금액 420,000원 · 같은 날 입금 2건 합산'(보조색). 행 금액만 보고 410,000 발행으로
 *               읽은 것이 422호의 첫 오해라, 금액이 같아도 한 장이 여러 행을 덮으면 말한다.
 *   예외 몫     '발행 금액 1,410,000원 · 보증금 포함'(경고색, 숫자 없이)
 *   줄 없음     '발행 표시만 있고 발행 기록이 없음 · 발행 합계에서 빠짐'(위험색, 방어. 정상 경로로는 안 생긴다)
 */
export function cashReceiptRowCaption(input: { stamped: boolean; key: CashReceiptKeyView | null | undefined }): CrCaption | null {
  if (!input.stamped) return null
  const line = input.key?.line
  if (!input.key || !line) {
    return { tone: 'danger', chunks: [[{ text: '발행 표시만 있고' }], [{ text: '발행 기록이 없음 ·' }], [{ text: '발행 합계에서 빠짐' }]] }
  }
  const head: CrPart[] = [{ text: '발행 금액 ' }, { text: fmtWon(line.amount), strong: true }, { text: ' ·' }]
  const incl = crInclLabel(line)
  if (incl) return { tone: 'warning', chunks: [head, [{ text: incl }]] }
  const diff = line.amount - crCoveredRent(input.key)
  const n = input.key.stampedRentRows
  if (diff === 0) {
    return n >= 2 ? { tone: 'muted', chunks: [head, [{ text: `같은 날 입금 ${n}건 합산` }]] } : null
  }
  const gap: CrPart[] = [{ text: fmtWon(Math.abs(diff)), strong: true }, { text: ` ${gapWord(diff, 'short')}` }]
  return {
    tone: 'warning',
    chunks: n >= 2
      ? [head, [{ text: `같은 날 입금 ${n}건` }], [{ text: '합계보다 ' }, ...gap]]
      : [head, [{ text: '받은 금액보다 ' }, ...gap]],
  }
}

/**
 * 현금영수증 탭 발행 내역 행의 메타 끝 조각. 그 행의 큰 숫자가 발행 금액이라 받은 금액이 화면에 없어서
 * 받은 금액을 숫자로 적는다. 예외 몫(보증금·청소비 포함)은 같은 행이 이미 그 낱말을 적으므로 덧붙이지 않는다.
 *
 * 덩이(units)로도 낸다. 조각 전체를 한 줄로 묶으면(whitespace-nowrap) 메타 칸보다 길어 넘친다(2026-10-14 하네스
 * 실측. 360px 기본 글자에서 32px, 320px·아주 크게에서 170px). 덩이마다 한 줄로 묶고 덩이 사이에서만 접는다.
 * 금액과 '많음·적음'은 한 덩이다. 덩이 안 숫자는 strong 이라 수납 행 캡션처럼 굵게·본문색으로 그린다(웹디자이너 F3).
 * 비교 기준·'합산' 판정은 수납 행 캡션과 같다(crCoveredRent, 도장 찍힌 행 수, 독립 검수 R-2).
 */
export function cashReceiptTabGap(r: { amount: number; received: number; stampedRentRows: number; unstampedRent: number; inclDeposit: boolean; inclCleaning: boolean }):
  { tone: 'warning' | 'muted'; text: string; units: CrPart[][] } | null {
  if (r.inclDeposit || r.inclCleaning) return null
  const basis = crCoveredRent({ rent: r.received, unstampedRent: r.unstampedRent, stampedRentRows: r.stampedRentRows })
  const diff = r.amount - basis
  const out = (tone: 'warning' | 'muted', units: CrPart[][]) => ({ tone, units, text: units.map(u => u.map(p => p.text).join('')).join(' ') })
  if (diff !== 0) {
    return out('warning', [
      [{ text: '받은 금액' }],
      [{ text: fmtWon(basis), strong: true }, { text: '보다' }],
      [{ text: fmtWon(Math.abs(diff)), strong: true }, { text: ` ${gapWord(diff, 'short')}` }],
    ])
  }
  return r.stampedRentRows >= 2 ? out('muted', [[{ text: `같은 날 입금 ${r.stampedRentRows}건 합산` }]]) : null
}

/**
 * 폼 힌트(문장형). 수납 등록 폼과 수납 수정 폼이 글자까지 같은 문장을 쓴다. 같으면 null.
 * 폼은 경고색을 안 쓴다(운영자 결정 2026-08-25). 색은 부르는 쪽이 --warm-mid 로 둔다.
 */
export function cashReceiptGapSentence(amount: number, basis: number): string | null {
  const diff = amount - basis
  if (diff === 0) return null
  return `받은 금액 ${fmtWon(basis)}보다 ${fmtWon(Math.abs(diff))} ${gapWord(diff, 'sentence')}`
}

// ── 켜기 확인 줄 ─────────────────────────────────────────────

/**
 * 살아 있는 줄에 새 돈만 더하는 켜기(add)의 확인 줄 캡션. 발행일은 앞 발행의 날짜를 지킨다(독립 검수 F4).
 * 확인 줄의 발행일 칸에서 다른 날을 골라도 그 날짜는 안 쓰인다. 그래서 지켜지는 날짜를 금액 바로 밑에 적는다.
 */
export function crAddPreviewChunks(prev: { amount: number; issuedYmd: string }, added: number): [string, string] {
  return [`기존 발행 ${fmtWon(prev.amount)}(${fmtMD(prev.issuedYmd)})에 ${fmtWon(added)} 더함`, `· 발행일 ${fmtMD(prev.issuedYmd)} 유지`]
}

/** 이미 다 덮인 키(보증금 행 켜기 등)의 확인 줄 캡션. 켜도 바뀌는 것이 없다. */
export const CR_KEEP_PREVIEW = '이미 같은 날 발행에 들어 있어 바뀌는 것이 없습니다.'
/** 이용료 몫이 없어 켤 수 없는 키의 확인 줄 캡션. 서버 거부 문장(setCashReceiptIssued)과 같은 사실이다. */
export const CR_NONE_PREVIEW = '이용료 몫이 없어 발행할 금액이 없습니다. 보증금·청소비는 받을 때 대상이 아닙니다.'

// ── 토스트 ─────────────────────────────────────────────────

/** 서버가 알려 준 '발행 금액과 받은 금액이 다르다'. 금액은 자동으로 안 덮었다(국세청 금액 보호). */
export function crMismatchSentence(m: { lineAmount: number; basis: number }): string {
  return `발행 금액 ${fmtWon(m.lineAmount)}이 받은 금액 ${fmtWon(m.basis)}과 다릅니다.`
}

/**
 * 원터치 켜기 결과 토스트. keep(이미 다 덮인 키라 아무것도 안 바뀜)은 성공처럼 말하지 않고 사실대로
 * 알린다. 바뀐 것이 없으니 적용취소도 달지 않는다(가짜 적용취소 금지, §16).
 *
 * 제목은 일괄 발행 토스트('N건 발행 기록됨 · 발행일 M/D')·확인 줄 버튼('발행 기록')과 같은 문법이다(웹디자이너
 * 패스 R5). 종전 '발행으로 표시했습니다 · …' 꼴은 320px 에서 3줄이었다. 이 꼴은 2줄이다.
 */
export function crOnToast(r: {
  change: 'create' | 'rebuild' | 'add' | 'keep' | 'off'
  line: CashReceiptLineView | null
  added?: { added: number; issuedYmd: string }
}, requestedYmd: string): { kind: 'success' | 'info'; message: string; detail?: string; undoable: boolean } {
  if (r.change === 'keep') {
    return {
      kind: 'info', message: '이미 같은 날 발행에 들어 있습니다', undoable: false,
      ...(r.line ? { detail: `바뀐 것이 없습니다. 발행 금액 ${fmtWon(r.line.amount)} · 발행일 ${fmtMD(r.line.issuedYmd)}` } : {}),
    }
  }
  const message = r.line
    ? `현금영수증 발행 기록됨 · 발행일 ${fmtMD(r.line.issuedYmd)} · ${fmtWon(r.line.amount)}`
    : `현금영수증 발행 기록됨 · 발행일 ${fmtMD(requestedYmd)}`
  const detail = r.change === 'add' && r.added
    ? `기존 발행에 ${fmtWon(r.added.added)}을 더했습니다. 발행일은 ${fmtMD(r.added.issuedYmd)} 그대로입니다.`
    : undefined
  return { kind: 'success', message, undoable: true, ...(detail ? { detail } : {}) }
}

/**
 * 원터치 끄기 결과 토스트의 둘째 줄. 그 달 발행 합계에서 얼마가 빠지는지 말한다. 발행월은 발행일의
 * KST 달이다(합계의 축, lib/cashReceipt 머리말). 한 장이 여러 행을 덮었으면 그 행들도 함께 내려간다.
 *
 * 합산 문장은 짧은 꼴이다(2026-10-14 하네스 실측). 토스트 둘째 줄은 3줄까지인데(가이드 §15) '같은 날 받은 2건의
 * 합산 발행 …을 함께 내려 …' 꼴은 320px 에서 4~5줄이었다. 같은 뜻을 한 문장 머리에 모으고 홈택스 문장을 줄였다.
 * 행 캡션·탭과 같은 낱말 '같은 날 입금 N건'을 쓴다(웹디자이너 패스 F4, 같은 사실을 다른 말로 부르지 않는다). 그 낱말은
 * 금액 뒤 괄호 부연이다. '같은 날 입금 2건 합산 1,230,000원이' 꼴은 320px·아주 크게(20px)에서 4줄이었다(하네스 실측).
 */
export function crOffToastDetail(dropped: CashReceiptLineView | null | undefined, stampedRows: number): string {
  if (!dropped) return '발행 기록이 없던 표시라 발행 합계는 그대로입니다.'
  const mon = Number(dropped.issuedYmd.slice(5, 7))
  if (stampedRows >= 2) return `${mon}월 발행 합계에서 ${fmtWon(dropped.amount)}(같은 날 입금 ${stampedRows}건)이 빠집니다. 홈택스 영수증은 그대로입니다.`
  return `${mon}월 발행 합계에서 ${fmtWon(dropped.amount)}이 빠집니다. 홈택스에 발행한 영수증은 그대로입니다.`
}

/** 적용취소 결과 토스트. §16 형식 "{목적어}를 적용취소했습니다 · {복귀}"(감지망 check-undo-verb). */
export const CR_ON_UNDONE = '현금영수증 발행 표시를 적용취소했습니다 · 미발행으로 복귀'
/**
 * 켜기의 적용취소 결과. 살아 있는 발행에 새 돈을 더한(add) 켜기나 환불 확정 재발행을 무르면 앞 발행이 그대로
 * 돌아온다. 그때 '미발행으로 복귀'는 거짓이라 돌아온 금액을 말한다(undoCashReceiptChange 의 line).
 */
export function crOnUndoneMessage(line: { amount: number } | null | undefined): string {
  return line ? `현금영수증 발행 표시를 적용취소했습니다 · 발행 ${fmtWon(line.amount)}으로 복귀` : CR_ON_UNDONE
}
export function crOffUndoneMessage(line: { amount: number } | null | undefined): string {
  return line ? `발행 표시 해제를 적용취소했습니다 · 발행 ${fmtWon(line.amount)}으로 복귀` : '발행 표시 해제를 적용취소했습니다 · 발행으로 복귀'
}
export const CR_DELETE_UNDONE = '수납 기록 삭제를 적용취소했습니다 · 원래 자리로 복귀'

/** 적용취소가 되살린 금액이 지금 받은 돈과 다를 때의 둘째 줄. 없으면 undefined. */
export function crUndoMismatchDetail(mismatch: { lineAmount: number; basis: number }[] | undefined): string | undefined {
  return mismatch && mismatch.length > 0 ? crMismatchSentence(mismatch[0]) : undefined
}

// ── 수납 삭제 ─────────────────────────────────────────────────

/**
 * 삭제 확인창 본문에 덧붙일 한 줄(previewPaymentDelete 결과). 본문 끝 줄(적용취소 안내) 앞에 선다.
 *   drop  이 삭제로 그 키에 덮을 돈이 안 남아 발행 기록을 함께 지운다.
 *   keep  형제가 남아 발행 기록은 그대로인데 이 삭제로 발행 금액과 받은 돈이 달라진다.
 *         금액이 그대로 맞으면(덮지 않던 행을 지우는 경우) 말할 것이 없다.
 *   none  덧붙이지 않는다.
 *
 * 홈택스 쪽은 앱이 하지 않는 일이라 서술형('취소합니다')으로 적지 않고 운영자에게 청한다(웹디자이너 패스 F5,
 * lib/refundTaxNotice 의 '홈택스에서 … 취소해 주세요' 문법). 줄을 말할 때는 '발행 기록 X원'이다(R6).
 */
export function crDeleteConfirmLine(pv: { effect: 'none' | 'drop' | 'keep'; line: { amount: number } | null; basisAfter: number } | null | undefined): string | null {
  if (!pv || !pv.line) return null
  if (pv.effect === 'drop') {
    return `이 입금의 현금영수증 발행 기록 ${fmtWon(pv.line.amount)}도 함께 지웁니다. 홈택스에 발행한 영수증은 그대로이니 필요하면 홈택스에서 취소해 주세요.`
  }
  if (pv.effect === 'keep' && pv.line.amount !== pv.basisAfter) {
    return `같은 날 입금과 묶인 현금영수증 발행 기록 ${fmtWon(pv.line.amount)}은 그대로 남습니다. 삭제 뒤 발행 금액을 확인해 주세요.`
  }
  return null
}

/**
 * 수납이 빠진 뒤의 결과 둘째 줄(deletePayment·일괄 수납 적용취소·등록 적용취소·예약 선납 취소의 cashReceipt).
 * 없으면 undefined. 서버가 계산한 drop·mismatch 를 버리지 않고 말하는 한 자리다(독립 검수 R-4).
 */
export function crDeleteToastDetail(r: { dropped: { amount: number }[]; mismatch: { lineAmount: number }[] } | undefined): string | undefined {
  if (!r) return undefined
  if (r.dropped.length > 0) return `현금영수증 발행 기록 ${fmtWon(r.dropped.reduce((s, d) => s + d.amount, 0))}도 함께 지웠습니다.`
  if (r.mismatch.length > 0) return `남은 수납의 현금영수증 발행 기록 ${fmtWon(r.mismatch[0].lineAmount)}은 그대로입니다.`
  return undefined
}

/** 삭제 적용취소 결과 토스트의 둘째 줄(restorePayment 의 cashReceipt). 없으면 undefined. */
export function crRestoreDetail(r: { revived: { amount: number }[]; mismatch: { lineAmount: number; basis: number }[] } | undefined): string | undefined {
  if (!r) return undefined
  const parts: string[] = []
  if (r.revived.length > 0) parts.push(`현금영수증 발행 기록 ${fmtWon(r.revived.reduce((s, v) => s + v.amount, 0))}도 되살렸습니다.`)
  if (r.mismatch.length > 0) parts.push(crMismatchSentence(r.mismatch[0]))
  return parts.length > 0 ? parts.join(' ') : undefined
}

// ── 수납 수정 ─────────────────────────────────────────────────

/** updatePayment 가 돌려주는 발행 줄 효과(rooms/cashReceiptLine PaymentEditEffect)에서 화면이 읽는 몫. */
export type CrEditEffectView = {
  line: { amount: number; issuedYmd: string } | null
  dropped?: { amount: number }
  transferred?: { amount: number }
  merged?: { prevAmount: number; amount: number }
  added?: { prevAmount: number; added: number; amount: number; issuedYmd: string }
  kept?: true
  notIssued?: string
  unstamped?: boolean
  mismatch: { lineAmount: number; basis: number }[]
}

/**
 * 수납 수정 저장 토스트의 둘째 줄. 발행 줄에 일어난 일 중 **가장 중요한 하나**를 말한다.
 *
 * 하나만 말하는 까닭(2026-10-14 하네스 실측). 토스트 둘째 줄은 3줄까지인데(가이드 §15) 320px 에서 한 줄이 16자
 * 남짓이라 두 문장이면 4~5줄이 됐다. 나머지는 저장 뒤 다시 그려지는 행 캡션(받은 금액과 다를 때)이 말한다.
 *
 * 입금일·수단을 옮기면(moved) 발행이 함께 옮겨 가거나(transfer) 옮긴 날의 발행과 합쳐지거나(merge)
 * 원래 날의 발행 안에 남아 도장만 빠진다(unstamp). 그때 서버는 폼의 발행 금액 칸을 쓰지 않는다(칸의
 * 프리필이 옛 키 금액이라, 쓰면 합친 결과를 옛 금액으로 덮는다, 검수 F1). 운영자가 칸을 고쳤으면 그것이 첫째다.
 * 금액 전환은 화살표로 적는다(값 전환 표기, 가이드 §29).
 */
export function crEditToastDetail(e: CrEditEffectView | undefined, opts: {
  /** 입금일·수단을 옮겼다(서버와 같이 엄격 비교). */
  moved: boolean
  /** 저장 전·후 이 행의 발행 표시. 입주자 수납 모달처럼 표시를 안 보내는 폼은 둘이 같다. */
  wasStamped: boolean; nowStamped: boolean
  /** 운영자가 발행 금액 칸을 고쳐 저장에 실었다. */
  amountEdited: boolean
  /** 저장 전 이 행 키의 살아 있는 발행 금액. */
  beforeAmount: number | null
  /**
   * 저장 전 이 행 키에서 도장이 찍혀 있던 이용료 행 수. 끄면 그 행들의 도장이 함께 지워진다(키 단위, 결함 D7).
   * 2 이상이면 끄기 문장이 그 사실을 말한다(원터치 끄기 토스트와 같은 낱말).
   */
  stampedRows?: number
}): string | undefined {
  if (!e) return undefined
  // 서버 문장의 첫 문장만. 둘째 문장(보증금·청소비 설명)은 등록 폼이 이미 상시로 적는다.
  if (e.notIssued) return e.notIssued.split('. ')[0].replace(/\.?$/, '.')
  if (opts.amountEdited && (e.transferred || e.merged || e.unstamped)) return '입금일·수단이 바뀌어 직접 고친 발행 금액은 반영하지 않았습니다.'
  if (e.added) {
    return e.added.amount === e.added.prevAmount + e.added.added
      ? `기존 발행에 ${fmtWon(e.added.added)}을 더했습니다. 발행일은 ${fmtMD(e.added.issuedYmd)} 그대로입니다.`
      : `현금영수증 발행 금액 ${fmtWon(e.added.prevAmount)} → ${fmtWon(e.added.amount)}`
  }
  if (e.merged) return `옮긴 날의 발행과 합침 · 발행 금액 ${fmtWon(e.merged.prevAmount)} → ${fmtWon(e.merged.amount)}`
  if (e.transferred) return `현금영수증 발행 기록 ${fmtWon(e.transferred.amount)}도 함께 옮겼습니다.`
  if (e.unstamped) return '이 입금은 원래 날의 발행에 들어 있어 발행 표시만 뺐습니다.'
  if (e.dropped) return `원래 날의 현금영수증 발행 기록 ${fmtWon(e.dropped.amount)}을 지웠습니다.`
  if (e.kept) return '이미 같은 날 발행에 들어 있어 발행 금액은 그대로입니다.'
  if (!opts.moved) {
    if (e.line && opts.beforeAmount != null && opts.beforeAmount !== e.line.amount) {
      return `현금영수증 발행 금액 ${fmtWon(opts.beforeAmount)} → ${fmtWon(e.line.amount)}`
    }
    if (e.line && !opts.wasStamped && opts.nowStamped) {
      return `현금영수증 발행 기록됨 · 발행일 ${fmtMD(e.line.issuedYmd)} · ${fmtWon(e.line.amount)}`
    }
    if (!e.line && opts.wasStamped && !opts.nowStamped && opts.beforeAmount != null) {
      return (opts.stampedRows ?? 1) >= 2
        ? `같은 날 입금 ${opts.stampedRows}건 합산 현금영수증 발행 기록 ${fmtWon(opts.beforeAmount)}을 지웠습니다.`
        : `현금영수증 발행 기록 ${fmtWon(opts.beforeAmount)}을 지웠습니다.`
    }
  }
  return e.mismatch.length > 0 ? crMismatchSentence(e.mismatch[0]) : undefined
}
