// 배송비 행의 결제수단과 착불 배송비 미기록을 가르는 정본(순수). 지출 등록·주문 묶기·수령 자리·감지망이 한 벌로 쓴다.
//
// 왜(신고 6ab4f868·a016642e, 운영자 승인 2026-11-02). 배송비 행은 본품의 결제수단·계정·금융사를 그대로 복사해 태어났다.
// 착불 배송비는 택배 기사에게 받을 때 따로 내는 돈이라 본품이 신용카드여도 계좌이체·현금인 경우가 많다. 그래서 착불 5건이
// 모두 신용카드·미정산으로 태어났고, 운영자가 그중 4건을 손으로 계좌이체로 고쳤다. 판정 정본(lib/settleStatus)은 그대로 두고,
// 배송비 행이 자기 결제수단을 갖게 한다. 미정산 판정은 그 수단으로 정본이 내린다.
//
// 착불인데 금액을 모르면(받을 때 안다) 금액 없이 주문만 '착불' 로 세운다. 배송비 행은 만들지 않는다(0원 행 금지).
// 이 상태가 '배송비 미기록' 이다. 첫 수령 때 한 번 묻고, 비우면 지출 상세 [수정] 에서 적거나 '없었음' 으로 닫는다.

/** 배송비 결제수단 칸에서 '구매와 같은 결제수단' 을 뜻하는 값. 칸 값이 이것이면 본품 행의 수단·계정을 그대로 쓴다. */
export const SHIP_PAY_SAME = '__same__'

export type ShipType = '선불' | '착불' | '신용'
export type ShipPayChoice = { payMethod: string; accountId: string }

/** 결제구분이 바뀔 때의 기본값. 착불은 계좌이체(받을 때 따로 낸다), 선불·신용은 구매와 같은 수단. */
export function defaultShipPay(shipType: string | null | undefined): ShipPayChoice {
  return shipType === '착불' ? { payMethod: '계좌이체', accountId: '' } : { payMethod: SHIP_PAY_SAME, accountId: '' }
}

/** 첫 선택지 이름. 머리 결제의 이름(카드·계좌 이름, 없으면 수단)을 괄호에 넣는다. */
export function sameShipPayLabel(head: { payMethod: string | null | undefined; financeName?: string | null }): string {
  const name = (head.financeName ?? '').trim() || (head.payMethod ?? '').trim()
  return name ? `구매와 같은 결제수단 (${name})` : '구매와 같은 결제수단'
}

/**
 * 배송비 행이 쓸 결제수단·계정. choice 가 없거나 '같은 수단' 이면 머리 값 그대로다(종전 동작, 옛 화면이 보낸 값도 여기로 온다).
 * account 는 서버가 이 영업장에서 다시 읽은 계정이다(이름은 서버가 짓는다, 화면이 보낸 이름을 믿지 않는다).
 */
export function resolveShipPay(
  head: { payMethod: string | null; financialAccountId: string | null; financeName: string | null },
  choice: { payMethod?: string | null; accountId?: string | null } | null | undefined,
  account: { id: string; name: string } | null,
): { payMethod: string; financialAccountId: string | null; financeName: string | null } {
  const m = (choice?.payMethod ?? '').trim()
  if (!m || m === SHIP_PAY_SAME) {
    return { payMethod: head.payMethod || '계좌이체', financialAccountId: head.financialAccountId, financeName: head.financeName }
  }
  return { payMethod: m, financialAccountId: account?.id ?? null, financeName: account?.name ?? null }
}

/** 배송비 미기록. 착불 주문인데 배송비 행이 없다. */
export function isCodShipPending(order: { shippingType: string | null } | null | undefined, shipRowCount: number): boolean {
  return order?.shippingType === '착불' && shipRowCount === 0
}

/**
 * 수령 자리에서 착불 배송비를 물을 주문인가. 미기록 착불이고 그 주문 본품을 아직 하나도 안 받았다(첫 수령 때만 묻는다).
 * rows 는 그 주문의 행 전부(배송비 행 포함)다.
 */
export function asksCodAtReceipt(
  order: { shippingType: string | null } | null | undefined,
  rows: { isShipping: boolean; receivedAt: Date | string | null }[],
): boolean {
  if (!isCodShipPending(order, rows.filter(r => r.isShipping).length)) return false
  return rows.every(r => r.isShipping || r.receivedAt == null)
}

// ── 화면 문구 정본(등록 폼·수령 자리 셋·상세 줄이 같은 문장) ─────────────────────────
export const SHIP_PAY_LABEL = '배송비 결제수단'
// 배송비 결제구분의 화면 라벨(운영자 승인 2026-11-02). 저장 값 '신용'(후불)은 그대로다. 그 값을 정산 판정 정본(lib/settleStatus
// isDeferredRow)과 카드 정산 조회·감지망이 읽어서 값까지 바꾸면 그 판정과 옛 행이 함께 갈린다. 바로 밑 '신용카드' 와 헷갈려 라벨만 '후불'.
export const SHIP_TYPE_LABEL: Record<string, string> = { 선불: '선불', 착불: '착불', 신용: '후불' }
export const shipTypeLabel = (v: string | null | undefined): string => (v ? (SHIP_TYPE_LABEL[v] ?? v) : '')
export const SHIP_PAY_COD_CAPTION = '착불은 받을 때 따로 내는 경우가 많아 계좌이체로 두었습니다. 다르면 바꿔 주세요.'
export const COD_AMOUNT_CAPTION = '비워 두면 수령 확인할 때 적습니다.'
export const COD_RECEIPT_LABEL = '착불 배송비는 얼마였나요? (선택)'
export const COD_RECEIPT_CAPTION = '비워 두면 나중에 지출 상세 [수정]에서 적습니다.'
export const COD_UNRECORDED = '배송비 미기록'
// 토스트 이후의 수령 취소는 배송비 행을 지우지 않는다(돈은 이미 냈을 수 있다). 남아 있다는 사실만 말한다.
export const COD_SHIP_KEPT = '착불 배송비 지출은 그대로 남아 있습니다. 필요하면 지출 관리에서 지워 주세요.'
