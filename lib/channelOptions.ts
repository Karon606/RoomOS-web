// 영업장 쇼핑몰 목록(Property.channelOptions) 읽기와 원자적 덧붙이기(서버 전용 도우미). 지출 저장·홈 승인·소모품 구매 수정·설정 카드가 같이 쓴다.
//
// 왜 원자적인가(독립 검수 2026-10-20). 읽고-고치고-쓰는 방식이면 두 저장이 동시에 새 이름을 더할 때 한쪽이 지워진다.
// 그래서 덧붙이기는 SQL 한 문장이다(이미 같은 열쇠의 이름이 있으면 아무것도 안 한다). 열쇠는 lib/expenseChannel channelKey 와
// 같은 규칙(앞뒤 공백·라틴 대소문자 무시)이다. 덧붙이기는 **저장이 끝난 뒤에만** 부른다(검증·합류 거부로 멈춘 저장이 목록을 바꾸지 않게).
// 'use server' 파일이 아니다(서버 액션 파일들이 import 한다).
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { parseOptionList } from '@/lib/optionLists'
import { normalizeChannel } from '@/lib/expenseChannel'

/** 이 영업장 쇼핑몰 목록. 목록 이름은 판매자 자리의 자동 기능(소급·자동완성·번호로 이름 채우기)에서 빠진다. */
export async function loadChannelNames(propertyId: string): Promise<string[]> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { channelOptions: true } })
  return parseOptionList('channelOptions', p?.channelOptions)
}

/**
 * 쇼핑몰 이름 하나를 목록 끝에 덧붙인다. 같은 열쇠의 이름이 이미 있으면 그대로 둔다. 실제로 더했으면 true.
 * 이름은 목록 정규화(normalizeChannel)를 거친다. 실패는 부르는 쪽이 삼킨다(목록은 다음 입력을 편하게 하려는 것이라 저장을 무르지 않는다).
 */
export async function appendChannelOption(propertyId: string, raw: string | null | undefined): Promise<boolean> {
  const name = normalizeChannel(raw)
  if (!name) return false
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "properties"
    SET "channelOptions" = CASE WHEN COALESCE(btrim("channelOptions"), '') = '' THEN ${name} ELSE "channelOptions" || ',' || ${name} END
    WHERE "id" = ${propertyId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM unnest(string_to_array(COALESCE("channelOptions", ''), ',')) AS t(v)
        WHERE lower(btrim(t.v)) = lower(${name})
      )`)
  return n > 0
}
