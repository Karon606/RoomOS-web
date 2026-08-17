'use server'

// 상담 도구가 쓰는 영업장 값 묶음 — 셸 어디서나 열리는 도구라 라우트 폴더가 아니라
// (app) 바로 아래에 둔다(오류신고 제출 액션 errorReports.ts 와 같은 자리).
//
// 원천은 전부 기존 것이다. 새 컬럼도 새 저장도 없다.
//   영업장명·주소·대표 연락처 = Property.name·address·phone (서류·공개 소개 페이지가 쓰는 값)
//   공개 소개 페이지 URL       = publicSlug 를 lib/publicSite 정본이 조립
//   입금 계좌                  = Property.bankAccount (미납 안내 문자 {계좌번호}·납부 확인서와 같은 값)
//   사업자등록번호             = businessInfo.registrationNo (계약서 헤더·영수증과 같은 값)
//
// FinancialAccount 는 쓰지 않는다. 그 표는 지출·카드정산 원장이라 신용카드 끝 4자리와
// 운영자 개인 계좌가 섞여 있고, '수납용 대표 계좌' 를 가리키는 표식이 스키마에 없다.
// 거기서 한 행을 골라 고객에게 안내하면 엉뚱한 계좌로 입금이 들어온다.

import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { canReadScope } from '@/lib/auth/routeScope'
import { normalizeBizNo } from '@/lib/bizNo'
import prisma from '@/lib/prisma'
import { publicSiteUrl } from '@/lib/publicSite'

/** 값이 없는 항목은 빈 문자열 — 부르는 쪽에서 그 줄을 세우지 않는다. */
export type ConsultInfo = {
  propertyName: string
  siteUrl: string
  address: string
  phone: string
  bankAccount: string
  bizNo: string
}

export type ConsultInfoResult =
  | { ok: true; info: ConsultInfo }
  | { ok: false; error: string }

export async function getConsultInfo(): Promise<ConsultInfoResult> {
  try {
    const access = await getPropertyAccess()
    if (!access) return { ok: false, error: '접근 권한이 없습니다.' }
    const property = await prisma.property.findUnique({
      where: { id: access.propertyId },
      select: { name: true, address: true, phone: true, publicSlug: true, bankAccount: true, businessInfo: true },
    })
    if (!property) return { ok: false, error: '영업장 정보를 찾을 수 없습니다.' }

    const biz = (property.businessInfo as { registrationNo?: string } | null) ?? {}
    // 저장 시점에 normalizeBizNo 를 거치지만(2026-08-03 도입) 그 이전 저장분은 하이픈이 없다.
    // 새 포맷터를 만들지 않고 같은 정본으로 방어한다.
    const rawBizNo = String(biz.registrationNo ?? '').trim()

    return {
      ok: true,
      info: {
        propertyName: property.name?.trim() ?? '',
        siteUrl:      publicSiteUrl(property.publicSlug) ?? '',
        address:      property.address?.trim() ?? '',
        phone:        property.phone?.trim() ?? '',
        // 금액 읽기가 막힌 역할(제한 스태프)에게는 계좌를 내리지 않는다. 서버 액션은
        // requireRouteAccess 가 못 막는 자리라 여기서 직접 끊는다.
        bankAccount:  canReadScope(access.role, 'money') ? (property.bankAccount?.trim() ?? '') : '',
        bizNo:        rawBizNo ? (normalizeBizNo(rawBizNo) ?? rawBizNo) : '',
      },
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '조회에 실패했습니다.' }
  }
}
