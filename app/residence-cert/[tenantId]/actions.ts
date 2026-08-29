'use server'

import { asDocNameStyle, type DocNameStyle } from '@/lib/documentName'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { getMyRole, requireEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { noteDocNameStyle } from '@/app/(app)/tenants/docNameStyle'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { driveImageDataUrl } from '@/lib/google-drive'
import { pickDocumentLease } from '@/lib/documentLease'
import {
  type ResidenceCertFieldValues, type ResidenceCertOverrides, type ResidenceCertOverridePatch,
  RESIDENCE_CERT_FIELD_ERROR, deriveResidenceCertFields, normalizeResidenceCertOverrides,
  parseResidenceCertOverrides,
} from '@/lib/documentFieldOverrides'

// 실거주 확인서 자동 채움 데이터.
// 소재지·임차인 주소 = 영업장 주소 + 방번호(lib/tenantAddress 정본 — 필요시 화면에서 수동 수정).
// 면적 = 영업장 전용면적(환경설정 defaultAreaM2). 호실별 측정 면적이 아님.
// 임대료 줄의 보증금은 보증금 금액만 (청소비 합성 없음).
// 손으로 고친 표시값 5종은 저장된다(lib/documentFieldOverrides 정본) — 자동값 위에 얹어 화면에
// 그리고, 발급 PDF 는 화면이 보낸 값을 그대로 쓰므로 종이와 화면이 갈릴 수 없다.

const RESIDENCE_CERT_DOC_TYPE = 'RESIDENCE_CERT'

export type ResidenceCertData = {
  tenantId: string
  leaseTermId: string | null
  // 소재지·임차인
  areaM2: string             // 면적(㎡) — 문자열(편집 가능)
  tenantName: string         // 고객 정보의 이름 그대로. 종이에 찍을 성명은 아래 표기 선택과 함께 조립한다
  tenantEnglishName: string | null   // 영문 이름. 없으면 표기 선택 UI 자체를 안 그린다
  // 표기 기본값을 정하는 두 축(lib/documentName resolveDocNameStyle). 종이에는 안 찍힌다.
  tenantNationality: string | null
  /** 이 계약에서 앞서 쓴 표기 — 이 서류에 저장된 값이 없을 때의 기본값이 된다. */
  lastNameStyle: DocNameStyle | null
  tenantNativeName: string | null    // 현지 표기 이름. 서류가 못 그리는 글자면 선택지에서 빠진다
  tenantBirth: string        // YYYY-MM-DD (없으면 '')
  tenantPhone: string
  // 저장 가능한 표시값 5종 — 자동값과 저장값을 나눠 내려준다(화면이 둘을 병기한다)
  autoFields: ResidenceCertFieldValues
  overrides: ResidenceCertOverrides
  overrideSavedDaysAgo: number | null   // 저장값이 없으면 null. 오래된 값 안내용
  // 임대인(영업장)
  landlordBusinessName: string   // 상호
  landlordName: string           // 성명(대표)
  landlordAddress: string        // 사업장 주소
  landlordIdNo: string           // '생년월일' 칸 값 = 사업자등록번호(사업자) 또는 생년월일(개인)
  landlordPhone: string          // 연락처
  // 도장
  stampImageUrl: string | null
  // 제출처 (지역별 — v1 서울 고정)
  submitTo: string
  regionSupported: boolean   // 현재 서식(서울형)이 유효한 지역인지 — false면 발급 차단 안내
  regionLabel: string        // 영업장 주소의 시·도(안내 문구용)
}

type BusinessInfo = { name?: string; registrationNo?: string; ceoName?: string; address?: string }

async function requireAuthAndProperty() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { userId, propertyId }
}

const ymd = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

// leaseTermId 는 계약 지목이다(2026-08-13, 다호실 마무리 — 계약서 축과 같은 문법).
// 한 사람이 방을 둘 쓰면 추론은 늘 거주 계약을 골라, 딸린 계약 몫 확인서를 뽑을 길이 없었다.
// 없거나 이 사람의 발급 대상이 아니면 종전 추론 그대로다 — 기존 링크·저장된 표시값은 불변이다.
export async function getResidenceCertData(tenantId: string, leaseTermId?: string | null): Promise<ResidenceCertData | null> {
  // 이 라우트는 (app) 셸 밖이라 canAccessRoute 가 안 걸린다. 목록은 막혀 있는데
  // 상세 URL 로 직접 들어가면 금액·생년월일·전화가 그대로 보였다(E페이즈 조사 2026-08-03).
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const { propertyId } = await requireAuthAndProperty()

  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        // 비거주 등록자·퇴실 예정자도 발급 대상(신고 ace54135). 같은 입주자가 거주·비거주 계약을
        // 같은 방에 동시 보유할 수 있어 단순 take 1 이 아니라 조회 후 JS 에서 우선순위로 고른다.
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'NON_RESIDENT'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 10,
          include: { room: { select: { roomNo: true } } },
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        address: true, phone: true, businessInfo: true,
        stampDriveFileId: true, defaultAreaM2: true,
      },
    }),
  ])

  if (!tenant) return null

  // 선택 규칙은 lib/documentLease 정본 하나다(계약서·납부 확인서와 같은 함수).
  // (여기서 고른 lease 로 저장된 표시값을 다시 조회한다 — 계약이 정해져야 행을 찾을 수 있다.)
  const lease = pickDocumentLease(tenant.leaseTerms, leaseTermId)
  const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                       ?? tenant.contacts.find(c => !c.isEmergency)
  const biz = (property?.businessInfo as BusinessInfo | null) ?? {}

  // 소재지·임차인 주소 = 영업장 주소 + 방번호. 방번호 없이 제출했다가 관청에서 연락을 받았다
  // (2026-08-08) — 병기는 서류 유효성 요건이다. 조립은 lib/tenantAddress 한 곳에서만 한다.
  // 방이 배정되지 않은 계약은 병기할 방번호가 없어 영업장 주소만 나간다(칸은 그대로 수정 가능).
  // 거주 기간·금액까지 묶은 자동값 5종의 조립은 lib/documentFieldOverrides 정본이 맡는다.
  const autoFields = deriveResidenceCertFields({
    propertyAddress: property?.address,
    roomNo: lease?.room?.roomNo,
    moveInDate: lease?.moveInDate ?? null,
    expectedMoveOut: lease?.expectedMoveOut ?? null,
    rentAmount: lease?.rentAmount ?? 0,
    depositAmount: lease?.depositAmount ?? 0,
  })

  // 손으로 고쳐 저장해 둔 표시값. 계약이 없으면 저장할 자리가 없어 항상 자동값이다.
  const saved = lease
    ? await prisma.documentFieldOverride.findUnique({
        where: { leaseTermId_docType: { leaseTermId: lease.id, docType: RESIDENCE_CERT_DOC_TYPE } },
        select: { fields: true, updatedAt: true },
      })
    : null
  const overrides = parseResidenceCertOverrides(saved?.fields)
  const hasOverrides = Object.keys(overrides).length > 0
  // '며칠 전 값인가'는 서버에서 센다. 화면에서 세면 SSR 과 클라이언트가 날짜 경계에서 갈려
  // 하이드레이션 경고가 난다.
  const overrideSavedDaysAgo = hasOverrides && saved
    ? Math.max(0, Math.floor((Date.now() - saved.updatedAt.getTime()) / 86_400_000))
    : null

  // 면적: 영업장 전용면적(환경설정). 호실별 측정 면적 아님.
  const area = property?.defaultAreaM2 ?? null

  return {
    tenantId: tenant.id,
    leaseTermId: lease?.id ?? null,
    areaM2: area != null ? String(area) : '',
    tenantName: tenant.name,
    tenantEnglishName: tenant.englishName,
    tenantNativeName: tenant.nativeName,
    tenantNationality: tenant.nationality,
    lastNameStyle: asDocNameStyle(lease?.lastDocNameStyle) ?? null,
    tenantBirth: ymd(tenant.birthdate),
    tenantPhone: primaryContact?.contactValue ?? '',
    autoFields,
    overrides,
    overrideSavedDaysAgo,
    landlordBusinessName: biz.name ?? '',
    landlordName: biz.ceoName ?? '',
    landlordAddress: biz.address ?? '',
    landlordIdNo: biz.registrationNo ?? '',
    landlordPhone: property?.phone ?? '',
    stampImageUrl: property?.stampDriveFileId ? await driveImageDataUrl(property.stampDriveFileId) : null,
    submitTo: '서울특별시장 귀하',   // 현재 서식은 서울형 — 지자체별 양식이 달라 비서울은 발급 차단(운영자 정정 2026-07-10, 유추 금지)
    regionSupported: ((property?.address ?? '').trim() || (biz.address ?? '').trim()).startsWith('서울'),
    regionLabel: (((property?.address ?? '').trim() || (biz.address ?? '').trim()).split(' ')[0]) || '미상',
  }
}

// ── 표시값 오버라이드 저장/되돌리기 ───────────────────────────────
// 운영자가 칸에서 고친 값을 계약 단위로 남긴다. **원천 컬럼에는 쓰지 않는다** — 수납·청구는
// 이 값을 영원히 모르고, 계약서·납부확인서도 이 값을 보지 않는다(서류별 독립, 운영자 결정 2026-08-08).
async function findLeaseForOverride(leaseTermId: string, propertyId: string) {
  return prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    select: {
      id: true, moveInDate: true, expectedMoveOut: true, rentAmount: true, depositAmount: true,
      room: { select: { roomNo: true } },
      property: { select: { address: true } },
    },
  })
}

export async function saveResidenceCertFieldOverride(
  leaseTermId: string,
  patch: ResidenceCertOverridePatch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { userId, propertyId } = await requirePropertyAccess()
    const lease = await findLeaseForOverride(leaseTermId, propertyId)
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }

    const auto = deriveResidenceCertFields({
      propertyAddress: lease.property?.address,
      roomNo: lease.room?.roomNo,
      moveInDate: lease.moveInDate,
      expectedMoveOut: lease.expectedMoveOut,
      rentAmount: lease.rentAmount,
      depositAmount: lease.depositAmount,
    })
    const stored = await prisma.documentFieldOverride.findUnique({
      where: { leaseTermId_docType: { leaseTermId, docType: RESIDENCE_CERT_DOC_TYPE } },
      select: { fields: true },
    })
    const { value, invalidKeys } = normalizeResidenceCertOverrides(stored?.fields, patch, auto)
    if (invalidKeys.length) return { ok: false, error: RESIDENCE_CERT_FIELD_ERROR[invalidKeys[0]] }

    // 남은 키가 없으면 행을 지운다 — 빈 행이 남으면 '저장된 값이 있다'로 잘못 읽힌다.
    if (value === null) {
      await prisma.documentFieldOverride.deleteMany({
        where: { leaseTermId, docType: RESIDENCE_CERT_DOC_TYPE },
      })
      return { ok: true }
    }
    const fields = value as unknown as Prisma.InputJsonValue
    await prisma.documentFieldOverride.upsert({
      where: { leaseTermId_docType: { leaseTermId, docType: RESIDENCE_CERT_DOC_TYPE } },
      create: { leaseTermId, propertyId, docType: RESIDENCE_CERT_DOC_TYPE, fields, updatedBy: userId },
      update: { fields, updatedBy: userId },
    })
    // 표기를 골랐으면 계약에 남긴다 — 다음 서류가 이 값을 기본으로 연다(app/(app)/tenants/docNameStyle).
    if (value.nameStyle) await noteDocNameStyle(leaseTermId, value.nameStyle)
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

// 표시값 전체를 자동값으로 되돌린다 — 행을 지우면 다음 발급부터 다시 자동값이 나온다.
export async function resetResidenceCertFieldOverrides(
  leaseTermId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requirePropertyAccess()
    const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    await prisma.documentFieldOverride.deleteMany({
      where: { leaseTermId, docType: RESIDENCE_CERT_DOC_TYPE },
    })
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}
