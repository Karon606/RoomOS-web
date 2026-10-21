'use server'

import { asDocNameStyle, type DocNameStyle } from '@/lib/documentName'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { billForLeaseMonth } from '@/lib/billing'
import { isRealRentPayment } from '@/lib/rentPaid'
import { dueDayAdjustsFrom, type BillingDueDayAdjust } from '@/lib/dueDayAdjust'
import { getMyRole, requireEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { discountedRent } from '@/lib/rentDiscount'
import { roomLabel } from '@/lib/tenantAddress'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { ReceiptKind } from '@/lib/rentReceiptPdf'
import { CLEANING_FEE_RECEIVED_WHERE } from '@/lib/incomeCategories'
import { pickDocumentLease } from '@/lib/documentLease'
import { depositComposition } from '@/lib/depositComposition'
import {
  issuableRentMonths, issueDateDefaults, type IssuableMonth,
  parseRentReceiptUndo, canonicalRentReceiptUndo, rentReceiptRowUnchanged,
  RENT_RECEIPT_UNDO_DOMAIN, RENT_RECEIPT_UNDO_STALE, RENT_RECEIPT_UNDO_INVALID,
} from '@/lib/rentReceiptMonths'
import { verifyUndoBody } from '@/app/(app)/rooms/cashReceiptLine'
import { revalidatePath } from 'next/cache'

// 입실료 납부 확인서 자동 채움 — 입실자/계약/영업장에서.
export type RentReceiptData = {
  tenantId: string
  leaseTermId: string | null
  name: string            // 수령인(입주자) 성명 — 고객 정보의 이름 그대로(표기 선택은 화면이 얹는다)
  englishName: string | null   // 영문 이름. 없으면 표기 선택 UI 자체를 안 그린다
  nativeName: string | null    // 현지 표기 이름. 서류가 못 그리는 글자면 선택지에서 빠진다
  // 표기 기본값을 정하는 두 축(lib/documentName resolveDocNameStyle).
  // 국적은 종이에 안 찍힌다 — 외국인이면 영문이 기본이라는 판정에만 쓴다.
  nationality: string | null
  /** 외국인등록번호 보유 — 존재 비트만. 국적과 OR 로 '외국인이면 영문' 판정에 든다. */
  hasForeignRegNo: boolean
  /** 고객 정보에 못박아 둔 사람 단위 표기. 형제 서류보다는 약하고 국적 추정보다는 세다. */
  tenantDocNameStyle: DocNameStyle | null
  /** 이 계약에서 앞서 쓴 표기. 계약이 없으면 null 이라 국적 기본값만 선다. */
  lastNameStyle: DocNameStyle | null
  room: string            // 호실
  period: string          // 거주 기간 (예 '2026.01.15 ~ 2026.07.14')
  targetMonth: string     // 납부 대상월 (예 '2026년 6월분')
  amount: number          // 월세
  payDate: string         // 납부일 (예 '2026년 6월 16일')
  payMethod: string       // 납부방법 (계좌이체 · 계좌번호 / 현금)
  note: string            // 비고 (기본: 다음 납부 예정일)
  recipientName: string   // 임대인 대표 성명
  anchorMonth: string     // 대상 주기 시작월 'YYYY-MM' (발급 화면 월 스테퍼 기준)
  todayMonth: string      // 이번 달 'YYYY-MM' (KST) — 과거 월 배지·미래 월 차단 판정용
  isShortTerm: boolean    // 단기 입주자 — 입주월 단일 청구라 월 스테퍼 숨김(회계 오더 2026-07-27)
  // 화면 전용 경고(인쇄물 미출력) — noRecord: 그 달 수납 기록 없음(0원), partial: 실입금이 청구액보다 부족
  warning: 'noRecord' | 'partial' | null
  kind: ReceiptKind       // 'deposit' 이면 보증금 영수증(월 개념 없음 — 스테퍼 숨김)
  preResidence: boolean   // 입주 전 보증금(예약금 성격) — 거주 기간 비움 + 반환 조건 문구가 다르다
  nonResident: boolean    // 비거주 계약 — 살지 않으므로 '거주'가 아닌 '이용' 어휘를 쓴다
  /**
   * 발행일 칸의 첫 상태(lib/rentReceiptMonths issueDateDefaults 정본, 운영자 결정 2026-10-21).
   * value 는 오늘, minDate 는 이 달 몫 마지막 실입금일(그보다 앞선 날은 서버도 거절), openMonth 는 달력이 먼저 열 달(그 입금일의 달).
   * 실입금이 없는 달과 보증금 영수증은 minDate·openMonth 가 null 이다(보증금은 월 축이 없어 하한도 없다).
   */
  issueDefaults: { value: string; minDate: string | null; openMonth: string | null }
  /**
   * 여러 달 발급에서 고를 수 있는 귀속월 — 이 계약에 실입금이 있는 달만, 최근 달이 앞(2026-10-20).
   * issuedAt 은 그 달 귀속의 살아 있는 발급본 중 가장 늦은 발행일(ISO). 고르기 전에 중복을 보이려는 것이다.
   * 단기·보증금은 빈 배열이다(단기는 입주월 하나, 보증금은 월 축이 없다).
   */
  issuable: (IssuableMonth & { issuedAt: string | null })[]
  /** 계약 상태 — 퇴실 완료 계약이면 화면이 '이번 달' 기본값 대신 지난 달을 연다. */
  leaseStatus: string | null
}

const dotPad = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${y}.${(m ?? '').padStart(2, '0')}.${(d ?? '').padStart(2, '0')}` }
const kor = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return `${y}년 ${m}월 ${d}일` }

// 월세 1달 선납 주기 — 납부일(dueDay) 기준(없으면 입주일의 일). 예) dueDay 5 → 6/5~7/4.
// anchorMonth('YYYY-MM')를 주면 그 달의 dueDay 를 주기 시작으로 잡는다(과거 달 발급). 없으면 오늘 기준 현재 주기.
function rentCyclePeriod(dueDay: string | null, moveIn: Date | null, anchorMonth?: string | null): { start: string; end: string } {
  let day = parseInt((dueDay ?? '').replace(/[^0-9]/g, ''), 10)
  if (!Number.isFinite(day) || day < 1 || day > 31) day = moveIn ? new Date(moveIn).getUTCDate() : 1
  const now = new Date(Date.now() + 9 * 3600 * 1000) // KST
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  const daysIn = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
  const anchor = /^\d{4}-\d{2}$/.test(anchorMonth ?? '') ? (anchorMonth as string).split('-').map(Number) : null
  let sy = y, sm = m
  if (anchor) { sy = anchor[0]; sm = anchor[1] - 1 }
  else if (d < Math.min(day, daysIn(y, m))) { sm = m - 1; if (sm < 0) { sm = 11; sy = y - 1 } }
  const start = new Date(Date.UTC(sy, sm, Math.min(day, daysIn(sy, sm))))
  let ny = sy, nm = sm + 1; if (nm > 11) { nm = 0; ny = sy + 1 }
  const nextStart = new Date(Date.UTC(ny, nm, Math.min(day, daysIn(ny, nm))))
  const end = new Date(nextStart.getTime() - 86400000)
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

type BusinessInfo = { name?: string; registrationNo?: string; ceoName?: string; address?: string }

async function requireAuthAndProperty() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { userId, propertyId }
}

const fmtRoom = roomLabel   // 호실 표기는 lib/tenantAddress 정본 하나 — 서류마다 제 규칙을 두면 갈린다

// month('YYYY-MM')를 주면 그 달 주기로 자동값을 채운다(과거 달 발급). 미지정이면 현재 주기 — 기존 재발급 링크 무회귀.
//
// leaseTermId 는 계약 지목이다(2026-08-13, 다호실 마무리 — 계약서 축과 같은 문법).
// 한 사람이 방을 둘 쓰면 추론은 늘 거주 계약을 골라, 601호 창고 몫 납부 확인서를 뽑을 길이 없었다.
// 없거나 이 사람의 발급 대상이 아니면 종전 추론 그대로다 — 기존 재발급 링크는 글자 하나 안 바뀐다.
export async function getRentReceiptData(tenantId: string, month?: string, kind: ReceiptKind = 'rent', leaseTermId?: string | null): Promise<RentReceiptData | null> {
  // 이 라우트는 (app) 셸 밖이라 canAccessRoute 가 안 걸린다. 목록은 막혀 있는데
  // 상세 URL 로 직접 들어가면 금액·생년월일·전화가 그대로 보였다(E페이즈 조사 2026-08-03).
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const { propertyId } = await requireAuthAndProperty()

  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
        leaseTerms: {
          // CHECKOUT_PENDING 누락 — 퇴실 예정자에게 확인서를 못 뗐다. 계약서(contractData)와
          // 실거주확인서는 원래 포함한다. 실측 5명이 해당하고 507·509호는 이미 발급 이력이 있다.
          // 비거주(NON_RESIDENT)도 대상 — 같은 입실자가 거주·비거주 계약을 함께 가질 수 있어
          // 단순 take 1 로는 엉뚱한 쪽이 잡힌다. 여러 건을 받아 아래에서 고른다(실거주확인서와 같은 처방).
          // 퇴실 완료(CHECKED_OUT)는 납부 확인서에만 연다(2026-10-20, 운영자 승인 범위 5번). 지난 달들의 납부를
          // 증명하는 종이라 퇴실 뒤에도 요청이 온다. 보증금 영수증은 아래에서 다시 거른다(퇴실 뒤 새로 쓸 사건 증빙이 아니다).
          // 우선순위는 lib/documentLease 표 밖(맨 뒤)이라 진행 중 계약이 있으면 종전 선택이 그대로다.
          where: { status: { in: kind === 'deposit'
            ? ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'NON_RESIDENT']
            : ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'NON_RESIDENT', 'CHECKED_OUT'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 10,
          include: { room: { select: { roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } }, discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } } },
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { phone: true, businessInfo: true, bankAccount: true, cleaningFeeInDeposit: true },
    }),
  ])

  if (!tenant) return null

  // 선택 규칙은 lib/documentLease 정본 하나다(계약서·실거주 확인서와 같은 함수).
  // 종전의 '비거주만 뒤로'는 절반짜리라, 한 사람이 예약과 거주를 함께 들면 이 서류만 다른 계약을
  // 그렸다. 실데이터 107명 전원에서 선택 결과가 같음을 확인하고 전 상태 우선순위로 올렸다.
  const lease = pickDocumentLease(tenant.leaseTerms, leaseTermId)
  const nonResident = lease?.status === 'NON_RESIDENT'
  const biz = (property?.businessInfo as BusinessInfo | null) ?? {}
  const isShortTerm = !!lease?.isShortTerm
  // 이 계약의 이용료 입금 전부 — 고를 수 있는 달(여러 달)과 퇴실 완료 계약의 기본 달을 함께 정한다.
  // 실입금 술어는 lib/rentPaid 정본(isRealRentPayment)이 rentReceiptMonths 안에서 쥔다.
  const allRentRecs = lease && kind === 'rent'
    ? await prisma.paymentRecord.findMany({
        where: { leaseTermId: lease.id, isDeposit: false, isPrevOwner: false },
        select: { targetMonth: true, actualAmount: true, isBillingAdjust: true, memo: true, payDate: true },
      })
    : []
  const paidMonths = issuableRentMonths(allRentRecs)
  // 단기는 입주월 단일 청구 — anchor 를 입주월로 고정(스테퍼도 화면에서 숨김, 회계 오더 2026-07-27)
  // 퇴실 완료 계약은 달을 안 주면 마지막 실입금 달을 연다. 오늘 주기를 열면 늘 '수납 기록 없음'이다.
  const requestedMonth = /^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : null
  const anchorMonth = isShortTerm && lease?.moveInDate
    ? new Date(lease.moveInDate).toISOString().slice(0, 7)
    : requestedMonth ?? (lease?.status === 'CHECKED_OUT' ? paidMonths[0]?.month ?? null : null)
  const cycle = rentCyclePeriod(lease?.dueDay ?? null, lease?.moveInDate ?? null, anchorMonth)
  const nextDue = dotPad(new Date(new Date(`${cycle.end}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10))
  const [cy, cm] = cycle.start.split('-').map(Number)
  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const todayMonth = todayKst.slice(0, 7)
  const viewMonth = cycle.start.slice(0, 7)

  // ── 보증금 영수증(kind='deposit') ─────────────────────────────────────
  // 보증금은 귀속 월이 없는 1회성 수령이고 반환 예정 채무다. 따라서 월 필터를 타지 않고
  // lease 전체의 isDeposit 실수납을 합산한다("받은 돈은 조회월과 무관" 정본).
  // 약정액(lease.depositAmount)을 자동기입하지 않는 것은 이용료와 같은 규칙 — 안 받은 돈을 받았다고
  // 적으면 허위 서류다. 부분 수령이면 화면 경고만 띄우고 발급 자체는 막지 않는다.
  if (kind === 'deposit') {
    const bank = property?.bankAccount ? `계좌이체 · ${property.bankAccount}` : '현금'
    let paid = 0
    let last: { payDate: Date; payMethod: string | null } | null = null
    if (lease) {
      const recs = await prisma.paymentRecord.findMany({
        where: { leaseTermId: lease.id, isDeposit: true, isPrevOwner: false },
        select: { actualAmount: true, payDate: true, payMethod: true },
        orderBy: { payDate: 'asc' },
      })
      for (const r of recs) {
        if (r.actualAmount <= 0) continue
        paid += r.actualAmount
        last = { payDate: r.payDate, payMethod: r.payMethod }
      }
    }
    const contracted = lease?.depositAmount ?? 0
    // 청소비가 보증금 안의 몫인 영업장에서는 현금 30,000 + 청소비 20,000 = 계약 50,000 이 완납이다.
    // 종전에는 현금만 세서 그런 계약이 영수증마다 '일부 수령' 경고를 달고 나왔다(상시 오탐).
    const cleaningPaidAgg = lease
      ? await prisma.extraIncome.aggregate({
          where: { leaseTermId: lease.id, propertyId, ...CLEANING_FEE_RECEIVED_WHERE }, _sum: { amount: true },
        })
      : null
    const depoComp = depositComposition({
      contractDeposit: contracted, depositPaid: paid,
      cleaningPaid: cleaningPaidAgg?._sum.amount ?? 0,
      cleaningFeeInDeposit: property?.cleaningFeeInDeposit ?? false,
    })
    const depoPartial = contracted > 0 && depoComp.shortfall > 0
    const moveInYmd = lease?.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null
    // 아직 입주 전이면 거주한 적이 없으므로 거주 기간을 비운다(운영자 지적 2026-07-31).
    // 보증금은 입주 전에 받는 돈이라 이 경우가 오히려 일반적이고, 살지도 않은 기간을 적으면 허위 기재다.
    const notMovedIn = lease?.status === 'RESERVED' || (!!moveInYmd && moveInYmd > todayKst)
    return {
      tenantId: tenant.id,
      leaseTermId: lease?.id ?? null,
      name: tenant.name,
      englishName: tenant.englishName,
    nativeName: tenant.nativeName,
      nationality: tenant.nationality,
    hasForeignRegNo: !!tenant.foreignRegNoEnc,
    tenantDocNameStyle: asDocNameStyle(tenant.docNameStyle) ?? null,
      lastNameStyle: asDocNameStyle(lease?.lastDocNameStyle) ?? null,
      room: fmtRoom(lease?.room?.roomNo),
      period: notMovedIn ? '' : `${dotPad(cycle.start)} ~ ${dotPad(cycle.end)}`,
      targetMonth: moveInYmd ? kor(moveInYmd) : '',
      amount: paid,
      payDate: kor(last ? new Date(last.payDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : todayKst),
      payMethod: last?.payMethod ?? bank,
      // 입주 전이면 예약금과 성격이 같다 — 입실 취소 시 반환되지 않는다는 점을 비고에 명시(운영자 지시)
      note: notMovedIn
        ? (depoPartial
            ? `계약 보증금 ${contracted.toLocaleString()}원 중 일부 · 입실 취소 시 반환되지 않습니다`
            : '입주 전 예약금 · 입실 취소 시 반환되지 않습니다')
        : depoPartial
          ? `계약 보증금 ${contracted.toLocaleString()}원 중 일부 수령`
          : depoComp.coveredByCleaning > 0
            // 현금 영수액과 계약 보증금이 다른 이유를 서류 자체가 설명해야 한다(입주자가 들고 가는 종이다).
            ? `계약 보증금 ${contracted.toLocaleString()}원 중 청소비 ${depoComp.coveredByCleaning.toLocaleString()}원은 입실 시 별도 수령 · 퇴실 시 미납금·손해배상액 공제 후 반환`
            : '퇴실 시 미납금·손해배상액 공제 후 반환',
      recipientName: biz.ceoName ?? '',
      anchorMonth: viewMonth,
      todayMonth,
      isShortTerm,
      warning: paid <= 0 ? 'noRecord' : (depoPartial ? 'partial' : null),
      kind,
      preResidence: notMovedIn,
      nonResident,
      issueDefaults: { value: todayKst, minDate: null, openMonth: null },
      issuable: [],
      leaseStatus: lease?.status ?? null,
    }
  }

  // 납부 확인서의 정본은 실입금(회계 오더 2026-07-27) — 그 귀속월(targetMonth=주기 시작월)의 수납 기록.
  // 보증금·양도인 몫·청구 조정 전표 제외. 소프트삭제는 prisma 확장이 자동 필터(where 에 deletedAt 금지).
  let paidSum = 0
  let lastRec: { payDate: Date; payMethod: string | null } | null = null
  let lockMax = 0
  // 그 달 조정 행 — 청구 엔진의 입력(입주달 첫 달 규칙). 엔진은 입주달 조정 행만 보고 여기서 묻는 달은 viewMonth 하나라,
  // 그 달 행에서 고르면 빠짐이 없다(lib/dueDayAdjust dueDayAdjustsFrom, 쿼리 추가 없음).
  let dueDayAdjusts: BillingDueDayAdjust[] = []
  if (lease) {
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, targetMonth: viewMonth, isDeposit: false, isPrevOwner: false },
      select: { actualAmount: true, expectedAmount: true, payDate: true, payMethod: true, isBillingAdjust: true, memo: true, targetMonth: true, seqNo: true },
      orderBy: { payDate: 'asc' },
    })
    dueDayAdjusts = dueDayAdjustsFrom(recs)
    for (const r of recs) {
      lockMax = Math.max(lockMax, r.expectedAmount)   // 청구 락(조정 전표 포함) — 부분 납부 판정용
      // 실입금 판정은 lib/rentPaid 정본이 쥔다 — 서류 시트의 '이번 달 확인서 작성' 문이 같은
      // 술어로 열린다. 사본을 두면 문은 열렸는데 금액은 0 인 날이 온다.
      if (!isRealRentPayment(r)) continue
      paidSum += r.actualAmount
      lastRec = { payDate: r.payDate, payMethod: r.payMethod }
    }
  }

  // 귀속월마다 살아 있는 발급본의 가장 늦은 발행일 — 여러 달 목록이 '발급본이 이미 있습니다'를 말한다.
  const issuedRows = lease && !isShortTerm
    ? await prisma.rentReceiptFile.findMany({
        where: { leaseTermId: lease.id, propertyId, kind: 'rent', deletedAt: null, targetMonth: { not: null } },
        select: { targetMonth: true, issuedAt: true },
      })
    : []
  const issuedByMonth = new Map<string, string>()
  for (const r of issuedRows) {
    const prev = issuedByMonth.get(r.targetMonth as string)
    const iso = r.issuedAt.toISOString()
    if (!prev || iso > prev) issuedByMonth.set(r.targetMonth as string, iso)
  }

  const defaultPayMethod = property?.bankAccount ? `계좌이체 · ${property.bankAccount}` : '현금'
  const isPastMonth = viewMonth < todayMonth
  let amount: number
  let payDateYmd: string
  let payMethod = defaultPayMethod
  let warning: 'noRecord' | 'partial' | null = null
  if (paidSum > 0 && lastRec) {
    // 실입금이 있으면 과거·이번 달 공통으로 실입금 합 + 최종 입금일 + 그 record 의 납부방법
    amount = paidSum
    payDateYmd = new Date(lastRec.payDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    payMethod = lastRec.payMethod ?? defaultPayMethod
    if (lockMax > 0 && paidSum < lockMax) warning = 'partial'
  } else if (isPastMonth) {
    // 기록 없는 과거 달 — 계약액 자동기입은 허위 서류가 된다. 0원 + 경고(발급 차단은 안 함, 수동 입력 허용)
    amount = 0
    payDateYmd = cycle.start
    warning = 'noRecord'
  } else {
    // 이번 달인데 아직 기록 없음 — '방금 받은 돈' 발급 흐름의 초기값.
    //
    // 종전에는 discountedRent 만 불러서 **청구 정본을 안 탔다.** 그래서
    //   락인 expectedAmount(협의가·청구 조정 전표) · 퇴실 일할 checkoutProratedAmount · 예약 인상 scheduledRent
    // 셋이 전부 무시됐다. 퇴실 일할이 걸린 달이면 서민준 기준 80,000 이 400,000 으로 나온다.
    // billForLeaseMonth 정본을 탄다(우선순위 일할 > 락인 > 예약 인상 > 할인). E페이즈 조사 2026-08-03.
    amount = lease
      ? billForLeaseMonth(
          {
            rentAmount: lease.rentAmount,
            status: lease.status,
            dueDay: lease.dueDay ?? null,
            dueDayAdjusts,
            discounts: lease.discounts ?? [],
            checkoutProratedAmount: lease.checkoutProratedAmount ?? null,
            checkoutProratedMonth: lease.checkoutProratedMonth ?? null,
            isShortTerm: lease.isShortTerm,
            moveInDate: lease.moveInDate,
            room: {
              scheduledRent: lease.room?.scheduledRent ?? null, rentUpdateDate: lease.room?.rentUpdateDate ?? null,
              nonResidentScheduled: lease.room?.nonResidentScheduled ?? null, nonResidentRentDate: lease.room?.nonResidentRentDate ?? null,
            },
          },
          viewMonth,
          lockMax > 0 ? lockMax : null,
        )
      : 0
    payDateYmd = todayKst
  }

  return {
    tenantId: tenant.id,
    leaseTermId: lease?.id ?? null,
    name: tenant.name,
    englishName: tenant.englishName,
    nativeName: tenant.nativeName,
    nationality: tenant.nationality,
    hasForeignRegNo: !!tenant.foreignRegNoEnc,
    tenantDocNameStyle: asDocNameStyle(tenant.docNameStyle) ?? null,
    lastNameStyle: asDocNameStyle(lease?.lastDocNameStyle) ?? null,
    room: fmtRoom(lease?.room?.roomNo),
    period: `${dotPad(cycle.start)} ~ ${dotPad(cycle.end)}`,
    targetMonth: `${cy}년 ${cm}월분`,
    amount,
    payDate: kor(payDateYmd),
    payMethod,
    note: `다음 납부 예정일 ${nextDue}`,
    recipientName: biz.ceoName ?? '',
    anchorMonth: viewMonth,
    todayMonth,
    isShortTerm,
    warning,
    kind,
    preResidence: false,
    nonResident,
    issueDefaults: issueDateDefaults(paidSum > 0 && lastRec ? payDateYmd : null, todayKst),
    issuable: isShortTerm ? [] : paidMonths.map(m => ({ ...m, issuedAt: issuedByMonth.get(m.month) ?? null })),
    leaseStatus: lease?.status ?? null,
  }
}

/**
 * 발급 적용취소(§16) — 한 장 발급과 여러 달 묶음 발급이 같은 길이다(한 장 = 길이 1 인 묶음).
 *
 * 되돌림은 발급 이력의 '삭제'와 같은 모양이다. 행에 deletedAt 을 찍고 Drive 파일을 휴지통으로 보낸다(전역 발급
 * 이력의 restoreRentReceiptFile 이 그 짝이다). 지운 행도 발행번호를 쥐고 있어 다음 번호가 겹치지 않는다(채번이
 * 지운 행까지 센다). 그래서 번호에는 빈자리가 남는다. 물리 삭제로 번호를 되돌리면 그 사이 다른 발급이 있었을 때
 * 같은 번호가 두 번 나간다.
 *
 * CAS. 토큰이 적어 둔 '발급 직후 모양'과 지금 행이 글자 그대로 같을 때만, 그리고 묶음이면 **전부** 같을 때만
 * 되돌린다. 그 사이 발급 이력에서 한 장을 지웠거나 바뀌었으면 아무것도 안 바꾼다(묶음을 반쪽만 되돌리지 않는다).
 * 서명은 현금영수증 적용취소와 같은 정본이고 용도 라벨이 'rent-receipt-issue' 다. 영업장 범위는 where 의
 * propertyId 가 진다(남의 영업장 id 로는 행이 안 잡혀 STALE 로 끝난다).
 *
 * 계약에 남긴 성명 표기 힌트(lastDocNameStyle)는 되돌리지 않는다. 다음 서류를 편하게 열려는 힌트이지 종이의
 * 사실이 아니고, 그 사이 다른 서류가 같은 칸을 썼을 수 있다(noteDocNameStyle 머리말).
 */
export async function undoRentReceiptIssue(raw: unknown): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await requireEdit()
  const { propertyId } = await requirePropertyAccess()
  const u = parseRentReceiptUndo(raw)
  if (!u || !verifyUndoBody(RENT_RECEIPT_UNDO_DOMAIN, propertyId, canonicalRentReceiptUndo(u), u.sig)) {
    return { ok: false, error: RENT_RECEIPT_UNDO_INVALID }
  }
  const ids = u.rows.map(r => r.id)
  let driveIds: string[]
  try {
    driveIds = await prisma.$transaction(async tx => {
      const rows = await tx.rentReceiptFile.findMany({
        where: { id: { in: ids }, propertyId },
        select: {
          id: true, driveFileId: true, fileName: true, receiptNo: true, issuedAt: true, kind: true,
          targetMonth: true, tenantId: true, leaseTermId: true, nameStyle: true, deletedAt: true,
        },
      })
      const byId = new Map(rows.map(r => [r.id, r]))
      for (const t of u.rows) {
        const db = byId.get(t.id)
        if (!db || !rentReceiptRowUnchanged(db, t)) throw new RentReceiptUndoStale()
      }
      // 확인과 쓰기 사이에 다른 적용취소·삭제가 끼면 여기서 수가 모자란다. 그러면 전부 되감는다.
      const res = await tx.rentReceiptFile.updateMany({
        where: { id: { in: ids }, propertyId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      if (res.count !== ids.length) throw new RentReceiptUndoStale()
      return rows.map(r => r.driveFileId)
    })
  } catch (err) {
    if (err instanceof RentReceiptUndoStale) return { ok: false, error: RENT_RECEIPT_UNDO_STALE }
    throw err
  }
  // Drive 정리는 커밋 뒤 — 실패해도 이력은 이미 지워졌고, 전역 발급 이력의 삭제와 같은 규칙(실패 무시)이다.
  const { trashInDrive } = await import('@/lib/google-drive')
  for (const id of driveIds) { try { await trashInDrive(id) } catch { /* Drive 정리 실패 무시 */ } }
  revalidatePath('/rent-receipts')
  return { ok: true, count: ids.length }
}

class RentReceiptUndoStale extends Error {
  constructor() { super(RENT_RECEIPT_UNDO_STALE); this.name = 'RentReceiptUndoStale' }
}
