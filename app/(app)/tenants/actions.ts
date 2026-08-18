'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { consumeGeminiAccess } from '@/lib/geminiKey'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma, { type PrismaDb } from '@/lib/prisma'
import { unpaidForLease, billedForLease } from '@/lib/billing'
import { canTransition, transitionDeniedMessage, transitionStatusLabel } from '@/lib/leaseTransitions'
import { reasonsForStatus } from '@/lib/statusReasons'
import { CLEANING_FEE_CATEGORY, CLEANING_FEE_RECEIVED_WHERE, DEPOSIT_SOURCED_PAY_METHOD } from '@/lib/incomeCategories'
import { depositComposition, splitWithheldDeposit, type DepositComposition } from '@/lib/depositComposition'
import { cleaningFeeDeductible, CLEANING_WITHHOLD_REASON } from '@/lib/depositWithholdReasons'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { LeaseStatus, ContactType, Gender, PaymentTiming, RegistrationStatus, Prisma } from '@prisma/client'
import { requireEdit } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import { recordDepositReceived, reanchorReservationPrepaid } from '@/app/(app)/rooms/actions'
import { discountedRent } from '@/lib/rentDiscount'
import { calcCheckoutProration, calcCheckoutRefund, clampPenaltyPct, isMoveOutNear, type CheckoutProrationResult, type CheckoutRefundResult, type RefundMode } from '@/lib/prorate'
import { kstYmdStr, kstDateTimeToUtc, ymdToDbDate } from '@/lib/kstDate'
import { parseShortStayPolicy, calcShortStay, stayDaysOf, isWithinOneCalendarMonth, type ShortStayPolicy } from '@/lib/shortStay'
import { loadWishMatch, WISH_LEAD_STATUSES, leavesWishLead, type WishLeaseMatch } from '@/lib/wishMatch'
import { propagateDueDayToSubLeases } from '@/lib/dueDay'
import { propagateMoveInDateToSubLeases } from '@/lib/moveInDate'

// 거주 전(pending) 상태 — 납부일이 무의미한 단계라 저장 시 dueDay 를 비운다(운영자 지적 2026-07-30).
// 등록 폼의 자동 파생 잔존이 문의·예약 건에 '말일'로 박히던 오염의 근본 봉합. 청구 상태 진입 시 재파생.
const DUE_PENDING_STATUSES = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED']
// 입주일 기준 납부일 파생 — 30일 이상이면 '말일'(등록 폼 applyDueDay 와 동일 규칙)
function dueDayFromMoveIn(moveIn: Date): string {
  const day = moveIn.getUTCDate()
  return day >= 30 ? '말일' : String(day)
}
import { shortStayLockTarget, lockAdjustKind, lockRewritesFor, shortStayBasisChanged, negotiatedRecalcNotice, type LockRewrite } from '@/lib/shortStayLock'
import { digitsToIso } from '@/lib/birthdate'
import { formatForeignRegNo, validateForeignRegNo } from '@/lib/foreignRegNo'
import { sanitizeNativeName } from '@/lib/documentName'
import { sanitizeNickname, toStoredDisplayNameStyle } from '@/lib/displayName'
import { maskStoredForeignRegNo, readStoredForeignRegNo, storeForeignRegNo } from '@/lib/pii'
import { randomUUID } from 'node:crypto'
import { parseRequestCategories } from '@/lib/requestCategories'
import { getRoomNoSnapshot } from '@/lib/requestRoomSnapshot'
import { ensureOpenStay, closeStay, syncRoomStayOnSave, isStayTerminalStatus } from '@/lib/roomStay'
import { resolveCategoryForSave } from '@/lib/categoryInput'
import { FORFEIT_CATEGORY, PENALTY_CATEGORY } from '@/lib/incomeCategories'
import { CARD_LIKE_METHODS } from '@/lib/paymentMethods'
import { checkSettlementMonth } from '@/lib/accountingGuard'
import { settlementPeriodFor } from '@/lib/settlementPeriod'
import { isVacancyExcluded } from '@/lib/vacancy'
import { roomAssignmentDenial, leaseSubordinationDenial, NON_RESIDENT_ROOM_ERROR } from '@/lib/roomAssignment'
import { primaryTenantLease } from '@/lib/leaseStatus'

/**
 * 폼의 외국인등록번호를 저장값으로 옮긴다. AAD 가 입주자 id 라 신규 등록은 id 를 먼저 정하고 부른다.
 *
 * 빈 값은 '건드리지 않음' 이다. 화면이 마스킹만 보여주는 것이 정상 흐름이라(뒤 7자리를 다시 받지 않는다)
 * 빈 값을 삭제로 읽으면 이름만 고쳐도 번호가 조용히 사라진다. 지우기는 별도 신호로만 받는다.
 * 국적을 대한민국으로 바꿔 칸이 사라진 경우도 같은 규칙이라 기존 값이 보존된다(본국 연락처 관행).
 */
function foreignRegNoPatch(formData: FormData, tenantId: string):
  | { ok: true; data: { foreignRegNoEnc?: string | null } }
  | { ok: false; error: string } {
  if (formData.get('foreignRegNoClear') === '1') return { ok: true, data: { foreignRegNoEnc: null } }
  const raw = (formData.get('foreignRegNo') as string | null) ?? ''
  if (!raw.trim()) return { ok: true, data: {} }
  const checked = validateForeignRegNo(raw)
  if (!checked.ok) return { ok: false, error: checked.error }
  return { ok: true, data: { foreignRegNoEnc: storeForeignRegNo(checked.value, tenantId) } }
}

// 현지 표기 이름 패치 — 폼이 그 칸을 **실제로 보냈을 때만** 키를 담는다.
// 국적이 대한민국이면 칸 자체가 안 그려지고(외국인등록번호·본국 연락처와 같은 조건), 그때 빈 값으로
// 덮으면 이미 들어 있던 표기가 조용히 지워진다. 칸이 보이는 상태에서 비우면 그 뜻대로 지운다.
function nativeNamePatch(formData: FormData): { nativeName?: string | null } {
  if (!formData.has('nativeName')) return {}
  return { nativeName: sanitizeNativeName(formData.get('nativeName')) }
}

// 별칭·카드 표시 이름 패치 — 현지 표기와 같은 '칸이 왔을 때만 건드린다' 규칙.
// 폼은 두 칸을 항상 보내지만(전송 지점 상시 렌더), 다른 경로에서 부분 저장이 들어오면
// 여기 없는 키는 손대지 않는다. 표시 선택은 기본(한글)일 때 NULL 로 남긴다 — 칸이 생기기 전과 같은 상태.
// 서류 성명 표기(lib/documentName)와는 별개 축이라 그쪽 저장에는 아무 영향이 없다.
function displayNamePatch(formData: FormData): { nickname?: string | null; displayNameStyle?: string | null } {
  const patch: { nickname?: string | null; displayNameStyle?: string | null } = {}
  if (formData.has('nickname')) patch.nickname = sanitizeNickname(formData.get('nickname'))
  if (formData.has('displayNameStyle')) patch.displayNameStyle = toStoredDisplayNameStyle(formData.get('displayNameStyle'))
  return patch
}

// 폼 생년월일(점 포맷 "1970.09.28" / ISO / 부분 입력) → 저장용 Date. 유효 8자리만 저장, 그 외 null.
function birthdateToDate(raw: string): Date | null {
  const iso = digitsToIso(raw)
  return iso ? new Date(iso) : null
}

async function getPropertyId() {
  const { userId, propertyId, role } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId, role }
}

// 입주자 목록 조회

// 퇴실하면 청소 예정을 자동으로 만든다(신고 b21e4e98 3단계).
// 붙일 자리가 두 곳이다 — checkoutTenant(홈 알림 경로)와 applyStatusTransition(상태전환 위젯 경로).
// 한 곳만 넣으면 퇴실 경로에 따라 누락된다. 코드가 스스로 "동일"이라고 적어둔 그 중복이다.
// 이미 열린 **퇴실** 청소 예정이 있으면 만들지 않는다. 되풀이 퇴실이나 상태 되돌리기로 같은 방에
// 예정이 쌓이면 '청소 필요' 숫자가 실제보다 커진다.
// 종전에는 사유를 안 보고 그 방의 아무 예정에나 걸려 넘어갔다. 그러면 입실 중 요청 청소 하나가
// 열려 있다는 이유로 퇴실 청소가 조용히 안 생긴다 — 사유가 다르면 다른 일이라 서로 갈음이 안 된다.
// 퇴실을 되돌리면 자동으로 만든 청소 예정도 걷는다. 안 걷으면 거주 중인 방에 '청소 필요' 가 붙는다.
// **자동으로 만든 것만** 지운다 — 운영자가 손으로 등록한 예정은 leaseTermId 가 없거나 사유가 다르고,
// 그것까지 지우면 사람이 넣은 일정을 코드가 없앤 것이 된다.
async function clearAutoCheckoutCleaning(propertyId: string, leaseTermId: string) {
  try {
    await prisma.roomCleaning.updateMany({
      where: { propertyId, leaseTermId, reason: 'CHECKOUT', status: 'PLANNED', deletedAt: null },
      data: { deletedAt: new Date() },
    })
  } catch { /* 청소 이력은 상태 전이를 막지 않는다 */ }
}

async function ensureCheckoutCleaning(propertyId: string, roomId: string | null, leaseTermId: string) {
  if (!roomId) return
  try {
    const open = await prisma.roomCleaning.findFirst({
      where: { roomId, propertyId, deletedAt: null, status: 'PLANNED', reason: 'CHECKOUT' },
      select: { id: true },
    })
    if (open) return
    await prisma.roomCleaning.create({
      // scheduledDate 는 @db.Date 다. 날 new Date() 를 넣으면 서버(UTC)가 KST 오전 9시 전에는
      // 어제로 잘라 저장해 예정일이 하루 앞선다. 날짜 저장 정본(ymdToDbDate)으로 UTC 자정을 박는다
      // — 종전의 `T00:00:00` 은 오프셋이 없어 KST 기기에서 돌면 도리어 하루 앞섰다.
      data: { propertyId, roomId, leaseTermId, reason: 'CHECKOUT', status: 'PLANNED', scheduledDate: ymdToDbDate(kstYmdStr()) },
    })
  } catch { /* 청소 이력은 퇴실을 막지 않는다 — 실패해도 퇴실 처리는 그대로 끝난다 */ }
}

export async function getTenants() {
  const { propertyId, role } = await getPropertyId()

  const tenants = await prisma.tenant.findMany({
    where: { propertyId },
    include: {
      contacts: true,
      leaseTerms: {
        orderBy: { createdAt: 'desc' },
        // take: 1 을 뺐다(2026-08-13) — 한 사람이 방을 둘 쓰면(509호 거주 + 601호 창고) '그 사람의
        // 계약'이 하나가 아니다. 잘라 보내면 어느 쪽이 오는지가 정렬에 달리고, 화면은 나머지 계약이
        // 존재한다는 사실 자체를 모른다. 메인 계약 선택은 화면이 primaryTenantLease 정본으로 한다.
        // 정렬(createdAt desc)은 그 정본의 마지막 폴백이 종전과 같은 계약을 고르도록 유지한다.
        include: {
          room: { select: { id: true, roomNo: true, floor: true } },
          // 환불 이력 유무 — 퇴실 재저장 시 환불 모달 재노출(중복 저장)을 막는 판정용(신고 13438ec9). 추가 왕복 없음.
          _count: { select: { depositRefunds: true } },
          // 취소 단계 부제(어느 단계에서 취소됐나) — 최근 CANCELLED 전이의 fromStatus·사유(e1b81629).
          // 퇴실 사유도 같은 자리에서 가져온다(운영자 오더 2026-08-03) — 한 사람이 지금 취소이면서
          // 동시에 퇴실일 수는 없으므로 최신 한 건이면 충분하다. 왕복이 늘지 않는다.
          statusLogs: {
            // CHECKOUT_PENDING 도 본다 — 퇴실 사유를 말하는 시점은 통보를 받는 '퇴실 예정'이지
            // 확정 순간이 아니다. 여기를 빼면 가장 자연스러운 수집 지점의 값이 표·카드에서 사라진다.
            // take 를 늘려 화면이 골라 쓴다 — 사유 있는 최신 한 건(표시)과 최신 CANCELLED(취소 단계)는
            // 서로 다른 행일 수 있어서 한 건만 가져오면 둘 중 하나가 죽는다.
            // deletedAt 은 손수 적는다 — 중첩 관계 조회는 소프트삭제 자동필터가 안 걸린다.
            // 여기가 무효 처리의 결정적 자리다(신고 e000c791): 잘못 적힌 퇴실 사유를 안 거르면
            // 그 사람이 실제로 퇴실하는 날 목록·카드의 퇴실 사유로 그대로 튀어나온다.
            where: { deletedAt: null, toStatus: { in: ['CANCELLED', 'CHECKOUT_PENDING', 'CHECKED_OUT'] } },
            orderBy: { changedAt: 'desc' },
            take: 5,
            select: { fromStatus: true, toStatus: true, reason: true },
          },
          paymentRecords: {
            where: { deletedAt: null },
            orderBy: { targetMonth: 'desc' },
            // 종전 take: 12 는 '최근 12개월' 의도였는데 실제로는 **record 12건**이라,
            // 한 달에 나눠 낸 계약은 오래된 달이 잘려 미납액이 반대로 과소 계상된다.
            // 김민정이 이미 7건이라 곧 발현한다. 달 기준으로 바꾼다.
            take: 60,
            select: {
              id: true, targetMonth: true,
              expectedAmount: true, actualAmount: true,
              // 미납액 정본(unpaidForLease)이 요구하는 플래그 — 종전엔 안 내려보내서
              // 클라이언트가 거르고 싶어도 못 걸렀다(신고 2026-08-02).
              isDeposit: true, isPrevOwner: true, isBillingAdjust: true,
              isPaid: true, payDate: true, payMethod: true, memo: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // 금액 읽기 차단(제한 스태프) — 응답 payload에서 이용료·보증금·청소비 제거. 조회 전용 경로라 결제 수식 무관.
  if (!canReadScope(role, 'money')) {
    for (const t of tenants) {
      for (const lt of t.leaseTerms) {
        ;(lt as { rentAmount: number | null }).rentAmount = null
        ;(lt as { depositAmount: number | null }).depositAmount = null
        ;(lt as { cleaningFee: number | null }).cleaningFee = null
      }
    }
  }
  // 신원번호는 컬럼째 내려보내지 않는다. 이 조회는 include 라 새 스칼라가 자동으로 딸려 나오는데,
  // 암호문이라도 브라우저가 들고 있을 이유가 없다. 스코프가 없는 역할에는 마스킹조차 주지 않는다.
  const canIdentity = canReadScope(role, 'identity')
  return tenants.map(({ foreignRegNoEnc, ...t }) => ({
    ...t,
    foreignRegNoMasked: canIdentity ? maskStoredForeignRegNo(foreignRegNoEnc, t.id) : null,
  }))
}

/**
 * 희망한 방이 하나 이상 있었지만 전부 날짜에서 빠진 계약의 id 목록.
 *
 * 홈 알림은 그 사람들을 세어 보여 주기만 한다("날짜가 맞지 않아 제외 N명"). 정작 연락해야 할
 * 상대가 목록 어디에 있는지 알 수 없으면 알림이 행동으로 이어지지 않는다 — 운영자 오더의
 * "기다리는 사람에게 방이 없다고 알려줄 수 있어야 한다"가 여기서 완성된다.
 * 판정은 홈과 같은 함수(lib/wishMatch)를 쓴다. 사본을 만들면 두 화면이 다른 사람을 가리킨다.
 */
export async function getWishDateNotices(): Promise<string[]> {
  const { propertyId } = await getPropertyId()
  const { noDateFitLeaseIds } = await loadWishMatch(prisma, propertyId, kstYmdStr())
  return noDateFitLeaseIds
}

/**
 * 이 계약 한 건의 사람 축 — "이 사람은 지금 어느 방에 들어갈 수 있는가".
 *
 * 홈 알림은 방을 세로 보고("409호에 맞는 사람 3명"), 입주자 상세는 사람을 세로 본다. 같은 판정을
 * 뒤집어 보는 것뿐이라 여기서 다시 매칭 규칙을 쓰지 않고 loadWishMatch 의 사람 축 한 칸을 꺼낸다.
 *
 * 노출 조건은 buildWishMatch 와 같아야 한다 — 리드 3상태이고 예약 확정 전. 여기가 한 글자라도
 * 다르면 홈은 후보라고 하는데 상세에는 안 보이는(또는 그 반대) 상태가 된다. 대상이 아니면 null.
 */
export async function getWishRoomsForLease(leaseTermId: string): Promise<WishLeaseMatch | null> {
  const { propertyId } = await getPropertyId()
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    select: { id: true, status: true, reservationConfirmedAt: true },
  })
  if (!lease) return null
  const leadStatuses: string[] = [...WISH_LEAD_STATUSES]
  if (!leadStatuses.includes(lease.status) || lease.reservationConfirmedAt) return null
  const { leases } = await loadWishMatch(prisma, propertyId, kstYmdStr())
  return leases.find(l => l.leaseId === leaseTermId) ?? null
}

/**
 * 저장된 외국인등록번호의 평문을 꺼내는 유일한 문. 입주자 화면의 [보기] 가 이 액션을 부른다.
 * 값을 돌려주기 전에 열람 기록을 남긴다. 뒤에 두면 기록 실패가 곧 기록 없는 열람이 된다.
 */
export async function revealForeignRegNo(tenantId: string): Promise<
  { ok: true; value: string } | { ok: false; error: string }
> {
  try {
    const { user, propertyId, role } = await getPropertyId()
    if (!canReadScope(role, 'identity')) return { ok: false, error: '외국인등록번호를 볼 권한이 없습니다.' }
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      select: { id: true, foreignRegNoEnc: true },
    })
    if (!tenant) return { ok: false, error: '입주자를 찾을 수 없습니다.' }
    if (!tenant.foreignRegNoEnc) return { ok: false, error: '등록된 외국인등록번호가 없습니다.' }
    const plain = readStoredForeignRegNo(tenant.foreignRegNoEnc, tenant.id)
    if (!plain) return { ok: false, error: '저장된 외국인등록번호를 읽지 못했습니다. 다시 입력해 주세요.' }
    await prisma.foreignRegNoView.create({
      data: { tenantId: tenant.id, propertyId, viewedById: user.sub },
    })
    return { ok: true, value: formatForeignRegNo(plain) }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '외국인등록번호를 불러오지 못했습니다.' }
  }
}

/**
 * 폼의 '일정 조절' 세그먼트 읽기 — 'yes'=true · 'no'=false · ''=미확인(null).
 * 필드 자체가 없으면 undefined 를 돌려준다. 거주 단계 저장은 이 입력을 그리지 않으므로
 * undefined 가 곧 '이 저장은 그 값을 편집하지 않는다'다(tourDate·inquiryAt 과 같은 부재=보존 관행).
 */
function moveInFlexibleOf(formData: FormData): boolean | null | undefined {
  if (!formData.has('moveInFlexible')) return undefined
  const v = (formData.get('moveInFlexible') as string) || ''
  return v === 'yes' ? true : v === 'no' ? false : null
}

/**
 * 그 방에 잡힌 예약 중 늘어난 체류 구간과 겹치는 첫 건 — 단기 연장(extendShortStay)과 편집 폼(updateTenant)이 공유한다.
 *
 * 구간으로 묻는다. "새 퇴실일 ≥ 다음 예약 입주일" 하나만 보면 **앞에 있던 예약**까지 걸린다 —
 * 404호는 조성훈(8/15~8/31) 뒤에 박정후(9/1~12/20)가 붙어 있어서, 박정후를 하루 늘리는 것이
 * 이미 나간 조성훈과 겹친다고 나왔다. 겹침은 두 구간이 실제로 포개질 때만이다.
 *   내 구간 [입주일, 새 퇴실일] · 예약 구간 [입주일, 퇴실 예정일(없으면 무기한)]
 */
async function nextReservationConflict(
  roomId: string | null,
  excludeLeaseId: string,
  selfMoveInYmd: string | null,
  newOutYmd: string | null,
): Promise<{ moveIn: string; tenantName: string } | null> {
  if (!roomId || !newOutYmd) return null
  const next = await prisma.leaseTerm.findFirst({
    where: {
      roomId, id: { not: excludeLeaseId }, status: 'RESERVED',
      moveInDate: { not: null, lte: new Date(`${newOutYmd}T00:00:00.000Z`) },
      // 내가 들어오기 전에 이미 나가는 예약은 겹치지 않는다(퇴실일 없는 예약은 무기한이라 항상 겹친다).
      ...(selfMoveInYmd
        ? { OR: [{ expectedMoveOut: null }, { expectedMoveOut: { gte: new Date(`${selfMoveInYmd}T00:00:00.000Z`) } }] }
        : {}),
    },
    orderBy: { moveInDate: 'asc' },
    select: { moveInDate: true, tenant: { select: { name: true } } },
  })
  if (!next?.moveInDate) return null
  return { moveIn: new Date(next.moveInDate).toISOString().slice(0, 10), tenantName: next.tenant.name }
}

/**
 * 거주용이 아닌 방인가 — 방 배정이 일어나는 경로가 공유하는 정본 판정.
 *
 * 415호(최은옥)·사무실(이원빈)처럼 명의만 있는 창고·사무실은 사람이 들어갈 수 없는 방인데,
 * 점유 계약이 0건이라 종전 가드가 전부 통과시켰다. 정작 문의·투어만 hasNonResident 로 막혀
 * 가장 약한 단계를 막고 가장 강한 단계(입주·예약)를 여는 역전이었다.
 *
 * 판정은 lib/vacancy 의 집계 제외 술어 그대로다 — 사본을 만들지 않는다. 418호처럼 방 설정이
 * '공실로 세라'(nonResidentVacant=true)인 거주·비거주 동거 방은 여기 걸리지 않는다(현존·정당).
 * 방을 못 읽었으면(=배정 대상 방이 없음) 막지 않는다.
 *
 * 2026-08-13 이후 술어가 방 단위 사실(플래그 하나)이 되면서, 명의자가 그 방의 거주자로 올라서는
 * 전환도 여기 걸린다. 그게 맞다 — 창고에 사람이 살기 시작하면 그 방은 더 이상 창고가 아니므로
 * 방 설정을 먼저 내려야 한다(거부 문구가 지목하는 그 출구다). 종전에는 명의를 거주로 바꾸는 순간
 * 술어가 거짓이 되어 통과했고, 그 결과가 감지망 축 ③(집계 제외 방에 거주 계약)이 부르는 상태였다.
 */
function nonResidentOccupiedRoom(room: { nonResidentVacant: boolean } | null): boolean {
  return !!room && isVacancyExcluded(room)
}

// 호실 목록 (입주자 등록/수정 시 선택용)
export async function getRoomsForSelect() {
  const { propertyId } = await getPropertyId()
  const rooms = await prisma.room.findMany({
    where: { propertyId },
    orderBy: { roomNo: 'asc' },
    select: {
      id: true, roomNo: true, baseRent: true, scheduledRent: true, nonResidentRent: true, isVacant: true, nonResidentVacant: true, type: true, floor: true, windowType: true, direction: true, noMoveInReport: true,
      // 단독 계약 불가 방인가 — 폼의 '딸릴 계약' 셀렉트가 필수로 바뀌는 조건(서버 가드와 같은 사실).
      standaloneLeaseAllowed: true,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT'] } },
        // take:1 을 뺐다 — 방이 '언제 비는지'와 '이미 예약이 걸렸는지'는 계약 하나만 봐서는 알 수 없다.
        select: { id: true, status: true, moveInDate: true, expectedMoveOut: true, isShortTerm: true, tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  const ymd = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) : null
  return rooms.map(({ leaseTerms, ...r }) => {
    // 그 방을 잡고 있는 계약 중 퇴실 예정일이 잡힌 건 — 단기 ACTIVE 도, 퇴실일 있는 예약도 여기 들어온다.
    // 예약을 빼면 '조성훈이 8/31 나가는 404호'가 언제 비는지 모르는 방으로 취급돼 고를 수 없었다.
    const occupants = leaseTerms.filter(l => ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'].includes(l.status) && l.expectedMoveOut)
    // 방이 비는 날은 마지막으로 나가는 사람 기준 — 계약이 둘이면 먼저 나가는 쪽을 보면 안 된다.
    const lastOut = occupants.reduce<typeof occupants[number] | null>(
      (m, l) => (!m || l.expectedMoveOut! > m.expectedMoveOut! ? l : m), null)
    return {
      ...r,
      // 종전 의미 그대로 — 가장 최근 생성 계약 하나의 상태. 소비처가 이 뜻에 기대고 있어 바꾸지 않는다.
      currentLeaseStatus: (leaseTerms[0]?.status ?? null) as string | null,
      // 집계 제외 방(창고·사무실) — 서버 가드(nonResidentOccupiedRoom)와 같은 정본 술어다.
      // currentLeaseStatus 로는 판정이 샌다. 그것은 '가장 최근 생성 계약 하나'라 계약이 없거나
      // 비거주가 최신이 아닌 방에서는 답이 안 나온다 — 방 단위 사실로 따로 싣는다.
      vacancyExcluded: isVacancyExcluded(r),
      occupantMoveOut: lastOut?.expectedMoveOut ? new Date(lastOut.expectedMoveOut).toISOString().slice(0, 10) : null,
      occupantIsShortTerm: lastOut?.isShortTerm ?? false,
      // 퇴실 예정일 없는 예약만 '무기한'이다. 날짜가 잡힌 예약은 언제 비는지 아는 방이라 막지 않고
      // 겹칠 때만 확인창으로 묻는다(운영 재량). 서버 가드(addTenant·updateTenant)도 같은 선이다.
      hasIndefiniteReservation: leaseTerms.some(l => l.status === 'RESERVED' && !l.expectedMoveOut),
      // 구간 목록 — 겹침 문구가 '방의 마지막 퇴실일'이 아니라 실제로 앞을 막고 선 계약을 지목하도록.
      occupancies: occupants.map(l => ({
        leaseId: l.id, tenantName: l.tenant.name, status: l.status,
        moveIn: ymd(l.moveInDate), moveOut: ymd(l.expectedMoveOut)!,
      })),
      // 입주 예정일이 잡힌 예약 — 퇴실일을 뒤로 미룰 때 다음 입주자를 밟는지 확인창이 묻는 근거.
      // 퇴실 예정일까지 준다(없으면 무기한) — 겹침은 두 구간이 실제로 포개질 때만이다(서버 가드와 같은 식).
      reservations: leaseTerms
        .filter(l => l.status === 'RESERVED' && l.moveInDate)
        .map(l => ({ leaseId: l.id, tenantName: l.tenant.name, moveIn: ymd(l.moveInDate)!, moveOut: ymd(l.expectedMoveOut) })),
    }
  })
}


// ── 계약 생성 공용부 (2026-08-13, 1인 다호실) ───────────────────────────────
// 사람을 새로 만들며 계약을 얹는 경로(addTenant)와 있는 사람에게 계약만 더 얹는 경로
// (addLeaseToTenant)가 **같은 폼 문법·같은 가드·같은 뒤처리**를 쓰게 하는 자리다.
// 사본을 두면 새 진입점에만 가드가 빠지는 그 사고(엑셀 가져오기가 그랬다)를 되풀이한다.

/** 계약 폼의 lease 칸을 읽는다. tenant 칸(이름·연락처 등)은 여기서 읽지 않는다. */
function readLeaseFields(formData: FormData) {
  const roomId           = formData.get('roomId') as string
  const status           = (formData.get('status') as LeaseStatus) || 'ACTIVE'
  const rentAmount       = Number(formData.get('rentAmount')) || 0
  const depositAmount    = Number(formData.get('depositAmount')) || 0
  const cleaningFee      = Number(formData.get('cleaningFee')) || 0
  const dueDay           = formData.get('dueDay') as string
  const moveInDate       = formData.get('moveInDate') as string
  const expectedMoveOut  = formData.get('expectedMoveOut') as string
  const contactAlertDate = formData.get('contactAlertDate') as string | null
  const paymentTiming    = (formData.get('paymentTiming') as PaymentTiming) || 'PREPAID'
  const payMethod           = formData.get('payMethod') as string
  const cashReceipt         = formData.get('cashReceipt') as string
  const registrationStatus  = (formData.get('registrationStatus') as RegistrationStatus) || 'NOT_REPORTED'
  const contractUrl         = formData.get('contractUrl') as string
  const wishRooms           = formData.get('wishRooms') as string
  const wishConditions      = formData.get('wishConditions') as string
  const keepAlertAfterInquiry = formData.get('keepAlertAfterInquiry') === 'true'
  const moveInFlexible      = moveInFlexibleOf(formData)
  const visitRoute          = formData.get('visitRoute') as string
  const tourDate            = formData.get('tourDate') as string
  const tourTime            = formData.get('tourTime') as string   // 'HH:MM' 또는 ''
  const inquiryAt           = formData.get('inquiryAt') as string
  const reservationConfirmed = formData.get('reservationConfirmed') === 'true'
  const isShortTerm          = formData.get('isShortTerm') === 'true'
  const depositReceived      = formData.get('depositReceived') === '1'
  // 얼마를 받은 것으로 기록할지 폼이 되물어 실어 보낸 값(2026-08-10). 비면 종전대로 미기록분 전액.
  const depositReceivedAmountRaw = formData.get('depositReceivedAmount')
  const depositReceivedAmount = depositReceivedAmountRaw != null && String(depositReceivedAmountRaw).trim() !== ''
    ? Math.max(0, Number(String(depositReceivedAmountRaw).replace(/[^0-9]/g, '')) || 0)
    : null
  const isReservedConfirmed = status === 'RESERVED' && reservationConfirmed
  // 딸릴 계약(2026-08-13, 다호실 2단계). **칸이 폼에 없는 것과 비워 둔 것은 다르다.**
  // 없으면(null) 이 저장은 종속을 편집하지 않는 것이고, 있으면서 빈 값이면 종속을 끊는 것이다.
  // 이 구분을 안 두면 종속 셀렉트가 없는 폼(수정 등)의 저장 한 번이 조용히 부모를 끊는다
  // (퇴실 예정일 칸에서 같은 사고가 있었다 — 신고 aae0ab38).
  const parentRaw = formData.get('parentLeaseTermId')
  const parentFieldPresent = parentRaw !== null
  const parentLeaseTermId = parentFieldPresent ? (String(parentRaw).trim() || null) : null

  return {
    roomId, status, rentAmount, depositAmount, moveInDate,
    isReservedConfirmed, depositReceived, depositReceivedAmount,
    parentFieldPresent, parentLeaseTermId,
    /** LeaseTerm.create 에 실리는 데이터. propertyId 는 부르는 쪽이 붙인다. */
    data: {
      roomId: roomId || null,
      parentLeaseTermId,
      status,
      rentAmount,
      depositAmount,
      cleaningFee,
      dueDay: DUE_PENDING_STATUSES.includes(status) ? null : (dueDay || null),
      moveInDate: moveInDate ? new Date(moveInDate) : null,
      expectedMoveOut: expectedMoveOut ? new Date(expectedMoveOut) : null,
      contactAlertDate: contactAlertDate ? new Date(contactAlertDate) : null,
      tourDate: tourDate ? new Date(tourDate) : null,
      tourTime: tourDate && tourTime ? tourTime : null,   // 날짜 없으면 시간도 무의미
      // 폼이 보내는 "YYYY-MM-DDTHH:mm" 은 오프셋이 없다 — 서버(UTC)가 그대로 파싱하면 9시간 뒤로 저장된다.
      // 변환은 서버에서 한다(캐시된 구버전 클라가 남아도 오염이 재발하지 않게).
      inquiryAt: kstDateTimeToUtc(inquiryAt),
      reservationConfirmedAt: isReservedConfirmed ? new Date() : null,
      isShortTerm,
      paymentTiming,
      payMethod: payMethod || null,
      cashReceipt: cashReceipt || null,
      registrationStatus,
      contractUrl: contractUrl || null,
      wishRooms: wishRooms || null,
      wishConditions: wishConditions || null,
      keepAlertAfterInquiry,
      // 리드 밖(거주중 직등록·예약 확정 등)이면 접는다 — 매칭이 안 읽는 자리의 잔존은 거짓 표시(감지망 축 3)
      moveInFlexible: leavesWishLead(status, isReservedConfirmed ? new Date() : null) ? null : (moveInFlexible ?? null),
      visitRoute: visitRoute || null,
    },
  }
}

/**
 * 이 계약의 종속 지목이 성립하는가 — 통과하면 null, 막히면 문구.
 *
 * 판정은 lib/roomAssignment 의 leaseSubordinationDenial 한 벌이고 여기서는 그 입력만 읽어 온다.
 * 부모 후보는 **같은 입주자 안에서만** 찾는다 — 남의 계약 id 를 실어 보내도 조회에서 안 걸린다.
 * 새 입주자의 첫 계약(tenantId 미정)은 딸릴 대상 자체가 없으므로 부모 조회를 하지 않는다.
 */
async function subordinationDenial(
  input: { roomId: string; parentLeaseTermId: string | null; tenantId: string | null; selfLeaseTermId: string | null },
): Promise<string | null> {
  const { roomId, parentLeaseTermId, tenantId, selfLeaseTermId } = input
  // 방이 없는 계약(문의·투어)은 단독 계약 규칙의 대상이 아니다 — 없는 방 설정을 '불가'로 읽으면 안 된다.
  const room = roomId
    ? await prisma.room.findUnique({ where: { id: roomId }, select: { standaloneLeaseAllowed: true } })
    : null
  const parent = parentLeaseTermId && tenantId
    ? await prisma.leaseTerm.findFirst({
        where: { id: parentLeaseTermId, tenantId },
        select: { id: true, tenantId: true, status: true, parentLeaseTermId: true },
      })
    : null
  // 자신에게 딸린 계약이 있는가 — 2단 종속의 반대 방향이다. 부모를 지목할 때만 물으면 된다.
  const selfHasSubLeases = parentLeaseTermId && selfLeaseTermId
    ? (await prisma.leaseTerm.count({ where: { parentLeaseTermId: selfLeaseTermId } })) > 0
    : false
  return leaseSubordinationDenial({
    roomStandaloneAllowed: room?.standaloneLeaseAllowed ?? true,
    parentLeaseTermId,
    parent,
    selfTenantId: tenantId,
    selfLeaseTermId,
    selfHasSubLeases,
  })
}

/**
 * 계약 하나를 저장해도 되는가 — 필수 칸과 방 배정 가드. 통과하면 null, 막히면 문구.
 * 두 진입점이 이 한 함수를 부른다. 방 배정 판정 자체는 lib/roomAssignment 정본이다.
 *
 * @param tenantId 이 계약의 주인. 새 입주자 등록(addTenant)은 아직 없으므로 null 이다 —
 *   그때는 딸릴 대상이 없어 종속 지목이 성립할 수 없고, 단독 계약 불가 방은 그대로 막힌다.
 */
async function leaseSaveDenial(f: ReturnType<typeof readLeaseFields>, tenantId: string | null): Promise<string | null> {
  const roomOptionalStatuses = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'] as string[]
  if (!f.roomId && !roomOptionalStatuses.includes(f.status)) return '호실을 선택해주세요.'
  if (f.isReservedConfirmed) {
    if (!f.roomId) return '예약 확정 시 호실은 필수입니다.'
    if (!f.rentAmount) return '예약 확정 시 월 이용료는 필수입니다.'
    if (!f.moveInDate) return '예약 확정 시 입주 희망일은 필수입니다.'
  }
  // 청구 발생 상태(unpaid.ts unpaidLeasesRaw 필터와 동일: ACTIVE·CHECKOUT_PENDING·NON_RESIDENT + rentAmount>0)로
  // 저장할 땐 입주일 필수. 비우면 leaseStartMonth가 인수 컷오프월로 앵커되어 과거월이 한꺼번에 미납으로 잡힌다.
  if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(f.status) && f.rentAmount > 0 && !f.moveInDate) {
    return '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.'
  }

  // NON_RESIDENT(명의만)와 실거주자(ACTIVE/RESERVED/CHECKOUT_PENDING)는 같은 방에 공존 가능
  // 방 설정(nonResidentVacant)까지 같이 읽는다 — 집계 제외 방 판정(nonResidentOccupied)의 입력이다.
  const roomForGuard = f.roomId ? await prisma.room.findUnique({
    where: { id: f.roomId },
    select: {
      nonResidentVacant: true,
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
        select: { status: true, expectedMoveOut: true },
      },
    },
  }) : null
  // 점유 가드는 lib/roomAssignment 한 벌이다 — 종전에는 여기와 updateTenant 에 같은 판정이 두 벌 적혀
  // 있었고 엑셀 가져오기에는 0 개였다(2026-08-12 봉합). 문구·순서는 그 정본이 갖는다.
  const denial = roomAssignmentDenial({
    incomingStatus: f.status,
    nonResidentOccupied: nonResidentOccupiedRoom(roomForGuard),
    otherLeases: roomForGuard?.leaseTerms ?? [],
  })
  if (denial) return denial

  // 종속 가드 — 생성 경로는 늘 묻는다. 부모 지목도, 단독 계약 불가 방도 이 한 줄이 본다.
  return subordinationDenial({
    roomId: f.roomId, parentLeaseTermId: f.parentLeaseTermId, tenantId, selfLeaseTermId: null,
  })
}

/** 계약을 만든 직후의 파생 처리 — 방 점유 플래그·등록 로그·거주 구간·보증금 받음 기록. */
async function afterLeaseCreated(
  f: ReturnType<typeof readLeaseFields>,
  ctx: { propertyId: string; tenantId: string; leaseId: string },
) {
  if (['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'].includes(f.status) && f.roomId) {
    await prisma.room.update({ where: { id: f.roomId }, data: { isVacant: false } })
  }
  // NON_RESIDENT, WAITING_TOUR, TOUR_DONE는 isVacant에 영향 없음

  // 등록 로그 — 신고 ad517231 조사에서 두 가지가 틀린 것이 드러났다.
  //   1) fromStatus 에 'RESERVED' 를 **하드코딩**해서, 실제 생성 상태와 무관하게 거짓 전이를 썼다.
  //      167건 중 44건이 그렇게 쌓였고, 어제 전이표를 넓힐 때 그 유령 데이터가 근거에 섞였다.
  //   2) leaseTermId 를 안 채웠다. 계약 단위로 이력을 묶으면 이 사람들이 통째로 사라진다.
  // 등록은 전이가 아니므로 from 과 to 를 같게 둔다(canTransition 은 from === to 를 항상 허용한다).
  await prisma.tenantStatusLog.create({
    data: { tenantId: ctx.tenantId, leaseTermId: ctx.leaseId, fromStatus: f.status, toStatus: f.status, propertyId: ctx.propertyId },
  })

  // 거주 구간 이력 — 호실이 있으면 열린 구간을 만든다(파생 기록, 추가 write). 종료 상태로 만든 계약은 바로 마감.
  await ensureOpenStay(prisma, ctx.leaseId)
  if (isStayTerminalStatus(f.status)) await closeStay(prisma, ctx.leaseId)

  // 보증금 '받음' 체크 시 실수납 record 생성 (예약 확정·신규 입주 시 보증금 수납 기록)
  if (f.depositReceived && f.depositAmount > 0) {
    try { await recordDepositReceived(ctx.leaseId, f.depositReceivedAmount != null && f.depositReceivedAmount > 0 ? { amount: f.depositReceivedAmount } : undefined) }
    catch { /* 이미 기록됨 등은 무시 */ }
  }
}

/**
 * 이 사람이 이미 등록돼 있는가 — 이름과 연락처가 둘 다 같으면 같은 사람으로 본다.
 *
 * 왜 필요한가 (설계 패널 2026-08-13). 방을 하나 더 주려고 같은 사람을 새 입주자로 또 등록하면
 * 그 사람은 앱 안에서 조용히 두 사람이 된다. 이름만으로 막으면 동명이인이 못 들어오고, 연락처만
 * 보면 가족이 번호를 같이 쓰는 경우를 막는다 — 둘 다 같을 때만 묻는다.
 * 숫자만 남겨 비교한다(010-1234-5678 과 01012345678 은 같은 번호다).
 */
export async function findDuplicateTenant(name: string, contactValue: string): Promise<
  { id: string; name: string; roomNo: string | null; status: string | null } | null
> {
  const { propertyId } = await getPropertyId()
  const digits = (contactValue ?? '').replace(/\D/g, '')
  if (!name?.trim() || digits.length < 8) return null
  const rows = await prisma.tenant.findMany({
    where: { propertyId, name: name.trim() },
    select: {
      id: true, name: true,
      contacts: { select: { contactValue: true } },
      leaseTerms: { select: { status: true, moveInDate: true, room: { select: { roomNo: true } } } },
    },
  })
  const hit = rows.find(r => r.contacts.some(c => c.contactValue.replace(/\D/g, '') === digits))
  if (!hit) return null
  const main = primaryTenantLease(hit.leaseTerms)
  return { id: hit.id, name: hit.name, roomNo: main?.room?.roomNo ?? null, status: main?.status ?? null }
}

/**
 * 중복 등록 확인창을 지나왔는가 — 폼이 이 값을 실어 보내면 서버는 경고를 넘긴다.
 * 화면(등록 폼)은 제출 전에 findDuplicateTenant 로 먼저 묻고 확인을 받으면 이 값을 싣는다.
 * 그래도 서버가 다시 보는 이유는 방 배정 가드와 같다 — 판정이 화면에만 있으면 그게 실제 규칙이 된다.
 */
const DUPLICATE_ACK = 'allowDuplicateTenant'

/**
 * 있는 입주자에게 계약을 하나 더 — 새 진입점(입주자 상세 '계약 추가').
 *
 * tenant 칸은 **한 글자도 건드리지 않는다.** 이 경로가 이름·연락처를 같이 저장하면 계약을 더하는
 * 일이 사람 정보를 덮는 일이 되어, 창고 계약을 만들다가 거주 계약의 연락처가 바뀔 수 있다.
 * 가드·뒤처리는 addTenant 와 문자 그대로 같은 함수를 쓴다.
 */
export async function addLeaseToTenant(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const tenantId = formData.get('tenantId') as string
    if (!tenantId) return { ok: false, error: '입주자를 찾을 수 없습니다.' }
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, propertyId }, select: { id: true } })
    if (!tenant) return { ok: false, error: '입주자를 찾을 수 없습니다.' }

    const f = readLeaseFields(formData)
    const denial = await leaseSaveDenial(f, tenantId)
    if (denial) return { ok: false, error: denial }

    const lease = await prisma.leaseTerm.create({
      data: { ...f.data, propertyId, tenantId },
      select: { id: true },
    })
    await afterLeaseCreated(f, { propertyId, tenantId, leaseId: lease.id })

    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입주자 추가
export async function addTenant(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const name             = formData.get('name') as string
  const englishName      = formData.get('englishName') as string
  const email            = formData.get('email') as string
  const birthdate        = formData.get('birthdate') as string
  const isBasicRecipient = formData.get('isBasicRecipient') === 'true'
  const smoking = formData.get('smoking') === 'true'
  const contactType      = (formData.get('contactType') as ContactType) || 'PHONE'
  const contactValue     = formData.get('contactValue') as string
  const emergencyRelation = formData.get('emergencyRelation') as string
  const emergencyContact = formData.get('emergencyContact') as string
  const homeCountryContact = formData.get('homeCountryContact') as string
  const homeCountryCode    = formData.get('homeCountryCode') as string
  const memo             = formData.get('memo') as string
  const nationality      = formData.get('nationality') as string
  const gender           = (formData.get('gender') as Gender) || 'UNKNOWN'
  const job              = formData.get('job') as string
  // 계약 칸·가드·뒤처리는 새 진입점(addLeaseToTenant)과 문자 그대로 같은 함수를 쓴다.
  const f = readLeaseFields(formData)

  if (!name?.trim()) return { ok: false, error: '이름은 필수입니다.' }
  // 새 입주자라 tenantId 가 아직 없다 — 딸릴 대상이 없으므로 종속 지목은 성립할 수 없고,
  // 단독 계약 불가 방은 여기서 막혀 운영자를 '계약 추가' 경로로 보낸다.
  const denial = await leaseSaveDenial(f, null)
  if (denial) return { ok: false, error: denial }

  // 같은 사람을 또 등록하려는가 — 방을 하나 더 주려고 새 입주자를 만드는 순간 그 사람은 앱 안에서
  // 조용히 두 사람이 된다. 확인창을 지나온 폼만 통과시킨다(화면이 '계약 추가' 경로를 권한다).
  if (formData.get(DUPLICATE_ACK) !== '1') {
    const dup = await findDuplicateTenant(name, contactValue)
    if (dup) return { ok: false, error: `${dup.name}님은 같은 연락처로 이미 등록돼 있습니다. 방을 하나 더 드리는 것이라면 그 입주자 상세에서 '계약 추가'를 써 주세요.` }
  }

  const contactsToCreate: {
    contactType: ContactType; contactValue: string; isPrimary: boolean;
    isEmergency: boolean; emergencyRelation?: string
    isHomeCountry?: boolean; countryCode?: string | null
  }[] = []
  if (contactValue) {
    contactsToCreate.push({ contactType, contactValue, isPrimary: true, isEmergency: false })
  }
  if (emergencyContact) {
    contactsToCreate.push({
      contactType: 'PHONE',
      contactValue: emergencyContact,
      isPrimary: false,
      isEmergency: true,
      emergencyRelation: emergencyRelation || undefined,
    })
  }
  if (homeCountryContact) {
    contactsToCreate.push({
      contactType: 'PHONE',
      contactValue: homeCountryContact,
      isPrimary: false,
      isEmergency: false,
      isHomeCountry: true,
      countryCode: homeCountryCode || null,
    })
  }

  // 암호문 AAD 가 이 행의 id 라 id 를 먼저 정해 둔다. 만들고 나서 두 번째 문으로 채우면
  // 그 문이 실패했을 때 번호 없는 입주자가 남고, 운영자는 저장된 줄 안다.
  const newTenantId = randomUUID()
  const regNo = foreignRegNoPatch(formData, newTenantId)
  if (!regNo.ok) return { ok: false, error: regNo.error }

  const tenant = await prisma.tenant.create({
    data: {
      id: newTenantId,
      propertyId,
      name: name.trim(),
      ...regNo.data,
      ...nativeNamePatch(formData),
      ...displayNamePatch(formData),
      englishName: englishName || null,
      email: email || null,
      birthdate: birthdateToDate(birthdate),
      isBasicRecipient,
      smoking,
      memo: memo || null,
      nationality: nationality || null,
      gender,
      job: job || null,
      leaseTerms: { create: { ...f.data, propertyId } },
      contacts: contactsToCreate.length > 0 ? { create: contactsToCreate } : undefined,
    },
  })

  const newLease = await prisma.leaseTerm.findFirst({
    where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' }, select: { id: true },
  })
  if (newLease) await afterLeaseCreated(f, { propertyId, tenantId: tenant.id, leaseId: newLease.id })

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입주자 수정
// shortSync — 단기 청구 락을 함께 조정한 경우의 결과(클라 토스트의 적용취소 액션·요약 문구용)
export async function updateTenant(formData: FormData): Promise<
  | { ok: true; notice?: string; shortSync?: { leaseTermId: string; diff: number; newRent: number; kind: 'increase' | 'decrease' } }
  | { ok: false; error: string }
> {
  try {
  await requireEdit()
  const { propertyId, user } = await getPropertyId()

  const tenantId    = formData.get('tenantId') as string
  const leaseTermId = formData.get('leaseTermId') as string

  // 입주자 기본 정보
  const name             = formData.get('name') as string
  const englishName      = formData.get('englishName') as string
  const email            = formData.get('email') as string
  const birthdate        = formData.get('birthdate') as string
  const isBasicRecipient = formData.get('isBasicRecipient') === 'true'
  const smoking = formData.get('smoking') === 'true'
  const memo             = formData.get('memo') as string
  const nationality      = formData.get('nationality') as string
  const gender           = (formData.get('gender') as Gender) || 'UNKNOWN'
  const job              = formData.get('job') as string

  // 연락처
  const contactType       = (formData.get('contactType') as ContactType) || 'PHONE'
  const contactValue      = formData.get('contactValue') as string
  const emergencyRelation = formData.get('emergencyRelation') as string
  const emergencyContact  = formData.get('emergencyContact') as string
  const homeCountryContact = formData.get('homeCountryContact') as string
  const homeCountryCode    = formData.get('homeCountryCode') as string

  // 계약 정보
  const roomId             = formData.get('roomId') as string
  // 딸릴 계약 — contractUrl 과 같은 관행이다. 칸이 폼에 없으면 undefined 를 넣어 Prisma 가 그
  // 컬럼을 건드리지 않게 한다. 무조건 `|| null` 로 쓰면 종속 셀렉트가 없는 폼의 저장 한 번이
  // 조용히 부모를 끊고, 그 계약은 단독 계약 불가 방에 부모 없이 남는다.
  const parentLeaseTermId  = formData.has('parentLeaseTermId')
    ? (((formData.get('parentLeaseTermId') as string) || '').trim() || null)
    : undefined
  const status             = formData.get('status') as LeaseStatus
  const rentAmount         = Number(formData.get('rentAmount')) || 0
  const depositAmount      = Number(formData.get('depositAmount')) || 0
  const cleaningFee        = Number(formData.get('cleaningFee')) || 0
  const dueDay             = formData.get('dueDay') as string
  const moveInDate         = formData.get('moveInDate') as string
  const expectedMoveOut    = formData.get('expectedMoveOut') as string | null   // null = 폼에 필드 없음(보존, tourDate/inquiryAt 관행)
  const actualMoveOut      = formData.get('actualMoveOut') as string | null     // 실제 퇴실일 — 퇴실 상태에서만 렌더(사후 정정 포함)
  const contactAlertDate   = formData.get('contactAlertDate') as string | null
  const paymentTiming      = (formData.get('paymentTiming') as PaymentTiming) || 'PREPAID'
  const payMethod          = formData.get('payMethod') as string
  const cashReceipt        = formData.get('cashReceipt') as string
  const registrationStatus = (formData.get('registrationStatus') as RegistrationStatus) || 'NOT_REPORTED'
  // 외부 계약서 링크 — 2026-08-01 수정 폼에서 입력 필드를 제거했다(DB 0건, 죽은 UI).
  // 필드가 없으면 undefined 를 넣어 Prisma 가 그 컬럼을 건드리지 않게 한다. 무조건 `|| null` 로
  // 쓰면 폼을 저장할 때마다 기존 값이 지워진다(지금은 0건이라 실해가 없지만 코드로는 파괴적 갱신).
  const contractUrl        = formData.has('contractUrl')
    ? ((formData.get('contractUrl') as string) || null)
    : undefined
  const wishRooms          = formData.get('wishRooms') as string
  const wishConditions     = formData.get('wishConditions') as string
  const keepAlertAfterInquiry = formData.get('keepAlertAfterInquiry') === 'true'
  // undefined = 폼에 필드 없음(거주 단계 저장) → Prisma 가 그 컬럼을 건드리지 않는다.
  // `|| null` 로 뭉뚱그리면 거주 정보를 저장할 때마다 예약 단계에서 받아 둔 답이 증발한다.
  const moveInFlexible     = moveInFlexibleOf(formData)
  const allowRoomOverlap   = formData.get('allowRoomOverlap') === 'true'
  const visitRoute         = formData.get('visitRoute') as string
  const tourDate           = formData.get('tourDate') as string | null   // null = 폼에 필드 없음(보존)
  const tourTime           = formData.get('tourTime') as string | null   // null = 폼에 필드 없음(보존)
  const inquiryAt          = formData.get('inquiryAt') as string | null  // null = 폼에 필드 없음(보존)
  const reservationConfirmed = formData.get('reservationConfirmed') === 'true'
  const isShortTerm          = formData.get('isShortTerm') === 'true'
  const depositReceived      = formData.get('depositReceived') === '1'
  // 얼마를 받은 것으로 기록할지 폼이 되물어 실어 보낸 값(2026-08-10). 비면 종전대로 미기록분 전액.
  const depositReceivedAmountRaw = formData.get('depositReceivedAmount')
  const depositReceivedAmount = depositReceivedAmountRaw != null && String(depositReceivedAmountRaw).trim() !== ''
    ? Math.max(0, Number(String(depositReceivedAmountRaw).replace(/[^0-9]/g, '')) || 0)
    : null
  const applyScheduledRent = formData.get('applyScheduledRent') as string  // '1' = 즉시 적용, '0' = 보류, 비어있음 = 처리 안함

  const isReservedConfirmed = status === 'RESERVED' && reservationConfirmed
  if (!name?.trim()) return { ok: false, error: '이름은 필수입니다.' }
  if (isReservedConfirmed) {
    // 호실은 '수정' 시엔 비워둘 수 있게 허용 — 만실에서 입실예정 둘이 방을 맞바꿀 때
    // 잠시 '미지정'으로 파킹했다가 서로의 방으로 재지정하기 위함(새 기능 없이). 신규 등록(addTenant)은 그대로 필수.
    if (!rentAmount) return { ok: false, error: '예약 확정 시 월 이용료는 필수입니다.' }
    if (!moveInDate) return { ok: false, error: '예약 확정 시 입주 희망일은 필수입니다.' }
  }
  // 청구 발생 상태(unpaid.ts unpaidLeasesRaw 필터와 동일: ACTIVE·CHECKOUT_PENDING·NON_RESIDENT + rentAmount>0)로
  // 저장/전환할 땐 입주일 필수. 비우면 leaseStartMonth가 인수 컷오프월로 앵커되어 과거월이 미납으로 잡힌다.
  if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(status) && rentAmount > 0 && !moveInDate) {
    return { ok: false, error: '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.' }
  }

  const currentLease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      roomId: true, status: true, reservationConfirmedAt: true, isShortTerm: true, rentAmount: true,
      // 폼에 종속 칸이 없는 저장은 저장된 값이 그대로 판정 입력이 된다(끊지도, 다시 묻지도 않는다).
      parentLeaseTermId: true,
      // 퇴실 일할 정산 일관 유지용 — 폼으로 퇴실일/납부일 변경 시 재계산·해제·자동적용 판단
      expectedMoveOut: true, moveOutDate: true, dueDay: true, moveInDate: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
      // 단기 청구 동기화(syncShortStayCharge) 입력 — 조건부 선점 기준값·이력 스냅샷용
      autoCheckoutAt: true, shortStayExtensions: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  if (!currentLease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

  const prevRoomId = currentLease.roomId
  const prevStatus = currentLease.status
  const newRoomId  = roomId || prevRoomId
  // 이 저장으로 확정될 납부일. 딸린 계약 전파가 같은 값을 봐야 해서 저장 데이터 밖으로 꺼내 둔다.
  // 거주 전 상태는 강제로 비운다. 거주 전에서 청구 상태로 전환하는데 미입력이면 입주일 기준 자동 파생(2026-07-30).
  const nextDueDay = DUE_PENDING_STATUSES.includes(status) ? null
    : (dueDay || (DUE_PENDING_STATUSES.includes(prevStatus) && moveInDate ? dueDayFromMoveIn(new Date(moveInDate)) : null))

  // 퇴실 예정일 변경 판정 — 재검증 발화와 일할 정산 재계산이 같은 값을 봐야 한다.
  // 신고 aae0ab38: 폼에 퇴실일 필드가 렌더되지 않으면(=null) 이 저장은 퇴실일을 편집하지 않는 것 —
  // 기존값을 '변경 없음'으로 간주해 정산 재계산·초기화가 헛트리거되지 않게 한다.
  const prevMoveOutIso = currentLease.expectedMoveOut ? new Date(currentLease.expectedMoveOut).toISOString().slice(0, 10) : null
  const moveOutFieldPresent = expectedMoveOut !== null
  const newMoveOutIso  = moveOutFieldPresent ? (expectedMoveOut || null) : prevMoveOutIso

  // 호실 점유 재검증 — addTenant 와 같은 규칙(무기한 점유·이중 예약만 거부, 퇴실 예정일이 잡힌 방은 허용).
  // 발화 조건을 반드시 좁힌다: 방이 실제로 바뀌거나, 비거주계 상태로부터 거주계로 올라가거나,
  // 같은 방에서 퇴실 예정일을 뒤로 미룰 때만. 조건 없이 걸면 이미 그 방에 확정돼 있는 건을
  // 그대로 재저장하는 것까지 막혀 회귀가 된다.
  // 퇴실일 연장을 발화 조건에 더한 이유(2026-08-11): 방도 상태도 안 바뀌는 저장이라 종전엔 아무 검사도
  // 지나가지 않았는데, 그 한 번의 저장이 뒤에 잡혀 있는 예약자의 입주일을 그대로 밟는다.
  const RESIDENT_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED']
  const roomChanged = !!newRoomId && newRoomId !== prevRoomId
  const climbingIntoResidence = RESIDENT_STATUSES.includes(status) && !RESIDENT_STATUSES.includes(prevStatus)
  // 무기한이던 계약에 퇴실일을 넣는 것은 '연장'이 아니라 축소다 — 없던 겹침을 만들 수 없으므로 묻지 않는다.
  const moveOutExtended = !!newMoveOutIso && !!prevMoveOutIso && newMoveOutIso > prevMoveOutIso
  if (newRoomId && moveOutExtended && !allowRoomOverlap) {
    // 다음 예약자와 겹치면 거절한다. 화면은 저장 전에 확인창으로 묻고, 운영자가 그래도 하겠다면
    // allowRoomOverlap 을 실어 보낸다 — 화면과 서버가 같은 규칙 한 벌이다(confirmRoomOverlap 문법).
    const selfMoveIn = moveInDate || (currentLease.moveInDate ? new Date(currentLease.moveInDate).toISOString().slice(0, 10) : null)
    const conflict = await nextReservationConflict(newRoomId, leaseTermId, selfMoveIn, newMoveOutIso)
    if (conflict) {
      const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
      return { ok: false, error: `이 방은 ${md(conflict.moveIn)}에 ${conflict.tenantName}님이 들어올 예정입니다. 퇴실 예정일을 ${md(newMoveOutIso)}로 두면 겹칩니다. 그 예약의 입주일을 먼저 옮기거나, 저장 화면의 확인을 거쳐 주세요.` }
    }
  }
  if (newRoomId && (roomChanged || climbingIntoResidence)) {
    // 방 설정(nonResidentVacant)까지 같이 읽는다 — addTenant 와 같은 정본 판정의 입력이다.
    const roomForGuard = await prisma.room.findUnique({
      where: { id: newRoomId },
      select: {
        nonResidentVacant: true,
        leaseTerms: {
          where: { id: { not: leaseTermId }, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
          select: { status: true, expectedMoveOut: true },
        },
      },
    })
    const otherLeases = roomForGuard?.leaseTerms ?? []
    // addTenant 와 같은 한 벌(lib/roomAssignment 정본). 본인 계약은 위 where 에서 이미 빠져 있어
    // 같은 방 안의 다른 계약과만 겨룬다.
    const denial = roomAssignmentDenial({
      incomingStatus: status,
      nonResidentOccupied: nonResidentOccupiedRoom(roomForGuard),
      otherLeases,
    })
    if (denial) return { ok: false, error: denial }
  }

  // 종속 재검증 — 방 배정 재검증과 같은 이유로 발화 조건을 좁힌다. 방이 바뀌어 단독 계약 불가 방으로
  // 들어올 때, 거주계로 올라올 때, 그리고 폼이 종속 칸을 실제로 실어 보냈을 때만 묻는다.
  // 조건 없이 걸면 방 설정을 뒤늦게 '단독 불가'로 켠 순간 그 방의 기존 계약이 재저장조차 안 된다 —
  // 이미 그렇게 남아 있는 계약은 막는 게 아니라 감지망 축 ②가 이름을 불러 준다.
  const parentEdited = parentLeaseTermId !== undefined
  if (roomChanged || climbingIntoResidence || parentEdited) {
    const effectiveParent = parentEdited ? parentLeaseTermId : currentLease.parentLeaseTermId
    const denial = await subordinationDenial({
      roomId: newRoomId ?? '',
      parentLeaseTermId: effectiveParent,
      tenantId,
      selfLeaseTermId: leaseTermId,
    })
    if (denial) return { ok: false, error: denial }
  }

  // 퇴실 일할 정산 일관 유지 — 편집 폼 경로도 전환 버튼(applyStatusTransition)과 동일 정책.
  // 정산이 적용된 상태에서 퇴실일만 바꾸면 옛 날짜 기준 일할이 잔존하던 문제의 수정.
  // (prevMoveOutIso·newMoveOutIso 는 위 재검증 블록과 같은 값을 쓴다.)
  let prorationPatch: Record<string, unknown> = {}
  let prorationNotice: string | null = null
  if (status === 'ACTIVE' && prevStatus === 'CHECKOUT_PENDING' && currentLease.checkoutProratedAmount != null) {
    // 거주중 복귀 — 적용돼 있던 퇴실예정일·정산·스냅샷 정리 (전환 버튼과 동일)
    prorationPatch = { expectedMoveOut: null, checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull }
    prorationNotice = '거주중 복귀. 퇴실 예정일과 적용돼 있던 퇴실 일할 정산을 해제했습니다.'
  } else if (newMoveOutIso !== prevMoveOutIso || (dueDay || null) !== (currentLease.dueDay ?? null)) {
    // 퇴실일/납부일이 바뀐 경우에만 — 적용 중이면 재계산, 미적용+퇴실예정이면 자동 적용.
    // (변동 없는 저장은 이 블록을 안 타므로 수동 조정 금액이 보존됨)
    const pr = prorationDataForChange(
      {
        status: prevStatus,
        expectedMoveOut: currentLease.expectedMoveOut,
        rentAmount,
        moveInDate: moveInDate ? moveInDate : currentLease.moveInDate,   // 폼 입력 우선(같이 바뀔 수 있음)
        isShortTerm,
        checkoutProratedAmount: currentLease.checkoutProratedAmount,
        checkoutProratedMonth: currentLease.checkoutProratedMonth,
        checkoutProrationUndo: currentLease.checkoutProrationUndo,
        discounts: currentLease.discounts,
      },
      dueDay || null, newMoveOutIso,
      false,   // 자동 적용 안 함 — 아래 정책 주석 참조(2026-08-01)
    )
    prorationPatch = pr.data
    prorationNotice = pr.notice
  }

  // 입주자 정보 수정
  const regNo = foreignRegNoPatch(formData, tenantId)
  if (!regNo.ok) return { ok: false, error: regNo.error }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: name.trim(),
      ...nativeNamePatch(formData),
      ...displayNamePatch(formData),
      englishName: englishName || null,
      email: email || null,
      birthdate: birthdateToDate(birthdate),
      isBasicRecipient,
      smoking,
      memo: memo || null,
      nationality: nationality || null,
      gender,
      job: job || null,
      ...regNo.data,
    },
  })

  // 주 연락처 수정
  if (contactValue) {
    const existing = await prisma.tenantContact.findFirst({
      where: { tenantId, isPrimary: true },
    })
    if (existing) {
      await prisma.tenantContact.update({
        where: { id: existing.id },
        data: { contactType, contactValue },
      })
    } else {
      await prisma.tenantContact.create({
        data: { tenantId, contactType, contactValue, isPrimary: true, isEmergency: false },
      })
    }
  }

  // 비상 연락처 수정
  const existingEmergency = await prisma.tenantContact.findFirst({
    where: { tenantId, isEmergency: true },
  })
  if (emergencyContact) {
    if (existingEmergency) {
      await prisma.tenantContact.update({
        where: { id: existingEmergency.id },
        data: {
          contactType: 'PHONE',
          contactValue: emergencyContact,
          emergencyRelation: emergencyRelation || null,
        },
      })
    } else {
      await prisma.tenantContact.create({
        data: {
          tenantId,
          contactType: 'PHONE',
          contactValue: emergencyContact,
          isPrimary: false,
          isEmergency: true,
          emergencyRelation: emergencyRelation || null,
        },
      })
    }
  } else if (existingEmergency) {
    await prisma.tenantContact.delete({ where: { id: existingEmergency.id } })
  }

  // 본국 연락처 (외국인 입주자) — upsert
  const existingHome = await prisma.tenantContact.findFirst({
    where: { tenantId, isHomeCountry: true },
  })
  if (homeCountryContact) {
    if (existingHome) {
      await prisma.tenantContact.update({
        where: { id: existingHome.id },
        data: {
          contactType: 'PHONE',
          contactValue: homeCountryContact,
          countryCode: homeCountryCode || null,
        },
      })
    } else {
      await prisma.tenantContact.create({
        data: {
          tenantId,
          contactType: 'PHONE',
          contactValue: homeCountryContact,
          isPrimary: false,
          isEmergency: false,
          isHomeCountry: true,
          countryCode: homeCountryCode || null,
        },
      })
    }
  } else if (existingHome) {
    await prisma.tenantContact.delete({ where: { id: existingHome.id } })
  }

  // 신고 d3ea25f0 근본 수정: 단기 청구 동기화 판정은 '날짜'가 아니라 '청구 락'이 기준이다.
  // 입주월 record 의 최대 expectedAmount(락)가 이미 잡혀 있으면 rentAmount 만 올려도 잔액이 안 변한다
  // (lib/billing.ts billForLeaseMonth 우선순위 ② 락). 목표 이용료가 락보다 크면 마커 record 로
  // 락 자체를 올려야 추가 청구가 실제로 생긴다 — 그 일을 아래 같은 트랜잭션에서 함께 처리한다.
  // 폼 금액이 DB 값과 다르면 운영자 의도 금액(수동), 같으면 날짜만 바꾼 흐름이라 정책가로 자동 재계산.
  const prevMoveInYmd = ymdOf(currentLease.moveInDate)
  const shortMoveInYmd = moveInDate || prevMoveInYmd
  let shortPlan: {
    targetRent: number; currentLock: number; moveInYmd: string; newOutYmd: string
    units: number; manual: boolean; kind: 'increase' | 'decrease'
  } | null = null
  let shortNotice: string | null = null
  // 원인 게이트(회계 확정 2026-07-26) — 정책가를 정하는 넷(퇴실일·이용료·호실·입주일)이 실제로 바뀌었을 때만
  // 동기화한다. 연락처만 고친 저장으로 협의가가 정책가로 증액·감액되던 것이 근거 없는 매출 정정이었다.
  const shortBasisChanged = shortStayBasisChanged(
    { moveOutIso: prevMoveOutIso, rentAmount: currentLease.rentAmount, roomId: prevRoomId, moveInYmd: prevMoveInYmd },
    { moveOutIso: newMoveOutIso,  rentAmount,                          roomId: newRoomId,  moveInYmd: shortMoveInYmd },
  )
  if (isShortTerm && !['CHECKED_OUT', 'CANCELLED'].includes(status) && shortMoveInYmd && newMoveOutIso) {
    const [prop, room, prevRoom] = await Promise.all([
      prisma.property.findUnique({ where: { id: propertyId }, select: { shortStayPolicy: true } }),
      // 견적의 표준가는 저장 후 호실(newRoomId) 기준 — 호실 변경과 기간 변경을 같이 저장해도 금액이 맞는다.
      newRoomId ? prisma.room.findUnique({ where: { id: newRoomId }, select: { baseRent: true } }) : Promise.resolve(null),
      // 직전 정책가 판정용 — 호실이 바뀐 저장에서는 옛 호실 표준가라야 '협의가였는지'가 맞는다.
      prevRoomId && prevRoomId !== newRoomId
        ? prisma.room.findUnique({ where: { id: prevRoomId }, select: { baseRent: true } })
        : Promise.resolve(null),
    ])
    const policy = parseShortStayPolicy(prop?.shortStayPolicy)
    const days = stayDaysOf(shortMoveInYmd, newMoveOutIso)
    // quote 가 null 이면 정책 밖(30일 초과 등) — 동기화는 건너뛰고 날짜만 저장한다.
    const quote = policy.enabled && room && days != null
      ? calcShortStay(policy, room.baseRent, days, { moveInYmd: shortMoveInYmd, moveOutYmd: newMoveOutIso })
      : null
    if (quote) {
      const manual = rentAmount !== currentLease.rentAmount
      const targetRent = manual ? rentAmount : quote.baseAmount
      const inMonth = shortMoveInYmd.slice(0, 7)
      // 락 집계와 수납 합계는 같은 범위여야 한다 — 보증금·양도인·소프트삭제 제외로 통일
      // (한쪽만 다르면 감액 하한이 어긋난다. isPrevOwner 누락 수정 2026-07-26).
      const scope = { leaseTermId, targetMonth: inMonth, isDeposit: false, isPrevOwner: false, deletedAt: null }
      const [lockAgg, paidAgg] = await Promise.all([
        prisma.paymentRecord.aggregate({ where: scope, _max: { expectedAmount: true } }),
        prisma.paymentRecord.aggregate({ where: scope, _sum: { actualAmount: true } }),
      ])
      const currentLock = lockAgg._max.expectedAmount ?? 0
      const paidSum = paidAgg._sum.actualAmount ?? 0
      // 단축(감액)도 '청구 정정'이라 자동 처리한다(운영자 확정 2026-07-26). 다만 이미 받은 금액
      // 아래로는 내리지 않는다 — 잔액 0(완납)에서 멈추고, 그 아래 차액은 환불 영역이라 수납에서 처리.
      const newTarget = shortStayLockTarget(targetRent, paidSum)
      const kind = lockAdjustKind(newTarget, currentLock)
      // 보조 가드 — 마지막 미취소 스냅샷이 같은 (금액, 퇴실일)이면 이미 반영된 저장(이중 제출)
      const snaps = (Array.isArray(currentLease.shortStayExtensions) ? currentLease.shortStayExtensions : []) as ShortStayExtensionSnapshot[]
      const lastSnap = snaps.filter(s => s && !s.undoneAt).at(-1) ?? null
      const already = !!lastSnap && lastSnap.newRentAmount === newTarget && lastSnap.newExpectedMoveOut === newMoveOutIso
      if (kind && !already && shortBasisChanged) {
        shortPlan = { targetRent: newTarget, currentLock, moveInYmd: shortMoveInYmd, newOutYmd: newMoveOutIso, units: quote.units, manual, kind }
        const notices: string[] = []
        // 협의가가 정책 누적가로 바뀌는 경우 — 비례 조정 없이 재계산하되 반드시 고지한다.
        // 직전 정책가는 '직전 기간 · 직전 호실' 기준이라야 협의가였는지 판정이 맞는다.
        if (!manual) {
          const prevDays = prevMoveInYmd && prevMoveOutIso ? stayDaysOf(prevMoveInYmd, prevMoveOutIso) : null
          const prevBaseRent = (prevRoom ?? room)?.baseRent ?? null
          const prevQuote = prevBaseRent != null && prevDays != null ? calcShortStay(policy, prevBaseRent, prevDays) : null
          const n = negotiatedRecalcNotice(currentLease.rentAmount, prevQuote?.baseAmount ?? null, targetRent)
          if (n) notices.push(n)
        }
        if (newTarget > targetRent) {
          notices.push(`정책가 ${targetRent.toLocaleString()}원이지만 이미 ${paidSum.toLocaleString()}원을 받아 청구는 ${newTarget.toLocaleString()}원(완납)까지만 조정했습니다. 차액 ${(paidSum - targetRent).toLocaleString()}원 환불은 수납에서 처리해 주세요.`)
        }
        shortNotice = notices.length > 0 ? notices.join(' ') : null
      }
    } else if (policy.enabled && days != null && days > policy.thresholdDays && shortBasisChanged
        && !(shortMoveInYmd && newMoveOutIso && isWithinOneCalendarMonth(shortMoveInYmd, newMoveOutIso))) {
      // 정책 범위 밖 — 날짜는 저장하되 요금은 손대지 않고 월 계약 전환을 안내한다.
      // 달력 기준 1개월 이내(31일 달 걸침)는 정책 안이므로 제외 — 일수 숫자 언급도 제거(웹디자이너 오더 2026-07-30).
      shortNotice = '체류 기간이 단기 범위(입실일부터 한 달)를 넘어 요금이 자동 계산되지 않습니다. 월 계약으로 전환해 주세요.'
    }
  }

  // 계약 수정 — 단기 동기화가 있으면 같은 트랜잭션에서 청구 락까지 함께 올린다(부분 반영 방지).
  await prisma.$transaction(async tx => {
    if (shortPlan) {
      await syncShortStayCharge(tx, {
        lease: { ...currentLease, id: leaseTermId, tenantId },
        propertyId,
        targetRent: shortPlan.targetRent,
        moveInYmd: shortPlan.moveInYmd,
        newOutYmd: shortPlan.newOutYmd,
        units: shortPlan.units,
        nextStatus: status,
        source: 'form',
        kind: shortPlan.kind,
        manual: shortPlan.manual,
      })
    }
    await tx.leaseTerm.update({
      where: { id: leaseTermId },
      data: {
        status,
        // 단기 동기화 시엔 목표 이용료 — 위 마커가 올린 청구 락과 같은 값이어야 잔액이 맞는다.
        rentAmount: shortPlan ? shortPlan.targetRent : rentAmount,
        depositAmount,
        cleaningFee,
        dueDay: nextDueDay,
        moveInDate: moveInDate ? new Date(moveInDate) : null,
        // 신고 aae0ab38: 폼에 퇴실일 필드가 없으면(null) 기존 값 보존 — 예약확정 단기 예약자의 퇴실 예정일 증발 방지.
        // 렌더됐지만 비운 경우('')만 의도적 삭제로 처리(tourDate/inquiryAt 관행).
        ...(moveOutFieldPresent ? { expectedMoveOut: expectedMoveOut ? new Date(expectedMoveOut) : null } : {}),
        // 퇴실 확정 시 실제 퇴실일(moveOutDate) 기록 — 폼의 '실제 퇴실일' 필드 우선, 없으면 기존 값, 그마저 없으면 오늘.
        // 예정일 복사는 중단 — 계약상 21일이어도 19일에 일찍 나가면 그날이 기록이어야 한다(2026-07-28 오더).
        // 'CHECKED_OUT인데 퇴실일 없음' 오염 차단(2026-07-20)은 폴백으로 유지.
        // 퇴실을 되돌리면(CHECKED_OUT에서 다른 상태로) 퇴실일도 함께 비운다.
        ...(status === 'CHECKED_OUT'
          ? { moveOutDate: actualMoveOut ? new Date(actualMoveOut) : (currentLease.moveOutDate ?? new Date()) }
          : prevStatus === 'CHECKED_OUT' ? { moveOutDate: null } : {}),
        // 퇴실일이 바뀌면 단기 자동 전환 기록을 리셋 — 연장 후 새 퇴실일 하루 전 재전환(재무장)
        ...(moveOutFieldPresent && ((expectedMoveOut ? new Date(expectedMoveOut).getTime() : null) !== (currentLease.expectedMoveOut?.getTime() ?? null)) ? { autoCheckoutAt: null } : {}),
        contactAlertDate: contactAlertDate ? new Date(contactAlertDate) : null,
        // 폼에 필드가 렌더되지 않은 상태(get()===null)면 기존 값 보존 — 상태 전환이 이력을 지우지 않게.
        // 렌더됐지만 비운 경우('')만 의도적 삭제로 처리.
        ...(tourDate === null ? {} : { tourDate: tourDate ? new Date(tourDate) : null }),
        ...(tourTime === null && tourDate === null ? {} : { tourTime: (tourDate ?? '') && (tourTime ?? '') ? tourTime : null }),
        // 오프셋 없는 폼 값을 KST 로 해석해 저장(등록 경로와 같은 정본) — 저장할 때마다 +9h 붙던 래칫 봉합.
        ...(inquiryAt === null ? {} : { inquiryAt: kstDateTimeToUtc(inquiryAt) }),
        reservationConfirmedAt: isReservedConfirmed
          ? (currentLease.reservationConfirmedAt ?? new Date())
          : null,
        isShortTerm,
        paymentTiming,
        roomId: newRoomId ?? null,
        payMethod: payMethod || null,
        cashReceipt: cashReceipt || null,
        registrationStatus,
        contractUrl,
        // undefined 면 이 저장은 종속을 편집하지 않는 것이다(contractUrl 과 같은 관행).
        parentLeaseTermId,
        // 호실이 실제로 바뀌면 희망 호실/조건 모두 초기화 (이미 이동했으므로 의미 없음 — 잔여 "{}"가 대시보드에 오탐되던 것 방지)
        wishRooms:      (newRoomId !== prevRoomId && !['CHECKED_OUT', 'CANCELLED'].includes(status)) ? null : (wishRooms || null),
        wishConditions: (newRoomId !== prevRoomId && !['CHECKED_OUT', 'CANCELLED'].includes(status)) ? null : (wishConditions || null),
        keepAlertAfterInquiry,
        // 리드를 떠나는 저장(비리드 상태·예약 확정)은 조절 여부를 접는다 — 잔존은 거짓 표시(감지망 축 3)
        ...(leavesWishLead(status, isReservedConfirmed ? new Date() : null)
          ? { moveInFlexible: null }
          : (moveInFlexible === undefined ? {} : { moveInFlexible })),
        visitRoute: visitRoute || null,
        // 퇴실 일할 정산 패치 — 위 expectedMoveOut 값을 덮어쓸 수 있음(거주중 복귀 시 null 등).
        // 단기 동기화 시엔 건너뛴다 — 일할이 락보다 우선이라 남으면 방금 올린 연장 청구가 통째로 무시된다.
        ...(shortPlan ? {} : prorationPatch),
      },
    })
    // 딸린 계약의 납부일도 같은 트랜잭션에서 옮긴다 — 부모만 바뀌고 딸린 쪽이 옛 날에 남으면
    // 한 사람의 두 방 청구일이 갈린다(운영자 오더 2026-08-13).
    await propagateDueDayToSubLeases(tx, leaseTermId, currentLease.dueDay, nextDueDay)
    // 입주일도 같은 자리에서 옮긴다(신고 eb66b990) — 입주일은 청구가 시작되는 달을 정하는 값이라
    // 갈리면 한 사람의 두 방이 서로 다른 달부터 청구된다. 딸린 계약의 거주 구간 이력까지 헬퍼가 함께 본다.
    await propagateMoveInDateToSubLeases(tx, leaseTermId, currentLease.moveInDate, moveInDate ? new Date(moveInDate) : null)
    // 거주 구간 이력 — 호실 변경·종료 전환을 파생 테이블에 기록(추가 write, 위 저장 분기와 무관).
    // 계약 저장 뒤라야 마감일이 방금 확정된 moveOutDate 를 읽는다.
    await syncRoomStayOnSave(tx, leaseTermId, {
      prevRoomId, nextRoomId: newRoomId ?? null,
      prevStatus, nextStatus: status,
      // 입주일 사후 정정도 입주 구간에 전파 — 같은 트랜잭션이라 계약·이력이 함께 확정된다.
      prevMoveInDate: currentLease.moveInDate,
      nextMoveInDate: moveInDate ? new Date(moveInDate) : null,
    })
  })

  // 호실 공실 상태 업데이트 (NON_RESIDENT는 isVacant에 영향 없음)
  const isActiveStatus  = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(status)
  const wasActiveStatus = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'].includes(prevStatus)

  const hasOtherActiveInRoom = async (roomId: string, excludeLeaseTermId: string) => {
    const count = await prisma.leaseTerm.count({
      where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] }, id: { not: excludeLeaseTermId } },
    })
    return count > 0
  }

  // 거주중→공실 전환 판정 (scheduledRent 즉시 적용 처리에 사용)
  let vacatedRoomId: string | null = null

  if (newRoomId !== prevRoomId && prevRoomId && wasActiveStatus) {
    const hasOther = await hasOtherActiveInRoom(prevRoomId, leaseTermId)
    if (!hasOther) {
      await prisma.room.update({ where: { id: prevRoomId }, data: { isVacant: true } })
      vacatedRoomId = prevRoomId
    }
  }

  if (isActiveStatus && newRoomId) {
    await prisma.room.update({ where: { id: newRoomId }, data: { isVacant: false } })
  } else if (!isActiveStatus && prevRoomId && wasActiveStatus) {
    const hasOther = await hasOtherActiveInRoom(prevRoomId, leaseTermId)
    if (!hasOther) {
      await prisma.room.update({ where: { id: prevRoomId }, data: { isVacant: true } })
      vacatedRoomId = prevRoomId
    }
  }

  // 거주중→공실 변경 + 호실에 예정 가격 보유 + 사용자가 즉시 적용 선택 시 baseRent 갱신
  if (vacatedRoomId && applyScheduledRent === '1') {
    const room = await prisma.room.findUnique({
      where: { id: vacatedRoomId },
      select: { scheduledRent: true },
    })
    if (room?.scheduledRent != null) {
      await prisma.room.update({
        where: { id: vacatedRoomId },
        data: {
          baseRent:       room.scheduledRent,
          scheduledRent:  null,
          rentUpdateDate: null,
        },
      })
    }
  }

  if (status !== prevStatus) {
    // 수정 폼 경로의 상태 전환도 사유를 이력에 남긴다(상태전환 미니폼과 동일, 2026-07-27).
    // 어떤 전이에서 받을지는 statusReasons 정본이 정한다 — 입실 취소 + 퇴실 계열(2026-08-03).
    const cancelReason = reasonsForStatus(status) ? ((formData.get('cancelReason') as string | null)?.trim() || null) : null
    await prisma.tenantStatusLog.create({
      data: {
        tenantId,
        leaseTermId,
        propertyId,
        fromStatus: prevStatus,
        toStatus:   status,
        changedById: user.sub,
        ...(cancelReason ? { reason: cancelReason } : {}),
      },
    })
  }

  // 보증금 '받음' 체크 시 실수납 record 생성 (미기록분만 채움 — 이미 기록됐으면 무시)
  if (depositReceived && depositAmount > 0) {
    try { await recordDepositReceived(leaseTermId, depositReceivedAmount != null && depositReceivedAmount > 0 ? { amount: depositReceivedAmount } : undefined) }
    catch { /* 이미 기록됨 등은 무시 */ }
  }

  // 단기에서 월 단위로 내려오면서 이용료가 바뀐 경우 — 락인된 청구액을 되쓴다(신고 2c6de978).
  //
  // 종전에는 단기 체크를 끄는 것이 전부였고, 그러면 2주 단가가 그대로 월세로 승격됐다.
  // 게다가 rentAmount 만 바꿔도 화면이 하나도 안 바뀐다 — 청구 우선순위가
  // '일할 > 락인 > 이용료' 라 이미 박힌 락인이 이용료를 이기기 때문이다.
  // 520호 김민정이 그 사례다(월 계약인데 7·8월 청구가 계속 2주 단가 329,000).
  //
  // 되쓰기 범위는 **입주월 이후**로 한정한다. 그 이전 달은 양도인 구간이거나 이 계약의 것이 아니다.
  // 협의 락인(기준값과 다른 금액)과 일할 정산월은 정본 함수가 알아서 건너뛴다.
  let rentRewriteNotice: string | null = null
  if (currentLease.isShortTerm && !isShortTerm && currentLease.rentAmount !== rentAmount) {
    const fromMonth = moveInDate ? new Date(moveInDate).toISOString().slice(0, 7)
      : (currentLease.moveInDate ? new Date(currentLease.moveInDate).toISOString().slice(0, 7) : null)
    const { rewriteLockedExpectedForRentAmount } = await import('@/app/(app)/rooms/paymentEngine')
    const res = await rewriteLockedExpectedForRentAmount(leaseTermId, currentLease.rentAmount, rentAmount, fromMonth)
    if (res.changed.length > 0) {
      const detail = res.changed
        .map(c => `${Number(c.month.slice(5, 7))}월 ${c.before.toLocaleString()}→${c.after.toLocaleString()}원`)
        .join(' · ')
      rentRewriteNotice = `월 단위로 전환하면서 이미 청구된 달의 금액도 새 이용료로 맞췄습니다 (${detail}).`
    }
  }

  // 예약 -> 거주중 전환이면 예약 선납을 입주월로 재앵커한다.
  //
  // 호출부가 세 곳(moveInTenant·confirmReservationToActive·applyStatusTransition)인데
  // **이 수정 폼 경로에만 없었다.** 폼 select 로 상태를 바꾸면 선납이 옛 달에 남아
  // 입주월이 미납으로 뜬다. 같은 논리 전이인데 경로에 따라 돈 처리가 달랐다(B페이즈 조사).
  if (prevStatus === 'RESERVED' && status === 'ACTIVE') {
    await reanchorReservationPrepaid(leaseTermId)
  }

  revalidatePath('/tenants')
  revalidatePath('/rooms')
  revalidatePath('/dashboard')
  revalidatePath('/room-manage')
  // 단기 동기화가 일할 패치를 건너뛰었으면 일할 안내는 사실과 달라 내보내지 않는다.
  // 단, 감액 하한(이미 받은 금액에서 멈춤) 안내는 동기화와 함께 나가야 하는 사실이라 유지.
  const baseNotice = shortPlan ? shortNotice : (shortNotice ?? prorationNotice)
  const finalNotice = [baseNotice, rentRewriteNotice].filter(Boolean).join(' ') || null
  return {
    ok: true,
    ...(finalNotice ? { notice: finalNotice } : {}),
    ...(shortPlan ? { shortSync: { leaseTermId, diff: shortPlan.targetRent - shortPlan.currentLock, newRent: shortPlan.targetRent, kind: shortPlan.kind } } : {}),
  }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if ((err as Error).message === 'CONFLICT') return { ok: false, error: '다른 곳에서 계약이 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 시 보증금 환불 처리:
// 1. DepositRefund 레코드 생성 (반환액 + 미반환액 양쪽 모두 명시 기록)
// 2. 미반환분이 있으면 ExtraIncome(payMethod='보유 보증금')도 생성
//    → 매출 인식 + '보유 보증금' KPI에서 차감 효과
//    카테고리는 성격대로 갈린다 — 보증금 안의 청소비 몫은 '청소비', 그걸 넘는 차감만 '보증금 몰취'.
//    둘 다 있으면 행도 둘이다(splitWithheldDeposit).
// leaseTermId / tenantId는 환불 이력 추적·표시를 위해 필수
export async function recordDepositReturn(params: {
  leaseTermId: string
  tenantId: string
  depositAmount: number
  returnedAmount: number
  date: string
  tenantName: string
  reason?: string
  memo?: string
  // 신고 9b974be0: 부가수익 detail 문구 분기. 기본은 퇴실, 'reservationCancel'은 예약 취소 몰취.
  context?: 'checkout' | 'reservationCancel'
  // 미반환분은 성격대로 최대 2행(청소비 몫 / 몰취)이라 id 도 배열이다. 적용취소가 한 행만 지우면
  // 나머지가 원장에 유령 매출로 남는다(가이드 §16 '가짜 undo 금지').
}): Promise<{ ok: true; refundId: string; extraIncomeIds: string[] } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!params.leaseTermId || !params.tenantId) return { ok: false, error: '계약/입주자 정보가 누락되었습니다.' }

    // 멱등 가드 — 같은 계약에 환불 이력이 이미 있으면 새로 만들지 않는다.
    // 퇴실 상태 재저장마다 (DepositRefund + ExtraIncome) 쌍이 새로 생겨 중복되던 문제(신고 13438ec9).
    const existingRefund = await prisma.depositRefund.findFirst({
      where: { leaseTermId: params.leaseTermId, propertyId },
      select: { id: true },
    })
    if (existingRefund) return { ok: false, error: '이미 보증금 환불이 처리된 계약입니다. 수정하려면 기존 환불을 먼저 취소해 주세요.' }

    // 기준액은 **서버가 다시 계산한다.** 클라이언트가 보낸 값을 그대로 믿으면 폼 조작으로 매출을 만들 수 있고,
    // 세 경로가 각자 계산하던 구조가 곧 위 유령 매출의 원인이었다.
    // 예약 취소(선납 몰취)는 기준이 다르므로(이용료 선납 실수납) 넘어온 값을 그대로 쓴다.
    const serverBasis = params.context === 'reservationCancel' ? null : await getDepositBasisForLease(params.leaseTermId)
    // `basis || params.depositAmount` 로 두면 source==='none'(받은 적 없고 승계도 아님)일 때
    // 클라이언트가 보낸 계약 보증금으로 되돌아가, 막으려던 유령 매출 경로가 그대로 열린다.
    // 그 경우는 정산할 돈 자체가 없으므로 거절한다.
    if (serverBasis && serverBasis.source === 'none') {
      return { ok: false, error: '이 계약은 받은 보증금이 없어 환불·몰취를 기록할 수 없습니다. 보증금 수납을 먼저 등록해 주세요.' }
    }
    const basisAmount = serverBasis ? serverBasis.basis : params.depositAmount
    const carriedOver = serverBasis?.source === 'carriedOver'
    // 화면이 연 최대치와 서버 기준액이 다르면 조용히 깎지 않고 알린다(§27.2).
    if (serverBasis && params.returnedAmount > basisAmount) {
      return { ok: false, error: `환불 가능액은 ${basisAmount.toLocaleString()}원입니다. 이 계약에서 실제로 받은 보증금 기준입니다.` }
    }
    const returned  = Math.max(0, Math.min(params.returnedAmount, basisAmount))
    const withheld  = Math.max(0, basisAmount - returned)
    const refundDate = new Date(params.date)

    // 환불 이력 — 반환·미반환 양쪽 합쳐 한 건으로 기록
    const refund = await prisma.depositRefund.create({
      data: {
        propertyId,
        tenantId:       params.tenantId,
        leaseTermId:    params.leaseTermId,
        date:           refundDate,
        returnedAmount: returned,
        withheldAmount: withheld,
        reason:         params.reason || null,
        memo:           params.memo || null,
      },
    })

    const extraIncomeIds: string[] = []
    if (withheld > 0) {
      // 몰취 성격에 따라 카테고리 — 예약 취소 몰취는 위약금, 퇴실 미반환분은 보증금 몰취.
      // 세무 자료에서 반환의무 있는 예수보증금(부채)과 실현 수익이 섞이지 않게(회계 패널 권고).
      //
      // '보증금' 이 아니라 '보증금 몰취' 인 이유(2026-08-01 회계 패널, 운영자 질의 후 개명):
      // ExtraIncome 은 수익 계정인데 그 안에 '보증금' 이 있으면 세무 자료를 받는 쪽에서 보증금을
      // '받은' 기록(부채 증가)으로 읽힌다. 실제로 수익 쪽에 '보증금 50,000' 이 서 있었다.
      // 기존 4건과 영업장 카테고리 목록도 함께 개명했다(backfill-forfeit-category.mjs).
      //
      // 남은 과제: 미납 임대료를 보증금에서 충당한 분은 세법상 '임대수입' 이라 여기가 아니라
      // 임대료 수납(PaymentRecord)으로 가야 한다. 지금은 미납이 있는 몰취 사례가 0건이라
      // 오분류가 실제로 없지만, 퇴실 정산의 초과 부과가 도입되면 발생한다. 그때 분기한다.
      const forfeitCategory = params.context === 'reservationCancel' ? PENALTY_CATEGORY : FORFEIT_CATEGORY

      // 미반환분 전부가 몰취인 것은 아니다(운영자 정본 2026-08-11). 보증금 안에 든 청소비 몫을 쓴 것은
      // 정상 청소비 수취고, 그 몫을 넘는 차감만 몰취다. 판정은 사유 텍스트가 아니라 계약에 적힌
      // 청소비와 입실 수령 이력으로 한다 — 사유는 운영자가 자유롭게 고르는 값이라 라벨이 계정을
      // 정하게 두면 같은 거래가 선택에 따라 다른 계정으로 간다.
      // 퇴실 폼이 여는 최대 환불액도 같은 cleaningFeeDeductible 로 계산한다(화면과 서버가 한 규칙).
      // 예약 취소는 이용료 선납 몰취라 보증금 청소비 몫이라는 개념 자체가 없다.
      const [lease, property] = await Promise.all([
        prisma.leaseTerm.findFirst({ where: { id: params.leaseTermId, propertyId }, select: { cleaningFee: true } }),
        prisma.property.findUnique({ where: { id: propertyId }, select: { incomeCategories: true } }),
      ])
      const cleaningPortion = params.context === 'reservationCancel'
        ? 0
        : cleaningFeeDeductible(lease?.cleaningFee ?? 0, await getCleaningFeeReceivedForLease(params.leaseTermId))
      const split = splitWithheldDeposit(withheld, Math.min(cleaningPortion, basisAmount))

      // 사유를 아는 케이스만 그 이름으로 표기 — 사유 미상까지 청소비로 단정하지 않는다(신고 13438ec9).
      // 승계분(이 앱에 입금 기록이 없는 보증금)은 그 사실을 남긴다. 세무 자료를 받는 쪽이
      // '입금 기록 없는 매출'을 물어볼 때 답이 이 줄에 있어야 한다.
      const carriedNote = carriedOver ? ' (인수 승계분)' : ''
      // 청소비 몫을 이미 따로 뗀 뒤라면 남은 몰취 행까지 '청소비' 라고 쓸 수 없다 — 카테고리와
      // 세부 항목이 서로 다른 말을 하는 행이 생긴다.
      const forfeitReason = params.reason?.trim() === CLEANING_WITHHOLD_REASON && split.cleaning > 0
        ? '보증금 미반환분'
        : (params.reason?.trim() || '보증금 미반환분').replace(/^기타 · /, '')
      const parts = [
        ...(split.cleaning > 0 ? [{
          category: CLEANING_FEE_CATEGORY as string,
          amount:   split.cleaning,
          detail:   `${params.tenantName} 퇴실 · ${CLEANING_WITHHOLD_REASON}${carriedNote}`,
        }] : []),
        ...(split.forfeit > 0 ? [{
          category: forfeitCategory as string,
          amount:   split.forfeit,
          detail:   params.context === 'reservationCancel'
            ? `${params.tenantName} 예약 취소 · 예약금 몰취`
            : `${params.tenantName} 퇴실 · ${forfeitReason}${carriedNote}`,
        }] : []),
      ]

      const raw = (property as any)?.incomeCategories ?? '건조기,세탁기,자판기,이자수익,기타'
      const cats: string[] = raw.split(',').map((s: string) => s.trim()).filter(Boolean)
      const missing = [...new Set(parts.map(p => p.category))].filter(c => !cats.includes(c))
      if (missing.length > 0) {
        await prisma.property.update({
          where: { id: propertyId },
          data: { incomeCategories: [...cats, ...missing].join(',') } as any,
        })
      }

      for (const part of parts) {
        const inc = await prisma.extraIncome.create({
          data: {
            propertyId,
            date:      refundDate,
            amount:    part.amount,
            category:  part.category,
            detail:    part.detail,
            // 새로 들어온 돈이 아니라 이미 받아 둔 보증금을 쓴 것 — 적용취소가 이 표식으로 대상을 찾는다.
            payMethod: DEPOSIT_SOURCED_PAY_METHOD,
            // 입주자 연결 — 수납관리 부가수익에서 누구 건인지 바로 확인
            tenantId:    params.tenantId,
            leaseTermId: params.leaseTermId,
          },
        })
        extraIncomeIds.push(inc.id)
      }
    }
    revalidatePath('/finance')
    revalidatePath('/dashboard')
    return { ok: true, refundId: refund.id, extraIncomeIds }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 보증금 반환 기록 적용취소 — 반환 이력 + 미반환분 부가수입을 함께 삭제(감사 2026-07-10: 되돌리기 전무 보완)
// 보증금 반환 기록 조회 — 상시 적용취소 진입점용(B페이즈).
// 종전에는 undoDepositReturn 호출부가 토스트 액션 하나뿐이라, 토스트가 사라지면 되돌릴 방법이 없었다.
// 그런데 recordDepositReturn 은 계약당 1건 멱등 가드가 있어, 잘못 기록하면 재퇴실까지 막혔다.
export async function getDepositRefundForLease(leaseTermId: string): Promise<
  { refundId: string; returned: number; withheld: number; date: string; reason: string | null
    extraIncomeIds: string[]; parts: { category: string; amount: number }[] } | null
> {
  const { propertyId } = await getPropertyId()
  const r = await prisma.depositRefund.findFirst({
    where: { leaseTermId, propertyId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, returnedAmount: true, withheldAmount: true, date: true, reason: true },
  })
  if (!r) return null
  // 미반환분 ExtraIncome 은 leaseTermId + '보유 보증금' 결제수단으로 식별(생성부와 동일 규약).
  // findFirst 였을 때는 청소비 몫과 몰취가 갈린 계약에서 한 행만 잡아, 적용취소가 절반만 됐다.
  const incs = r.withheldAmount > 0
    ? await prisma.extraIncome.findMany({
        where: { leaseTermId, propertyId, payMethod: DEPOSIT_SOURCED_PAY_METHOD },
        orderBy: { createdAt: 'asc' }, select: { id: true, category: true, amount: true },
      })
    : []
  return {
    refundId: r.id, returned: r.returnedAmount, withheld: r.withheldAmount, reason: r.reason,
    date: r.date.toISOString().slice(0, 10),
    extraIncomeIds: incs.map(i => i.id),
    parts: incs.map(i => ({ category: i.category, amount: i.amount })),
  }
}

export async function undoDepositReturn(refundId: string, extraIncomeIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    await prisma.$transaction([
      prisma.depositRefund.deleteMany({ where: { id: refundId, propertyId } }),
      ...(extraIncomeIds.length > 0 ? [prisma.extraIncome.deleteMany({ where: { id: { in: extraIncomeIds }, propertyId } })] : []),
    ])
    revalidatePath('/finance'); revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 신고 9b974be0: 실수납 보증금 합 조회(읽기 전용) — 예약 취소 시 반환·몰취 기준 금액.
// 계약 보증금(lease.depositAmount)이 아니라 실제 받은 예약금(PaymentRecord isDeposit=true 실수납 합)이
// 기준이어야 유령 매출이 안 잡힌다. 소프트삭제는 aggregate 확장으로 자동 필터(where에 deletedAt 금지).
// 입실 때 청소비를 이미 받았는가 — 퇴실 공제와 배타다.
//
// 계약서 §2-4 가 "보증금이 있는 경우 퇴실 정산 시 보증금에서 공제하고, 보증금이 없는 경우
// 입실 시 이용료와 함께 받습니다" 로 either/or 를 약정하는데 시스템이 그걸 강제하지 않았다.
// 입실 때 saveCleaningFeePayment 로 받아도 퇴실 환불 모달은 여전히 `보증금 − 청소비` 를 최대치로
// 제시하고 사유 '청소비' 를 자동 선택했다. 실측 520호 김민정 1건이 이미 그 상태다
// (입실 청소비 20,000 수령 + 보증금 50,000 + 청소비 필드 20,000, ACTIVE).
// 퇴실하면 2만원을 두 번 받는다(E페이즈 조사 2026-08-03).
//
// 퇴실 정산이 만든 청소비 몫(payMethod '보유 보증금')은 빼고 센다 — 그건 '입실 때 따로 받은 돈'이
// 아니라 보증금 안에 있던 몫이다. 안 빼면 퇴실 직후 either/or 가 뒤집혀, 적용취소 후 재기록 때
// 환불 최대치가 30,000 에서 50,000 으로 벌어진다(CLEANING_FEE_RECEIVED_WHERE 주석 참조).
export async function getCleaningFeeReceivedForLease(leaseTermId: string): Promise<number> {
  const { propertyId } = await getPropertyId()
  const agg = await prisma.extraIncome.aggregate({
    where: { leaseTermId, propertyId, ...CLEANING_FEE_RECEIVED_WHERE },
    _sum: { amount: true },
  })
  return agg._sum.amount ?? 0
}

// 보증금 정산 기준액 정본 — 환불·몰취가 딛고 설 금액을 한 곳에서 정한다.
//
// 종전에는 세 경로가 각자 `lease.depositAmount` 를 기준으로 넘겼다. 그래서 **계약 300,000 인데
// 실제로 200,000 만 받은 계약**에서 환불을 안 하면 몰취가 300,000 이 되어, 받은 적 없는 100,000 이
// 기타수익으로 잡혔다. 지금 해당 데이터가 0건이라 안 터졌을 뿐 경로는 열려 있었다.
//
// 반대로 "항상 실수납 기준"도 틀리다. 인수 전 입주자는 보증금을 양도인이 받았고 인수 시 승계됐다.
// 이 앱 원장에 입금이 없을 뿐 반환의무는 실재하므로 계약 보증금이 기준이어야 한다
// (운영자 확인 2026-08-02 — 인수 정산에서 인계·차감을 받았다).
export async function getDepositBasisForLease(leaseTermId: string): Promise<{
  received: number; contract: number; preAcquisition: boolean; basis: number; source: 'received' | 'carriedOver' | 'none'
}> {
  const { propertyId } = await getPropertyId()
  const [agg, lease, property] = await Promise.all([
    prisma.paymentRecord.aggregate({
      where: { leaseTermId, propertyId, isDeposit: true }, _sum: { actualAmount: true },
    }),
    prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { depositAmount: true, moveInDate: true } }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { acquisitionDate: true, prevOwnerCutoffDate: true } }),
  ])
  const received = agg._sum.actualAmount ?? 0
  const contract = lease?.depositAmount ?? 0
  const cutoff = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null
  const preAcquisition = !!(cutoff && lease?.moveInDate && new Date(lease.moveInDate) < cutoff)
  if (received > 0) return { received, contract, preAcquisition, basis: received, source: 'received' }
  if (preAcquisition && contract > 0) return { received, contract, preAcquisition, basis: contract, source: 'carriedOver' }
  return { received, contract, preAcquisition, basis: 0, source: 'none' }
}

// 계약 하나의 보증금 구성 + 정산 기준액을 한 번에 — 화면이 각자 조각을 모으지 않게 하는 자리.
//
// 종전에는 청소비를 연결해 읽는 자리가 DepositStatusPanel 하나뿐이었고, 그 한 곳도 min/max 를
// 직접 썼다. 퇴실 정산 3폼·홈 보유 보증금·재무 보증금 탭은 계약 보증금을 그대로 믿어, 화면이 5만을
// 제시하고 서버가 3만으로 거절하는 실사고 지점이 됐다(설계 감사 2026-08-10).
// 판정은 lib/depositComposition 정본이 하고 여기는 입력만 모은다.
export async function getDepositCompositionForLease(leaseTermId: string): Promise<
  DepositComposition & { basis: number; basisSource: 'received' | 'carriedOver' | 'none'; carriedOver: boolean }
> {
  const { propertyId } = await getPropertyId()
  const [basis, cleaningPaid, property] = await Promise.all([
    getDepositBasisForLease(leaseTermId),
    getCleaningFeeReceivedForLease(leaseTermId),
    prisma.property.findUnique({ where: { id: propertyId }, select: { cleaningFeeInDeposit: true } }),
  ])
  const comp = depositComposition({
    contractDeposit: basis.contract,
    depositPaid: basis.received,
    cleaningPaid,
    cleaningFeeInDeposit: property?.cleaningFeeInDeposit ?? false,
  })
  return { ...comp, basis: basis.basis, basisSource: basis.source, carriedOver: basis.source === 'carriedOver' }
}

// 일괄 편집 확인창 근거 — 선택한 입주자 중 입실 청소비를 이미 받은 사람이 몇인가(2026-08-10).
// 보증금을 한 번에 같은 값으로 덮으면 그 사람들에게는 청소비 몫이 두 번 잡힐 수 있다.
export async function countTenantsWithCleaningFeeReceived(tenantIds: string[]): Promise<number> {
  if (tenantIds.length === 0) return 0
  const { propertyId } = await getPropertyId()
  const rows = await prisma.extraIncome.findMany({
    where: { propertyId, ...CLEANING_FEE_RECEIVED_WHERE, tenantId: { in: tenantIds } },
    select: { tenantId: true },
  })
  return new Set(rows.map(r => r.tenantId)).size
}

export async function getReceivedDepositTotal(leaseTermId: string): Promise<number> {
  const { propertyId } = await getPropertyId()
  const agg = await prisma.paymentRecord.aggregate({
    where: { leaseTermId, propertyId, isDeposit: true },
    _sum: { actualAmount: true },
  })
  return agg._sum.actualAmount ?? 0
}

// prepaid 모드 예약 취소 기준액 — 그 lease가 예약 단계에서 실제로 받은 돈 전부.
// 계약 보증금이 아니라 실제 받은 금액이 반환·몰취 기준. 소프트삭제는 aggregate 확장이 자동 필터(where에 deletedAt 금지).
//
// 두 몫을 함께 센다(운영자 확정 2026-08-19, 산식 1). 분해 수납(applyToRent)은 받은 예약금을
// 청소비 부가수익 + 이용료 선납 record 로 나눠 적는데, 입실 전 취소는 **청소 용역을 하기 전**이라
// 청소비 몫도 돌려주거나 몰취해야 할 돈이다. 선납 record 만 세면 화면이 3만을 제시하고 운영자는
// 5만을 받은 걸 아는 상태가 된다 — 화면 최대치와 실제가 갈리는 그 사고 유형이다.
//
// 분해하지 않은 예약(정책 미설정·장기·청소비 0)에는 예약 단계 청소비 부가수익이 없으므로
// 두 번째 항이 0 이고 값이 종전과 문자 그대로 같다(실측 RESERVED 전수 갈림 0건).
async function reservedPrepaidComposition(propertyId: string, leaseTermId: string): Promise<{ cleaning: number; prepaid: number }> {
  const [agg, cleaning] = await Promise.all([
    prisma.paymentRecord.aggregate({
      where: { leaseTermId, propertyId, isDeposit: false },
      _sum: { actualAmount: true },
    }),
    prisma.extraIncome.aggregate({
      where: { leaseTermId, propertyId, ...CLEANING_FEE_RECEIVED_WHERE },
      _sum: { amount: true },
    }),
  ])
  return { cleaning: cleaning._sum.amount ?? 0, prepaid: agg._sum.actualAmount ?? 0 }
}

export async function getReservedPrepaidTotal(leaseTermId: string): Promise<number> {
  const { propertyId } = await getPropertyId()
  const c = await reservedPrepaidComposition(propertyId, leaseTermId)
  return c.cleaning + c.prepaid
}

// 예약 취소 미니폼의 구성 표시용 — 기준액이 어떻게 나뉘어 있는지(청소비 몫 / 선납 몫).
// 합은 getReservedPrepaidTotal 과 정의상 같다(같은 헬퍼를 쓴다 — 두 화면 숫자가 갈릴 여지 없음).
export async function getReservedPrepaidComposition(leaseTermId: string): Promise<{ cleaning: number; prepaid: number }> {
  const { propertyId } = await getPropertyId()
  return reservedPrepaidComposition(propertyId, leaseTermId)
}

// prepaid 모드 예약 취소 — 예약 단계에서 받은 돈의 반환/몰취.
//   반환: 선납 record + 예약 청소비 부가수익 전량 소프트삭제(매출 자동 소멸).
//   몰취: 소프트삭제 + 몰취분을 ExtraIncome(category '위약금')로 재인식.
// 소프트삭제와 ExtraIncome 생성을 한 트랜잭션으로 강제해 이중 계상을 차단한다.
//
// 청소비 몫도 기준에 넣는 이유(운영자 확정 2026-08-19, 산식 1) — 입실 전 취소는 청소 용역을
// 하기 전이라 그 돈은 아직 대가가 아니다. 그래서 반환이면 청소비 인식을 지우고, 몰취면 위약금으로
// 성격이 바뀐다. 분해하지 않은 예약에는 그 부가수익이 없어 종전과 완전히 같은 경로다.
export async function recordReservationPrepaidCancel(params: {
  leaseTermId: string
  tenantId: string
  refundAmount: number
  date: string
  tenantName: string
}): Promise<{ ok: true; recordIds: string[]; cleaningIncomeIds: string[]; extraIncomeId: string | null } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!params.leaseTermId || !params.tenantId) return { ok: false, error: '계약/입주자 정보가 누락되었습니다.' }

    const [records, cleaningIncomes] = await Promise.all([
      prisma.paymentRecord.findMany({
        where: { leaseTermId: params.leaseTermId, propertyId, isDeposit: false },
        select: { id: true, actualAmount: true },
      }),
      prisma.extraIncome.findMany({
        where: { leaseTermId: params.leaseTermId, propertyId, ...CLEANING_FEE_RECEIVED_WHERE },
        select: { id: true, amount: true },
      }),
    ])
    const total = records.reduce((s, r) => s + r.actualAmount, 0)
      + cleaningIncomes.reduce((s, r) => s + r.amount, 0)
    const returned = Math.max(0, Math.min(params.refundAmount, total))
    const withheld = Math.max(0, total - returned)
    const recordIds = records.map(r => r.id)
    const cleaningIncomeIds = cleaningIncomes.map(r => r.id)
    const forfeitDate = new Date(params.date)
    const deletedAt = new Date()

    // 몰취분이 있으면 '위약금' 카테고리 보장(없으면 추가) — 트랜잭션 밖 선처리.
    if (withheld > 0) {
      const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { incomeCategories: true } })
      const raw = property?.incomeCategories ?? '건조기,세탁기,자판기,이자수익,기타'
      const cats = raw.split(',').map(s => s.trim()).filter(Boolean)
      if (!cats.includes(PENALTY_CATEGORY)) {
        await prisma.property.update({ where: { id: propertyId }, data: { incomeCategories: [...cats, PENALTY_CATEGORY].join(',') } })
      }
    }

    const extraIncomeId = await prisma.$transaction(async tx => {
      if (recordIds.length > 0) {
        await tx.paymentRecord.updateMany({ where: { id: { in: recordIds } }, data: { deletedAt } })
      }
      if (cleaningIncomeIds.length > 0) {
        await tx.extraIncome.updateMany({ where: { id: { in: cleaningIncomeIds } }, data: { deletedAt } })
      }
      if (withheld > 0) {
        const inc = await tx.extraIncome.create({
          data: {
            propertyId,
            date:      forfeitDate,
            amount:    withheld,
            category:  PENALTY_CATEGORY,
            detail:    `${params.tenantName} 예약 취소 · 이용료 선납 위약금`,
            payMethod: '예약금 몰취',
            tenantId:    params.tenantId,
            leaseTermId: params.leaseTermId,
          },
        })
        return inc.id as string
      }
      return null
    })

    revalidatePath('/finance'); revalidatePath('/dashboard'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true, recordIds, cleaningIncomeIds, extraIncomeId }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// prepaid 예약 취소 적용취소 — 소프트삭제한 선납 record·예약 청소비 복원 + 몰취 부가수입 삭제(대칭).
// 지운 것과 되살리는 것이 정확히 짝이어야 한다. 청소비 몫을 지우면서 복원만 빼면 취소를 되돌린
// 계약에서 그 매출이 영영 사라진다(적용취소 원칙 — 모든 기능에는 되돌릴 길이 있어야 한다).
export async function undoReservationPrepaidCancel(
  recordIds: string[], extraIncomeId: string | null, cleaningIncomeIds: string[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    await prisma.$transaction([
      ...(recordIds.length > 0 ? [prisma.paymentRecord.updateMany({ where: { id: { in: recordIds }, propertyId }, data: { deletedAt: null } })] : []),
      ...(cleaningIncomeIds.length > 0 ? [prisma.extraIncome.updateMany({ where: { id: { in: cleaningIncomeIds }, propertyId }, data: { deletedAt: null } })] : []),
      ...(extraIncomeId ? [prisma.extraIncome.deleteMany({ where: { id: extraIncomeId, propertyId } })] : []),
    ])
    revalidatePath('/finance'); revalidatePath('/dashboard'); revalidatePath('/rooms'); revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 처리 + 보증금 환불 한 번에
export async function checkoutWithDepositRefund(params: {
  leaseTermId: string
  tenantId: string
  refundAmount: number
  moveOutDate?: string   // 실제 퇴실일 — 환불 기록 날짜도 같은 날로 맞춘다(정본 미니폼과 동일 규칙)
  reason?: string        // 미환불 사유 — 종전에는 이 경로에 전달 수단이 없어 홈 퇴실은 사유가 항상 비었다
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: params.leaseTermId },
      select: { depositAmount: true, tenant: { select: { name: true } } },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    const checkoutRes = await checkoutTenant(params.leaseTermId, params.tenantId, params.moveOutDate)
    if (!checkoutRes.ok) return checkoutRes

    if (lease.depositAmount > 0) {
      // 퇴실일이 없으면 오늘 — 서버(UTC) 로컬로 만들면 KST 00~09 시에 환불 기록이 어제 날짜로 남는다.
      const dateStr = params.moveOutDate || kstYmdStr()
      const refundRes = await recordDepositReturn({
        leaseTermId:    params.leaseTermId,
        tenantId:       params.tenantId,
        depositAmount:  lease.depositAmount,
        returnedAmount: Math.max(0, Math.min(params.refundAmount, lease.depositAmount)),
        date:           dateStr,
        tenantName:     lease.tenant.name,
        ...(params.reason ? { reason: params.reason } : {}),
      })
      if (!refundRes.ok) return refundRes
    }
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입실 처리 (입실예정 → 거주중)
export async function moveInTenant(leaseTermId: string, tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId, user } = await getPropertyId()

  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: { roomId: true, status: true, dueDay: true, moveInDate: true },
  })
  if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

  // 청구 상태 진입인데 납부일이 없으면 입주일 기준 자동 파생(운영자 승인 2026-07-30)
  const derivedDueDay = lease.dueDay == null && lease.moveInDate ? dueDayFromMoveIn(lease.moveInDate) : null
  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    // moveInFlexible: 리드를 떠나므로 접는다(감지망 축 3, lib/wishMatch.leavesWishLead 판정과 동일)
    data: { status: 'ACTIVE', moveInFlexible: null, ...(derivedDueDay ? { dueDay: derivedDueDay } : {}) },
  })
  // 이 계약에 딸린 계약도 같은 날로 — 부모가 비어 있다 날을 갖는 것도 납부일 변경이다.
  if (derivedDueDay) await propagateDueDayToSubLeases(prisma, leaseTermId, lease.dueDay, derivedDueDay)

  // 입주월 재앵커 — prepaid 예약금이 실제 입주월과 다른 달에 걸려 있으면 이동(deposit/none은 no-op).
  if (lease.status === 'RESERVED') await reanchorReservationPrepaid(leaseTermId)

  if (lease.roomId) {
    await prisma.room.update({
      where: { id: lease.roomId },
      data: { isVacant: false },
    })
  }

  // 거주 구간 이력 — 입실 처리 시 열린 구간 보장(이미 있으면 no-op, 추가 write).
  await ensureOpenStay(prisma, leaseTermId)

  await prisma.tenantStatusLog.create({
    data: {
      tenantId,
      leaseTermId,
      propertyId,
      fromStatus:  lease.status,
      toStatus:    'ACTIVE',
      changedById: user.sub,
    },
  })

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 예약 확정 → 거주중 전환 (대시보드 알림에서 사용). 호실이 공실이 아니면 거부.
export async function confirmReservationToActive(leaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        id: true, status: true, tenantId: true, roomId: true, reservationConfirmedAt: true,
        rentAmount: true, moveInDate: true, dueDay: true,
        room: { select: { id: true, roomNo: true, isVacant: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    if (lease.status !== 'RESERVED' || !lease.reservationConfirmedAt) {
      return { ok: false, error: '예약 확정 상태가 아닙니다.' }
    }
    if (!lease.roomId || !lease.room) return { ok: false, error: '확정된 호실 정보가 없습니다.' }

    // 백스톱 — ACTIVE(청구 상태)로 확정하는데 rentAmount>0 이면서 moveInDate가 비면 거부.
    // "확정예약은 moveInDate 있다"는 불변식에만 의존하지 않고 최종 저장값을 직접 검증한다.
    if (lease.rentAmount > 0 && !lease.moveInDate) {
      return { ok: false, error: '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.' }
    }

    // 호실이 공실이 아니면 차단 (다른 거주자가 있는지 확인 — 본인 lease 제외)
    if (!lease.room.isVacant) {
      const others = await prisma.leaseTerm.findMany({
        where: {
          roomId: lease.roomId,
          id: { not: leaseTermId },
          status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] },
        },
        select: { status: true },
      })
      if (others.some(o => o.status === 'ACTIVE')) {
        return { ok: false, error: `${lease.room.roomNo}호는 아직 거주 중인 입주자가 있습니다.` }
      }
      if (others.some(o => o.status === 'CHECKOUT_PENDING')) {
        return { ok: false, error: `${lease.room.roomNo}호는 아직 퇴실 처리가 완료되지 않았습니다.` }
      }
    }

    // 청구 상태 진입인데 납부일이 없으면 입주일 기준 자동 파생(운영자 승인 2026-07-30)
    const derivedDueDay = lease.dueDay == null && lease.moveInDate ? dueDayFromMoveIn(lease.moveInDate) : null
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { status: 'ACTIVE', moveInFlexible: null, ...(derivedDueDay ? { dueDay: derivedDueDay } : {}) },
    })
    // 딸린 계약도 같은 날로(moveInTenant 와 같은 한 벌).
    if (derivedDueDay) await propagateDueDayToSubLeases(prisma, leaseTermId, lease.dueDay, derivedDueDay)

    // 입주월 재앵커 — prepaid 예약금을 실제 입주월로(deposit/none은 no-op).
    await reanchorReservationPrepaid(leaseTermId)

    await prisma.room.update({
      where: { id: lease.roomId },
      data: { isVacant: false },
    })

    // 거주 구간 이력 — 예약 확정 입실도 열린 구간 보장(이미 있으면 no-op, 추가 write).
    await ensureOpenStay(prisma, leaseTermId)

    await prisma.tenantStatusLog.create({
      data: {
        tenantId:    lease.tenantId,
        leaseTermId,
        propertyId,
        fromStatus:  'RESERVED',
        toStatus:    'ACTIVE',
        changedById: user.sub,
      },
    })

    revalidatePath('/dashboard')
    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 처리
export async function checkoutTenant(leaseTermId: string, tenantId: string, moveOutDate?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
  await requireEdit()
  const { propertyId } = await getPropertyId()

  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: { roomId: true, status: true },
  })
  if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

  // moveOutDate = 실제 퇴실일(호출부 입력, 기본 오늘). 예정일 복사 금지 — 계약상 예정일과 실제 퇴실은 다르다(2026-07-28 오더).
  await prisma.leaseTerm.update({
    where: { id: leaseTermId },
    data: { status: 'CHECKED_OUT', moveInFlexible: null, moveOutDate: moveOutDate ? new Date(moveOutDate) : new Date() },
  })

  // [Trigger A] 퇴실 완료 시 예약된 가격이 있으면 baseRent에 적용하고 예약 필드 초기화
  if (lease.roomId) {
    const room = await prisma.room.findUnique({
      where: { id: lease.roomId },
      select: { scheduledRent: true },
    })
    await prisma.room.update({
      where: { id: lease.roomId },
      data: {
        isVacant: true,
        ...(room?.scheduledRent != null && {
          baseRent:      room.scheduledRent,
          scheduledRent: null,
          rentUpdateDate: null,
        }),
      },
    })
  }

  await ensureCheckoutCleaning(propertyId, lease.roomId, leaseTermId)

  // 거주 구간 이력 — 퇴실 확정이면 열린 구간을 퇴실일로 마감(추가 write).
  await closeStay(prisma, leaseTermId)

  await prisma.tenantStatusLog.create({
    data: {
      tenantId,
      leaseTermId,
      fromStatus: lease.status,
      toStatus:   'CHECKED_OUT',
      propertyId,
    },
  })

  revalidatePath('/tenants')
  return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 상태값 → 호실 공실 여부 (null = 호실 상태 변경 안 함)
function roomVacantForStatus(status: string): boolean | null {
  if (['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'].includes(status)) return false
  if (['CHECKED_OUT', 'CANCELLED', 'NON_RESIDENT'].includes(status)) return true
  return null  // WAITING_TOUR, TOUR_DONE — 호실 점유 변경 없음
}

// 이 방을 아직 점유하고 있는 다른 계약이 있는가.
//
// 공실로 되돌리기 전에 반드시 본다. 종전에는 그 방의 다른 lease 를 보지 않고 isVacant 를 덮어써서,
// 한 방에 비거주자와 거주자가 공존하는 상황에서 한쪽이 퇴실하면
// **거주자가 있는 방이 공실로 표시**됐다(B페이즈 조사, 실측 0건이지만 열린 경로다).
async function roomStillOccupied(roomId: string, exceptLeaseId: string): Promise<boolean> {
  const other = await prisma.leaseTerm.findFirst({
    where: {
      roomId, id: { not: exceptLeaseId },
      status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'] },
    },
    select: { id: true },
  })
  return !!other
}

// 명시적 상태 전환 — 상태 + 그 전환에 필요한 필드만 변경하고 호실 공실·이력 자동 처리.
// 상세 모달의 전환 버튼(투어 완료/예약 전환/입실 처리/퇴실 예정/퇴실/비거주 전환 등)이 사용.
export async function applyStatusTransition(input: {
  leaseTermId: string
  tenantId: string
  toStatus: string
  moveInDate?: string | null
  expectedMoveOut?: string | null
  moveOutDate?: string | null
  reservationConfirmedAt?: string | null
  rentAmount?: number | null
  reason?: string | null   // 전이 사유(선택) — 취소 사유 수집(e1b81629), TenantStatusLog.reason에 기록
}): Promise<{ ok: true; notice?: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: input.leaseTermId },
      select: {
        roomId: true, status: true, dueDay: true, rentAmount: true, moveInDate: true, reservationConfirmedAt: true,
        expectedMoveOut: true, isShortTerm: true, checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    // 전이표 검사 — 서버가 from/to 를 검증하지 않아 8x8 전부가 통과했다(B페이즈 조사).
    // 상태를 바꾸는 경로가 넷(전환 버튼·수정 폼·홈 알림·cron)이라 경로마다 규칙이 갈렸다.
    // 정본은 lib/leaseTransitions 하나다. 되돌리기는 운영상 필요해 막지 않는다 — 실측으로도 쓰인다.
    if (!canTransition(lease.status, input.toStatus)) {
      return { ok: false, error: transitionDeniedMessage(lease.status, input.toStatus) }
    }

    // 신고 9b974be0: 예약 확정 시 월 이용료·입주 희망일 필수(서버 방어). 확정 호출은 값을 새로 넘기지 않고
    // 기존 lease 값으로 확정하므로 lease 쪽 값을 검증한다.
    if (input.reservationConfirmedAt) {
      const rentOk    = input.rentAmount != null ? input.rentAmount > 0 : lease.rentAmount > 0
      const moveInOk  = input.moveInDate ? true : lease.moveInDate != null
      if (!rentOk || !moveInOk) return { ok: false, error: '예약 확정에는 월 이용료와 입주 희망일이 필요합니다.' }
    }

    // 백스톱 — 최종 저장값 기준으로 청구 상태(ACTIVE·CHECKOUT_PENDING·NON_RESIDENT) + rentAmount>0 인데
    // moveInDate가 비면 거부(addTenant/updateTenant 가드와 동일 정책). 무료방 등록 후 상태전환에서 유료·비거주로
    // 넘겨 입주일 없는 청구 계약이 생기면 unpaid.ts가 인수월~오늘 전월을 미납으로 오탐한다.
    const finalStatus     = input.toStatus
    const finalRentAmount = input.rentAmount ?? lease.rentAmount
    const finalMoveInDate = input.moveInDate ?? lease.moveInDate
    if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(finalStatus) && finalRentAmount > 0 && !finalMoveInDate) {
      return { ok: false, error: '입주일을 입력해주세요. 입주일이 없으면 미납이 잘못 계산됩니다.' }
    }

    const data: Record<string, unknown> = { status: input.toStatus as LeaseStatus }
    if (input.moveInDate !== undefined)             data.moveInDate = input.moveInDate ? new Date(input.moveInDate) : null
    if (input.expectedMoveOut !== undefined)        data.expectedMoveOut = input.expectedMoveOut ? new Date(input.expectedMoveOut) : null
    if (input.moveOutDate !== undefined)            data.moveOutDate = input.moveOutDate ? new Date(input.moveOutDate) : null
    // 퇴실 확정인데 퇴실일 미전달이면 오늘로 보정 — 'CHECKED_OUT인데 퇴실일 없음' 오염 차단(2026-07-20).
    // 예정일 복사는 중단 — moveOutDate 는 실제 퇴실일이고 계약 예정일과 다를 수 있다(2026-07-28 오더).
    if (input.toStatus === 'CHECKED_OUT' && input.moveOutDate === undefined) {
      data.moveOutDate = new Date()
    }
    if (input.reservationConfirmedAt !== undefined) data.reservationConfirmedAt = input.reservationConfirmedAt ? new Date(input.reservationConfirmedAt) : null
    // 리드를 떠나는 전환은 조절 여부를 접는다 — 매칭이 안 읽는 자리의 잔존은 거짓 표시(감지망 축 3)
    {
      const finalReservedAt = input.reservationConfirmedAt !== undefined
        ? (input.reservationConfirmedAt ? new Date(input.reservationConfirmedAt) : null)
        : lease.reservationConfirmedAt
      if (leavesWishLead(input.toStatus, finalReservedAt)) data.moveInFlexible = null
    }
    if (input.rentAmount != null)                   data.rentAmount = input.rentAmount
    // 청구 상태 진입인데 납부일이 없으면 입주일 기준 자동 파생 — 거주 전 단계는 납부일을 비워두므로(2026-07-30) 진입 시 채운다
    if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(input.toStatus) && !lease.dueDay && finalMoveInDate) {
      data.dueDay = dueDayFromMoveIn(new Date(finalMoveInDate))
    }
    let notice: string | null = null
    // 퇴실예정 취소 등으로 거주중 복귀 시 퇴실예정일 + 퇴실 일할 정산(+롤백 스냅샷) 정리.
    // 신고 aae0ab38: CHECKOUT_PENDING발 복귀일 때만 초기화 — RESERVED발 입실 처리에서는
    // 단기 예약자가 미리 넣은 퇴실 예정일·정산이 지워지지 않도록 보존한다.
    if (input.toStatus === 'ACTIVE' && input.expectedMoveOut === undefined && lease.status === 'CHECKOUT_PENDING') {
      data.expectedMoveOut = null
      data.checkoutProratedAmount = null
      data.checkoutProratedMonth = null
      data.checkoutProrationUndo = Prisma.DbNull
      if (lease.checkoutProratedAmount != null) notice = '거주중 복귀. 적용돼 있던 퇴실 일할 정산을 해제했습니다.'
    } else if (input.expectedMoveOut !== undefined) {
      // 퇴실 예정일 변경 — 적용된 일할 정산이 있으면 무통보 삭제 대신 새 날짜 기준 재계산
      // (updateTenant 폼·changeDueDay 와 동일 정책: prorationDataForChange)
      const pr = prorationDataForChange(
        { ...lease, rentAmount: input.rentAmount ?? lease.rentAmount },
        lease.dueDay, input.expectedMoveOut || null,
        false,   // 자동 적용 안 함 — prorationDataForChange 의 정책 주석 참조(2026-08-01)
      )
      Object.assign(data, pr.data)
      notice = pr.notice
    }

    await prisma.leaseTerm.update({ where: { id: input.leaseTermId }, data })
    // 딸린 계약도 같은 날로 — 위 자동 파생이 부모의 빈 납부일을 채운 경우다(운영자 오더 2026-08-13).
    if (typeof data.dueDay === 'string') {
      await propagateDueDayToSubLeases(prisma, input.leaseTermId, lease.dueDay, data.dueDay)
    }
    // 입주일도 같은 자리에서 — 전환 미니폼이 입주일을 함께 고치는 경로(입실 처리·예약 확정)가 있다(신고 eb66b990).
    // 이 저장이 입주일을 편집하지 않았으면(필드 부재) 아무것도 하지 않는다.
    if (input.moveInDate !== undefined) {
      await propagateMoveInDateToSubLeases(prisma, input.leaseTermId, lease.moveInDate, input.moveInDate ? new Date(input.moveInDate) : null)
    }

    // 거주 구간 이력 — 퇴실·입실취소는 마감, 종료에서 복귀하면 재개방, 입실 처리는 열린 구간 보장(추가 write).
    await syncRoomStayOnSave(prisma, input.leaseTermId, {
      prevRoomId: lease.roomId, nextRoomId: lease.roomId,
      prevStatus: lease.status, nextStatus: input.toStatus,
      // 상태 전환에서 입주일을 같이 고치는 경로도 입주 구간에 전파(위 finalMoveInDate 재사용).
      prevMoveInDate: lease.moveInDate,
      nextMoveInDate: finalMoveInDate ? new Date(finalMoveInDate) : null,
    })
    if (input.toStatus === 'ACTIVE') await ensureOpenStay(prisma, input.leaseTermId)

    // 입주월 재앵커 — 예약(RESERVED)에서 입실 처리(ACTIVE)로 넘어갈 때 prepaid 예약금을 실제 입주월로 이동.
    // moveInDate가 폼에서 갱신됐을 수 있어 lease.update 후에 실행(deposit/none은 no-op).
    if (lease.status === 'RESERVED' && input.toStatus === 'ACTIVE') await reanchorReservationPrepaid(input.leaseTermId)

    // 호실 공실 처리
    let vac = roomVacantForStatus(input.toStatus)
    // 공실로 되돌리려는데 그 방을 아직 점유한 다른 계약이 있으면 덮지 않는다
    if (vac === true && lease.roomId && await roomStillOccupied(lease.roomId, input.leaseTermId)) vac = null
    if (lease.roomId && vac !== null) {
      if (input.toStatus === 'CHECKED_OUT') {
        // 퇴실 완료 — 예약 가격 있으면 baseRent 적용 (checkoutTenant 와 동일)
        const room = await prisma.room.findUnique({ where: { id: lease.roomId }, select: { scheduledRent: true } })
        await prisma.room.update({
          where: { id: lease.roomId },
          data: { isVacant: true, ...(room?.scheduledRent != null && { baseRent: room.scheduledRent, scheduledRent: null, rentUpdateDate: null }) },
        })
        await ensureCheckoutCleaning(propertyId, lease.roomId, input.leaseTermId)
      } else {
        // 퇴실이 아닌 상태로 되돌아왔다 — 자동 생성한 청소 예정을 걷는다
        await clearAutoCheckoutCleaning(propertyId, input.leaseTermId)
        await prisma.room.update({ where: { id: lease.roomId }, data: { isVacant: vac } })
      }
    }

    // 신고 9b974be0: 예약 확정·해제(RESERVED→RESERVED)는 상태 변화가 아니므로 이력 미기록.
    // 확정 시각은 reservationConfirmedAt 컬럼 자체가 기록한다(이력 오염 방지).
    const isReservationToggle = input.toStatus === lease.status && input.reservationConfirmedAt !== undefined
    if (!isReservationToggle) {
      await prisma.tenantStatusLog.create({
        data: {
          tenantId: input.tenantId,
          leaseTermId: input.leaseTermId,
          propertyId,
          fromStatus: lease.status,
          toStatus: input.toStatus as LeaseStatus,
          reason: input.reason || null,
          changedById: user.sub,
        },
      })
    }

    revalidatePath('/tenants')
    revalidatePath('/dashboard')
    revalidatePath('/rooms')
    revalidatePath('/room-manage')
    revalidatePath('/finance')
    return notice ? { ok: true, notice } : { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// Gemini 수납 분석
export async function analyzeTenantWithGemini(tenantId: string): Promise<string> {
  await getPropertyId()

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      leaseTerms: {
        // 메인 계약 하나를 분석한다. 잘라 읽으면 정렬이 고르므로 전부 읽고 정본이 고른다.
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNo: true } },
          paymentRecords: {
            where: { deletedAt: null },
            orderBy: { targetMonth: 'asc' },
            select: {
              targetMonth: true, expectedAmount: true, actualAmount: true,
              isDeposit: true, isPrevOwner: true, isBillingAdjust: true,
              isPaid: true, payDate: true, payMethod: true,
            },
          },
        },
      },
    },
  })

  if (!tenant) return '[오류] 입주자를 찾을 수 없습니다.'

  const lease = primaryTenantLease(tenant.leaseTerms)
  const payments = lease?.paymentRecords ?? []
  // 청구·미납은 정본 규칙(월별 최댓값)으로 — 합으로 잡으면 나눠 낸 달이 곱해진다(신고 2026-08-02).
  // AI 가 이 값으로 "회수 지연 심각" 같은 진단을 쓰므로 부풀린 값이 그대로 문장이 된다.
  const totalExpected = billedForLease(payments)
  const totalPaid     = payments.filter(p => !p.isBillingAdjust && !p.isPrevOwner).reduce((s, p) => s + p.actualAmount, 0)
  const paidCount     = payments.filter(p => p.isPaid).length
  const unpaid        = unpaidForLease(payments)

  const paymentLines = payments.map(p => {
    const diff = p.isPaid && p.payDate
      ? (() => {
          const [y, m] = p.targetMonth.split('-').map(Number)
          const dueDay = lease?.dueDay
          const dueDayNum = dueDay?.includes('말') ? new Date(y, m, 0).getDate() : parseInt(dueDay?.replace(/[^0-9]/g, '') || '1')
          const dueDate = new Date(y, m - 1, dueDayNum)
          const paid = new Date(p.payDate)
          const diffDays = Math.round((paid.getTime() - dueDate.getTime()) / 86400000)
          return diffDays <= 0 ? `${Math.abs(diffDays)}일 조기` : `${diffDays}일 지연`
        })()
      : null
    return `  - ${p.targetMonth}: 예정 ${p.expectedAmount.toLocaleString()}원, 납부 ${p.actualAmount.toLocaleString()}원 (${p.isPaid ? `완납${diff ? ` / ${diff}` : ''}` : '미납'})`
  }).join('\n')

  const prompt = `당신은 공간 대여 관리 전문 AI입니다. 아래 입주자의 수납 데이터를 분석하고 한국어로 3~5문장으로 수납 패턴, 건전성, 관리 제안을 알려주세요.

[입주자 정보]
- 이름: ${tenant.name}, 호실: ${lease?.room?.roomNo ?? '미지정'}호
- 월 이용료: ${lease?.rentAmount.toLocaleString() ?? '—'}원, 납부일: ${lease?.dueDay ?? '미지정'}
- 입주일: ${lease?.moveInDate ? new Date(lease.moveInDate).toLocaleDateString('ko-KR') : '—'}

[수납 이력 (${payments.length}건)]
${paymentLines || '  수납 기록 없음'}

[통계]
- 완납: ${paidCount}/${payments.length}개월
- 총 납부액: ${totalPaid.toLocaleString()}원
- 미납 잔액: ${Math.max(0, unpaid).toLocaleString()}원

분석 결과를 실용적이고 구체적으로 작성해주세요.`

  const ai = await consumeGeminiAccess()
  if (!ai.ok) return `[오류] ${ai.error}`
  const apiKey = ai.apiKey

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  )

  if (!res.ok) return `[오류] Gemini API 응답 실패 (${res.status})`
  const json = await res.json()
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? 'AI 분석 결과를 가져올 수 없습니다.'
}

// ── 계약서 OCR (Gemini Vision) ────────────────────────────────────
// 계약서 사진/스캔에서 입주자 등록에 필요한 핵심 필드를 추출.
// 화면/PDF/사진 어떤 형태든 시도. 추출 못 한 필드는 undefined.
export type ContractOcrResult = {
  name?: string
  englishName?: string
  gender?: 'MALE' | 'FEMALE' | 'OTHER'
  nationality?: string
  birthdate?: string         // YYYY-MM-DD
  job?: string
  contactPhone?: string      // 주 연락처
  emergencyName?: string
  emergencyPhone?: string
  emergencyRelation?: string
  roomNo?: string            // '402호' 형태
  rentAmount?: number
  depositAmount?: number
  cleaningFee?: number
  dueDay?: string            // '25' | '말일'
  moveInDate?: string        // YYYY-MM-DD
  contractEnd?: string       // YYYY-MM-DD
}

export async function analyzeContractWithGemini(imageBase64: string, mimeType: string): Promise<{ ok: true; data: ContractOcrResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    if (!imageBase64) return { ok: false, error: '이미지 데이터가 비어있습니다.' }
    const ai = await consumeGeminiAccess()
    if (!ai.ok) return { ok: false, error: ai.error }
    const apiKey = ai.apiKey

    const prompt = `이 계약서/임대차 계약 문서를 분석하고 입주자 정보를 JSON 으로만 응답하세요. 다른 설명·마크다운·코드블록 없이 순수 JSON.

JSON 스키마 (모든 필드 선택. 추출 못 한 건 생략):
{
  "name": "한글 이름",
  "englishName": "영문 이름 (외국인이거나 별도 표기 있을 때)",
  "gender": "MALE" | "FEMALE" | "OTHER",
  "nationality": "대한민국 | 베트남 | 우즈베키스탄 ...",
  "birthdate": "YYYY-MM-DD",
  "job": "직업",
  "contactPhone": "010-1234-5678 (주 연락처)",
  "emergencyName": "비상연락처 본인 이름",
  "emergencyPhone": "010-...",
  "emergencyRelation": "부/모/형제/친구 등",
  "roomNo": "402호 (호실 번호)",
  "rentAmount": 370000,       // 정수 원 (월 이용료)
  "depositAmount": 1000000,   // 정수 원 (보증금)
  "cleaningFee": 50000,       // 정수 원 (청소비)
  "dueDay": "25" | "말일",    // 납부일
  "moveInDate": "YYYY-MM-DD", // 입주일
  "contractEnd": "YYYY-MM-DD" // 계약 만료일
}

규칙:
- 숫자는 콤마 제거 후 정수만
- 한국어 계약서 우선. 영어 표기도 인식 가능
- 호실은 "402호" 또는 "402" 형태 그대로
- 계약서로 보이지 않는 이미지: {} 빈 객체 반환`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1200, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },   // 사고 토큰 잠식 방지(신고 4b1f59e2 계열)
        }),
      }
    )
    if (!res.ok) return { ok: false, error: `Gemini API 오류 (${res.status})` }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { ok: false, error: 'AI 응답이 비어있습니다.' }
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(cleaned) }
    catch { return { ok: false, error: 'AI 응답을 JSON으로 해석하지 못했습니다.' } }

    const str = (k: string) => typeof parsed[k] === 'string' && parsed[k] ? (parsed[k] as string).trim() : undefined
    const num = (k: string) => typeof parsed[k] === 'number' ? Math.round(parsed[k] as number) : undefined
    const gender = parsed.gender === 'MALE' || parsed.gender === 'FEMALE' || parsed.gender === 'OTHER' ? parsed.gender : undefined

    return {
      ok: true,
      data: {
        name: str('name'),
        englishName: str('englishName'),
        gender,
        nationality: str('nationality'),
        birthdate: str('birthdate'),
        job: str('job'),
        contactPhone: str('contactPhone'),
        emergencyName: str('emergencyName'),
        emergencyPhone: str('emergencyPhone'),
        emergencyRelation: str('emergencyRelation'),
        roomNo: str('roomNo'),
        rentAmount: num('rentAmount'),
        depositAmount: num('depositAmount'),
        cleaningFee: num('cleaningFee'),
        dueDay: str('dueDay'),
        moveInDate: str('moveInDate'),
        contractEnd: str('contractEnd'),
      },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 신분증/외국인등록증 OCR (Gemini Vision) ────────────────────────
export type IdCardOcrResult = {
  name?: string             // 한글 이름
  englishName?: string      // 외국인등록증 영문 이름
  gender?: 'MALE' | 'FEMALE' | 'OTHER'
  birthdate?: string        // YYYY-MM-DD
  nationality?: string      // '대한민국' | 'VIETNAM' 등 (가능하면 한글)
}

export async function analyzeIdCardWithGemini(imageBase64: string, mimeType: string): Promise<{ ok: true; data: IdCardOcrResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    if (!imageBase64) return { ok: false, error: '이미지 데이터가 비어있습니다.' }
    const ai = await consumeGeminiAccess()
    if (!ai.ok) return { ok: false, error: ai.error }
    const apiKey = ai.apiKey

    const prompt = `이 사진이 한국 주민등록증·운전면허증·외국인등록증 중 하나라고 보고 다음 필드를 추출. 순수 JSON 만 응답. 마크다운·코드블록 X.

JSON 스키마 (모든 필드 선택, 추출 못 한 건 생략):
{
  "name": "한글 이름",                  // 외국인등록증은 한글 표기 또는 없음
  "englishName": "ROMAN/ENGLISH NAME",  // 외국인등록증·여권형
  "gender": "MALE" | "FEMALE" | "OTHER",
  "birthdate": "YYYY-MM-DD",            // 주민번호 앞 6자리 또는 별도 표기
  "nationality": "대한민국 | 베트남 | 우즈베키스탄 ..."
}

규칙:
- 한국 주민번호 앞 6자리(YYMMDD)를 봤다면, 7번째 숫자가 1·2 → 19YY, 3·4 → 20YY, 5·6 → 19YY(외국인), 7·8 → 20YY(외국인)
- 외국인등록증의 영문 이름은 ROMAN 으로 정확히 (성/이름 그대로)
- 신분증으로 보이지 않으면 {} 빈 객체`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 600, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },   // 사고 토큰 잠식 방지(신고 4b1f59e2 계열)
        }),
      }
    )
    if (!res.ok) return { ok: false, error: `Gemini API 오류 (${res.status})` }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) return { ok: false, error: 'AI 응답이 비어있습니다.' }
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(cleaned) }
    catch { return { ok: false, error: 'AI 응답을 JSON으로 해석하지 못했습니다.' } }

    const str = (k: string) => typeof parsed[k] === 'string' && parsed[k] ? (parsed[k] as string).trim() : undefined
    const gender = parsed.gender === 'MALE' || parsed.gender === 'FEMALE' || parsed.gender === 'OTHER' ? parsed.gender : undefined
    return {
      ok: true,
      data: {
        name: str('name'),
        englishName: str('englishName'),
        gender,
        birthdate: str('birthdate'),
        nationality: str('nationality'),
      },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입주자 삭제 — 계약·수납(매출) 이력까지 연쇄 영구 삭제되므로,
// 이력이 있으면 1차 호출은 건수를 알려주며 거부하고 force 재호출에서만 실제 삭제(정보 동의 단계).
export async function deleteTenant(tenantId: string, opts?: { force?: boolean }): Promise<
  { ok: true } | { ok: false; error: string; needsForce?: boolean; leases?: number; payments?: number }
> {
  try {
    await requireEdit()

    // 이력 확인 — 복구 불가 삭제임을 건수와 함께 동의받는다
    if (!opts?.force) {
      const [leases, payments] = await Promise.all([
        prisma.leaseTerm.count({ where: { tenantId } }),
        prisma.paymentRecord.count({ where: { tenantId } }),
      ])
      if (payments > 0 || leases > 0) {
        return {
          ok: false, needsForce: true, leases, payments,
          error: `계약 ${leases}건·수납 기록 ${payments}건이 함께 영구 삭제됩니다.`,
        }
      }
    }

    // 활성 계약이 있으면 해당 호실을 공실로 전환 (단, 다른 입주자/비거주자가 남아있으면 제외)
    const activeLeases = await prisma.leaseTerm.findMany({
      where: { tenantId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
      select: { roomId: true },
    })
    for (const { roomId } of activeLeases) {
      if (!roomId) continue
      const remaining = await prisma.leaseTerm.findFirst({
        where: { roomId, tenantId: { not: tenantId }, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
      })
      if (!remaining) {
        await prisma.room.update({ where: { id: roomId }, data: { isVacant: true } })
      }
    }

    await prisma.tenant.delete({ where: { id: tenantId } })
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 입주자 요청사항 ──────────────────────────────────────────────

// 요청 목록 + 영업장의 요청 카테고리 목록을 한 번에 — 위젯이 자체 fetch 라 왕복을 늘리지 않으려고 같이 실어 보낸다.
export async function getTenantRequests(tenantId: string) {
  const { propertyId } = await getPropertyId()
  const [requests, property] = await Promise.all([
    prisma.tenantRequest.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, content: true, requestDate: true,
        targetDate: true, resolvedAt: true, createdAt: true,
        tenant: { select: { name: true } },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { requestCategories: true } as any,
    }),
  ])
  return { requests, categories: parseRequestCategories((property as any)?.requestCategories) }
}

export async function getAllRequestsForProperty() {
  const { propertyId } = await getPropertyId()
  const rows = await prisma.tenantRequest.findMany({
    where: { propertyId, deletedAt: null },
    orderBy: [{ resolvedAt: 'asc' }, { isUrgent: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, content: true, requestDate: true,
      targetDate: true, resolvedAt: true, resolutionMemo: true,
      category: true, isUrgent: true, createdAt: true,
      tenantId: true, commonPlace: true, roomNoSnapshot: true,
      tenant: {
        select: {
          id: true, name: true,
          // take: 1 + status asc 를 뺐다 — enum 선언 순서라 RESERVED 가 ACTIVE 를 이기던 자리다
          // (primaryRoomLease 머리말의 503호 사례와 같은 함정). 메인 계약은 정본이 고른다.
          leaseTerms: {
            where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
            select: { status: true, moveInDate: true, room: { select: { roomNo: true } } },
          },
        },
      },
    },
  })
  return rows.map(r => ({
    ...r,
    tenant: r.tenant ? { ...r.tenant, leaseTerms: mainLeaseOnly(r.tenant.leaseTerms) } : r.tenant,
  }))
}

/** 사람 축 조회가 메인 계약 하나만 내려보낼 때 쓰는 마무리 — 화면의 `leaseTerms[0]` 문법을 그대로 유지시킨다. */
function mainLeaseOnly<T extends { status: string; moveInDate?: Date | string | null }>(leases: T[]): T[] {
  const main = primaryTenantLease(leases)
  return main ? [main] : []
}

// 폼에서 직접 입력한 카테고리를 저장 흐름 안에서 처리 — 기존 목록과 일치하면 정본 값을 쓰고,
// 신규면 Property.requestCategories 끝에 덧붙인다. 저장을 취소하면 목록에도 아무것도 안 남는다.
async function resolveRequestCategoryForSave(propertyId: string, raw: string | null | undefined): Promise<string | null> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { requestCategories: true } as any,
  })
  const list = parseRequestCategories((property as any)?.requestCategories)
  const { value, nextList } = resolveCategoryForSave(list, raw)
  if (nextList) {
    await prisma.property.update({
      where: { id: propertyId },
      data: { requestCategories: nextList.join(',') } as any,
    })
    revalidatePath('/settings')
  }
  return value
}

export async function createTenantRequest(data: {
  tenantId?: string | null
  content: string
  requestDate: string
  targetDate: string | null
  category?: string | null
  isUrgent?: boolean
  commonPlace?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!data.content.trim()) return { ok: false, error: '내용을 입력해주세요.' }
    const category = await resolveRequestCategoryForSave(propertyId, data.category)
    // 등록 시점 호실을 고정 — 이사·퇴실 뒤에도 '당시 호실'로 남는다(공용부는 null).
    const roomNoSnapshot = await getRoomNoSnapshot(data.tenantId)
    await prisma.tenantRequest.create({
      data: {
        tenantId:    data.tenantId ?? null,
        propertyId,
        content:     data.content.trim(),
        requestDate: data.requestDate ? new Date(data.requestDate) : new Date(),
        targetDate:  data.targetDate  ? new Date(data.targetDate)  : null,
        category,
        isUrgent:    data.isUrgent ?? false,
        commonPlace: data.commonPlace?.trim() || null,
        roomNoSnapshot,
      },
    })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 요청 수정 — 완료 관련 필드(resolvedAt·resolutionMemo)는 기존 완료 흐름 전용이라 여기서 다루지 않는다.
// 성공 시 이전 값 스냅샷을 돌려주어 적용취소(같은 액션 재호출)로 원복할 수 있게 한다.
export type TenantRequestSnapshot = {
  tenantId: string | null
  commonPlace: string | null
  category: string | null
  isUrgent: boolean
  requestDate: string
  targetDate: string | null
  content: string
  roomNoSnapshot: string | null
}

export async function updateTenantRequest(id: string, data: {
  tenantId?: string | null
  content: string
  requestDate: string
  targetDate: string | null
  category?: string | null
  isUrgent?: boolean
  commonPlace?: string | null
  /** 적용취소 전용 — 값이 있으면 그대로 원복하고 재파생하지 않는다. */
  roomNoSnapshot?: string | null
}): Promise<{ ok: true; prev: TenantRequestSnapshot } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (!data.content.trim()) return { ok: false, error: '내용을 입력해주세요.' }

    // propertyId 스코프 — 다른 영업장 요청은 조회 자체가 안 되므로 수정도 불가.
    const before = await prisma.tenantRequest.findFirst({
      where: { id, propertyId, deletedAt: null },
      select: {
        tenantId: true, commonPlace: true, category: true,
        isUrgent: true, requestDate: true, targetDate: true, content: true,
        roomNoSnapshot: true,
      },
    })
    if (!before) return { ok: false, error: '요청을 찾을 수 없습니다.' }

    const category = await resolveRequestCategoryForSave(propertyId, data.category)
    // 호실 스냅샷은 대상(입주자)이 실제로 바뀔 때만 다시 뽑는다 — 요청일 소급 변경에는 불변.
    // 적용취소로 값이 넘어오면 재파생 없이 그 값 그대로 원복한다.
    const nextTenantId = data.tenantId ?? null
    const roomNoSnapshot =
      data.roomNoSnapshot !== undefined ? data.roomNoSnapshot
      : nextTenantId !== before.tenantId ? await getRoomNoSnapshot(nextTenantId)
      : undefined
    await prisma.tenantRequest.update({
      where: { id },
      data: {
        tenantId:    nextTenantId,
        content:     data.content.trim(),
        requestDate: data.requestDate ? new Date(data.requestDate) : new Date(),
        targetDate:  data.targetDate  ? new Date(data.targetDate)  : null,
        category,
        isUrgent:    data.isUrgent ?? false,
        commonPlace: data.commonPlace?.trim() || null,
        ...(roomNoSnapshot !== undefined ? { roomNoSnapshot } : {}),
      },
    })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return {
      ok: true,
      prev: {
        tenantId:    before.tenantId,
        commonPlace: before.commonPlace,
        category:    before.category,
        isUrgent:    before.isUrgent,
        requestDate: kstYmdStr(before.requestDate),
        targetDate:  before.targetDate ? kstYmdStr(before.targetDate) : null,
        content:     before.content,
        roomNoSnapshot: before.roomNoSnapshot,
      },
    }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function getActiveTenantsForRequests() {
  const { propertyId } = await getPropertyId()
  const rows = await prisma.tenant.findMany({
    where: {
      propertyId,
      leaseTerms: { some: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } } },
    },
    select: {
      id: true, name: true,
      // 형제(getAllRequestsForProperty)와 같은 선 — 잘라 읽지 않고 정본이 메인 계약을 고른다.
      leaseTerms: {
        where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        select: { status: true, moveInDate: true, room: { select: { roomNo: true } } },
      },
    },
    orderBy: { name: 'asc' },
  })
  return rows.map(r => ({ ...r, leaseTerms: mainLeaseOnly(r.leaseTerms) }))
}

export async function resolveTenantRequest(id: string, memo?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.tenantRequest.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolutionMemo: memo?.trim() || null,
      },
    })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 요청 완료 해제 — 실수로 완료 처리한 요청을 미완료로 복귀(감사 2026-07-10: 삭제만 있던 문제)
export async function unresolveTenantRequest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getPropertyId()
    await prisma.tenantRequest.update({ where: { id }, data: { resolvedAt: null } })
    revalidatePath('/tenants'); revalidatePath('/requests'); revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 납입일 영구 변경 + 일할 조정 기록 생성
export async function changeDueDay(
  leaseTermId: string,
  newDueDay: string,
  targetMonth: string,
  adjustAmount: number, // 양수 = 과입금(환불), 음수 = 추가납부 필요
): Promise<{ ok: true; notice?: string; undo: DueDayChangeUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()

    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        dueDay: true, rentAmount: true, tenantId: true, status: true, moveInDate: true,
        // 퇴실 일할 정산 재계산용 — 납부일이 바뀌면 일할 기간(납부일~퇴실일)도 달라짐
        expectedMoveOut: true, isShortTerm: true, checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    // 적용된 퇴실 일할 정산이 있으면 새 납부일 기준으로 재계산 (updateTenant·전환 버튼과 동일 정책).
    // 납입일 변경은 '자동 적용' 대상이 아님(false) — 이미 적용된 정산만 새 납부일로 재계산.
    const pr = prorationDataForChange(
      lease,
      newDueDay.trim() || null,
      lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      false,
    )

    // 되돌리기 스냅샷 — 납입일·일할 정산 필드 원값(감사 2026-07-10: 되돌리기 전무 보완)
    const undoSnap: DueDayChangeUndo = {
      leaseTermId,
      prevDueDay: lease.dueDay,
      prevProration: {
        checkoutProratedAmount: lease.checkoutProratedAmount,
        checkoutProratedMonth: lease.checkoutProratedMonth,
        checkoutProrationUndo: lease.checkoutProrationUndo,
      },
      adjustRecordId: null,
    }

    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { dueDay: newDueDay.trim(), ...pr.data },
    })
    // 딸린 계약도 같은 날로. 되돌리기 스냅샷에 함께 실어야 적용취소가 전파분까지 원복한다.
    undoSnap.subLeases = await propagateDueDayToSubLeases(prisma, leaseTermId, lease.dueDay, newDueDay.trim())

    if (adjustAmount !== 0) {
      const maxSeq = await prisma.paymentRecord.aggregate({
        where: { leaseTermId, targetMonth, deletedAt: undefined },
        _max: { seqNo: true },
      })
      const seqNo = (maxSeq._max.seqNo ?? 0) + 1
      const isRefund = adjustAmount > 0
      const absAmt = Math.abs(adjustAmount)
      const typeLabel = isRefund ? '과입금' : '추가납부'

      const adj = await prisma.paymentRecord.create({
        data: {
          leaseTermId,
          tenantId:      lease.tenantId,
          propertyId,
          targetMonth,
          expectedAmount: 0,
          actualAmount:   adjustAmount,
          isPaid:         isRefund,
          payDate:        new Date(),
          seqNo,
          memo: `[납입일변경] ${lease.dueDay ?? '?'}일→${newDueDay} 변경, 일할 ${absAmt.toLocaleString()}원 (${typeLabel})`,
        },
      })
      undoSnap.adjustRecordId = adj.id
    }

    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    return pr.notice ? { ok: true, notice: pr.notice, undo: undoSnap } : { ok: true, undo: undoSnap }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 납입일 변경 적용취소 — 납입일·일할 정산 필드 원복 + 생성된 조정 기록 삭제
export type DueDayChangeUndo = {
  leaseTermId: string
  prevDueDay: string | null
  prevProration: { checkoutProratedAmount: number | null; checkoutProratedMonth: string | null; checkoutProrationUndo: unknown }
  adjustRecordId: string | null
  // 함께 옮겨 간 딸린 계약의 원값. 선택 항목이라, 이 필드가 없던 시절에 받아 둔 스냅샷도 그대로 먹는다.
  subLeases?: { id: string; prevDueDay: string | null }[]
}

export async function undoChangeDueDay(u: DueDayChangeUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({ where: { id: u.leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    await prisma.$transaction([
      prisma.leaseTerm.update({ where: { id: u.leaseTermId }, data: {
        dueDay: u.prevDueDay,
        checkoutProratedAmount: u.prevProration.checkoutProratedAmount,
        checkoutProratedMonth: u.prevProration.checkoutProratedMonth,
        checkoutProrationUndo: u.prevProration.checkoutProrationUndo == null ? Prisma.DbNull : (u.prevProration.checkoutProrationUndo as Prisma.InputJsonValue),
      } }),
      // 함께 옮겼던 딸린 계약도 제자리로 — 전파분이 남으면 되돌린 것이 아니다.
      ...(u.subLeases ?? []).map(s => prisma.leaseTerm.updateMany({ where: { id: s.id, propertyId }, data: { dueDay: s.prevDueDay } })),
      ...(u.adjustRecordId ? [prisma.paymentRecord.deleteMany({ where: { id: u.adjustRecordId, propertyId } })] : []),
    ])
    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 퇴실 정산(일할) ──────────────────────────────────────────────────
// 선납 모델에서 퇴실 예정일이 기간 중간이면 마지막(퇴실) 달 청구를 사용 일수만큼 일할로 줄인다.
// 미리보기(previewCheckoutProration)로 금액을 확인한 뒤 setCheckoutProration 으로 확정·기록(lock).
// 확정 시 lease.checkoutProratedAmount/Month 에 저장 → 청구 엔진이 그 달 청구를 이 값으로 덮어씀.
// (rooms getRoomPaymentStatus · dashboard unpaid.ts · dashboard page.tsx 셋 다 동일하게 참조)

export type CheckoutProrationPreview =
  | { ok: true; calc: CheckoutProrationResult; currentDueDay: string | null }
  | { ok: false; error: string }

export async function previewCheckoutProration(
  leaseTermId: string,
  expectedMoveOut: string,  // 'YYYY-MM-DD'
): Promise<CheckoutProrationPreview> {
  try {
    await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        dueDay: true, rentAmount: true, moveInDate: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    const sc = settlementCalcFor(lease, expectedMoveOut)
    if (!sc) return { ok: false, error: '정산할 기간을 찾을 수 없습니다. 납부일이 없거나 퇴실일이 입주일보다 앞선 경우입니다.' }
    const { calc } = sc
    return { ok: true, calc, currentDueDay: lease.dueDay }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 퇴실 정산 계산 묶음 (2026-08-02) ──────────────────────────────────────────
// 정산은 '귀속월 산출 → 그 달 할인 반영 월세 → 일할' 순서로만 맞다. 네 곳(미리보기·저장·
// 재계산·환불 미리보기)이 같은 순서를 반복하는데, 흩어두면 한 곳만 옛 순서로 남아 갈린다.
// 실제로 종전에는 네 곳 모두 **퇴실월** 기준으로 할인을 잡아, 정산 기간이 전월인 경우
// 다른 달의 할인가로 계산했다.
type SettlementCalc = {
  period: NonNullable<ReturnType<typeof settlementPeriodFor>>
  monthlyRent: number
  calc: NonNullable<ReturnType<typeof calcCheckoutProration>>
}
function settlementCalcFor(
  lease: {
    dueDay: string | null
    moveInDate: Date | string | null
    rentAmount: number
    discounts: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[]
  },
  moveOutYmd: string,
): SettlementCalc | null {
  const period = settlementPeriodFor({ dueDay: lease.dueDay, moveInDate: lease.moveInDate }, moveOutYmd)
  if (!period) return null
  // 할인은 **정산 귀속월** 기준(운영자 확정 2026-08-02) — 기간이 5월분 서비스면 5월 할인을 쓴다
  const monthlyRent = discountedRent(lease.discounts, period.month, lease.rentAmount)
  const calc = calcCheckoutProration(monthlyRent, lease.dueDay, moveOutYmd, ymdOf(lease.moveInDate))
  if (!calc) return null
  return { period, monthlyRent, calc }
}

// 적용취소(롤백)용 직전 스냅샷 형태
type CheckoutProrationUndo = {
  prevStatus: LeaseStatus
  prevExpectedMoveOut: string | null   // ISO 'YYYY-MM-DD' or null
  prevAmount: number | null
  prevMonth: string | null
  // 적용/재계산이 설정한 값 — 적용취소 시 '그 후 수동 수정 여부' 감지용 (구버전 스냅샷엔 없음)
  appliedMoveOut?: string | null
  appliedAmount?: number | null
}

// 적용된 일할 정산의 일관 유지 — 퇴실일/납부일이 바뀌는 모든 경로(입주자 관리 편집 폼 updateTenant,
// 전환 버튼 applyStatusTransition, 납입일 영구 변경 changeDueDay)가 이 헬퍼로 같은 결과를 낸다.
// (경로마다 정산이 잔존/무통보 삭제되던 불일치 해소 — 2026-06-11 점검 후속)
// 반환: leaseTerm.update 에 합칠 data 조각 + 사용자 안내문.
// Date|string|null → 'YYYY-MM-DD' (DB @db.Date 는 UTC 자정 저장이라 toISOString 슬라이스가 정확)
function ymdOf(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

function prorationDataForChange(
  lease: {
    status: LeaseStatus
    expectedMoveOut: Date | string | null
    rentAmount: number
    moveInDate: Date | string | null
    checkoutProratedAmount: number | null
    checkoutProratedMonth: string | null
    checkoutProrationUndo: unknown
    isShortTerm: boolean
    discounts: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[]
  },
  newDueDay: string | null,
  newExpectedMoveOut: string | null,   // 'YYYY-MM-DD' | null
  autoApply: boolean,                  // 미적용 상태에서도 자동 적용할지. 2026-08-01 이후 호출부는 전부 false
): { data: Record<string, unknown>; notice: string | null } {
  // 자동 적용 폐지(운영자 승인 2026-08-01, 퇴실 정산 구조 1항).
  //
  // 종전에는 퇴실 예정으로 전환하거나 예정일을 고치면 시스템이 말없이 그 달 청구를 일할로 덮어썼다.
  // 예정일은 바뀐다(실측: 서민준 예정 6/13, 실제 6/16). 날짜가 바뀔 때마다 재계산이 돌고 그 재계산이
  // 곧 무통보 덮어쓰기라, 퇴실 예정일이 두 달 뒤인데 금액부터 들이미는 문제가 됐다(신고 0df59b92).
  //
  // 새 정책: 돈이 실제로 움직이는 지점은 퇴실 처리다. 예정 단계에서는 묻기만 하고 청구는 그대로 둔다.
  // 운영자 원문 — "미리 퇴실예정일을 미리 입력할거고 ... 실제 퇴실날짜에 처리하면서 다시 한번 더
  // 환불할지 일할부과할지를 물어보게 하는게 좋을 것 같아"
  //
  // 이 인자를 지우지 않고 false 로 고정한 이유: 아래 분기들(환불 확정 보존·단기 차단·퇴실 예정 해제·
  // 이미 적용된 건의 재계산)은 전부 살아 있어야 한다. 인자를 없애면 그 분기 구조까지 손대게 된다.
  // 미적용 계약에 대해서만 no-op 이 되는 것이 정확히 의도한 변화다.
  // 미리 확정하고 싶으면 CheckoutProrationWidget 의 수동 경로(setCheckoutProration)를 쓴다.
  // 환불 확정(finalizeRentRefund) 이후에는 그 달 청구가 회사 귀속액으로 고정된 상태 —
  // 날짜 변경 재계산이 이 확정을 덮으면 record와 청구가 어긋난다(적대검증 P0). 보존하고 손대지 않는다.
  // 단기(주 단위 정액)는 일할 대상이 아니다 — 이미 그 기간 전액을 받았는데 퇴실월 일할을 얹으면
  // 이중 청구가 된다(520호 김민정: 2주 329,000 완납 + 8월 21,933 중복). 환불 쪽에는 같은 차단이
  // 이미 있었는데(finalizeRentRefund) 적용 쪽에만 빠져 있었다.
  if (lease.isShortTerm) {
    if (lease.checkoutProratedAmount == null && lease.checkoutProratedMonth == null) return { data: {}, notice: null }
    return {
      data: { checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull },
      notice: '단기 계약은 주 단위 정액이라 퇴실 일할 정산 대상이 아닙니다. 적용돼 있던 일할을 해제했습니다.',
    }
  }
  const undoObj = lease.checkoutProrationUndo
  if (undoObj && typeof undoObj === 'object' && 'refund' in (undoObj as Record<string, unknown>)) {
    return { data: {}, notice: '이용료 환불이 확정된 계약이라 일할 정산을 재계산하지 않았습니다. 변경하려면 환불 적용취소 후 진행해 주세요.' }
  }
  const wasApplied = lease.checkoutProratedAmount != null
  // 퇴실 예정 해제 — 적용분 있으면 정산도 함께 해제
  if (!newExpectedMoveOut) {
    if (!wasApplied) return { data: {}, notice: null }
    return {
      data: { checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull },
      notice: '퇴실 예정이 해제되어 적용돼 있던 퇴실 일할 정산도 함께 해제했습니다.',
    }
  }
  // 미적용 + 자동적용 대상 아님(거주중 납입일 변경 등) → 손대지 않음
  if (!wasApplied && !autoApply) return { data: {}, notice: null }

  // 정산 귀속월 기준 — 할인도 그 달 것을 쓴다(운영자 확정 2026-08-02).
  // 여기 lease 타입은 헬퍼(settlementCalcFor)와 달라 정본을 직접 부른다. 순서는 같아야 한다.
  const period = settlementPeriodFor({ dueDay: newDueDay, moveInDate: lease.moveInDate }, newExpectedMoveOut)
  const moveOutMonth = period ? period.month : newExpectedMoveOut.slice(0, 7)
  const monthlyRent = discountedRent(lease.discounts, moveOutMonth, lease.rentAmount)
  const calc = calcCheckoutProration(monthlyRent, newDueDay, newExpectedMoveOut, ymdOf(lease.moveInDate))
  if (!calc) {
    // 퇴실일 ≤ 납부일 → 그 달 자동 0원(일할 불필요). 기존 적용분만 해제.
    if (!wasApplied) return { data: {}, notice: null }
    return {
      data: { checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull },
      notice: '퇴실일이 납부일 이전이 되어 마지막 달 청구가 자동으로 0원 처리됩니다. 기존 일할 정산은 해제했습니다.',
    }
  }
  // 적용취소 스냅샷 — 이미 적용 중이면 기존 스냅샷(최초 적용 직전) 유지, 신규 자동적용이면 현재 상태 기록.
  const prevUndo = lease.checkoutProrationUndo
  const undoBase: CheckoutProrationUndo = (prevUndo && typeof prevUndo === 'object')
    ? (prevUndo as CheckoutProrationUndo)
    : {
        prevStatus: lease.status,
        prevExpectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
        prevAmount: lease.checkoutProratedAmount ?? null,
        prevMonth: lease.checkoutProratedMonth ?? null,
      }
  const undo: CheckoutProrationUndo = { ...undoBase, appliedMoveOut: newExpectedMoveOut, appliedAmount: calc.amount }
  return {
    data: {
      checkoutProratedAmount: calc.amount,
      checkoutProratedMonth: calc.moveOutMonth,
      checkoutProrationUndo: undo,
    },
    // 퇴실이 먼 미래(오늘+1달 초과)면 금액·환불 프레임 없이 사실 안내만 — 두 달 뒤 정산 금액이
    // 지금 행동이 필요한 것처럼 읽히던 문제(신고 0df59b92). 근접 기준은 정산 팝업과 동일(isMoveOutNear 정본).
    // 적용 자체는 시점 무관 즉시 — 선납 추천액(billForLeaseMonth)이 이 값을 쓰므로 미루면 과납이 생긴다.
    notice: isMoveOutNear(newExpectedMoveOut, kstYmdStr())
      ? (wasApplied
        ? `적용돼 있던 퇴실 일할 정산을 변경된 조건으로 재계산했습니다 · ${calc.daysUsed}일치 ${calc.amount.toLocaleString()}원.`
        : `퇴실 일할 정산을 자동 적용했습니다. ${calc.daysUsed}일치 ${calc.amount.toLocaleString()}원. (금액 조정은 '퇴실 정산'에서)`)
      : `${Number(calc.moveOutMonth.slice(5))}월 이용료가 퇴실일 기준 ${calc.daysUsed}일치로 자동 청구될 예정입니다. 지금 처리할 일은 없습니다.`,
  }
}

// 퇴실 환불 미리보기 — 환경설정 '퇴실 환불 규정'으로 환불액 내역 산출(읽기전용 표시용).
// 선납액 = 퇴실 달에 낸 금액(보증금·양도인 제외). 사용일수 = 일할 daysUsed(퇴실일<납부일이면 0).
export type CheckoutRefundPreview =
  | {
      ok: true; refund: CheckoutRefundResult; prepaidAmount: number; defaultPenaltyPct: number
      // 퇴실 정산 위젯이 먼저 확정한 그 달 청구액 — 있으면 환불 창은 재계산 대신 이 값을 이어받는다(이중 수정 방지)
      appliedProration: number | null
    }
  | { ok: false; error: string }

export async function previewCheckoutRefund(
  leaseTermId: string,
  expectedMoveOut: string,  // 'YYYY-MM-DD'
  mode: RefundMode = 'legal',
  penaltyPct?: number | null,  // 사람별 위약금율(%) — 미지정 시 영업장 기본값, 서버에서 0~10 캡
): Promise<CheckoutRefundPreview> {
  try {
    const { propertyId } = await getPropertyId()
    const [lease, prop] = await Promise.all([
      prisma.leaseTerm.findFirst({
        where: { id: leaseTermId, propertyId },
        select: {
          dueDay: true, rentAmount: true, moveInDate: true,
          checkoutProratedAmount: true, checkoutProratedMonth: true,
          discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
        },
      }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { refundPenaltyPct: true } }),
    ])
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    // 영업장 기본 위약금율(공정위 10% 캡) — 사람별 입력이 있으면 그 값을, 없으면 기본값을 캡 안에서 적용
    const defaultPenaltyPct = clampPenaltyPct(prop?.refundPenaltyPct)
    const effectivePct = clampPenaltyPct(penaltyPct ?? defaultPenaltyPct)
    // 기준월은 정산 귀속월이다. 선납액 집계·할인·일할·기존 적용분 비교가 **전부 같은 달**을 봐야 한다.
    // 종전에는 넷 다 퇴실월이었고, 기준월만 옮기고 선납액 집계를 그대로 두면 prepaidAmount 가 0 이 되어
    // 화면의 이용료 환불 섹션이 통째로 사라진다(적대 검증 지적 — 오류도 경고도 없는 형태).
    const sc = settlementCalcFor(lease, expectedMoveOut)
    const settleMonth = sc ? sc.period.month : expectedMoveOut.slice(0, 7)
    const monthlyRent = sc ? sc.monthlyRent : discountedRent(lease.discounts, settleMonth, lease.rentAmount)
    const paidAgg = await prisma.paymentRecord.aggregate({
      where: { leaseTermId, targetMonth: settleMonth, isDeposit: false, isPrevOwner: false },
      _sum: { actualAmount: true },
    })
    const prepaidAmount = Math.max(0, paidAgg._sum.actualAmount ?? 0)
    const daysUsed = sc ? sc.calc.daysUsed : 0   // 정산할 기간이 없으면 미사용 = 0
    const refund = calcCheckoutRefund({ prepaidAmount, monthlyRent, daysUsed, mode, penaltyPct: effectivePct })
    const appliedProration = (lease.checkoutProratedAmount != null && lease.checkoutProratedMonth === settleMonth)
      ? lease.checkoutProratedAmount : null
    return { ok: true, refund, prepaidAmount, defaultPenaltyPct, appliedProration }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// ── 중도퇴실 이용료 환불 확정 (운영자 승인 2026-07-20) ────────────────────
// 퇴실월 이용료 record를 회사 귀속액(선납 − 환불액) 1건으로 재기록해 매출에서 환불분을 뺀다.
// 원 record는 소프트삭제(복원 가능), 그 달 청구는 checkoutProrated(청구 우선순위 ①)로 회사 귀속액에 고정.
// 반환된 id들로 클라 토스트의 적용취소(undoRentRefund)가 원복한다(보증금 반환 undo와 같은 패턴).
// taxNotice — 환불 후 운영자가 **홈택스에서 따로 해야 하는 일**. 앱과 국세청은 연동되지 않으므로
// 앱이 대신 취소해 줄 수 없고, 알려주는 것까지가 앱의 몫이다(운영자 확정 2026-08-01).
//   "국세청이랑 이 앱은 연동이 안되니까 ... 홈택스에 취소하라고 알려주는 것 정도면 괜찮을 것 같은데"
export type RentRefundTaxNotice = {
  cashReceipt?: { amount: number; ymd: string }   // 발행 표시가 있던 금액과 그 결제일
  card?: { amount: number }                       // 카드 계열로 받은 금액
  pastMonth?: string                              // 지난 달 장부가 바뀐다는 고지(lib/accountingGuard)
  companyKeeps: number                            // 재발행이 필요할 때 쓸 확정액
}

export type RentRefundResult =
  | { ok: true; refunded: number; companyKeeps: number; taxNotice?: RentRefundTaxNotice }
  | { ok: false; error: string }

// 환불 스냅샷 — checkoutProrationUndo JSON 안에 refund 키로 영속(적대검증 P1-2·P2).
// id를 클라가 들고 다니지 않아 새로고침 후에도 적용취소 가능하고 위조도 차단된다.
type RentRefundSnapshot = {
  at: string
  month: string
  refunded: number
  prepaid: number
  newRecordId: string | null
  deletedRecordIds: string[]
  prevProration: { amount: number | null; month: string | null }
}

export async function finalizeRentRefund(input: {
  leaseTermId: string
  moveOutYmd: string        // 'YYYY-MM-DD'
  rentRefundAmount: number  // 운영자 확정 이용료 환불액
}): Promise<RentRefundResult> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: input.leaseTermId, propertyId },
      // dueDay·moveInDate — 정산 귀속월 산출에 필요(2026-08-02). 없으면 퇴실월로 폴백해 옛 동작이 된다.
      select: { tenantId: true, isShortTerm: true, dueDay: true, moveInDate: true, checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    // 단기는 주 단위 계약이라 일할 환불 정책 밖(운영자 결정 2026-07-20 범위 제외) — 수납 기록에서 직접 조정
    if (lease.isShortTerm) return { ok: false, error: '단기 계약의 이용료 환불은 수납 기록에서 직접 조정해 주세요(주 단위 계약이라 일할 환불 정책 밖).' }
    // 정산 귀속월 — 미리보기(previewCheckoutRefund)와 **같은 달**을 봐야 한다.
    // 어긋나면 미리보기는 전월 선납으로 환불액을 계산하고 확정은 퇴실월 record 를 지운다.
    const refundPeriod = settlementPeriodFor({ dueDay: lease.dueDay, moveInDate: lease.moveInDate }, input.moveOutYmd)
    const mon = refundPeriod ? refundPeriod.month : input.moveOutYmd.slice(0, 7)
    const records = await prisma.paymentRecord.findMany({
      where: { leaseTermId: input.leaseTermId, targetMonth: mon, isDeposit: false, isPrevOwner: false },
      orderBy: { payDate: 'asc' },
      // 증빙 메타를 함께 읽는다 — 재기록에 승계하지 않으면 그 결제일 달의 카드·현금영수증 합계에서
      // 금액이 통째로 사라진다(519호 임형진 사례, knowledge/cash-receipt-refund.md).
      select: {
        id: true, actualAmount: true, payDate: true, memo: true,
        payMethod: true, cashReceiptIssuedAt: true,
        paymentConfirmedAt: true, paymentConfirmedBy: true, bankTxRef: true,
      },
    })
    // 멱등 가드 — 이미 이 달을 환불 재기록했으면 이중 환불 차단(적대검증 P2)
    if (records.some(r => r.memo?.startsWith('[중도퇴실 환불]'))) {
      return { ok: false, error: '이미 환불 처리된 달입니다. 되돌리려면 환불 적용취소 후 다시 진행해 주세요.' }
    }
    // 과거 회계월 보호 — 이미 신고를 마친 달을 조용히 뒤집지 않는다(lib/accountingGuard 정본).
    // 이 앱에는 월 마감·잠금 개념이 없고, 정산액이 락인 expectedAmount 보다 우선하므로
    // 여기가 유일한 방어선이다. 차단만 하면 운영자가 막히므로 사유에 대안을 함께 준다.
    const todayYmd = kstYmdStr()   // 월이 아니라 날짜 — 5/31 같은 신고 기한 경계를 그으려면 필요하다
    const prop = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { acquisitionDate: true },
    })
    const monthVerdict = checkSettlementMonth(mon, todayYmd, prop?.acquisitionDate ?? null)
    if (!monthVerdict.ok) return { ok: false, error: monthVerdict.reason }

    const prepaid = records.reduce((s, r) => s + r.actualAmount, 0)
    const refundAmt = Math.round(input.rentRefundAmount)
    if (!Number.isFinite(refundAmt) || refundAmt <= 0) return { ok: false, error: '환불 금액이 올바르지 않습니다.' }
    if (refundAmt > prepaid) return { ok: false, error: `환불 금액이 그 기간 수납액(${prepaid.toLocaleString()}원)을 넘을 수 없습니다.` }
    const companyKeeps = prepaid - refundAmt
    const ids = records.map(r => r.id)
    const firstRecord = records[0]
    const firstPayDate = firstRecord?.payDate ?? new Date()

    await prisma.$transaction(async tx => {
      const del = await tx.paymentRecord.updateMany({
        where: { id: { in: ids }, leaseTermId: input.leaseTermId },
        data: { deletedAt: new Date() },
      })
      if (del.count !== ids.length) throw new Error('CONFLICT')
      let newRecordId: string | null = null
      if (companyKeeps > 0) {
        const seqNo = await tx.paymentRecord.count({
          where: { leaseTermId: input.leaseTermId, targetMonth: mon, deletedAt: undefined },
        })
        const created = await tx.paymentRecord.create({
          data: {
            leaseTermId: input.leaseTermId, tenantId: lease.tenantId, propertyId,
            targetMonth: mon, expectedAmount: companyKeeps, actualAmount: companyKeeps,
            payDate: firstPayDate, seqNo: seqNo + 1, isPaid: true, carryOver: 0,
            // 결제수단·입금확인은 승계한다. 안 하면 payDate 월의 카드 합계에서 회사 귀속분까지 빠져
            // 어느 집계에도 없는 유령이 된다.
            payMethod: firstRecord?.payMethod ?? null,
            paymentConfirmedAt: firstRecord?.paymentConfirmedAt ?? null,
            paymentConfirmedBy: firstRecord?.paymentConfirmedBy ?? null,
            bankTxRef: firstRecord?.bankTxRef ?? null,
            // cashReceiptIssuedAt 은 **일부러 승계하지 않는다**(회계 패널 2026-08-01).
            // 승계하면 앱 현금영수증 합계가 확정액으로 조용히 줄지만 홈택스에는 원 금액이 그대로 살아 있다.
            // 화면상 아무 이상이 없어 보여 운영자가 취소·재발행을 안 해도 앱이 침묵한다.
            // 표시를 지워 눈에 걸리게 하고, 재발행 후 수납 기록에서 다시 켜는 흐름이 맞다.
            memo: `[중도퇴실 환불] 환불 ${refundAmt.toLocaleString()}원 · 원 수납 ${prepaid.toLocaleString()}원 · 청구 확정 ${companyKeeps.toLocaleString()}원`,
          },
        })
        newRecordId = created.id
      }
      const snapshot: RentRefundSnapshot = {
        at: new Date().toISOString(), month: mon, refunded: refundAmt, prepaid,
        newRecordId, deletedRecordIds: ids,
        prevProration: { amount: lease.checkoutProratedAmount, month: lease.checkoutProratedMonth },
      }
      const undoBase = (lease.checkoutProrationUndo && typeof lease.checkoutProrationUndo === 'object')
        ? lease.checkoutProrationUndo as Record<string, unknown> : {}
      // 그 달 청구를 회사 귀속액으로 고정(0도 유효 — 전액 환불이면 청구 0) — 발생주의 매출·미수와 record가 일치.
      // 스냅샷은 checkoutProrationUndo.refund 에 영속 — updateTenant 재계산이 이 키를 보고 보존한다(P0 방어 2중).
      await tx.leaseTerm.updateMany({
        where: { id: input.leaseTermId, propertyId },
        data: {
          checkoutProratedAmount: companyKeeps, checkoutProratedMonth: mon,
          checkoutProrationUndo: { ...undoBase, refund: snapshot } as Prisma.InputJsonValue,
        },
      })
    })

    // 홈택스 조치 안내 — 해당할 때만 채운다. 없는데 매번 띄우면 진짜 경고도 안 읽힌다.
    const receiptRec = records.find(r => r.cashReceiptIssuedAt)
    const cardAmt = records
      .filter(r => r.payMethod && CARD_LIKE_METHODS.includes(r.payMethod))
      .reduce((sum, r) => sum + r.actualAmount, 0)
    const taxNotice: RentRefundTaxNotice | undefined =
      (receiptRec || cardAmt > 0 || monthVerdict.warning)
        ? {
            companyKeeps,
            ...(monthVerdict.warning ? { pastMonth: monthVerdict.warning } : {}),
            ...(receiptRec ? { cashReceipt: {
              amount: records.filter(r => r.cashReceiptIssuedAt).reduce((sum, r) => sum + r.actualAmount, 0),
              ymd: receiptRec.payDate.toISOString().slice(0, 10),
            } } : {}),
            ...(cardAmt > 0 ? { card: { amount: cardAmt } } : {}),
          }
        : undefined

    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/finance'); revalidatePath('/')
    return { ok: true, refunded: refundAmt, companyKeeps, taxNotice }
  } catch (err) {
    if ((err as Error).message === 'CONFLICT') return { ok: false, error: '수납 기록이 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.' }
    return { ok: false, error: (err as Error).message ?? '환불 처리 중 오류가 발생했습니다.' }
  }
}

// 이용료 환불 적용취소 — DB에 영속된 스냅샷 기준으로 원 record 복원 + 재기록 소프트삭제 + 일할 필드 원복.
// 클라 전달값을 신뢰하지 않는다(적대검증 P2 — id 위조·다른 사유 삭제분 복원 차단).
export async function undoRentRefund(leaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: { checkoutProrationUndo: true },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    const undoObj = (lease.checkoutProrationUndo && typeof lease.checkoutProrationUndo === 'object')
      ? lease.checkoutProrationUndo as Record<string, unknown> : null
    const snap = undoObj?.refund as RentRefundSnapshot | undefined
    if (!snap || !Array.isArray(snap.deletedRecordIds)) return { ok: false, error: '되돌릴 환불 기록이 없습니다.' }

    await prisma.$transaction(async tx => {
      if (snap.deletedRecordIds.length > 0) {
        await tx.paymentRecord.updateMany({
          where: { id: { in: snap.deletedRecordIds }, leaseTermId },
          data: { deletedAt: null },
        })
      }
      if (snap.newRecordId) {
        await tx.paymentRecord.updateMany({ where: { id: snap.newRecordId, leaseTermId }, data: { deletedAt: new Date() } })
      }
      const rest = { ...undoObj }
      delete rest.refund
      await tx.leaseTerm.updateMany({
        where: { id: leaseTermId, propertyId },
        data: {
          checkoutProratedAmount: snap.prevProration?.amount ?? null,
          checkoutProratedMonth: snap.prevProration?.month ?? null,
          checkoutProrationUndo: (Object.keys(rest).length > 0 ? rest : Prisma.DbNull) as Prisma.InputJsonValue,
        },
      })
    })
    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/finance'); revalidatePath('/')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? '적용취소 중 오류가 발생했습니다.' }
  }
}

export async function setCheckoutProration(
  leaseTermId: string,
  expectedMoveOut: string,  // 'YYYY-MM-DD'
  manualAmount?: number,    // 운영자 수동 조정값 — 없으면 자동 일할액 사용 (봐주기·특이 케이스)
): Promise<{ ok: true; calc: CheckoutProrationResult } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        status: true, tenantId: true, dueDay: true, rentAmount: true, moveInDate: true,
        expectedMoveOut: true, checkoutProratedAmount: true, checkoutProratedMonth: true,
        checkoutProrationUndo: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }
    const sc = settlementCalcFor(lease, expectedMoveOut)
    if (!sc) return { ok: false, error: '정산할 기간을 찾을 수 없습니다. 납부일이 없거나 퇴실일이 입주일보다 앞선 경우입니다.' }
    const { calc } = sc

    // 과거 회계월 보호 — 환불 확정과 같은 가드를 여기에도 건다(운영자 확정 2026-08-02).
    // 이 함수가 쓰는 checkoutProratedAmount 는 락인 expectedAmount 보다 우선하므로(lib/billing),
    // 가드가 환불 쪽에만 있으면 같은 위험이 이 문으로 그대로 들어온다. 3단계에서 정산월이
    // 기간월로 바뀌면 이 함수는 일상적으로 과거 달에 쓰게 된다.
    const settleProp = await prisma.property.findUnique({ where: { id: propertyId }, select: { acquisitionDate: true } })
    const settleVerdict = checkSettlementMonth(calc.moveOutMonth, kstYmdStr(), settleProp?.acquisitionDate ?? null)
    if (!settleVerdict.ok) return { ok: false, error: settleVerdict.reason }
    // 수동 조정값이 있으면 그 값으로(0 이상 정수), 없으면 자동 일할액. undo 의 appliedAmount 도 이 값으로 기록.
    const finalAmount = (manualAmount != null && Number.isFinite(manualAmount) && manualAmount >= 0) ? Math.round(manualAmount) : calc.amount

    // 적용취소용 직전 스냅샷 — 이미 정산이 적용돼 있으면(재정산) 기존 스냅샷(최초 적용 직전)을 유지해
    // '적용취소' 한 번으로 정산 이전(거주중 등) 원상태까지 되돌아가게 한다.
    const undoBase: CheckoutProrationUndo = (lease.checkoutProrationUndo as CheckoutProrationUndo | null) ?? {
      prevStatus: lease.status,
      prevExpectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      prevAmount: lease.checkoutProratedAmount ?? null,
      prevMonth: lease.checkoutProratedMonth ?? null,
    }
    // 적용이 설정한 값 기록 — 이후 수동 수정 감지(적용취소가 수동 수정을 덮어쓰지 않게)
    const undo: CheckoutProrationUndo = { ...undoBase, appliedMoveOut: expectedMoveOut, appliedAmount: finalAmount }

    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: {
        status: 'CHECKOUT_PENDING',
        expectedMoveOut: new Date(expectedMoveOut),
        checkoutProratedAmount: finalAmount,
        checkoutProratedMonth: calc.moveOutMonth,
        checkoutProrationUndo: undo,
      },
    })
    // 거주 구간 이력 — 종료 상태에서 퇴실 예정으로 되돌아오는 경우의 재개방(그 외에는 no-op, 추가 write).
    await syncRoomStayOnSave(prisma, leaseTermId, {
      prevRoomId: null, nextRoomId: null,
      prevStatus: lease.status, nextStatus: 'CHECKOUT_PENDING',
    })
    // 상태 전환 로그 — ACTIVE→CHECKOUT_PENDING 등 변경 시에만 남김
    if (lease.status !== 'CHECKOUT_PENDING') {
      await prisma.tenantStatusLog.create({
        data: {
          tenantId: lease.tenantId, leaseTermId, propertyId,
          fromStatus: lease.status, toStatus: 'CHECKOUT_PENDING', changedById: user.sub,
        },
      })
    }

    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    revalidatePath('/finance')
    revalidatePath('/room-manage')
    return { ok: true, calc }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 퇴실 일할 정산 '적용취소'(롤백) — 적용 직전 스냅샷으로 상태·퇴실예정일·일할액을 한 번에 복원.
// 스냅샷이 없으면(과거 적용분 등) 일할액만 제거(풀 청구 복귀)하는 안전 폴백.
export async function clearCheckoutProration(
  leaseTermId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId, user } = await getPropertyId()
    const lease = await prisma.leaseTerm.findUnique({
      where: { id: leaseTermId },
      select: {
        status: true, tenantId: true, checkoutProrationUndo: true,
        expectedMoveOut: true, checkoutProratedAmount: true,
      },
    })
    if (!lease) return { ok: false, error: '계약 정보를 찾을 수 없습니다.' }

    // 환불 확정(finalizeRentRefund) 상태 — 일할 해제가 환불 스냅샷을 지우고 청구·record 정합을 깬다.
    // 되돌리려면 환불 적용취소(undoRentRefund)를 먼저(적대검증 P0 연쇄 방어).
    const undoRaw = lease.checkoutProrationUndo
    if (undoRaw && typeof undoRaw === 'object' && 'refund' in (undoRaw as Record<string, unknown>)) {
      return { ok: false, error: '이용료 환불이 확정된 계약입니다. 환불 적용취소를 먼저 진행해 주세요.' }
    }

    const undo = lease.checkoutProrationUndo as CheckoutProrationUndo | null
    // 적용 이후 수동 수정(퇴실일 변경 등) 감지 — 스냅샷 복원이 그 수정을 덮어쓰지 않게,
    // 수정이 있었으면 일할액만 제거하고 현재 상태·퇴실일은 유지한다.
    const curMoveOut = lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null
    const manuallyChanged = !!undo && undo.appliedMoveOut !== undefined
      && (curMoveOut !== undo.appliedMoveOut || lease.checkoutProratedAmount !== undo.appliedAmount)
    if (undo && manuallyChanged) {
      await prisma.leaseTerm.update({
        where: { id: leaseTermId },
        data: { checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull },
      })
    } else if (undo) {
      // 완전 복원 — 적용 직전 상태로
      await prisma.leaseTerm.update({
        where: { id: leaseTermId },
        data: {
          status: undo.prevStatus,
          expectedMoveOut: undo.prevExpectedMoveOut ? new Date(undo.prevExpectedMoveOut) : null,
          checkoutProratedAmount: undo.prevAmount,
          checkoutProratedMonth: undo.prevMonth,
          checkoutProrationUndo: Prisma.DbNull,
        },
      })
      // 거주 구간 이력 — 복원된 상태가 종료 상태면 마감(그 외에는 no-op, 추가 write).
      await syncRoomStayOnSave(prisma, leaseTermId, {
        prevRoomId: null, nextRoomId: null,
        prevStatus: lease.status, nextStatus: undo.prevStatus,
      })
      // 상태가 실제로 되돌아가면 전환 로그 남김 (예: CHECKOUT_PENDING → ACTIVE)
      if (undo.prevStatus !== lease.status) {
        await prisma.tenantStatusLog.create({
          data: {
            tenantId: lease.tenantId, leaseTermId, propertyId,
            fromStatus: lease.status, toStatus: undo.prevStatus, changedById: user.sub,
          },
        })
      }
    } else {
      // 폴백 — 스냅샷 없으면 일할액만 제거(상태·퇴실예정 유지)
      await prisma.leaseTerm.update({
        where: { id: leaseTermId },
        data: { checkoutProratedAmount: null, checkoutProratedMonth: null },
      })
    }

    revalidatePath('/tenants')
    revalidatePath('/rooms')
    revalidatePath('/dashboard')
    revalidatePath('/finance')
    revalidatePath('/room-manage')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deleteTenantRequest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    // 소프트삭제 — 적용취소(restoreTenantRequest) 가능. 모든 조회는 deletedAt:null 필터로 제외.
    await prisma.tenantRequest.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function restoreTenantRequest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.tenantRequest.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/tenants')
    revalidatePath('/requests')
    revalidatePath('/dashboard')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 입실 예정 → 거주중 자동 전환 (입주일 도래 시)
// autoTransitionReserved 는 제거했다 (2026-08-03).
// 호출부를 b8fe79d 에서 의도적으로 뺐는데 함수만 남아 있었다. 예약->거주중 자동 전환은
// 지금 홈 알림에서 운영자가 확인하고 넘기는 흐름이다. 죽은 채 남아 있으면 다음 세션이
// '이미 자동으로 된다'고 오해한다.

// ── 계약서 파일 (서명된 PDF / 스캔 본) ─────────────────────────────────

export type ContractFileRow = {
  id: string
  driveFileId: string
  fileName: string
  source: 'GENERATED' | 'UPLOADED'
  signedAt: Date
  createdAt: Date
  // 계약번호 — 사람이 부를 수 있는 유일한 이름. 스캔본과 번호 도입(2026-08-03) 이전 발급본은 null 이다.
  contractNo: string | null
  // 같은 계약의 발급본을 묶는 축. 한 사람이 계약을 둘 가질 수 있으므로 사람이 아니라 계약이 기준이다.
  leaseTermId: string | null
  viewUrl: string
}

export async function getContractFiles(tenantId: string): Promise<ContractFileRow[]> {
  const { propertyId } = await getPropertyId()
  const rows = await prisma.contractFile.findMany({
    where: { driveFileId: { not: '' }, tenantId, propertyId, deletedAt: null },
    orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    // issuedSnapshot 은 여기서 읽지 않는다 — 서명 dataURL 두 장이 들어 있어 목록 응답이 통째로 무거워진다.
    // 발급 상세(getContractIssuedSnapshot)에서 한 건씩만 읽는다.
    select: {
      id: true, driveFileId: true, fileName: true, source: true,
      signedAt: true, createdAt: true, contractNo: true, leaseTermId: true,
    },
  })
  return rows.map(r => ({
    ...r,
    viewUrl: `https://drive.google.com/file/d/${r.driveFileId}/view`,
  }))
}

// 발급본 박제(ContractFile.issuedSnapshot)의 모양. 쓰기는 발급 트랜잭션 한 번뿐이고(app/api/contract/generate),
// 읽기는 발급 상세 시트 하나다. 어떤 경로도 이 값을 갱신하지 않는다 — 증거이기 때문이다.
export type IssuedContractSnapshot = {
  v: number
  issuedAt: string                      // 발급 시각(ISO)
  bodySource: 'SNAPSHOT' | 'ARCHIVED' | 'LIVE'   // 본문을 어디서 가져왔나(lib/contract resolveSignedBody)
  shareLinkId: string | null            // 원격 서명 링크로 받은 서명이면 그 링크. 없으면 대면 서명이다
  signature: {
    contractImage: string | null        // dataURL
    contractSignedAt: string | null     // ISO
    disposalImage: string | null
    disposalSignedAt: string | null
  }
  facts: Record<string, unknown>        // lib/contractPrintedFacts 15축 사영
}

export type IssuedContractDetail = {
  contractNo: string | null
  fileName: string
  source: 'GENERATED' | 'UPLOADED'
  signedAt: Date
  createdAt: Date
  tenantName: string
  snapshot: IssuedContractSnapshot | null
}

// 발급 상세 — 이 발급본이 무엇을 인쇄했는지의 기록 한 건. 목록 쿼리에서 분리한 이유는
// issuedSnapshot 이 서명 dataURL 두 장을 품고 있어서다(목록 42건에 곱하면 응답이 통째로 무거워진다).
// 게이트는 서명 이미지를 돌려주는 형제 경로(contractShare getSignedSnapshot)와 같은 requireEdit 이다.
export async function getContractIssuedSnapshot(id: string): Promise<
  { ok: true; detail: IssuedContractDetail } | { ok: false; error: string }
> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const row = await prisma.contractFile.findFirst({
      where: { id, propertyId },
      select: {
        contractNo: true, fileName: true, source: true, signedAt: true, createdAt: true,
        issuedSnapshot: true, tenant: { select: { name: true } },
      },
    })
    if (!row) return { ok: false, error: '계약서 파일을 찾을 수 없습니다.' }
    const snap = row.issuedSnapshot as IssuedContractSnapshot | null
    return {
      ok: true,
      detail: {
        contractNo: row.contractNo,
        fileName: row.fileName,
        source: row.source as 'GENERATED' | 'UPLOADED',
        signedAt: row.signedAt,
        createdAt: row.createdAt,
        tenantName: row.tenant.name,
        snapshot: snap && typeof snap === 'object' ? snap : null,
      },
    }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '발급 기록을 불러오지 못했습니다.' }
  }
}

export async function deleteContractFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const { trashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.contractFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    // 소프트삭제 — Drive는 휴지통으로(복구 가능), DB는 deletedAt 표시. 적용취소는 restoreContractFile.
    try { await trashInDrive(file.driveFileId) } catch { /* Drive 정리 실패 무시 */ }
    await prisma.contractFile.update({ where: { id }, data: { deletedAt: new Date() } })
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '삭제에 실패했습니다.' }
  }
}

export async function restoreContractFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const { untrashInDrive } = await import('@/lib/google-drive')
    const file = await prisma.contractFile.findFirst({ where: { id, propertyId }, select: { driveFileId: true } })
    if (!file) return { ok: false, error: '파일을 찾을 수 없습니다.' }
    try { await untrashInDrive(file.driveFileId) } catch { /* Drive 복구 실패 무시 */ }
    await prisma.contractFile.update({ where: { id }, data: { deletedAt: null } })
    revalidatePath('/tenants')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '복구에 실패했습니다.' }
  }
}

// 스캔 업로드 — 종이로 서명받은 계약서를 사진/PDF로 첨부
const MAX_SCAN_BYTES = 25 * 1024 * 1024  // 25MB

export async function createContractScanUploadSession(input: {
  tenantId: string
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_SCAN_BYTES) return { ok: false, error: `파일 크기는 ${MAX_SCAN_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }
    const tenant = await prisma.tenant.findFirst({ where: { id: input.tenantId, propertyId }, select: { id: true } })
    if (!tenant) return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    const { createDriveResumableSession } = await import('@/lib/google-drive')
    const ext = input.fileName.split('.').pop() ?? 'bin'
    const uniqueName = `contract_scan_${input.tenantId}_${Date.now()}.${ext}`
    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName, mimeType: input.mimeType, fileSize: input.fileSize, origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: `업로드 준비 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

export async function finalizeContractScan(input: {
  tenantId: string
  driveFileId: string
  fileName: string
  signedAt?: string  // YYYY-MM-DD, 없으면 오늘
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    const { deleteFromDrive, isOwnedByApp } = await import('@/lib/google-drive')
    const tenant = await prisma.tenant.findFirst({
      where: { id: input.tenantId, propertyId },
      include: {
        leaseTerms: {
          // 퇴실 예정·비거주도 살아 있는 계약이다. 여기가 서명 상태까지 좌우하게 됐으므로
          // 계약서 화면·발급 API 와 같은 목록을 쓴다.
          where: { status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
          // take: 1 을 뺐다 — 스캔본이 붙을 계약은 '입주일이 가장 늦은 계약'이 아니라 그 사람의
          // 메인 계약이다(primaryTenantLease). 창고 계약이 나중에 생겼다고 그쪽에 붙으면 안 된다.
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, status: true, moveInDate: true, signatureSignedAt: true, signedContractSnapshot: true },
        },
      },
    })
    if (!tenant) {
      try { await deleteFromDrive(input.driveFileId) } catch {}
      return { ok: false, error: '입실자를 찾을 수 없습니다.' }
    }
    // 공개 권한을 주지 않는다 — 앱은 /api/doc-file(로그인·영업장 검증)로만 연다.
    // 종전에는 anyone:reader 라서 링크만 알면 로그인 없이 성명·생년월일·서명이 보였다(E페이즈 2026-08-03).
    // 이 앱이 올린 파일인지도 확인한다. 임의 ID 를 밀어 넣으면 남의 파일이 우리 레코드가 된다.
    if (!(await isOwnedByApp(input.driveFileId))) {
      return { ok: false, error: '업로드된 파일을 찾을 수 없습니다. 다시 시도해 주세요.' }
    }
    const lease = primaryTenantLease(tenant.leaseTerms) ?? null
    const signedAt = input.signedAt ? new Date(`${input.signedAt}T00:00:00`) : new Date()
    // 스캔본 업로드는 서명 완료로 친다(운영자 확정 2026-08-04). 종이에 서명이 있고 그 스캔이 원본이다.
    // 다만 **서명 이미지는 만들지 않는다** — 서명은 종이에 있고 없는 것을 지어내지 않는다.
    // 본문도 담지 않는다. 인쇄는 아무 기록을 안 남겨서 종이에 무엇이 인쇄됐는지 앱이 원리적으로 모른다.
    // 대신 증거가 어디 있는지만 가리키고, 그 계약은 앱이 새 발급본을 만들지 못한다(resolveSignedBody).
    const created = await prisma.$transaction(async tx => {
      const file = await tx.contractFile.create({
        data: {
          propertyId,
          tenantId: tenant.id,
          leaseTermId: lease?.id ?? null,
          driveFileId: input.driveFileId,
          fileName: input.fileName,
          source: 'UPLOADED',
          signedAt,
        },
        select: { id: true },
      })
      // 이미 서명이 있는 계약에 스캔본을 덧붙이는 경우는 아무것도 덮지 않는다. 파일만 붙는다.
      if (lease && !lease.signatureSignedAt && !lease.signedContractSnapshot) {
        await tx.leaseTerm.update({
          where: { id: lease.id },
          data: {
            signatureSignedAt: signedAt,
            signedContractSnapshot: {
              origin: 'SCAN', capturedAt: signedAt.toISOString(), sourceContractFileId: file.id,
            },
          },
        })
      }
      return file
    })
    revalidatePath('/tenants')
    return { ok: true, id: created.id }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    if (input.driveFileId) {
      try { const { deleteFromDrive } = await import('@/lib/google-drive'); await deleteFromDrive(input.driveFileId) } catch {}
    }
    return { ok: false, error: `업로드 마무리 실패: ${(err as Error).message ?? '알 수 없는 오류'}` }
  }
}

// ── 일괄 편집
export async function batchUpdateTenants(
  tenantIds: string[],
  data: {
    // Tenant 필드
    nationality?: string | null
    gender?: string
    // LeaseTerm 필드 (가장 최근 활성·예약 계약에 적용)
    depositAmount?: number
    dueDay?: string | null
    status?: string
    // 퇴실 예정일(YYYY-MM-DD) — status 가 CHECKOUT_PENDING 일 때만 유효(신고 204522b7). 빈 값 = 미변경.
    expectedMoveOut?: string
  },
): Promise<{ ok: true; tenantCount: number; leaseCount: number; skipped: { reason: string; count: number }[]; undo: BatchTenantsUndo } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    if (tenantIds.length === 0) return { ok: false, error: '선택된 입주자가 없습니다.' }

    const tenantFields: Record<string, unknown> = {}
    if ('nationality' in data) tenantFields.nationality = data.nationality
    if ('gender' in data && data.gender) tenantFields.gender = data.gender

    const leaseFields: Record<string, unknown> = {}
    if ('depositAmount' in data && data.depositAmount != null) leaseFields.depositAmount = data.depositAmount
    if ('dueDay' in data) leaseFields.dueDay = data.dueDay
    if ('status' in data && data.status) {
      leaseFields.status = data.status
      // 리드 밖 상태로의 일괄 전환은 조절 여부를 접는다(감지망 축 3) — 일괄엔 예약 확정 토글이 없어 상태만 본다
      if (leavesWishLead(data.status, null)) leaseFields.moveInFlexible = null
    }
    // 퇴실 예정일 — 퇴실 예정 전환과 함께일 때만. 단건 경로(updateTenant)와 동일하게 단기 자동 전환 기록 리셋(재무장)
    if (data.status === 'CHECKOUT_PENDING' && data.expectedMoveOut) {
      leaseFields.expectedMoveOut = new Date(data.expectedMoveOut)
      leaseFields.autoCheckoutAt = null
    }

    let tenantCount = 0
    let leaseCount = 0

    // 사유별 제외 건수 — 일괄 편집 정본 문법(finance batchUpdateExpenses 와 같은 모양·같은 토스트).
    const skippedCounts: Record<string, number> = {}
    const bump = (reason: string) => { skippedCounts[reason] = (skippedCounts[reason] ?? 0) + 1 }

    // 되돌리기 스냅샷 — 덮어쓰기 전 원값(감사 백로그 2026-07-10, 일괄 수납 undo와 동일 패턴)
    const undo: BatchTenantsUndo = { tenants: [], leases: [] }

    if (Object.keys(tenantFields).length > 0) {
      const before = await prisma.tenant.findMany({
        where: { id: { in: tenantIds }, propertyId },
        select: { id: true, nationality: true, gender: true },
      })
      undo.tenants = before.map(b => ({ id: b.id, fields: Object.fromEntries(Object.keys(tenantFields).map(k => [k, (b as Record<string, unknown>)[k] ?? null])) }))
      const r = await prisma.tenant.updateMany({
        where: { id: { in: tenantIds }, propertyId },
        data: tenantFields,
      })
      tenantCount = r.count
    }

    if (Object.keys(leaseFields).length > 0) {
      const allLive = await prisma.leaseTerm.findMany({
        where: {
          tenantId: { in: tenantIds },
          status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT'] },
        },
        // rentAmount·moveInDate — 아래 청구 상태 백스톱의 입력(단건 경로 applyStatusTransition 과 같은 판정).
        select: { id: true, tenantId: true, depositAmount: true, dueDay: true, status: true, expectedMoveOut: true, autoCheckoutAt: true, rentAmount: true, moveInDate: true },
      })
      // 사람당 메인 계약 하나만 덮는다(2026-08-13). 종전에는 이 where 가 그 사람의 살아 있는 계약을
      // 전부 집어, 방을 둘 쓰는 사람(509호 거주 + 601호 창고)에게 일괄 편집을 걸면 보증금·납부일·상태가
      // 두 계약에 동시에 찍혔다. 창고 계약에 거주 계약의 보증금이 들어가는 식이다. 머리말이 이미
      // '가장 최근 활성·예약 계약에 적용'이라 적고 있었는데 코드가 그 말을 지키지 않던 자리다.
      // 고르는 규칙은 화면이 메인으로 보여 주는 그 계약과 같아야 한다 — primaryTenantLease 정본.
      const byTenant = new Map<string, typeof allLive>()
      for (const l of allLive) {
        const arr = byTenant.get(l.tenantId)
        if (arr) arr.push(l); else byTenant.set(l.tenantId, [l])
      }
      const before = [...byTenant.values()].map(ls => primaryTenantLease(ls)!).filter(Boolean)

      // 상태를 바꾸는 일괄은 단건 경로와 같은 선을 지킨다. 종전에는 전이 검증이 통째로 없어
      // 퇴실 완료에서 투어 대기로, 아무 계약이나 비거주로 한 번에 뒤집을 수 있었다 — 경로가 넷이라
      // 경로마다 규칙이 갈리던 그 문제(lib/leaseTransitions 머리말)가 일괄에만 남아 있었다.
      // 막힌 건은 통째로 실패시키지 않고 건너뛴 뒤 사유를 세어 돌려준다(일괄 편집 정본 문법).
      const nextStatus = typeof leaseFields.status === 'string' ? leaseFields.status : null
      const eligible = before.filter(b => {
        if (!nextStatus) return true
        if (!canTransition(b.status, nextStatus)) { bump(`${transitionStatusLabel(b.status)}에서 바꿀 수 없음`); return false }
        // 백스톱 — 청구 발생 상태로 올리는데 입주일이 없으면 unpaid 가 인수월부터 미납을 오탐한다
        // (addTenant·updateTenant·applyStatusTransition 이 이미 같은 문장으로 막는 자리).
        if (['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(nextStatus) && b.rentAmount > 0 && !b.moveInDate) {
          bump('입주일 없음'); return false
        }
        return true
      })

      undo.leases = eligible.map(b => ({ id: b.id, fields: Object.fromEntries(Object.keys(leaseFields).map(k => [k, (b as Record<string, unknown>)[k] ?? null])) }))
      if (eligible.length > 0) {
        const r = await prisma.leaseTerm.updateMany({
          where: { id: { in: eligible.map(b => b.id) } },
          data: leaseFields,
        })
        leaseCount = r.count
        // 딸린 계약의 납부일도 함께 옮긴다(운영자 오더 2026-08-13). 일괄은 사람마다 메인 계약 하나만
        // 덮으므로, 딸린 계약은 여기서 부모를 따라가지 않으면 옛 날에 홀로 남는다.
        // 되돌리기 목록에 같은 모양으로 이어 붙여 적용취소 한 번이 전파분까지 되돌리게 한다.
        if ('dueDay' in leaseFields) {
          const nextDue = (leaseFields.dueDay ?? null) as string | null
          for (const b of eligible) {
            const moved = await propagateDueDayToSubLeases(prisma, b.id, b.dueDay, nextDue)
            undo.leases.push(...moved.map(m => ({ id: m.id, fields: { dueDay: m.prevDueDay } })))
          }
        }
      }

      // 거주 구간 이력 — 일괄 전환이 종료 상태를 넘나들 때만 마감·재개방(호실은 안 바뀜, 추가 write).
      if (nextStatus) {
        for (const b of eligible) {
          await syncRoomStayOnSave(prisma, b.id, {
            prevRoomId: null, nextRoomId: null,
            prevStatus: b.status, nextStatus,
          })
        }
      }
    }

    const skipped = Object.entries(skippedCounts).map(([reason, count]) => ({ reason, count }))
    // 전부 걸러진 저장은 '변경할 항목이 없습니다'가 아니다 — 왜 안 바뀌었는지가 답이라
    // 사유를 실어 정상 응답으로 돌려주고 토스트가 그것을 말한다(제외가 0건일 때만 종전 문구).
    if (tenantCount === 0 && leaseCount === 0 && skipped.length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
    revalidatePath('/tenants')
    revalidatePath('/rooms')
    return { ok: true, tenantCount, leaseCount, skipped, undo }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

// 단기 입실 요금 시뮬레이션용 — 방 목록(월세·사용중 여부). 등록 없이 견적만 낼 때 방 선택 → 월세 자동.
export async function getRoomsForQuote(): Promise<{
  rooms: { id: string; roomNo: string; baseRent: number; type: string | null; windowType: string | null; tier: string | null; occupied: boolean }[]
  shortStay: ShortStayPolicy   // 단기 입실 정책 — 시뮬이 이 수치로 계산(영업장별 템플릿)
}> {
  const { propertyId } = await getPropertyId()
  const [rooms, prop] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId },
      orderBy: { roomNo: 'asc' },
      select: {
        id: true, roomNo: true, baseRent: true, type: true, windowType: true, tier: true,
        leaseTerms: { where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } }, select: { id: true }, take: 1 },
      },
    }),
    prisma.property.findUnique({ where: { id: propertyId }, select: { shortStayPolicy: true } }),
  ])
  return {
    rooms: rooms.map(r => ({ id: r.id, roomNo: r.roomNo, baseRent: r.baseRent, type: r.type, windowType: r.windowType, tier: r.tier, occupied: r.leaseTerms.length > 0 })),
    shortStay: parseShortStayPolicy(prop?.shortStayPolicy),
  }
}

// ── 단기 연장 (운영자 승인 2026-07-20) ─────────────────────────────────────
// 규칙(knowledge/short-stay-policy.md): 누적 재계산 — 최초 입주일~새 퇴실일 전체를 calcShortStay로
// 재계산하고 추가 납부 = 새 사용료 - 기존 rentAmount. 청소비는 입실 1회(연장 미청구).
// 30일(thresholdDays) 초과는 단기 정책 밖 → 월 계약 전환 안내(여기서는 거부).
// 금액은 반드시 서버가 정책·DB에서 재산출 — 클라 값 신뢰 금지(락인 expectedAmount가 영구 청구 기준).

type ShortStayExtensionSnapshot = {
  at: string
  prevRentAmount: number
  newRentAmount: number
  prevExpectedMoveOut: string | null
  newExpectedMoveOut: string
  prevStatus: string
  prevAutoCheckoutAt: string | null
  prevProration: { amount: number | null; month: string | null; undo: unknown } | null
  markerRecordId: string
  undoneAt: string | null
  // 아래 둘은 감액 도입(2026-07-26) 이후 스냅샷에만 있다 — 구 스냅샷은 undefined(연장으로 간주 + 휴리스틱 복원).
  kind?: 'increase' | 'decrease'
  lockRewrites?: LockRewrite[]   // 되쓰기 전 원값 — 적용취소의 정확 복원 근거
  // 운영자가 폼에서 직접 넣은 금액(협의가)을 락으로 쓴 저장인지. 협의가 이력을 영속 기록한다
  // (I8' — 마지막 저장이 manual 이면 그 금액이 새 기준선). 구 스냅샷은 undefined.
  manual?: boolean
}

// 트랜잭션 클라이언트 — lib/prisma 의 익스텐션(소프트삭제 자동필터)이 적용된 타입이라야 tx 안에서도 규칙이 같다.
type ShortStayTx = Omit<PrismaDb, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

// 동기화 대상 lease — 값은 전부 '쓰기 전에 읽은' 시점의 것이어야 한다.
// 조건부 선점(where)의 기준이자 적용취소 스냅샷의 prev 값으로 함께 쓰이기 때문.
type ShortStayChargeLease = {
  id: string; tenantId: string
  status: LeaseStatus; isShortTerm: boolean
  rentAmount: number; expectedMoveOut: Date | null; autoCheckoutAt: Date | null
  checkoutProratedAmount: number | null; checkoutProratedMonth: string | null; checkoutProrationUndo: Prisma.JsonValue
  shortStayExtensions: Prisma.JsonValue
}

/**
 * 단기 청구 동기화 — 수정 폼(updateTenant)과 연장 모달(extendShortStay)의 단일 계산 경로.
 * 입주월 마커 record(청구 조정 전표)로 청구 락(그 달 최대 expectedAmount)을 targetRent 로 맞추고,
 * lease 필드·이력 스냅샷·isPaid 를 같은 트랜잭션에서 함께 맞춘다.
 * 락을 조정하지 않으면 rentAmount 만 바꿔도 잔액이 그대로다(lib/billing.ts 우선순위 ② 락).
 * kind='decrease' 는 마커만으로 내려가지 않는다 — 락이 '최대'라 큰 값을 물고 있는 record 를 함께 되쓴다.
 * 호출부는 반드시 트랜잭션 안에서 부르고, lease 는 쓰기 전에 읽은 값을 그대로 넘긴다.
 */
async function syncShortStayCharge(
  tx: ShortStayTx,
  p: {
    lease: ShortStayChargeLease
    propertyId: string
    targetRent: number
    moveInYmd: string
    newOutYmd: string
    units: number
    nextStatus: LeaseStatus
    source: 'form' | 'modal'
    kind: 'increase' | 'decrease'
    manual?: boolean       // 폼 경로에서 운영자가 직접 넣은 금액을 락으로 쓴 경우
  },
): Promise<{ inMonth: string }> {
  const { lease, propertyId, targetRent, moveInYmd, newOutYmd, units, nextStatus, source, kind } = p
  const inMonth = moveInYmd.slice(0, 7)
  const prevOutYmd = ymdOf(lease.expectedMoveOut)

  // 마커 record — 입주월 앵커(예약 선납 reanchor와 동일 관례). 청구 락을 새 누적으로 맞춤.
  // 수납이 아니라 청구 조정 전표라 isBillingAdjust=true·payMethod 없음(표시·수납 집계에서 제외).
  // seqNo는 소프트삭제분 포함 count(@@unique 충돌 방지 — savePayment 관례).
  const seqNo = await tx.paymentRecord.count({
    where: { leaseTermId: lease.id, targetMonth: inMonth, deletedAt: undefined },
  })
  const base = kind === 'decrease' ? '단기감액' : '단기연장'
  const tag = source === 'form' ? (p.manual ? `[${base} 폼·수동]` : `[${base} 폼]`) : `[${base}]`
  const marker = await tx.paymentRecord.create({
    data: {
      leaseTermId: lease.id, tenantId: lease.tenantId, propertyId,
      targetMonth: inMonth,
      expectedAmount: targetRent,
      actualAmount: 0,
      payDate: new Date(),
      seqNo: seqNo + 1,
      isPaid: false, carryOver: 0,
      isBillingAdjust: true,
      memo: `${tag} ${units}주 · ${lease.rentAmount.toLocaleString()}→${targetRent.toLocaleString()} · 퇴실 ${prevOutYmd ?? '미정'}→${newOutYmd}`,
    },
  })

  // 감액 되쓰기 — 새 목표보다 큰 락을 물고 있는 활성 record 를 전부 새 목표로 내린다.
  // 되쓰기 '전' 원값을 스냅샷에 남겨야 적용취소가 휴리스틱 없이 정확히 복원된다.
  let lockRewrites: LockRewrite[] = []
  if (kind === 'decrease') {
    const actives = await tx.paymentRecord.findMany({
      where: { leaseTermId: lease.id, targetMonth: inMonth, isDeposit: false, isPrevOwner: false, deletedAt: null },
      select: { id: true, expectedAmount: true },
    })
    lockRewrites = lockRewritesFor(actives, targetRent)
    for (const w of lockRewrites) {
      await tx.paymentRecord.update({ where: { id: w.recordId }, data: { expectedAmount: targetRent } })
    }
  }

  const snapshot: ShortStayExtensionSnapshot = {
    at: new Date().toISOString(),
    prevRentAmount: lease.rentAmount, newRentAmount: targetRent,
    prevExpectedMoveOut: prevOutYmd, newExpectedMoveOut: newOutYmd,
    prevStatus: lease.status,
    prevAutoCheckoutAt: lease.autoCheckoutAt ? lease.autoCheckoutAt.toISOString() : null,
    prevProration: (lease.checkoutProratedAmount != null || lease.checkoutProratedMonth != null || lease.checkoutProrationUndo != null)
      ? { amount: lease.checkoutProratedAmount, month: lease.checkoutProratedMonth, undo: lease.checkoutProrationUndo }
      : null,
    markerRecordId: marker.id,
    undoneAt: null,
    kind,
    lockRewrites,   // increase 도 빈 배열로 기록해 구조를 통일한다
    manual: !!p.manual,
  }
  const prevList = Array.isArray(lease.shortStayExtensions) ? lease.shortStayExtensions : []

  // 조건부 선점 — 읽은 시점의 상태·퇴실일·요금 그대로일 때만 갱신(크론·동시 조작·이중 제출 차단)
  const updated = await tx.leaseTerm.updateMany({
    where: {
      id: lease.id, propertyId,
      isShortTerm: lease.isShortTerm,
      status: lease.status,
      expectedMoveOut: lease.expectedMoveOut,
      rentAmount: lease.rentAmount,
    },
    data: {
      rentAmount: targetRent,
      expectedMoveOut: new Date(newOutYmd),   // 'YYYY-MM-DD' → UTC 자정, @db.Date 절삭(기존 저장 관행)
      status: nextStatus,
      autoCheckoutAt: null,   // 새 퇴실일 D-1에 크론 재무장
      checkoutProratedAmount: null, checkoutProratedMonth: null, checkoutProrationUndo: Prisma.DbNull,
      shortStayExtensions: [...prevList, snapshot] as Prisma.InputJsonValue,
    },
  })
  if (updated.count !== 1) throw new Error('CONFLICT')

  // 입주월 isPaid 재계산 — 청구가 새 누적으로 올라 기존 완납 record가 미완납이 될 수 있음
  const records = await tx.paymentRecord.findMany({
    where: { leaseTermId: lease.id, targetMonth: inMonth, isDeposit: false },
    orderBy: { payDate: 'asc' },
  })
  let cumulative = 0
  for (const rec of records) {
    cumulative += rec.actualAmount
    await tx.paymentRecord.update({ where: { id: rec.id }, data: { isPaid: cumulative >= targetRent } })
  }
  return { inMonth }
}

export type ShortStayExtensionPreview =
  | {
      ok: true
      tenantName: string; roomNo: string | null
      moveInDate: string; currentOut: string | null
      currentRent: number; cleaningFee: number
      newOut: string; stayDays: number; units: number; contractDays: number
      newRent: number; diff: number
      cappedAtMonth: boolean; roundedUp: boolean
      thresholdDays: number
      /** 새 퇴실일이 그 방 다음 예약의 입주일을 밟는가 — 있으면 화면이 확인을 받아야 확정된다. */
      overlap: { moveIn: string; tenantName: string } | null
    }
  | { ok: false; error: string; overThreshold?: boolean }

// 연장 대상 lease 로드 + 새 퇴실일 기준 누적 견적 — preview·extend 공용(단일 계산 경로)
async function loadExtensionQuote(propertyId: string, leaseTermId: string, newOutYmd: string) {
  const lease = await prisma.leaseTerm.findFirst({
    where: { id: leaseTermId, propertyId },
    select: {
      id: true, status: true, isShortTerm: true, rentAmount: true, cleaningFee: true,
      moveInDate: true, expectedMoveOut: true, autoCheckoutAt: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true, checkoutProrationUndo: true,
      shortStayExtensions: true, tenantId: true, roomId: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true, baseRent: true } },
      property: { select: { shortStayPolicy: true } },
    },
  })
  const fail = (error: string, overThreshold?: boolean) => ({ ok: false as const, error, overThreshold })
  if (!lease) return fail('계약을 찾을 수 없습니다.')
  if (!lease.isShortTerm) return fail('단기 계약이 아닙니다.')
  if (!['ACTIVE', 'CHECKOUT_PENDING'].includes(lease.status)) return fail('거주 중(또는 퇴실 예정) 상태에서만 연장할 수 있습니다.')
  if (!lease.moveInDate) return fail('입주일이 없어 누적 요금을 계산할 수 없습니다.')
  if (!lease.room) return fail('호실이 배정되지 않아 표준가를 찾을 수 없습니다.')

  const moveInYmd = ymdOf(lease.moveInDate)!
  const currentOutYmd = ymdOf(lease.expectedMoveOut)
  // 같은 날짜는 허용 — 수정 폼에서 퇴실일만 먼저 저장한 뒤 "재계산 정리"로 들어오는 경로
  // (요금은 그대로인데 기간만 늘어난 상태를 누적 요금으로 맞춘다). 과거로 당기는 건 단축이라 범위 밖.
  if (currentOutYmd && newOutYmd < currentOutYmd) return fail('연장은 현 퇴실 예정일 이후 날짜만 선택할 수 있습니다.')
  if (!currentOutYmd && newOutYmd <= moveInYmd) return fail('퇴실일은 입주일 이후여야 합니다.')

  const policy = parseShortStayPolicy(lease.property.shortStayPolicy)
  if (!policy.enabled) return fail('이 영업장은 단기 입실 정책이 꺼져 있습니다. 설정에서 먼저 켜 주세요.')
  const stayDays = stayDaysOf(moveInYmd, newOutYmd)
  if (stayDays == null) return fail('날짜가 올바르지 않습니다.')
  const quote = calcShortStay(policy, lease.room.baseRent, stayDays, { moveInYmd, moveOutYmd: newOutYmd })
  if (!quote) return fail('단기 범위(입실일부터 한 달)를 넘습니다. 월 계약으로 전환해 주세요.', true)

  return { ok: true as const, lease, policy, quote, moveInYmd, currentOutYmd, stayDays }
}

export async function previewShortStayExtension(leaseTermId: string, newOutYmd: string): Promise<ShortStayExtensionPreview> {
  const { propertyId } = await getPropertyId()
  const r = await loadExtensionQuote(propertyId, leaseTermId, newOutYmd)
  if (!r.ok) return { ok: false, error: r.error, overThreshold: r.overThreshold }
  const { lease, quote, moveInYmd, currentOutYmd } = r
  return {
    ok: true,
    tenantName: lease.tenant.name, roomNo: lease.room?.roomNo ?? null,
    moveInDate: moveInYmd, currentOut: currentOutYmd,
    currentRent: lease.rentAmount, cleaningFee: lease.cleaningFee,
    newOut: newOutYmd, stayDays: r.stayDays, units: quote.units, contractDays: quote.contractDays,
    newRent: quote.baseAmount, diff: quote.baseAmount - lease.rentAmount,
    cappedAtMonth: quote.cappedAtMonth, roundedUp: quote.roundedUp,
    thresholdDays: r.policy.thresholdDays,
    overlap: await nextReservationConflict(lease.roomId, leaseTermId, moveInYmd, newOutYmd),
  }
}

/**
 * 단기 연장 확정 — 한 트랜잭션으로:
 * rentAmount(새 누적 사용료)·expectedMoveOut 갱신, ACTIVE 복귀, autoCheckoutAt 리셋(새 D-1 재무장),
 * 퇴실 일할 필드 클리어(일할이 락인보다 우선이라 남으면 연장 청구가 무시됨 — 적대검증 P0-1),
 * 입주월 마커 record(expectedAmount=새 누적)로 청구 락 인상, isPaid 재계산, 이력 스냅샷 적립.
 * expectedCurrentOutYmd는 클라가 본 현 퇴실일 — 조건부 선점(updateMany)의 멱등 토큰(이중 제출·동시 수정 방어).
 * allowOverlap 은 화면이 "다음 예약자와 겹칩니다"를 물어 운영자가 승인했다는 표식이다 — 없으면 서버가 거절한다.
 */
export async function extendShortStay(
  leaseTermId: string,
  newOutYmd: string,
  expectedCurrentOutYmd: string | null,
  allowOverlap?: boolean,
): Promise<{ ok: true; diff: number; newRent: number; inMonth: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { user, propertyId } = await getPropertyId()
    const r = await loadExtensionQuote(propertyId, leaseTermId, newOutYmd)
    if (!r.ok) return { ok: false, error: r.error }
    const { lease, quote, moveInYmd, currentOutYmd } = r

    if (currentOutYmd !== expectedCurrentOutYmd) return { ok: false, error: '다른 곳에서 계약이 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }
    // 연장이 뒷사람의 입주일을 밟는지 — 이 방은 이미 다음 사람에게 약속돼 있을 수 있다(404호 사슬).
    // 편집 폼(updateTenant)과 같은 규칙·같은 판정 함수다. 확인 없이 미는 경로를 남기지 않는다.
    if (!allowOverlap) {
      const conflict = await nextReservationConflict(lease.roomId, leaseTermId, moveInYmd, newOutYmd)
      if (conflict) {
        const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
        return { ok: false, error: `이 방은 ${md(conflict.moveIn)}에 ${conflict.tenantName}님이 들어올 예정입니다. ${md(newOutYmd)}까지 연장하면 겹칩니다.` }
      }
    }
    if (quote.baseAmount <= lease.rentAmount) {
      return { ok: false, error: '새 누적 요금이 기존 이용료 이하입니다. 수동 협의 금액이면 수정 폼에서 직접 조정해 주세요.' }
    }

    const inMonth = moveInYmd.slice(0, 7)

    await prisma.$transaction(async tx => {
      await syncShortStayCharge(tx, {
        lease, propertyId,
        targetRent: quote.baseAmount,
        moveInYmd, newOutYmd,
        units: quote.units,
        nextStatus: 'ACTIVE',
        source: 'modal',
        kind: 'increase',   // 모달은 연장 전용(loadExtensionQuote 가 과거 날짜를 거부) — 감액은 수정 폼 경로
      })

      if (lease.status === 'CHECKOUT_PENDING') {
        await tx.tenantStatusLog.create({
          data: { tenantId: lease.tenantId, leaseTermId, propertyId, fromStatus: 'CHECKOUT_PENDING', toStatus: 'ACTIVE', changedById: user.sub, reason: '단기 연장' },
        })
      }
    })

    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/')
    return { ok: true, diff: quote.baseAmount - lease.rentAmount, newRent: quote.baseAmount, inMonth }
  } catch (err) {
    if ((err as Error).message === 'CONFLICT') return { ok: false, error: '다른 곳에서 계약이 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }
    return { ok: false, error: (err as Error).message ?? '연장 처리 중 오류가 발생했습니다.' }
  }
}

/**
 * 단기 청구 조정 적용취소(연장·감액 공용) — 마지막 미취소 스냅샷으로 원복(v2.0 §16).
 * 가드: 조정 이후 계약이 또 수정됐거나, 입주월 이용료 수납 합이 이전 누적을 초과하면 차단.
 * 원복: lease 필드 복원 + 마커 소프트삭제 + 락(expectedAmount) 되쓰기 + isPaid 재계산.
 * (마커만 지우면 차액 수납·0원 record가 새 누적을 락으로 물고 남는다 — 적대검증 P1-1)
 * 되쓰기는 스냅샷 lockRewrites 로 정확 복원. 구 스냅샷(lockRewrites 없음)만 종전 휴리스틱으로 처리.
 */
export async function undoShortStayExtension(leaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { user, propertyId } = await getPropertyId()
    const lease = await prisma.leaseTerm.findFirst({
      where: { id: leaseTermId, propertyId },
      select: {
        id: true, status: true, rentAmount: true, expectedMoveOut: true, tenantId: true,
        moveInDate: true, shortStayExtensions: true,
      },
    })
    if (!lease || !lease.moveInDate) return { ok: false, error: '계약을 찾을 수 없습니다.' }
    const list = (Array.isArray(lease.shortStayExtensions) ? lease.shortStayExtensions : []) as ShortStayExtensionSnapshot[]
    const idx = list.map(e => e.undoneAt).lastIndexOf(null)
    if (idx < 0) return { ok: false, error: '되돌릴 청구 조정이 없습니다.' }
    const entry = list[idx]
    // 구 스냅샷(kind 없음)은 연장 — 문구만 갈린다.
    const label = entry.kind === 'decrease' ? '감액' : '연장'

    if (lease.rentAmount !== entry.newRentAmount || ymdOf(lease.expectedMoveOut) !== entry.newExpectedMoveOut) {
      return { ok: false, error: `${label} 이후 계약이 수정되어 적용취소할 수 없습니다. 수정 폼에서 직접 되돌려 주세요.` }
    }
    const inMonth = ymdOf(lease.moveInDate)!.slice(0, 7)
    // 락 집계와 같은 범위(보증금·양도인·소프트삭제 제외)로 통일 — 조정 판정과 어긋나지 않게.
    const paidAgg = await prisma.paymentRecord.aggregate({
      where: { leaseTermId, targetMonth: inMonth, isDeposit: false, isPrevOwner: false, deletedAt: null },
      _sum: { actualAmount: true },
    })
    if ((paidAgg._sum.actualAmount ?? 0) > entry.prevRentAmount) {
      return { ok: false, error: '이전 청구액을 넘는 수납이 이미 기록되어 적용취소할 수 없습니다. 수납 기록을 먼저 삭제해 주세요.' }
    }

    await prisma.$transaction(async tx => {
      const updated = await tx.leaseTerm.updateMany({
        where: { id: leaseTermId, propertyId, rentAmount: entry.newRentAmount },
        data: {
          rentAmount: entry.prevRentAmount,
          expectedMoveOut: entry.prevExpectedMoveOut ? new Date(entry.prevExpectedMoveOut) : null,
          status: entry.prevStatus as LeaseStatus,
          autoCheckoutAt: entry.prevAutoCheckoutAt ? new Date(entry.prevAutoCheckoutAt) : null,
          checkoutProratedAmount: entry.prevProration?.amount ?? null,
          checkoutProratedMonth: entry.prevProration?.month ?? null,
          checkoutProrationUndo: (entry.prevProration?.undo ?? Prisma.DbNull) as Prisma.InputJsonValue,
          shortStayExtensions: list.map((e, i) => i === idx ? { ...e, undoneAt: new Date().toISOString() } : e) as Prisma.InputJsonValue[],
        },
      })
      if (updated.count !== 1) throw new Error('CONFLICT')

      // 마커 소프트삭제 + 락 되쓰기 복원
      await tx.paymentRecord.updateMany({
        where: { id: entry.markerRecordId, leaseTermId },
        data: { deletedAt: new Date() },
      })
      if (entry.lockRewrites) {
        // 감액 때 내려썼던 record 를 원값으로 정확 복원(빈 배열이면 되쓸 것이 없던 연장).
        for (const w of entry.lockRewrites) {
          await tx.paymentRecord.updateMany({
            where: { id: w.recordId, leaseTermId },
            data: { expectedAmount: w.prevExpectedAmount },
          })
        }
      } else {
        // 구 스냅샷 호환 — lockRewrites 가 없던 시절(연장 전용)의 휴리스틱.
        await tx.paymentRecord.updateMany({
          where: { leaseTermId, targetMonth: inMonth, isDeposit: false, createdAt: { gte: new Date(entry.at) }, expectedAmount: { gt: entry.prevRentAmount } },
          data: { expectedAmount: entry.prevRentAmount },
        })
      }
      if (lease.status !== entry.prevStatus) {
        await tx.tenantStatusLog.create({
          data: { tenantId: lease.tenantId, leaseTermId, propertyId, fromStatus: lease.status as LeaseStatus, toStatus: entry.prevStatus as LeaseStatus, changedById: user.sub, reason: `단기 ${label} 적용취소` },
        })
      }
      // isPaid 재계산 — 이전 누적 기준
      const records = await tx.paymentRecord.findMany({
        where: { leaseTermId, targetMonth: inMonth, isDeposit: false },
        orderBy: { payDate: 'asc' },
      })
      let cumulative = 0
      for (const rec of records) {
        cumulative += rec.actualAmount
        await tx.paymentRecord.update({ where: { id: rec.id }, data: { isPaid: cumulative >= entry.prevRentAmount } })
      }
    })

    revalidatePath('/tenants'); revalidatePath('/rooms'); revalidatePath('/dashboard'); revalidatePath('/')
    return { ok: true }
  } catch (err) {
    if ((err as Error).message === 'CONFLICT') return { ok: false, error: '다른 곳에서 계약이 수정되었습니다. 새로고침 후 다시 시도해 주세요.' }
    return { ok: false, error: (err as Error).message ?? '적용취소 중 오류가 발생했습니다.' }
  }
}


// 입주자 일괄 수정 적용취소 — 항목별 원값 복원(v2.0 §16)
export type BatchTenantsUndo = {
  tenants: { id: string; fields: Record<string, unknown> }[]
  leases: { id: string; fields: Record<string, unknown> }[]
}

export async function undoBatchUpdateTenants(u: BatchTenantsUndo): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await getPropertyId()
    // 거주 구간 이력 — 되돌릴 상태를 복원 전에 읽어 둔다(복원 뒤에는 직전 상태를 알 수 없다).
    const stayUndo = u.leases
      .map(x => ({ id: x.id, status: (x.fields as Record<string, unknown>).status }))
      .filter((x): x is { id: string; status: string } => typeof x.status === 'string')
    const stayBefore = stayUndo.length > 0
      ? await prisma.leaseTerm.findMany({ where: { id: { in: stayUndo.map(x => x.id) }, propertyId }, select: { id: true, status: true } })
      : []
    await prisma.$transaction([
      ...u.tenants.map(x => prisma.tenant.updateMany({ where: { id: x.id, propertyId }, data: x.fields as never })),
      ...u.leases.map(x => prisma.leaseTerm.updateMany({ where: { id: x.id, propertyId }, data: x.fields as never })),
    ])
    // 일괄 전환으로 마감·재개방된 구간도 함께 되돌린다(추가 write).
    for (const b of stayBefore) {
      const restored = stayUndo.find(x => x.id === b.id)
      if (!restored) continue
      await syncRoomStayOnSave(prisma, b.id, {
        prevRoomId: null, nextRoomId: null,
        prevStatus: b.status, nextStatus: restored.status,
      })
    }
    revalidatePath('/tenants'); revalidatePath('/rooms')
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '되돌리기에 실패했습니다.' }
  }
}
