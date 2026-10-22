// 사유를 저장하는 서버 경로(상태 전환·입주자 수정·상태 이력 수정·보증금 미반환 기록, 2차 여섯 목록의 저장 자리)가 함께 쓰는 검증·목록 적립.
//
// 화면이 보낸 저장 글자를 지금 영업장 목록으로 다시 잰다(lib/reasonLists planReasonSave). 목록에 더하는 것은
// 기록 저장이 끝난 뒤(commit)다. 저장이 실패하면 목록에도 아무것도 안 남는다(지출 카테고리 자동 추가와 같은 약속).
// 'use server' 파일이 아니다. 영업장 id 를 받는 함수라 화면에서 부를 수 있으면 안 된다.
import 'server-only'
import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { parseOptionList, type OptionListField, type ReasonListField } from '@/lib/optionLists'
import { planReasonSave } from '@/lib/reasonLists'
import { normalizeCategoryInput, resolveCategoryForSave } from '@/lib/categoryInput'

export type ReasonSave = { reason: string | null; commit: () => Promise<void> }

/**
 * '기타' 규약 목록 칸 전부. 칸 이름이 인자라 select 를 타입으로 좁히려고 둔다(빠진 칸은 satisfies 가 막는다).
 * 종전에는 세 칸을 손으로 적어 두 자리(검증·적립)에 두 벌이 있었다(2026-10-22 2차, 칸 이름으로 일반화).
 */
export const REASON_LIST_SELECT = {
  cancelReasons: true, checkoutReasons: true, withholdReasons: true,
  dueDayReasons: true, cleaningReasons: true, stockDisposalReasons: true, stockSourceOptions: true, assetDisposalReasons: true, visitRouteOptions: true,
} as const satisfies Record<ReasonListField, true>

export async function reasonForSave(
  propertyId: string,
  field: ReasonListField,
  raw: string | null | undefined,
  opts: { addToList?: boolean; prev?: string | null } = {},
): Promise<ReasonSave> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: REASON_LIST_SELECT })
  const list = parseOptionList(field, p?.[field])
  const plan = planReasonSave(field, list, raw, opts)
  return {
    reason: plan.reason,
    commit: async () => {
      const add = plan.add
      if (!add) return
      if (await appendOptionName(propertyId, field, add)) revalidatePath('/settings')
    },
  }
}

/** 저절로 쌓는 목록 중 이 헬퍼가 받는 칸(2026-10-22 2차, 작업 종류·부가수익 카테고리·지출 카테고리의 새 자리). */
export type AutoListField = 'workKindOptions' | 'incomeCategories' | 'expenseCategories'
export type OptionSave = { value: string | null; commit: () => Promise<void> }

/**
 * 저절로 쌓는 목록(카테고리·종류, CategorySelect addMode 'auto')의 저장 값과 목록 적립.
 *
 * 값은 적은 글자 그대로다. 목록 이름과 대소문자·공백만 다르면 목록 표기로 맞추고(lib/categoryInput resolveCategoryForSave),
 * '기타 · ' 꼴로 바꾸지 않는다(이름 자체가 값인 목록이라 목록 밖 글자도 맨 글자로 둔다, 1차 결정 2). 목록 밖 새 이름이고
 * '목록에 추가' 가 꺼져 있지 않고(기본 켜짐, 체크 칸이 없는 종전 호출도 켜짐) 고치는 기록의 지금 값(prev)과 다르면
 * 기록이 선 뒤(commit) 목록 끝에 붙인다. 지금 값과 같으면 안 붙인다(목록에서 뺀 카테고리가 그 기록 저장마다 되살아나지 않는다).
 * 지금 값도 값과 같은 정규화(normalizeCategoryInput)를 거쳐 견준다. 홈 영수증 인식 결과처럼 공백이 불규칙한 지금 값을
 * 정규화 전 글자로 견주면 화면은 체크 칸을 안 보였는데 서버는 목록에 더한다(2차 독립 검수 D5).
 */
export async function autoOptionForSave(
  propertyId: string,
  field: AutoListField,
  raw: string | null | undefined,
  opts: { addToList?: boolean; prev?: string | null } = {},
): Promise<OptionSave> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { workKindOptions: true, incomeCategories: true, expenseCategories: true } })
  const { value, nextList } = resolveCategoryForSave(parseOptionList(field, p?.[field]), raw)
  const prev = opts.prev ? normalizeCategoryInput(opts.prev) : null
  const add = opts.addToList !== false && nextList && value && value !== prev ? value : null
  return {
    value,
    commit: async () => {
      if (add && await appendOptionName(propertyId, field, add)) revalidatePath('/settings')
    },
  }
}

/**
 * 목록 끝에 이름 하나를 붙인다. 이미 있으면 그대로(false).
 * 원자적으로 붙인다(독립 검수 N4). 영업장 행을 잠그고(FOR UPDATE) 지금 목록을 다시 읽어 끝에 붙인다. 두 저장이 동시에
 * 다른 이름을 더해도 한쪽이 지워지지 않는다. 칸이 null(기본값)이어도 parseOptionList 로 읽으므로 SQL 한 문장
 * 덧붙이기(lib/channelOptions)와 달리 기본값을 잃지 않는다.
 */
async function appendOptionName(propertyId: string, field: OptionListField, add: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM "properties" WHERE "id" = ${propertyId}::uuid FOR UPDATE`
    // 칸 이름이 인자라 select 를 한 칸으로 만든다(타입은 목록 칸 표로 좁힌다).
    const now = await tx.property.findUnique({ where: { id: propertyId }, select: { [field]: true } as Record<OptionListField, boolean> })
    const cur = parseOptionList(field, (now as Partial<Record<OptionListField, string | null>> | null)?.[field])
    if (cur.includes(add)) return false
    await tx.property.update({
      where: { id: propertyId },
      data: { [field]: [...cur, add].join(',') } as Prisma.PropertyUpdateInput,
    })
    return true
  })
}
