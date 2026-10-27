// 작업·청소가 만드는 지출의 결제수단 기본값과 확정 정본(server-only). 완료·수정 액션과 화면 기본값 조회가 같은 규칙을 쓴다.
import 'server-only'
//
// 왜 (2026-10-27 운영자 지적). "작업에서 지출 금액이 입력되고 완료처리된다는 것은 돈이 나간다는 거니까 작업 단에서도
// 결제수단을 뭘로할지 물어보는 옵션이 필요할 듯". 종전 completeRoomWork·completeCleaning 은 payMethod·결제 계정을 안 적어
// 결제수단 빈 지출이 남았고(운영 실측 작업·청소 지출 7건), 카드로 낸 청소비가 카드 정산에 안 올랐다.
//
// 기본값 차례(운영자 승인 결정 3). ① 같은 업체 직전 지출의 결제수단 ② 같은 카테고리 직전 지출의 결제수단 ③ 영업장 결제수단 목록 첫 값.
// 지출 화면의 '직전 지출'(getLastPayDefaults)은 쓰지 않는다. 그것은 아무 지출이나 마지막 것이라 청소비가 장보기 카드를 따라간다.
// 서버도 값이 안 오면 같은 규칙으로 채운다. null 을 남기지 않는다.
// 결제 계정은 그 영업장 것만 받는다. 표시명(financeName)은 화면 글자를 믿지 않고 계정에서 다시 짓는다.

import prisma from '@/lib/prisma'
import { parseOptionList } from '@/lib/optionLists'
import { accName, effectivePayMethods } from '@/lib/payMethodOptions'

// 트랜잭션 클라이언트도 받는다. 확장된 실제 클라이언트에서 뽑는다(Prisma.TransactionClient 와 안 맞는다, finance/actions TxClient 와 같은 이유).
type Db = Pick<Parameters<Parameters<typeof prisma.$transaction>[0]>[0], 'expense' | 'property' | 'financialAccount'>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type WorkPay = { payMethod: string; financialAccountId: string | null; financeName: string | null }

const LAST_PAY_SELECT = {
  payMethod: true, financialAccountId: true,
  financialAccount: { select: { brand: true, alias: true, isActive: true } },
} as const

type LastPayRow = { payMethod: string | null; financialAccountId: string | null; financialAccount: { brand: string; alias: string | null; isActive: boolean } | null }

/** 직전 지출의 결제수단을 기본값 꼴로. 쉬는(비활성) 계정은 안 따라간다(결제수단만 쓴다). */
function payOfRow(r: LastPayRow): WorkPay {
  const acc = r.financialAccount && r.financialAccount.isActive ? r.financialAccount : null
  return { payMethod: r.payMethod as string, financialAccountId: acc ? r.financialAccountId : null, financeName: acc ? accName(acc) : null }
}

/** 영업장 결제수단 목록 첫 값(선불 계정 브랜드 병합 뒤). 목록이 비면 '계좌이체'(지출 폼 기본값과 같다). */
async function fallbackPay(db: Db, propertyId: string): Promise<WorkPay> {
  const [prop, accounts] = await Promise.all([
    db.property.findFirst({ where: { id: propertyId }, select: { paymentMethods: true } }),
    db.financialAccount.findMany({ where: { propertyId, isActive: true }, select: { type: true, brand: true, alias: true } }),
  ])
  const methods = effectivePayMethods(parseOptionList('paymentMethods', prop?.paymentMethods), accounts)
  return { payMethod: methods[0] ?? '계좌이체', financialAccountId: null, financeName: null }
}

/**
 * 같은 업체 → 같은 카테고리 → 영업장 목록 첫 값. 직전은 지출 날짜 기준(같은 날이면 늦게 만든 것). 배송비 줄과 결제수단 빈 줄은 안 본다.
 * 업체는 앞뒤 공백을 걷은 글자 그대로 맞춘다.
 */
export async function defaultPayMethodFor(db: Db, propertyId: string, opts: { vendor?: string | null; category: string }): Promise<WorkPay> {
  const vendor = opts.vendor?.trim() || null
  if (vendor) {
    const byVendor = await db.expense.findFirst({
      where: { propertyId, vendor, isShipping: false, payMethod: { not: null } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: LAST_PAY_SELECT,
    })
    if (byVendor) return payOfRow(byVendor)
  }
  const byCategory = await db.expense.findFirst({
    where: { propertyId, category: opts.category, isShipping: false, payMethod: { not: null } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: LAST_PAY_SELECT,
  })
  if (byCategory) return payOfRow(byCategory)
  return fallbackPay(db, propertyId)
}

/**
 * 화면 기본값 한 벌. 고를 업체 후보마다의 기본값(①)과 업체를 모를 때의 기본값(②·③)을 한 번에 돌려준다.
 * 화면은 업체 이름이 바뀔 때마다 서버를 다시 부르지 않고 이 표에서 고른다. 후보에 없는 이름이면 fallback 이다
 * (그때 저장 값은 화면이 보인 그 값이다. 서버 규칙 ①은 값 없이 온 저장에만 쓴다).
 */
export async function workPayDefaults(db: Db, propertyId: string, opts: { vendors: string[]; category: string }): Promise<{ byVendor: Record<string, WorkPay>; fallback: WorkPay }> {
  const names = [...new Set(opts.vendors.map(v => v.trim()).filter(Boolean))].slice(0, 20)
  const byVendor: Record<string, WorkPay> = {}
  if (names.length > 0) {
    const rows = await db.expense.findMany({
      where: { propertyId, vendor: { in: names }, isShipping: false, payMethod: { not: null } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { vendor: true, ...LAST_PAY_SELECT },
      take: 500,
    })
    for (const r of rows) if (r.vendor && !byVendor[r.vendor]) byVendor[r.vendor] = payOfRow(r)
  }
  return { byVendor, fallback: await defaultPayMethodFor(db, propertyId, { category: opts.category }) }
}

/**
 * 저장할 결제수단을 확정한다. 화면이 보낸 결제수단이 있으면 그것, 없으면 기본값 규칙. 결제 계정은 이 영업장 것만 받는다(없으면 거부).
 * 결제수단을 안 보냈는데 계정만 온 것은 받지 않는다(어느 수단의 계정인지 모른다).
 */
export async function resolveWorkPay(
  db: Db, propertyId: string,
  input: { payMethod?: string | null; financialAccountId?: string | null; vendor?: string | null; category: string },
): Promise<{ ok: true; pay: WorkPay } | { ok: false; error: string }> {
  const method = input.payMethod?.trim() || null
  if (!method) return { ok: true, pay: await defaultPayMethodFor(db, propertyId, { vendor: input.vendor, category: input.category }) }
  if (method.length > 50) return { ok: false, error: '결제수단 이름이 너무 깁니다.' }
  if (!input.financialAccountId) return { ok: true, pay: { payMethod: method, financialAccountId: null, financeName: null } }
  if (!UUID.test(input.financialAccountId)) return { ok: false, error: '결제 계정을 찾을 수 없습니다.' }
  const acc = await db.financialAccount.findFirst({ where: { id: input.financialAccountId, propertyId }, select: { id: true, brand: true, alias: true } })
  if (!acc) return { ok: false, error: '결제 계정을 찾을 수 없습니다.' }
  return { ok: true, pay: { payMethod: method, financialAccountId: acc.id, financeName: accName(acc) } }
}
