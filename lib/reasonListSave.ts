// 사유를 저장하는 서버 경로가 함께 쓰는 검증·목록 적립 — 상태 전환·입주자 수정·상태 이력 수정·보증금 미반환 기록.
//
// 화면이 보낸 저장 글자를 지금 영업장 목록으로 다시 잰다(lib/reasonLists planReasonSave). 목록에 더하는 것은
// 기록 저장이 끝난 뒤(commit)다. 저장이 실패하면 목록에도 아무것도 안 남는다(지출 카테고리 자동 추가와 같은 약속).
// 'use server' 파일이 아니다. 영업장 id 를 받는 함수라 화면에서 부를 수 있으면 안 된다.
import 'server-only'
import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { parseOptionList, type ReasonListField } from '@/lib/optionLists'
import { planReasonSave } from '@/lib/reasonLists'

export type ReasonSave = { reason: string | null; commit: () => Promise<void> }

export async function reasonForSave(
  propertyId: string,
  field: ReasonListField,
  raw: string | null | undefined,
  opts: { addToList?: boolean; prev?: string | null } = {},
): Promise<ReasonSave> {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { cancelReasons: true, checkoutReasons: true, withholdReasons: true },
  })
  const list = parseOptionList(field, p?.[field])
  const plan = planReasonSave(field, list, raw, opts)
  return {
    reason: plan.reason,
    commit: async () => {
      if (!plan.add) return
      // 저장 사이에 다른 화면이 목록을 고쳤을 수 있어 지금 목록을 다시 읽어 끝에 붙인다.
      const now = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { cancelReasons: true, checkoutReasons: true, withholdReasons: true },
      })
      const cur = parseOptionList(field, now?.[field])
      if (cur.includes(plan.add)) return
      await prisma.property.update({
        where: { id: propertyId },
        data: { [field]: [...cur, plan.add].join(',') } as Prisma.PropertyUpdateInput,
      })
      revalidatePath('/settings')
    },
  }
}
