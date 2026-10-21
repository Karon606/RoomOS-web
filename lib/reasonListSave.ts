// 사유를 저장하는 서버 경로(상태 전환·입주자 수정·상태 이력 수정·보증금 미반환 기록)가 함께 쓰는 검증·목록 적립.
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
      const add = plan.add
      if (!add) return
      // 원자적으로 붙인다(독립 검수 N4). 영업장 행을 잠그고(FOR UPDATE) 지금 목록을 다시 읽어 끝에 붙인다. 두 저장이 동시에
      // 다른 이름을 더해도 한쪽이 지워지지 않는다. 칸이 null(기본값)이어도 parseOptionList 로 읽으므로 SQL 한 문장
      // 덧붙이기(lib/channelOptions)와 달리 기본값을 잃지 않는다.
      const added = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 FROM "properties" WHERE "id" = ${propertyId}::uuid FOR UPDATE`
        const now = await tx.property.findUnique({
          where: { id: propertyId },
          select: { cancelReasons: true, checkoutReasons: true, withholdReasons: true },
        })
        const cur = parseOptionList(field, now?.[field])
        if (cur.includes(add)) return false
        await tx.property.update({
          where: { id: propertyId },
          data: { [field]: [...cur, add].join(',') } as Prisma.PropertyUpdateInput,
        })
        return true
      })
      if (added) revalidatePath('/settings')
    },
  }
}
