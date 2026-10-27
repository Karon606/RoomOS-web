'use server'

// 작업·청소 완료·수정 폼의 결제수단 선택지와 기본값 조회(2026-10-27 운영자 지적 "작업 단에서도 결제수단을 물어보는 옵션").
//
// 선택지는 지출 화면과 같은 한 벌이다(영업장 결제수단 목록 + 선불 계정 브랜드, 활성 결제 계정). 기본값 규칙은 lib/workPayDefault 정본.
// 결제 계정 이름은 돈 화면의 정보라 편집 권한이 있는 사람만 읽는다(폼 자체가 편집 권한일 때만 열린다).

import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { requireEdit } from '@/lib/role'
import { parseOptionList } from '@/lib/optionLists'
import { effectivePayMethods } from '@/lib/payMethodOptions'
import { workPayDefaults, type WorkPay } from '@/lib/workPayDefault'
import { CLEANING_EXPENSE_CATEGORY, WORK_EXPENSE_CATEGORY } from './cleaningConstants'

export type WorkPayOptions = {
  methods: string[]
  accounts: { id: string; type: string; brand: string; alias: string | null }[]
  byVendor: Record<string, WorkPay>
  fallback: WorkPay
}

/** kind 는 지출 카테고리를 고른다(작업 = 수선유지비, 청소 = 청소용역비). vendors 는 화면이 고를 업체 이름 후보다. */
export async function getWorkPayOptions(kind: 'work' | 'cleaning', vendors: string[]): Promise<WorkPayOptions> {
  await requireEdit()
  const { propertyId } = await requirePropertyAccess()
  const [prop, accounts] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId }, select: { paymentMethods: true } }),
    prisma.financialAccount.findMany({
      where: { propertyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, brand: true, alias: true },
    }),
  ])
  const category = kind === 'work' ? WORK_EXPENSE_CATEGORY : CLEANING_EXPENSE_CATEGORY
  const defaults = await workPayDefaults(prisma, propertyId, { vendors: Array.isArray(vendors) ? vendors.filter(v => typeof v === 'string') : [], category })
  return {
    methods: effectivePayMethods(parseOptionList('paymentMethods', prop?.paymentMethods), accounts),
    accounts: accounts.map(a => ({ id: a.id, type: String(a.type), brand: a.brand, alias: a.alias })),
    ...defaults,
  }
}
