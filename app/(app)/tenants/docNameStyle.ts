'use server'

// 서류 성명 표기 이어받기 — 계약 하나에 '마지막으로 쓴 표기' 한 낱말을 남기고, 다음 서류가 그것을
// 기본값으로 연다(운영자 확정 2026-08-29 — "계약서를 영어로 발급하면 거주확인서도 영어로").
//
// **여기 남는 것은 힌트뿐이다.** 서류에 실제로 찍히는 표기는 각 서류가 제 자리에 따로 갖는다
// (계약서는 LeaseTerm.contractFieldOverrides, 실거주 확인서는 DocumentFieldOverride).
// 그 자리를 통합하지 않은 이유는 세 서류가 서로 다른 사실을 말하기 때문이고(2026-08-08 결정),
// 이 칸은 그 결정을 안 건드리면서 "앞에서 무엇을 골랐나"만 답한다.
//
// 서류마다 따로 기억하지 않는 이유. 운영자가 원한 것은 "앞 서류가 무엇이었나" 하나이고,
// 서류별로 나눠 두면 어느 것이 '앞'인지 다시 정해야 한다. 계약 단위 한 낱말이면 그 물음이 없다.

import prisma from '@/lib/prisma'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { asDocNameStyle, type DocNameStyle } from '@/lib/documentName'

/**
 * 이 계약에서 앞서 쓴 표기 — 없으면 null.
 *
 * 발급 화면이 열릴 때 resolveDocNameStyle 의 siblings 로 넘긴다. 배열인 것은 정본 시그니처가
 * 여럿을 받기 때문이고, 여기서는 늘 0개 아니면 1개다.
 */
export async function getLastDocNameStyle(leaseTermId: string): Promise<DocNameStyle | null> {
  const { propertyId } = await requirePropertyAccess()
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    select: { lastDocNameStyle: true },
  })
  return asDocNameStyle(lease?.lastDocNameStyle) ?? null
}

/**
 * 이번에 쓴 표기를 남긴다 — 발급·저장이 끝난 뒤에 부른다.
 *
 * **실패해도 조용히 넘긴다.** 이 값은 다음 서류를 편하게 열려는 힌트이지 서류의 사실이 아니다.
 * 힌트를 못 남겼다고 방금 발급한 서류를 무르는 것이 훨씬 나쁘다.
 */
export async function noteDocNameStyle(leaseTermId: string, style: DocNameStyle): Promise<void> {
  try {
    const { propertyId } = await requirePropertyAccess()
    const s = asDocNameStyle(style)
    if (!s) return
    await prisma.leaseTerm.updateMany({
      where: { id: leaseTermId, propertyId },
      data: { lastDocNameStyle: s },
    })
  } catch { /* 힌트 기록 실패가 발급을 되돌리지 않는다 */ }
}
