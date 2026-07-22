import 'server-only'
import prisma from '@/lib/prisma'

// 세트 상품 의심 감지 — "주문 1개 = 실물 N개" (운영자 2026-07-06, 하수구트랩·의자발 사례).
// 온라인 영수증(쿠팡 등)은 품목당 합계 위주라 개당 단가·실물 수량이 안 보임 →
// 인식 단계에서 의심되면 사용자에게 "1세트에 몇 개?"를 되묻기 위한 근거를 만든다.
//
// 근거 두 갈래:
//  ① 라벨 표기: 'N개입 / N입 / N매입 / Npcs / Nea / xN' — 명시된 구성 수
//  ② 단가 이력: 이 품목의 과거 개당 단가 대비 이번 (금액÷수량)이 정확히 N배(±3%)
// 규격(specValue>1)이 이미 잡혀 있으면 구성이 파악된 것이므로 의심 대상 아님.

export type SetHint = {
  count: number        // 추정 구성 수 (1세트 = count개)
  perPiece: number     // 적용 시 개당 단가 = 금액 ÷ (수량 × count)
  basis: 'label' | 'price'   // 근거: 라벨 표기 | 단가 이력 배수
  histUnit?: number    // (price 근거) 과거 개당 단가
}

// 한글 접미사 뒤 \b 는 JS 에서 동작하지 않아(한글=비단어문자, 경계 미형성) "3개입"을 못 잡던 버그 —
// 한글 갈래는 뒤에 한글이 더 붙지 않는지 부정 전방탐색으로 판정(신고 91b812ce 검증 중 발견, 2026-07-22).
const LABEL_COUNT_RE = /(\d{1,3})\s*(?:개입|매입|입)(?![가-힣])|(\d{1,3})\s*(?:pcs|ea)\b|[xX×]\s*(\d{1,3})\b/i

export function countFromLabel(...labels: (string | null | undefined)[]): number | null {
  for (const l of labels) {
    if (!l) continue
    const m = l.match(LABEL_COUNT_RE)
    if (m) {
      const n = parseInt(m[1] ?? m[2] ?? m[3], 10)
      if (n >= 2 && n <= 200) return n
    }
  }
  return null
}

export async function computeSetHint(propertyId: string, item: {
  label: string
  rawLabel?: string | null
  amount: number
  qtyValue?: string | null
  specValue?: string | null
}): Promise<SetHint | null> {
  // 규격이 이미 있으면(20개입 등 파악됨) 되물을 필요 없음
  if (item.specValue && (Number(item.specValue) || 0) > 1) return null
  const qty = Number(item.qtyValue) || 1
  const amount = item.amount || 0

  // ① 라벨 명시 구성
  const labelN = countFromLabel(item.rawLabel, item.label)
  if (labelN) {
    return { count: labelN, perPiece: amount > 0 ? Math.round(amount / (qty * labelN)) : 0, basis: 'label' }
  }

  // ② 단가 이력 배수 — 유상 구매 최신 행에서 개당 단가 역산(무상입수 0원 제외)
  if (amount <= 0) return null
  const hist = await prisma.expense.findFirst({
    where: { propertyId, itemLabel: item.label, amount: { gt: 0 } },
    select: { amount: true, qtyValue: true, specValue: true, unitBasis: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!hist) return null
  const hBasis = (hist.unitBasis === 'spec' || hist.unitBasis === 'qty') ? hist.unitBasis : (hist.specValue ? 'spec' : 'qty')
  const hq = (hist.qtyValue ?? 1) * (hBasis === 'spec' ? (hist.specValue ?? 1) : 1)
  if (hq <= 0) return null
  const histUnit = hist.amount / hq
  if (histUnit <= 0) return null
  const ratio = (amount / qty) / histUnit
  for (let n = 2; n <= 24; n++) {
    if (Math.abs(ratio - n) <= n * 0.03) {
      return { count: n, perPiece: Math.round(amount / (qty * n)), basis: 'price', histUnit: Math.round(histUnit) }
    }
  }
  return null
}
