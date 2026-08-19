'use client'

import { useState, useTransition, useEffect, useRef, useCallback, useMemo, useId } from 'react'
import { fmtDateKor as fmtDate, fmtMD } from '@/lib/fmtDate'
import { fmtWon, fmtNoBillCovered } from '@/lib/fmtMoney'
import { calcShortStay, stayDaysOf, isWithinOneCalendarMonth } from '@/lib/shortStay'
import { calendarMonthsBetween, fmtStayPeriod } from '@/lib/stayPeriod'
import { buildReason, reasonsForStatus, reasonLabel } from '@/lib/statusReasons'
import { WISH_LEAD_STATUSES } from '@/lib/wishMatch'
import { isSameDayTurnover } from '@/lib/roomAssignment'
import { resolveReservationDepositMode } from '@/lib/reservationDeposit'
import type { ShortStayReservationMode } from '@/lib/shortStay'
import { getRoomsForQuote, undoBatchUpdateTenants, undoShortStayExtension, revealForeignRegNo, addLeaseToTenant, findDuplicateTenant } from './actions'
import { formatForeignRegNo, validateForeignRegNo } from '@/lib/foreignRegNo'
import { digitsToIso } from '@/lib/birthdate'
import { NATIVE_NAME_MAX } from '@/lib/documentName'
import { DISPLAY_NAME_STYLE_LABEL, NICKNAME_MAX, asDisplayNameStyle, displayName, displayNameStyles, type DisplayNameStyle } from '@/lib/displayName'
import { useRouter, useSearchParams } from 'next/navigation'
import { addTenant, updateTenant, deleteTenant, recordDepositReturn, undoDepositReturn, getDepositCompositionForLease,
  countTenantsWithCleaningFeeReceived,
  batchUpdateTenants, previewCheckoutRefund, finalizeRentRefund, undoRentRefund,
  type RentRefundTaxNotice,
} from './actions'
import { LEGAL_PENALTY_PCT, type CheckoutRefundResult } from '@/lib/prorate'
import { ContractFilesPanel } from '@/components/entity-modal/widgets/ContractFilesPanel'
import { savePayment, saveDepositPayment, deletePayment, restorePayment, updatePayment, getPaymentsByLease, getLeaseSettlementInfo, setDueDayOverride, clearDueDayOverride } from '@/app/(app)/rooms/actions'
import { PaymentEntryForm } from '@/components/entity-modal/widgets/PaymentEntryForm'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { Badge } from '@/components/ui/Badge'
import { InfoHint } from '@/components/ui/InfoHint'
import { confirmDialog, choiceDialog } from '@/components/ui/ConfirmDialog'
import { confirmDeletePayment } from '@/lib/paymentConfirm'
import { confirmDepositCleaningOverlap } from '@/lib/depositEntryGuard'
import { depositCompositionLabel, withheldDestinationLabel } from '@/lib/depositComposition'
import { PrismNavBar } from '@/components/entity-modal/PrismNavBar'
import { OcrToolbar, setInputByName } from './OcrToolbar'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import BirthdateInput from '@/components/ui/BirthdateInput'
import { dueDayBucketOf, DUE_DAY_BUCKET_OPTIONS, type DueDayBucket } from '@/lib/dueDayBucket'
import { dueDayParts, sameDueDay } from '@/lib/dueDay'
import { sameMoveInDate } from '@/lib/moveInDate'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput'
import { formatPhone } from '@/lib/formatPhone'
import { CountrySelect, flagByName, codeByName } from '@/components/ui/CountrySelect'
import { JobSelect } from '@/components/ui/JobSelect'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr, splitKstDateTime } from '@/lib/kstDate'
import { useUrlState } from '@/lib/useUrlState'
import { useLongPress } from '@/lib/useLongPress'
import { withSave, trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Modal } from '@/components/ui/Modal'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { SortSelect } from '@/components/ui/SortSelect'
import { STATUS_LABEL, leaseCardKind, statusException, leaseTipTone } from '@/lib/statusColors'
import { RoomCard } from '@/components/ui/RoomCard'
import { StatusBadge, statusTipColor, statusRowTint } from '@/components/ui/StatusBadge'
import { DepositStatusPanel } from '@/components/entity-modal/widgets/DepositStatusPanel'
import { WITHHOLD_REASONS, buildWithholdReason, cleaningFeeDeductible } from '@/lib/depositWithholdReasons'
import { DisplayFieldsMenu, useDisplayFields, type FieldDef } from '@/components/ui/DisplayFieldsMenu'
import { NoticeSmsModal } from '@/components/NoticeSmsModal'
import { useCanReadScope } from '@/components/RoleContext'
import { fmtRoomNo, fmtRoomList } from '@/lib/roomNo'
import { primaryTenantLease, roomLeaseRowOrder, TENANT_LIST_STATUSES, CLOSED_STATUSES } from '@/lib/leaseStatus'
// 거주 구간을 만드는 상태 정본 — 이사일 칸의 노출 조건이 서버의 쪼개기 조건과 같은 자를 쓰게 한다.
import { STAY_ELIGIBLE_STATUSES } from '@/lib/roomStay'
import { PARENT_LEASE_STATUSES } from '@/lib/roomAssignment'

// ── 타입 ─────────────────────────────────────────────────────────

type Room = { id: string; roomNo: string; baseRent: number; scheduledRent: number | null; nonResidentRent: number | null; isVacant: boolean; nonResidentVacant: boolean; type: string | null; floor: string | null; windowType: string | null; direction: string | null; currentLeaseStatus: string | null
  occupantMoveOut: string | null     // 'YYYY-MM-DD' — 그 방을 잡은 계약(거주중·퇴실 예정·예약) 중 마지막 퇴실 예정일. 이 방이 비는 날
  occupantIsShortTerm: boolean       // 그 점유 계약이 단기인지 — 상태는 ACTIVE 라도 퇴실일이 잡혀 있다
  hasIndefiniteReservation: boolean  // 퇴실 예정일 없는 예약이 걸린 방 — 언제 비는지 몰라 차단
  vacancyExcluded: boolean           // 비거주 점유 방(창고·사무실) — 서버 가드와 같은 정본 술어(lib/vacancy)
  standaloneLeaseAllowed: boolean    // 이 방만으로 계약이 되는가 — false 면 '메인 계약'이 필수다(2026-08-13)
  // 퇴실 예정일이 잡힌 점유 계약들의 구간 — 겹침 문구가 '마지막 날짜'가 아니라 실제로 막고 선 계약을 지목하게.
  occupancies: { leaseId: string; tenantName: string; status: string; moveIn: string | null; moveOut: string }[]
  // 이 방에 잡혀 있는 입실 예약들 — 퇴실일을 뒤로 미룰 때 다음 입주자를 밟는지 묻는 데 쓴다.
  reservations: { leaseId: string; tenantName: string; moveIn: string; moveOut: string | null }[]
}

// 호실 선택 자격 — 폼 세 곳(선택 비활성·겹침 캡션·저장 확인창)이 같은 판정을 쓴다.
// 판정식이 '이번 달에 나가는가'를 묻는 isShortTermCheckoutDue(수납·호실 관리 표시용)와 다른 이유는,
// 여기서는 월 창과 무관하게 '언제 비는지 날짜가 있는가'만 필요하기 때문이다. 그래서 ACTIVE 단기도 같은 자격이다.
// 같은 날 = 겹침으로 본다. 서버는 겹침을 막지 않는다(폼 확인창 경로).
// 무기한 점유와 무기한 예약은 서버(addTenant·updateTenant)도 막는다 — 화면과 서버가 같은 규칙이다.
function roomPickability(r: Room, isCurrentRoom: boolean) {
  // 본인이 이미 들어가 있는 방이면 그 방의 예약(=본인 것)이 자기 발목을 잡지 않게 한다.
  // 퇴실 예정일이 잡힌 예약은 '언제 비는지 아는 방'이라 막지 않는다(겹치면 확인창이 묻는다).
  const blockedByReservation = r.hasIndefiniteReservation && !isCurrentRoom
  const openDate = !r.isVacant && !blockedByReservation ? r.occupantMoveOut : null
  // 비거주 점유 방(창고·사무실)은 isVacant 가 true 로 남는다 — 비거주는 공실 플래그를 안 내린다.
  // 그래서 '빈 방'만 보면 415호가 고를 수 있는 방으로 보인다. 서버 가드와 같은 술어로 함께 접는다.
  const openForNewLease = r.isVacant && !r.vacancyExcluded
  return {
    openDate,                                                  // 이 방이 비는 날('YYYY-MM-DD')
    reservable: openForNewLease || isCurrentRoom || !!openDate, // 문의·예약 확정 단계에서 고를 수 있는가
    residable:  openForNewLease || isCurrentRoom,              // 입실·퇴실 예정 단계는 지금 빈 방만(서버도 같은 선)
  }
}

// 일정 조절 세그먼트 값 — 빈 문자열이 '미확인'(DB null).
type MoveInFlexValue = '' | 'yes' | 'no'

// 희망 입주일이 그 방의 어느 계약과 겹치는가 — 겹치는 그 계약을 돌려준다(같은 날도 겹침).
//
// 종전에는 방의 '마지막 퇴실 예정일'(occupantMoveOut) 하나만 보고 그 날짜를 문구에 박았다.
// 계약이 둘 이상 이어 붙은 방에서는 실제로 앞을 막고 선 계약과 다른 날짜를 말한다 —
// 404호(조성훈 8/15~8/31 · 박정후 9/1~12/20)에 8/20 입주를 적으면 "12/20에 퇴실 예정"이라고
// 안내했다. 사실은 조성훈이 8/31까지 있다. 구간으로 물어 실제 겹치는 계약을 지목한다.
function overlapOccupancy(room: Room | undefined, moveIn: string, selfLeaseId?: string): Room['occupancies'][number] | null {
  if (!room || !moveIn) return null
  const hits = room.occupancies.filter(o => o.leaseId !== selfLeaseId && moveIn <= o.moveOut)
  if (hits.length === 0) return null
  // 희망일을 품고 있는 계약이 있으면 그것이 앞을 막고 선 계약이다. 없으면 가장 먼저 나가는 쪽.
  return hits.find(o => !o.moveIn || o.moveIn <= moveIn)
    ?? hits.reduce((m, o) => (o.moveOut < m.moveOut ? o : m), hits[0])
}

type Contact = {
  id: string; contactType: string; contactValue: string
  isEmergency: boolean; emergencyRelation: string | null; isPrimary: boolean
  isHomeCountry?: boolean; countryCode?: string | null
}

type PaymentRecord = {
  id: string; targetMonth: string; expectedAmount: number; actualAmount: number
  isPaid: boolean; payDate: string | Date; payMethod: string | null; memo: string | null
}

type PayRecord = {
  id: string; seqNo: number; payDate: Date; targetMonth: string
  actualAmount: number; payMethod: string | null; memo: string | null; isPaid: boolean
  isDeposit: boolean
  cashReceiptIssuedAt?: Date | string | null   // 발행 칩 표시(오류신고 c0936f89)
}

type LeaseTerm = {
  id: string; status: string; rentAmount: number; depositAmount: number
  cleaningFee: number; dueDay: string | null
  overrideDueDay: string | null; overrideDueDayMonth: string | null; overrideDueDayReason: string | null
  moveInDate: string | Date | null; moveOutDate: string | Date | null
  expectedMoveOut: string | Date | null; contactAlertDate?: string | Date | null; tourDate: string | Date | null; tourTime?: string | null; inquiryAt: string | Date | null
  reservationConfirmedAt: string | Date | null
  isShortTerm: boolean
  reservationDepositMode?: string | null
  paymentTiming: string
  payMethod: string | null; cashReceipt: string | null
  registrationStatus: string; contractUrl: string | null
  wishRooms: string | null; wishConditions: string | null; keepAlertAfterInquiry: boolean; visitRoute: string | null
  moveInFlexible: boolean | null   // 입주 희망일 조절 가능 여부 — null=미확인(매칭 날짜 게이트 입력)
  parentLeaseTermId: string | null // 딸려 있는 계약(2026-08-13 다호실 2단계). null=단독 계약
  room: { id: string; roomNo: string; floor: string | null } | null
  paymentRecords: PaymentRecord[]
  // 최근 CANCELLED 전이(fromStatus·사유) — 취소 단계 부제 파생용(e1b81629)
  statusLogs?: { fromStatus: string; toStatus: string; reason: string | null }[]
  // 보증금 환불 이력 건수 — 퇴실 재저장 시 환불 모달 재노출 차단용(13438ec9)
  _count?: { depositRefunds: number }
}

type Tenant = {
  id: string; name: string; englishName: string | null
  nativeName: string | null
  // 별칭과 카드 표시 이름 선택(lib/displayName). 서류 성명 표기(lib/documentName)와는 별개 축이다.
  nickname: string | null
  displayNameStyle: string | null
  email: string | null
  birthdate: string | Date | null; memo: string | null
  nationality: string | null; gender: string; job: string | null
  // 외국인등록번호 마스킹. 서버가 이 값만 내려보낸다(암호문도 평문도 브라우저에 오지 않는다).
  // 뒤 7자리는 [보기]가 revealForeignRegNo 를 부를 때만 오고, 그 열람은 기록으로 남는다.
  foreignRegNoMasked?: string | null
  isBasicRecipient: boolean; smoking: boolean; contacts: Contact[]; leaseTerms: LeaseTerm[]
}

// 이 사람의 메인 계약 — 규칙은 lib/leaseStatus 의 primaryTenantLease 정본이다(방 축 primaryRoomLease 의 전치).
// 종전의 `leaseTerms[0]` 은 서버 조회가 계약을 하나로 잘라 보내던 시절의 문법이라, 한 사람이 방을 둘
// 쓰면(509호 거주 + 601호 창고) 어느 쪽이 [0] 인지가 정렬에 달렸다. 같은 사람이 목록·카드·모달에서
// 다른 계약으로 보이는 길이다 — 방 축이 2026-06 에 갔던 그 길이라 같은 처방을 쓴다.
function mainLease(t: { leaseTerms: LeaseTerm[] } | null | undefined): LeaseTerm | undefined {
  return t ? primaryTenantLease(t.leaseTerms) : undefined
}

// 메인 계약 밖에 있는 진행 중 계약의 호실 — 목록 호실 칸의 꼬리('509호 (+601)').
//
// 술어는 프리즘 '추가 계약' 줄(TenantBasicInfo)과 문자 그대로 같은 한 벌이다. 한쪽이 세는 계약을
// 다른 쪽이 안 세면 같은 사람이 화면마다 다른 방 수를 갖는다. 취소·퇴실 계약은 죽은 계약이라 안 센다.
// 계약이 하나면 빈 문자열이고, 그 입주자의 목록 픽셀은 종전과 완전히 같다(지금 108명 중 107명).
// 꼬리에는 '호'를 안 붙인다 — 앞 칸이 이미 '509호'라 '(+601호)'는 같은 말을 두 번 하고 폭만 먹는다.
function extraRoomSuffix(t: { leaseTerms: LeaseTerm[] }, main: LeaseTerm | undefined): string {
  const live: string[] = TENANT_LIST_STATUSES
  const extras = t.leaseTerms.filter(l => l.id !== main?.id && live.includes(l.status))
  if (extras.length === 0) return ''
  return ` (+${extras.map(l => l.room?.roomNo ?? '미지정').join(', ')})`
}

/**
 * 수정 창의 폼 한 벌이 지금 손에 쥔, 아직 저장하지 않은 값 — 딸린 계약이 비추는 원천이다.
 *
 * 두 칸만 담는다. 딸린 계약이 '메인 계약과 같음'으로 따라가는 값이 입주일과 납부일 둘뿐이라서다.
 * 늘리려면 폼이 보고하는 자리(TenantForm 의 useEffect)와 읽는 자리를 함께 늘려야 한다.
 * 두 값 모두 저장 문자열 그대로다. 입주일은 'YYYY-MM-DD', 납부일은 raw('14'·'말일').
 */
type LeaseFormLiveValues = { moveInDate: string; dueDay: string }

/**
 * 이 계약에 딸린 진행 중 계약 — 메인 계약을 끝낼 때 남겨질 계약들이다(다호실 마무리 2026-08-17).
 *
 * 서버는 막지 않는다. 부모를 퇴실·취소로 보내는 것 자체는 정당한 일이고(창고만 남기고 방을 뺄 수도
 * 있다), 끊긴 부모는 감지망 축 ①(check-lease-subordination)이 사후에 센다. 화면이 할 일은
 * '자동으로 따라 정리되지는 않는다'는 사실을 그 순간에 말해 주는 것뿐이다.
 *
 * 술어는 목록 호실 꼬리·프리즘 '추가 계약' 줄과 같은 한 벌이다(죽은 계약은 안 센다).
 */
function liveSubLeases(t: { leaseTerms: LeaseTerm[] } | null | undefined, parentId: string | undefined): LeaseTerm[] {
  if (!t || !parentId) return []
  const live: string[] = TENANT_LIST_STATUSES
  return t.leaseTerms.filter(l => l.parentLeaseTermId === parentId && live.includes(l.status))
}

// 이 사람의 계약을 수정 창이 고를 순서대로 — 거주 · 예약 · 비거주를 먼저 세우고(roomLeaseRowOrder 정본)
// 층이 없는 단계(문의·투어·퇴실 완료)를 뒤에 잇는다. 하나도 빠뜨리지 않는 것이 이 함수의 일이다.
// 빠뜨리면 지금 편집 중인 계약이 세그먼트에 없는 상태가 만들어진다.
function editableLeases(t: { leaseTerms: LeaseTerm[] }): LeaseTerm[] {
  const ordered = roomLeaseRowOrder(t.leaseTerms)
  return [...ordered, ...t.leaseTerms.filter(l => !ordered.includes(l))]
}

// '메인 계약' 후보 — 같은 사람의 살아 있는 계약 중 자기 자신과 이미 다른 계약에 묶인 계약을 뺀다.
// 상태 명단은 서버 가드가 쓰는 그 상수(PARENT_LEASE_STATUSES)를 그대로 읽는다. 손으로 베끼면
// 화면이 고르게 해 준 것을 서버가 거부하거나, 화면이 못 고르는 것을 서버가 받는다.
function parentLeaseOptions(t: { leaseTerms: LeaseTerm[] }, selfLeaseId?: string): LeaseTerm[] {
  return roomLeaseRowOrder(
    t.leaseTerms.filter(l => l.id !== selfLeaseId && !l.parentLeaseTermId && PARENT_LEASE_STATUSES.includes(l.status)),
  )
}

/**
 * 수정 창의 계약 전환 — 두 수정 창(목록 경유 '수정', 프리즘 경유 '입주자 정보 수정')이 같은 한 벌을 쓴다.
 *
 * 왜 정본 하나인가. 2026-08-13 실기 신고가 정확히 그 사고였다 — '계약 추가' 문을 한쪽 창에만 달아
 * 운영자 주 동선에서는 보이지 않았다. 세그먼트를 손으로 두 벌 적으면 같은 일이 또 일어난다.
 * 계약이 하나면 아무것도 그리지 않는다(픽셀 무변동) — 지금 입주자 대부분이 그렇다.
 */
function EditLeaseSegment({ leases, value, onChange }: {
  leases: LeaseTerm[]; value: string; onChange: (id: string) => void
}) {
  if (leases.length < 2) return null
  // 같은 방에 계약이 둘인 사람(거주 + 비거주 명의 공존)은 호실만으로는 구분이 안 된다.
  // 그때만 상태를 덧붙인다 — 늘 붙이면 흔한 경우의 라벨이 길어져 좁은 화면에서 밀린다.
  const labelOf = (l: LeaseTerm) => {
    const room = fmtRoomNo(l.room?.roomNo, '호실 미지정')
    const dup = leases.filter(o => fmtRoomNo(o.room?.roomNo, '호실 미지정') === room).length > 1
    return dup ? `${room} · ${STATUS_LABEL[l.status] ?? l.status}` : room
  }
  return (
    <SegmentedControl
      ariaLabel="수정할 계약"
      size="sm"
      scroll
      value={value}
      options={leases.map(l => ({ value: l.id, label: labelOf(l) }))}
      onChange={onChange}
    />
  )
}

/**
 * 수정 창의 계약별 폼 — 세그먼트로 계약을 오가도 적다 만 입력이 그대로 남는다.
 *
 * 왜 인스턴스를 여러 벌 들고 있나. 종전에는 TenantForm 에 `key={계약id}` 를 걸어 전환할 때마다
 * 통째로 새로 마운트했다. 601호를 고치다 509호를 들렀다 돌아오면 601호 폼이 서버 값으로 되감겨
 * 손으로 적은 것이 사라졌다(운영자 실기 신고 2026-08-13). 폼 값은 TenantForm 안의 useState 와
 * uncontrolled DOM 에 흩어져 있어 밖에서 갈무리했다 되돌릴 수 있는 모양이 아니다. 그래서 값을
 * 옮기는 대신 폼 자체를 살려 둔다 — 지금 고르지 않은 계약의 폼은 숨긴다.
 *
 * 숨기는 방법이 fieldset[disabled] 인 이유. 숨은 폼도 같은 <form> 안에 있어서, 그냥 감추기만 하면
 * ① FormData 가 두 계약의 값을 함께 담아 이름이 겹치는 칸에서 엉뚱한 쪽이 저장되고
 * ② 숨은 칸의 required 가 "focus 할 수 없는 폼 컨트롤" 로 제출 자체를 막는다.
 * disabled 된 컨트롤은 제출에서도 빠지고 검증에서도 빠진다 — 두 함정을 한 속성이 같이 막는다.
 *
 * 처음 여는 계약만 마운트하고 나머지는 들른 순간 붙인다. 계약마다 보증금 구성 조회가 한 번 나가는데,
 * 열지도 않은 계약 몫까지 창을 열자마자 쏘면 왕복이 계약 수만큼 늘어난다.
 *
 * 세그먼트를 이 컴포넌트가 함께 그리는 이유는 '들른 계약'을 아는 곳이 여기 하나여야 하기 때문이다.
 * 두 수정 창이 각자 세는 순간 한쪽만 고쳐지는 그 사고(2026-08-13 '계약 추가' 문)를 또 만든다.
 *
 * 저장에 성공하면 두 수정 창 모두 창을 닫으므로(proceedAfterRentDecision) 이 컴포넌트가 통째로
 * 사라진다. 다음에 여는 창은 서버에서 새로 받은 값으로 시작한다 — 옛 입력이 남을 자리가 없다.
 */
function LeaseEditForms({ tenant, activeLeaseId, onChangeLease, rooms, error, defaultDeposit, defaultCleaningFee, contactLeadDays }: {
  tenant: Tenant; activeLeaseId: string; onChangeLease: (id: string) => void
  rooms: Room[]; error?: string
  defaultDeposit?: number | null; defaultCleaningFee?: number | null; contactLeadDays?: number
}) {
  // 들른 계약. 세그먼트를 누르는 그 자리에서만 늘어난다.
  const [visited, setVisited] = useState<string[]>([])
  // 폼들이 지금 손에 쥔(아직 저장 안 한) 값 — 계약 id 로 한 벌씩(신고 eb66b990).
  //
  // 왜 여기 모으나. 딸린 계약의 '메인 계약과 같음' 칸은 메인 계약의 **지금 화면 값**을 비춰야 한다.
  // 저장된 값만 보면 메인 폼에서 입주일을 8/20 으로 고쳐도 딸린 폼은 8/14 를 계속 보여 주고,
  // 저장하고 나서야 따라온다(서버 전파는 이미 있다 — lib/moveInDate). 화면이 저장 뒤에야
  // 진실을 말하면 운영자는 저장 전에 무엇이 될지 모른 채 저장 버튼을 누른다.
  // 폼끼리 직접 주고받지 않고 이 컴포넌트를 거치는 이유는 '들른 계약'을 아는 곳이 여기 하나이기
  // 때문이다(세그먼트를 오가도 인스턴스가 살아 있어 값이 남는다).
  const [liveValues, setLiveValues] = useState<Record<string, LeaseFormLiveValues>>({})
  const reportLive = useCallback((id: string, v: LeaseFormLiveValues) => {
    setLiveValues(prev => {
      const cur = prev[id]
      // 같은 값이면 새 객체를 만들지 않는다. 만들면 자식이 다시 그려지고 그 자식이 다시 보고한다.
      if (cur && cur.moveInDate === v.moveInDate && cur.dueDay === v.dueDay) return prev
      return { ...prev, [id]: v }
    })
  }, [])
  const leases = editableLeases(tenant)
  // 지금 고른 계약은 항상 들어간다 — 처음 여는 계약은 아직 아무 데도 안 들렀다.
  // 이 사람의 계약만 세므로 다른 입주자를 고쳤던 흔적은 저절로 빠진다.
  const shown = leases.map(l => l.id).filter(id => id === activeLeaseId || visited.includes(id))

  // 계약이 하나도 없는 입주자 — 종전대로 계약 없는 폼 한 벌(사람 칸만 고친다).
  if (shown.length === 0) {
    return <TenantForm rooms={rooms} tenant={tenant} error={error}
      defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} contactLeadDays={contactLeadDays} />
  }
  return (
    <>
      <EditLeaseSegment leases={leases} value={activeLeaseId}
        onChange={id => { setVisited(v => v.includes(id) ? v : [...v, id]); onChangeLease(id) }} />
      {/* 바깥 space-y 는 이 div 한 칸에만 걸리고, 섹션 사이 간격은 fieldset 이 제 안에서 낸다.
          형제 fieldset 사이에는 간격을 두지 않는다 — 한 번에 하나만 보이는데 Tailwind v4 의 space-y 는
          margin-bottom 이라, 숨은 쪽이 마지막 자식이면 보이는 쪽 아래에 빈 칸이 하나 더 생긴다. */}
      <div className="min-w-0">
        {shown.map(id => {
          const on = id === activeLeaseId
          return (
            <fieldset key={id} disabled={!on} hidden={!on} className="space-y-4 min-w-0">
              <TenantForm rooms={rooms} tenant={tenant} leaseId={id}
                parentLeases={parentLeaseOptions(tenant, id)}
                liveValues={liveValues} onLiveChange={reportLive}
                error={error} defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} contactLeadDays={contactLeadDays} />
            </fieldset>
          )
        })}
      </div>
    </>
  )
}

// 수납 모달의 청구·잔액 정본(서버 계산 — 할인·인상·예약 실수납 반영)
type PaySettlement = NonNullable<Awaited<ReturnType<typeof getLeaseSettlementInfo>>>

type SortKey =
  | 'roomNo' | 'name' | 'status' | 'rentAmount' | 'depositAmount'
  | 'moveInDate' | 'moveOutDate' | 'expectedMoveOut'
  | 'nationality' | 'gender' | 'stayPeriod' | 'dueDay'
type SortDir = 'asc' | 'desc'

// ── 열 정의 ─────────────────────────────────────────────────────

const COL_DEFS = [
  { key: 'englishName',   label: '영어이름', defaultOn: false, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'nationality',   label: '국적',     defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'gender',        label: '성별',     defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'job',           label: '직업',     defaultOn: false, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'contact',       label: '연락처',   defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'payMethod',     label: '결제수단', defaultOn: false, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'depositAmount', label: '보증금',   defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'rentAmount',    label: '이용료', defaultOn: true, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'dueDay',        label: '납부일',   defaultOn: true,  tabs: ['residents'] },
  { key: 'stayPeriod',    label: '거주기간', defaultOn: true,  tabs: ['residents', 'past'] },
  { key: 'status',        label: '상태',     defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'scheduledDate', label: '예정일',   defaultOn: false, tabs: ['residents'] },
  { key: 'moveOutDate',   label: '퇴실일',   defaultOn: true,  tabs: ['past'] },
  // 사유 열 — 저장은 되는데 볼 곳이 없다는 신고(ad517231). 각 탭에서 뜻이 서는 쪽만 켠다.
  { key: 'checkoutReason', label: '퇴실사유', defaultOn: true,  tabs: ['past'] },
  { key: 'cancelReason',   label: '취소사유', defaultOn: true,  tabs: ['dropped'] },
] as const
type ColKey = (typeof COL_DEFS)[number]['key']

const COL_VIS_KEY    = 'stayeum_tenant_col_vis'
const COL_WIDTHS_KEY = 'stayeum_tenant_col_widths'

const DEFAULT_WIDTHS: Record<string, number> = {
  roomNo: 72, name: 140,
  englishName: 120, nationality: 80, gender: 60, job: 100,
  contact: 130, payMethod: 90, depositAmount: 90, rentAmount: 100,
  dueDay: 90, stayPeriod: 90, status: 120, scheduledDate: 80, moveOutDate: 130,
  checkoutReason: 140, cancelReason: 140,
}

function loadColWidths(): Record<string, number> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ── 상수 ─────────────────────────────────────────────────────────

// 예약 입주 임박 보조 문구 — today(서버 KST)로 계산해 하이드레이션 안전(#418).
function reservedMoveInSub(moveInDate: string | Date | null | undefined, today?: string): string | undefined {
  const dd = fmtDDay(moveInDate, today)   // '3일 후' | '오늘' | 'n일 초과' | null
  if (!dd) return undefined
  return dd === '오늘' ? '오늘 입주' : dd.endsWith('초과') ? `입주 예정일 ${dd}` : `${dd} 입주`
}

// 상태 칩 — 예외 상태는 StatusBadge, 정상 상태는 조용한 텍스트 (상세·표 컨텍스트용).
// 예약은 확정 여부를 라벨로 구분('입실 예약'/'예약 확정') — 호실 관리(RoomsClient) 정본과 동일 문법.
// 투어일 없는 WAITING_TOUR는 '문의'로 파생 표시(e1b81629 용어 재정의 — enum 신설 없음).
// 별도 success 칩(완납 색과 충돌)을 쓰지 않는다(디자인 패널 2026-07-15).
function StatusChip({ status, confirmed, moveInDate, today, hasTourDate, quietSub }: {
  status: string; confirmed?: boolean; moveInDate?: string | Date | null; today?: string; hasTourDate?: boolean; quietSub?: string
}) {
  if (status === 'RESERVED') {
    return <StatusBadge tone="movein" sub={reservedMoveInSub(moveInDate, today)}>{confirmed ? '예약 확정' : '입실 예약'}</StatusBadge>
  }
  const ex = statusException(status, { hasTourDate })
  if (ex) return <StatusBadge tone={ex.tone}>{ex.label}</StatusBadge>
  return (
    <span className="text-xs font-medium text-[var(--warm-mid)]">
      {STATUS_LABEL[status] ?? status}
      {quietSub && <span className="font-normal text-[var(--warm-muted)]"> · {quietSub}</span>}
    </span>
  )
}

// 취소 단계 부제 — 어느 단계에서 이탈했는지 이력(fromStatus)으로 파생 + 기록된 사유(e1b81629).
// 이력이 없으면(구 데이터·생성 직후 취소) 부제 없음.
// 종료 상태 — 사유를 보여줄 자격이 있는 상태. 표와 카드가 같은 목록을 본다.
const ENDED_STATUSES = ['CANCELLED', 'CHECKED_OUT']

// 이 계약의 종료 사유(입실 취소 또는 퇴실). 표·카드 캡션이 같은 값을 쓴다.
// 사유가 적힌 최신 한 건을 고른다 — 퇴실 예정에서 적었든 퇴실 확정에서 적었든 같은 값으로 잡힌다.
function endReasonText(lease: LeaseTerm | undefined): string | undefined {
  return lease?.statusLogs?.find(l => l.reason)?.reason ?? undefined
}

// 취소 단계만 — 사유는 길이가 무제한이라 칩에 넣지 않는다(§20 1순위는 짧은 값 자리).
// 종전에는 단계와 사유를 한 문자열로 붙여 120px 상태 열 안에서 다섯 줄로 접히고 잘렸다.
function cancelStageText(lease: LeaseTerm | undefined): string | undefined {
  const log = lease?.statusLogs?.find(l => l.toStatus === 'CANCELLED')
  if (!log) return undefined
  const stage =
    log.fromStatus === 'RESERVED'     ? '예약 취소'
    : log.fromStatus === 'TOUR_DONE'  ? '투어 후 취소'
    : log.fromStatus === 'WAITING_TOUR' ? (lease?.tourDate ? '투어 전 취소' : '문의 취소')
    : ['ACTIVE', 'CHECKOUT_PENDING'].includes(log.fromStatus) ? '거주 중 취소'
    : undefined
  return stage
}

// 카드 표시 항목 — 이용자가 켜고 끌 수 있는 필드 (호실·이름·상태는 항상 표시)
const TENANT_CARD_FIELDS: FieldDef[] = [
  { key: 'contact', label: '연락처' },
  { key: 'payment', label: '이용료·납부일' },
  { key: 'deposit', label: '보증금·거주기간' },
]
const REG_LABEL: Record<string, string> = {
  NOT_REPORTED: '미신고', REGISTERED: '완료', EXEMPTED: '해당없음',
}
const GENDER_LABEL: Record<string, string> = {
  MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '—',
}
const PT_LABEL: Record<string, string> = { PREPAID: '선납', POSTPAID: '후납' }

// v2.0 §23 — 탭+하위 2단계를 한 줄로 평탄화한 단일 상태 필터(생애주기 전 상태)
// '거주중(living)' = ACTIVE+CHECKOUT_PENDING — 퇴실 예정도 아직 사는 사람이라 거주중에 포함(기본값).
// 'inquiry' = 아직 방이 안 정해진 사람(문의~입실 예약) — 구 '예약'/'투어' 분리 세그먼트 통합(e1b81629).
// 'confirmed'(입실 예정) = 방·날짜가 잡힌 예약 확정 — 2026-08-12 최상위 그룹으로 분리(운영자 확정).
//   문의 퍼널 맨 끝에 묻혀 있었는데, 확정자는 더 이상 '설득할 사람'이 아니라 '맞이할 사람'이라
//   퇴실 예정과 짝을 이루는 운영 축이다. 그래서 자리도 퇴실 예정 바로 옆이다.
// 하위 단계는 2차 sm 세그먼트(InquiryStage)로 구분 — 요청관리 2단 필터 정본 문법.
type StatusFilter = 'living' | 'CHECKOUT_PENDING' | 'confirmed' | 'NON_RESIDENT' | 'inquiry' | 'CANCELLED' | 'past' | 'all'
type InquiryStage = '' | 'INQUIRY' | 'TOUR' | 'RESERVED'

// 문의 퍼널 단계 파생 — 칩 라벨과 동일 규칙(문의 = WAITING_TOUR·투어일 없음).
// 투어 = 투어 예정(WAITING_TOUR+투어일) + 투어 완료(TOUR_DONE).
// 예약 확정은 null 이다 — 이제 별도 그룹('입실 예정')이라 문의 퍼널의 단계가 아니다.
// 여기서 갈라 두면 단계 카운트·단계 필터가 저절로 확정자를 빼고, 부르는 쪽마다 조건을 또 적지 않아도 된다.
function inquiryStageOf(lease: { status: string; tourDate?: string | Date | null; reservationConfirmedAt?: string | Date | null } | undefined): Exclude<InquiryStage, ''> | null {
  if (!lease) return null
  if (lease.status === 'RESERVED')     return lease.reservationConfirmedAt ? null : 'RESERVED'
  if (lease.status === 'TOUR_DONE')    return 'TOUR'
  if (lease.status === 'WAITING_TOUR') return lease.tourDate ? 'TOUR' : 'INQUIRY'
  return null
}

/** 예약 확정 — '입실 예정' 그룹의 유일한 판정. 그룹·카운트·정렬이 같은 함수를 본다. */
function isConfirmedReservation(lease: { status: string; reservationConfirmedAt?: string | Date | null } | undefined): boolean {
  return lease?.status === 'RESERVED' && !!lease.reservationConfirmedAt
}

// ── 헬퍼 ─────────────────────────────────────────────────────────

function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return ''
  return kstYmdStr(new Date(d))
}

// 'YYYY-MM-DD' → DatePicker 트리거가 보여 주는 그 문자열('2026년 8월 14일').
// 잠긴 날짜 칸(메인 계약과 같음)이 이 표기를 쓴다 — '따로 정하기'를 눌러 달력으로 바뀌는 순간
// 글자가 달라지면 값이 바뀐 것처럼 보인다. 표기 규칙을 DatePicker 와 한 벌로 묶어 둔다.
function fmtDateTrigger(ymd: string): string {
  if (!ymd) return ''
  return new Date(ymd + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
}

// 'HH:mm' → '오후 6:40' (안내 문구용 12시간 표기)
function fmtHM12(hm: string): string {
  const [h, m] = hm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hm
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`
}

// 일시값을 날짜('YYYY-MM-DD') + 시각('HH:mm')으로 분리 — 시각도 KST 정본(로컬 게터 금지).
function splitDateTime(d: string | Date | null | undefined): { date: string; time: string } {
  const { ymd, hm } = splitKstDateTime(d)
  return { date: ymd, time: hm }
}

function fmtShortDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`
}

function fmtDueDay(dueDay: string | null | undefined): string {
  if (!dueDay) return '—'
  const n = parseInt(dueDay, 10)
  if (!isNaN(n)) return n >= 30 ? '매월 말일' : `매월 ${n}일`
  if (dueDay.includes('말')) return '매월 말일'
  return `매월 ${dueDay}일`
}

// 거주기간 표시 — lib/stayPeriod 정본(달력 기준 만 개월, 신고 f9803357) 위임
function calcStayPeriod(
  moveInDate: string | Date | null | undefined,
  endDate?: string | Date | null,
  today?: string,            // 'YYYY-MM-DD'(서버 KST 기준) — SSR/클라 동일값으로 하이드레이션 불일치(#418) 방지
): string {
  return fmtStayPeriod(moveInDate, endDate, today)
}

function fmtDDay(date: string | Date | null | undefined, today?: string): string | null {
  if (!date) return null
  // 날짜(YYYY-MM-DD)만으로 일수 차 — Date.UTC 로 계산해 서버(UTC)/클라(KST) 동일 결과(하이드레이션 #418 방지).
  // setHours/getTime 방식은 TZ에 따라 '오늘'이 달라져 D-day 텍스트가 서버≠클라가 됨.
  const ymd = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
  const todayStr = today ?? ymd(new Date())
  const [ay, am, ad] = todayStr.split('-').map(Number)
  const [by, bm, bd] = ymd(date).split('-').map(Number)
  const days = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
  if (days < 0) return `${Math.abs(days)}일 초과`
  if (days === 0) return '오늘'
  return `${days}일 후`
}

function getScheduledDate(lease: LeaseTerm | undefined): { date: string | Date | null; label: string } | null {
  if (!lease) return null
  if (lease.status === 'WAITING_TOUR' && lease.tourDate)
    return { date: lease.tourDate, label: lease.tourTime ? `투어 ${lease.tourTime}` : '투어' }
  if (['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'].includes(lease.status) && lease.moveInDate)
    return { date: lease.moveInDate, label: '입주희망' }
  if ((lease.status === 'CHECKOUT_PENDING' || lease.status === 'ACTIVE') && lease.expectedMoveOut)
    return { date: lease.expectedMoveOut, label: '퇴실' }
  return null
}

function getSortValue(t: Tenant, key: SortKey): string | number {
  const l = mainLease(t)
  switch (key) {
    case 'roomNo':          return l?.room?.roomNo ?? ''
    // 이름순은 화면에 선 이름으로 센다 — 별칭이 적힌 사람을 한글 이름 자리에 세우면 정렬이 어긋나 보인다.
    case 'name':            return displayName(t, t.displayNameStyle)
    case 'status':          return l?.status ?? ''
    case 'rentAmount':      return l?.rentAmount ?? 0
    case 'depositAmount':   return l?.depositAmount ?? 0
    case 'moveInDate':      return l?.moveInDate ? new Date(l.moveInDate).getTime() : 0
    case 'moveOutDate':     return l?.moveOutDate ? new Date(l.moveOutDate).getTime() : 0
    case 'expectedMoveOut': return l?.expectedMoveOut ? new Date(l.expectedMoveOut).getTime() : Infinity
    case 'nationality':     return t.nationality ?? ''
    case 'gender':          return GENDER_LABEL[t.gender] ?? ''
    case 'stayPeriod':      return l?.moveInDate ? new Date(l.moveInDate).getTime() : Infinity
    case 'dueDay': {
      const d = l?.dueDay
      if (!d) return 0
      if (d.includes('말')) return 32
      const n = parseInt(d, 10)
      return n >= 30 ? 32 : (isNaN(n) ? 0 : n)
    }
    default: return ''
  }
}

function loadColVis(): Record<ColKey, boolean> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(COL_VIS_KEY)
    return raw ? (JSON.parse(raw) as Record<ColKey, boolean>) : null
  } catch { return null }
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────

export default function TenantClient({
  initialTenants, rooms, targetMonth, today, defaultDeposit, defaultCleaningFee, contactLeadDays = 14, propertyReservationDepositMode = null, myRole, shortStayUnitDays = 7,
  shortStayReservationMode = null, shortStayDeposit = 0,
  wishDateNoticeLeaseIds = [],
}: {
  initialTenants: Tenant[]
  rooms: Room[]
  targetMonth: string
  today: string              // 'YYYY-MM-DD' 서버 KST 기준 — 거주기간·D-day 가 SSR/클라 동일하게(하이드레이션 안전)
  defaultDeposit: number | null
  contactLeadDays?: number
  defaultCleaningFee: number | null
  propertyReservationDepositMode?: string | null   // 영업장 예약금 기본 모드 — 예약자 라벨/폼 기본값
  myRole: string
  shortStayUnitDays?: number   // 단기 계약 단위 일수(영업장 정책) — 카드 '(N주)' 표기용
  // 단기 정책의 예약금 처리 — 단기 계약에서 영업장 공통 기본값보다 앞선다(null=미설정, 현행 해석)
  shortStayReservationMode?: ShortStayReservationMode | null
  // 단기 정책 예약금 시드(원) — 분해 수납 폼의 금액 프리필. 0(미설정)이면 종전 기본값으로 떨어진다.
  shortStayDeposit?: number
  // 희망한 방이 전부 입주 희망일에서 빠진 계약 — 홈 알림의 '제외 N명'과 같은 판정(lib/wishMatch)
  wishDateNoticeLeaseIds?: string[]
}) {
  const canEdit = myRole === 'OWNER' || myRole === 'MANAGER'
  const wishDateNoticeSet = useMemo(() => new Set(wishDateNoticeLeaseIds), [wishDateNoticeLeaseIds])
  const hideMoney = !useCanReadScope('money')   // 제한 스태프 — 금액 컬럼·필드·정렬·필터를 집합에서 제외
  // 카드 표시 항목 — 금액 차단 시 '이용료·납부일' 제거, '보증금·거주기간'은 거주기간만
  const tenantCardFields: FieldDef[] = hideMoney
    ? [{ key: 'contact', label: '연락처' }, { key: 'deposit', label: '거주기간' }]
    : TENANT_CARD_FIELDS
  const router = useRouter()
  const searchParams = useSearchParams()
  const entityModal = useEntityModal()

  // 퇴실자 클릭 시 Prism의 month를 퇴실월로 자동 세팅 (수납 내역이 그 월 안에 있어야 보임).
  // 일반 입주자는 현재 month 유지.
  const openTenantPrism = (tenant: Tenant) => {
    const lease = mainLease(tenant)
    if (lease && ['CHECKED_OUT', 'CANCELLED'].includes(lease.status) && lease.moveOutDate) {
      const d = new Date(lease.moveOutDate)
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (searchParams.get('month') !== month) {
        const params = new URLSearchParams(searchParams.toString())
        params.set('month', month)
        router.replace(`?${params.toString()}`, { scroll: false })
      }
    }
    entityModal.open({
      kind: 'tenant',
      tenantId: tenant.id,
      leaseTermId: lease?.id ?? undefined,
      roomId: lease?.room?.id ?? undefined,
    })
  }

  const initColVis = Object.fromEntries(
    COL_DEFS.map(c => [c.key, c.defaultOn])
  ) as Record<ColKey, boolean>

  const [showAdd, setShowAdd]             = useState(false)
  const [showNoticeSms, setShowNoticeSms] = useState(false)   // 단체 공지 문자 (R4)
  // v2.0 §12 — 폼 모달 입력 보호(dirty). 입력 시작 후 배경클릭 무시, Esc/X 확인(Modal 내장).
  const [addTenantDirty, setAddTenantDirty] = useState(false)
  const [editTenantDirty, setEditTenantDirty] = useState(false)
  const [detailEditDirty, setDetailEditDirty] = useState(false)
  const [selectMode, setSelectMode]       = useState(false)
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [showBatchEdit, setShowBatchEdit] = useState(false)
  const toggleSelectTenant = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }
  const press = useLongPress()      // 데스크톱 행 꾹 눌러 선택 진입 (v2.0 §23 공통 제스처, 카드는 RoomCard 내장)
  const [editTenant, setEditTenant]       = useState<Tenant | null>(null)
  // 계약 추가 — 있는 입주자에게 계약만 하나 더(창고·사무실 명의 등). 사람 칸은 안 그리고 안 보낸다.
  const [addLeaseTenant, setAddLeaseTenant] = useState<Tenant | null>(null)
  const [addLeaseDirty, setAddLeaseDirty]   = useState(false)
  const [detailTenant, setDetailTenant]   = useState<Tenant | null>(null)
  const [detailEditMode, setDetailEditMode] = useState(false)
  // 두 수정 창이 지금 편집 중인 계약. 값이 그 사람의 계약이 아니면(창을 닫고 다른 사람을 열었을 때)
  // 조용히 메인 계약으로 되돌아간다 — 그래서 창을 닫을 때마다 손으로 초기화할 자리가 없다.
  const [editLeaseId, setEditLeaseId]     = useState<string | null>(null)
  const [detailEditLeaseId, setDetailEditLeaseId] = useState<string | null>(null)
  const [roomDetailId, setRoomDetailId]   = useState<string | null>(null)
  const [error, setError]               = useState('')
  const [depositRefundModal, setDepositRefundModal] = useState<{ fd: FormData; tenantName: string; depositAmount: number; cleaningFee: number; fromDetail: boolean; leaseTermId: string; tenantId: string; compositionLabel: string | null } | null>(null)
  const [depositReturnAmt, setDepositReturnAmt] = useState(0)
  const [depositRefundDirty, setDepositRefundDirty] = useState(false)   // 환불 창 dirty — 금액·날짜를 만졌을 때만 닫기 확인(§12)
  // 이용료 환불(통합 환불 창, 운영자 승인 2026-07-20) — 계산은 서버 미리보기, 최종 금액은 운영자 확정
  const [rentRefundPreview, setRentRefundPreview] = useState<{ prepaidAmount: number; refund: CheckoutRefundResult; defaultPenaltyPct: number; appliedProration: number | null } | null>(null)
  const [rentRefundAmt, setRentRefundAmt] = useState(0)
  const [rentPenaltyPctInput, setRentPenaltyPctInput] = useState('')   // 빈 값 = 영업장 기본 위약금율
  const [rentMoveOutYmd, setRentMoveOutYmd] = useState('')
  const [depositReturnDate, setDepositReturnDate] = useState(() => kstYmdStr())
  const [rentChangeModal, setRentChangeModal] = useState<{ fd: FormData; fromDetail: boolean; roomNo: string; baseRent: number; scheduledRent: number } | null>(null)
  // 단일 상태 필터(탭+하위 평탄화). 선택값 → 생애주기 범주(cat)로 표 열·정렬 구성
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('living')   // 기본 = 거주중(퇴실예정 포함)
  // 문의·예약 그룹 내 단계 필터 — 그룹 세그먼트 선택 시에만 노출, 그룹 이탈 시 초기화
  const [inquiryStage, setInquiryStage] = useState<InquiryStage>('')
  const changeStatusFilter = (v: StatusFilter) => { setStatusFilter(v); setInquiryStage('') }
  // 입실 예정은 아직 안 들어온 사람이라 표 열 구성이 문의·예약과 같다(입주희망일·문의일 등).
  // 열 집합을 새로 만들지 않는다 — 같은 성격의 그룹이 서로 다른 표를 그리면 그게 이질감이다.
  const cat: 'residents' | 'inquiry' | 'dropped' | 'past' =
    statusFilter === 'inquiry' || statusFilter === 'confirmed' ? 'inquiry'
    : statusFilter === 'CANCELLED' ? 'dropped'
    : statusFilter === 'past' ? 'past'
    : 'residents'
  const [floorFilter, setFloorFilter]   = useState('')
  const [showFilters, setShowFilters]   = useState(false)   // 검색창 옆 필터 토글(정본 §23 호실관리 패턴)
  // 필터 패널 조건들 — 순수 표시 필터(서버 로직 불변). 탭별 유효성은 아래 게이팅 상수가 단일 판정.
  const [natFilter, setNatFilter]           = useState('')
  const [genderFilter, setGenderFilter]     = useState('')
  const [dueDayFilter, setDueDayFilter]     = useState<'' | DueDayBucket>('')
  const [stayFilter, setStayFilter]         = useState('')   // lt1 | m1_6 | m6_12 | y1_2 | y2p
  const [rentMinFilter, setRentMinFilter]   = useState<number | undefined>(undefined)
  const [rentMaxFilter, setRentMaxFilter]   = useState<number | undefined>(undefined)
  const [search, setSearch]             = useUrlState('q', '')
  const [sortKey, setSortKey]           = useState<SortKey>('roomNo')
  const [sortDir, setSortDir]           = useState<SortDir>('asc')
  const [cardFields, toggleCardField]   = useDisplayFields('tenants.cardFields', TENANT_CARD_FIELDS)
  const [colVis, setColVis]             = useState<Record<ColKey, boolean>>(initColVis)
  const [isPending, startTransition]    = useTransition()
  const [colWidths, setColWidths]       = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const colWidthsRef                    = useRef<Record<string, number>>(DEFAULT_WIDTHS)

  // 수납 모달
  const [payTarget, setPayTarget]   = useState<{ tenant: Tenant; lease: LeaseTerm } | null>(null)
  const [payHistory, setPayHistory] = useState<PayRecord[]>([])
  // 목록 표시 전용 3개월 창 — 낸 달과 귀속월이 갈리는 건을 한 화면에서 본다(신고 2c6de978).
  // **금액 계산에는 절대 쓰지 않는다.** 총 수납·이월은 payHistory(조회월) 기준을 유지한다.
  const [payWindow, setPayWindow] = useState<PayRecord[]>([])
  // 미환불 사유 — 주 퇴실 경로다. 여기가 빠지면 같은 퇴실이 어느 버튼을 눌렀는지에 따라 다른 장부가 된다.
  const [depoWithholdReason, setDepoWithholdReason] = useState('')
  // 입실 때 받은 청소비 — 0 초과면 퇴실 공제를 하지 않는다(계약서 §2-4 either/or)
  const [depoCleaningPaid, setDepoCleaningPaid] = useState(0)
  const [depoWithholdEtc, setDepoWithholdEtc] = useState('')
  const [distNotice, setDistNotice] = useState<string | null>(null)   // 자동 분배 요약 — 모달 내 지속 표시
  const [payAcquisitionDate, setPayAcquisitionDate] = useState<Date | null>(null)
  // 수납 모달 청구·잔액 정본 — 클라 재계산(할인·인상 미반영) 대신 서버 settlement 사용(신고 50a2a69b)
  const [paySettlement, setPaySettlement] = useState<PaySettlement | null>(null)
  const [showPayForm, setShowPayForm] = useState(false)
  const [payAmount, setPayAmount]   = useState(0)
  const [payDateVal, setPayDateVal] = useState(kstYmdStr())
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overrideDateInput, setOverrideDateInput] = useState('')
  const [confirmClearOverride, setConfirmClearOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [editingPayId, setEditingPayId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editMemo, setEditMemo] = useState('')

  // localStorage에서 열 설정 불러오기
  useEffect(() => {
    const saved = loadColVis()
    if (saved) setColVis(prev => ({ ...prev, ...saved }))
    const savedW = loadColWidths()
    if (savedW) {
      const merged = { ...DEFAULT_WIDTHS, ...savedW }
      setColWidths(merged)
      colWidthsRef.current = merged
    }
  }, [])

  // colWidths 변경 시 ref 동기화
  useEffect(() => { colWidthsRef.current = colWidths }, [colWidths])

  // URL 파라미터 — /tenants?tenantId=xxx → 셸 열기, &edit=1 → 자체 편집 폼(페이지 종속) 열기.
  // Phase 2.3c (2026-05-30): 상세 팝업은 전역 Prism 셸로 마이그레이션. 편집 폼만 페이지에 잔존.
  //
  // deps 는 아래 edit 훅과 같다. mount 1회(deps=[])로 두면 **이미 /tenants 에 있는 상태**에서 종 알림이
  // /tenants?tenantId=X 를 push 해도 URL 만 바뀌고 셸이 안 열린다 — 2026-05-31 에 같은 결함을 적어 두고
  // edit 쪽만 고친 자리다(종 8종 중 6종이 이 경로라 같은 화면에서 누르면 전부 무반응이었다).
  //
  // openedTenantRef: **같은 대상은 한 번만 연다.** 검색어(?q=)·조회월(?month=) 변경이나 refresh 로
  // effect 가 다시 돌 때마다 셸이 재오픈되면 안에서 옮겨 둔 면(수납·호실)이 초기화된다.
  // tenantId 가 URL 에서 사라지면(clearTenantUrlParams) ref 를 비워 다음 알림 클릭을 다시 받는다 —
  // 파라미터 정리는 tenantId 를 지우므로 여기서 재오픈으로 되돌아오는 고리가 생기지 않는다.
  // edit=1 은 아래 훅 담당 — 여기서 같이 처리하면 한 요청에 셸과 편집 폼이 둘 다 뜬다.
  const openedTenantRef = useRef<string | null>(null)
  useEffect(() => {
    const tenantId = searchParams.get('tenantId')
    if (!tenantId) { openedTenantRef.current = null; return }
    if (searchParams.get('edit') === '1') return
    if (openedTenantRef.current === tenantId) return
    const found = initialTenants.find(t => t.id === tenantId)
    if (!found) return
    openedTenantRef.current = tenantId
    entityModal.open({
      kind: 'tenant',
      tenantId: found.id,
      leaseTermId: mainLease(found)?.id ?? undefined,
      roomId: mainLease(found)?.room?.id ?? undefined,
    })
  }, [searchParams, initialTenants]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?edit=1 변화 감지 — Prism [수정] 버튼 클릭 시 호출됨.
  // ⚠️ 한 edit 요청(tenantId+edit=1)당 폼을 '한 번만' 연다(handledEditRef). 안 그러면 저장 후
  //   detailEditMode 가 false 로 바뀌는 순간 useEffect 가 재실행돼(아직 URL 에 edit=1 잔존) 폼을
  //   옛 데이터로 다시 여는 레이스 발생 → 깜빡임·2중 팝업·수정 전 내용 표시 (2026-06-05 사용자 보고).
  //   edit 가 사라지면 ref 를 리셋해 다음 [수정] 요청은 정상 처리.
  const handledEditRef = useRef<string | null>(null)
  useEffect(() => {
    const tenantId = searchParams.get('tenantId')
    const edit = searchParams.get('edit')
    if (edit !== '1' || !tenantId) { handledEditRef.current = null; return }
    if (handledEditRef.current === tenantId) return
    const found = initialTenants.find(t => t.id === tenantId)
    if (!found) return
    handledEditRef.current = tenantId
    setDetailTenant(found); setDetailEditMode(true)
  }, [searchParams, initialTenants])

  // 열 설정 변경 시 저장
  const updateColVis = (key: ColKey, val: boolean) => {
    const next = { ...colVis, [key]: val }
    setColVis(next)
    localStorage.setItem(COL_VIS_KEY, JSON.stringify(next))
  }

  const startResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidthsRef.current[col] ?? 100

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(50, startW + ev.clientX - startX)
      setColWidths(prev => ({ ...prev, [col]: newW }))
    }
    const onUp = () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidthsRef.current))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // 제한 스태프는 금액 컬럼 자체를 집합에서 제외(마스킹 아님 — 흔적 없이 제거)
  const MONEY_COLS: readonly string[] = ['depositAmount', 'rentAmount']
  const visibleCols = COL_DEFS.filter(
    c => (c.tabs as readonly string[]).includes(cat) && colVis[c.key] && !(hideMoney && MONEY_COLS.includes(c.key))
  )

  // ── 필터 ────────────────────────────────────────────────────────

  // 패널 필터 게이팅 — 납부일·거주기간은 해당 탭에서만 유효. 렌더·적용·계수·리셋이 이 판정을 공유(유령 필터 방지).
  const dueDayFilterValid = cat === 'residents'
  const stayFilterValid   = cat === 'residents' || cat === 'past'
  // 옵션은 전체 집합 기준 파생(하드코딩 금지 — 존재하는 값만)
  const natOptions    = [...new Set(initialTenants.map(t => t.nationality).filter((v): v is string => !!v))].sort()
  const genderOptions = [...new Set(initialTenants.map(t => t.gender).filter(Boolean))]
  // 거주기간(개월) — 표시 로직(calcStayPeriod)과 동일식·동일 종점(moveOutDate ?? today, SSR 안전)
  const stayMonthsOf = (t: Tenant): number | null => {
    const l = mainLease(t)
    if (!l?.moveInDate) return null
    const start = new Date(l.moveInDate)
    const end   = l.moveOutDate ? new Date(l.moveOutDate) : new Date(today)
    return calendarMonthsBetween(start, end)
  }
  const matchStayBucket = (m: number): boolean =>
    stayFilter === 'lt1'   ? m < 1 :
    stayFilter === 'm1_6'  ? m >= 1 && m < 6 :
    stayFilter === 'm6_12' ? m >= 6 && m < 12 :
    stayFilter === 'y1_2'  ? m >= 12 && m < 24 :
    stayFilter === 'y2p'   ? m >= 24 : true
  const activeFilterCount =
    (floorFilter ? 1 : 0) + (natFilter ? 1 : 0) + (genderFilter ? 1 : 0) +
    (dueDayFilterValid && dueDayFilter ? 1 : 0) +
    (stayFilterValid && stayFilter ? 1 : 0) +
    (rentMinFilter != null || rentMaxFilter != null ? 1 : 0)
  const resetFilters = () => {
    setFloorFilter(''); setNatFilter(''); setGenderFilter(''); setDueDayFilter(''); setStayFilter('')
    setRentMinFilter(undefined); setRentMaxFilter(undefined)
  }

  const filtered = initialTenants.filter(t => {
    const status = mainLease(t)?.status ?? ''

    // 단일 상태 필터 — 생애주기 전 상태를 한 줄로 평탄화
    const isResident = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(status)
    // 리드 3상태는 매칭 정본(lib/wishMatch)이 날짜 게이트를 거는 그 집합이다. 문자열을 여기 또 적으면
    // 그룹에는 보이는데 매칭에는 안 잡히는(또는 그 반대) 사람이 생긴다 — 정의를 한 곳에 잠근다.
    const isLead     = (WISH_LEAD_STATUSES as readonly string[]).includes(status)
    const isConfirmed = isConfirmedReservation(mainLease(t))
    const isInquiry  = isLead && !isConfirmed   // 확정자는 '입실 예정'으로 빠져나갔다
    const isDropped  = status === 'CANCELLED'
    // 퇴실 판정은 isInquiry 가 아니라 isLead 로 본다 — 확정자를 뺀 집합으로 빼면 확정자가 퇴실로 굴러떨어진다.
    const isPast     = !isResident && !isLead && !isDropped   // 퇴실·종료
    const matchStatus =
      statusFilter === 'all'       ? true :
      statusFilter === 'living'    ? ['ACTIVE', 'CHECKOUT_PENDING'].includes(status) :   // 거주중 = 거주중+퇴실예정
      statusFilter === 'confirmed' ? isConfirmed :
      statusFilter === 'inquiry'   ? isInquiry && (!inquiryStage || inquiryStageOf(mainLease(t)) === inquiryStage) :
      statusFilter === 'past'      ? isPast :
      status === statusFilter      // CHECKOUT_PENDING/NON_RESIDENT/CANCELLED
    if (!matchStatus) return false

    // 층 필터
    if (floorFilter && getTenantFloor(t) !== floorFilter) return false

    // 패널 필터 — 매칭 불가 값(계약·입주일 없음 등)은 필터 설정 시 제외(정본 면적 필터와 동일 규칙)
    if (natFilter && t.nationality !== natFilter) return false
    if (genderFilter && t.gender !== genderFilter) return false
    if (dueDayFilterValid && dueDayFilter) {
      // 날짜형(일회성 지정)은 월 컨텍스트가 없어 제외 — 정기 납부일만 매칭
      if (dueDayBucketOf(mainLease(t)?.dueDay) !== dueDayFilter) return false
    }
    if (stayFilterValid && stayFilter) {
      const m = stayMonthsOf(t)
      if (m == null || !matchStayBucket(m)) return false
    }
    if (rentMinFilter != null || rentMaxFilter != null) {
      const rent = mainLease(t)?.rentAmount
      if (rent == null) return false
      if (rentMinFilter != null && rent < rentMinFilter) return false
      if (rentMaxFilter != null && rent > rentMaxFilter) return false
    }

    // 검색
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const qDigits = q.replace(/[^0-9]/g, '')   // 전화번호 검색 — 하이픈·공백 무관 숫자 비교
    return (
      t.name.toLowerCase().includes(q) ||
      (t.englishName?.toLowerCase().includes(q) ?? false) ||
      // 별칭도 잡는다 — 카드·표에 별칭이 서 있는 사람은 그 말이 그 사람의 이름이다.
      // 보이는 이름으로 검색이 안 되면 목록에서 찾을 길이 없다.
      (t.nickname?.toLowerCase().includes(q) ?? false) ||
      (mainLease(t)?.room?.roomNo ?? '').includes(q) ||
      // 상태 검색은 화면에 보이는 파생 라벨 기준('문의'·'예약 확정' 포함) — 칩 표시와 동일 규칙
      ((status === 'RESERVED'
        ? (mainLease(t)?.reservationConfirmedAt ? '예약 확정' : '입실 예약')
        : statusException(status, { hasTourDate: !!mainLease(t)?.tourDate })?.label ?? STATUS_LABEL[status] ?? ''
      ).includes(q)) ||
      (t.nationality?.toLowerCase().includes(q) ?? false) ||
      (t.job?.toLowerCase().includes(q) ?? false) ||
      (qDigits.length >= 2 && t.contacts.some(c => c.contactValue.replace(/[^0-9]/g, '').includes(qDigits)))
    )
  })

  // inquiryAt 보조 정렬 (오래된 순 = 오래 기다린 순). 없으면 createdAt fallback. asc 고정.
  const inquiryTime = (t: Tenant): number => {
    const l = mainLease(t)
    const inq = l?.inquiryAt
    if (inq) return new Date(inq).getTime()
    const c = (l as any)?.createdAt
    return c ? new Date(c).getTime() : Infinity
  }
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1

    // 입실 예정 그룹은 입주 임박순 고정 — 이 그룹의 질문은 하나뿐이다("다음에 누가 들어오나").
    // 동률(같은 날 입주)은 문의 오래된 순 — 다른 그룹의 동률 규칙과 같다.
    if (statusFilter === 'confirmed') {
      const moveIn = (t: Tenant) => { const d = mainLease(t)?.moveInDate; return d ? new Date(d).getTime() : Infinity }
      const ma = moveIn(a), mb = moveIn(b)
      if (ma !== mb) return ma - mb
      return inquiryTime(a) - inquiryTime(b)
    }

    // 퇴실 예정도 같은 이유로 날짜 고정 — 이 그룹의 질문은 "다음에 누가 나가나"뿐인데
    // 종전에는 호실순이라 9/30 가 8/15 위에 섰다. 입실 예정과 대칭이다(카드에 보이는 그 날짜로 센다).
    if (statusFilter === 'CHECKOUT_PENDING') {
      const out = (t: Tenant) => {
        const l = mainLease(t)
        const d = l?.expectedMoveOut ?? l?.moveOutDate
        return d ? new Date(d).getTime() : Infinity   // 날짜 없는 건은 맨 뒤 — 없는 날짜를 짓지 않는다
      }
      const oa = out(a), ob = out(b)
      if (oa !== ob) return oa - ob
      return inquiryTime(a) - inquiryTime(b)
    }

    // 문의·예약 그룹은 퍼널 역순(입주 임박순) 고정 — 입실 예약 → 투어 → 문의(e1b81629).
    // 확정 단계는 2026-08-12 에 '입실 예정' 최상위 그룹으로 빠졌다(inquiryStageOf 가 null 을 준다).
    // 세그먼트는 안 쪼갬(§23).
    if (statusFilter === 'inquiry') {
      const STAGE_RANK: Record<string, number> = { RESERVED: 1, TOUR: 2, INQUIRY: 3 }
      const la = mainLease(a), lb = mainLease(b)
      const sa = STAGE_RANK[inquiryStageOf(la) ?? 'INQUIRY']
      const sb = STAGE_RANK[inquiryStageOf(lb) ?? 'INQUIRY']
      if (sa !== sb) return sa - sb
      // 단계 내: 예약은 입주 임박순, 투어는 투어일 임박순, 동률·문의는 문의 오래된 순
      const dateOf = (l: LeaseTerm | undefined, rank: number): number => {
        const d = rank <= 1 ? l?.moveInDate : rank === 2 ? l?.tourDate : null
        return d ? new Date(d).getTime() : Infinity
      }
      const da = dateOf(la, sa), db = dateOf(lb, sb)
      if (da !== db) return da - db
      return inquiryTime(a) - inquiryTime(b)
    }

    // 호실순: 미배정자(호실 없음)는 항상 하단, 미배정 내에서는 inquiryAt asc 고정
    if (sortKey === 'roomNo') {
      const ra = mainLease(a)?.room?.roomNo ?? ''
      const rb = mainLease(b)?.room?.roomNo ?? ''
      const aHas = !!ra
      const bHas = !!rb
      if (aHas !== bHas) return aHas ? -1 : 1   // 배정된 사람 위로 (sortDir 무관)
      if (!aHas) return inquiryTime(a) - inquiryTime(b)  // 미배정 그룹은 문의 오래된 순
      return dir * ra.localeCompare(rb, 'ko', { numeric: true })
    }

    // 상태순: 같은 상태 내에서는 inquiryAt asc로 보조 정렬
    if (sortKey === 'status') {
      const sa = mainLease(a)?.status ?? ''
      const sb = mainLease(b)?.status ?? ''
      if (sa !== sb) return dir * sa.localeCompare(sb, 'ko', { numeric: true })
      return inquiryTime(a) - inquiryTime(b)
    }

    const va = getSortValue(a, sortKey)
    const vb = getSortValue(b, sortKey)
    if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb)
    return dir * String(va).localeCompare(String(vb), 'ko', { numeric: true })
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // ── 새로고침 상태 ────────────────────────────────────────────────
  // router.refresh()는 void를 반환해서 isPending으로 추적 불가.
  // initialTenants prop이 교체될 때(= 서버 재요청 완료)를 감지해서 클리어.
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    if (isRefreshing) setIsRefreshing(false)
    setDetailTenant(prev => {
      if (!prev) return prev
      const updated = initialTenants.find(t => t.id === prev.id)
      return updated ?? prev
    })
  }, [initialTenants]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 액션 핸들러 ─────────────────────────────────────────────────

  const refresh = useCallback(() => {
    setIsRefreshing(true)
    router.refresh()
  }, [router])

  // 저장이 그 방의 다른 계약과 겹치면 한 번 묻는다(막지는 않는다). 두 방향이 있다.
  //   들어가는 쪽 — 예약 확정 입주일이 앞사람 퇴실 예정일과 겹친다.
  //   미는 쪽     — 내 퇴실 예정일을 뒤로 늘려 다음 예약자 입주일을 밟는다.
  // 세 저장 경로(등록·수정·상세 내 수정)가 이 판정을 공유한다 — 한 곳만 달면 경로별로 갈린다.
  // 확인한 겹침은 allowRoomOverlap 으로 서버에 실어 보낸다. 서버는 그 표식이 없으면 거절한다(같은 규칙 한 벌).
  const confirmRoomOverlap = async (fd: FormData): Promise<boolean> => {
    const leaseId = (fd.get('leaseTermId') as string) || undefined
    const room = rooms.find(r => r.id === ((fd.get('roomId') as string) || ''))
    if (!room) return true
    // 저장 전 계약 — 퇴실일이 실제로 뒤로 밀렸는지 비교하려면 이전 값이 필요하다(폼은 새 값만 보낸다).
    const prevLease = leaseId
      ? initialTenants.flatMap(t => t.leaseTerms).find(l => l.id === leaseId)
      : undefined

    // 미는 쪽 — 퇴실 예정일을 늘리면 그 방에 잡힌 다음 예약의 입주일과 겹칠 수 있다.
    // 서버 가드(nextReservationConflict)와 같은 구간 판정이다. 내가 들어오기 전에 이미 나가는 예약은 겹치지 않는다.
    const prevOut = toDateInput(prevLease?.expectedMoveOut)
    const newOut = ((fd.get('expectedMoveOut') as string) || '').slice(0, 10)
    const selfIn = ((fd.get('moveInDate') as string) || '').slice(0, 10) || toDateInput(prevLease?.moveInDate)
    if (newOut && prevOut && newOut > prevOut) {
      const hit = room.reservations
        .filter(rv => rv.leaseId !== leaseId && rv.moveIn <= newOut && (!rv.moveOut || !selfIn || rv.moveOut >= selfIn))
        .sort((a, b) => a.moveIn.localeCompare(b.moveIn))[0]
      if (hit) {
        const ok = await confirmDialog({
          title: `${hit.tenantName}님 입주 예정일과 겹칩니다`,
          message: `${fmtRoomNo(room.roomNo)}은 ${fmtMD(hit.moveIn)}에 ${hit.tenantName}님이 들어올 예정입니다. 퇴실 예정일을 ${fmtMD(newOut)}로 두면 겹치는데 이대로 저장할까요.`,
          level: 'caution',
          confirmLabel: '이대로 저장',
          cancelLabel: '취소',
        })
        if (!ok) return false
        fd.set('allowRoomOverlap', 'true')
      }
    }

    // 들어가는 쪽 — 문의·투어 단계 저장은 묻지 않는다(방을 비우는 약속이 아니라 희망 호실 메모라서).
    if ((fd.get('status') as string) !== 'RESERVED' || fd.get('reservationConfirmed') !== 'true') return true
    const moveIn = ((fd.get('moveInDate') as string) || '').slice(0, 10)
    const hit = overlapOccupancy(room, moveIn, leaseId)
    if (!hit) return true
    // 당일 회전(앞사람이 나가는 그날 들어온다)은 묻지 않는다 — 운영 일상이라 확인창이 곧 잡음이
    // 된다(2026-08-19 겹침 판정 개정, 운영자 확정). 폼 아래 중립 캡션이 그 사실만 적어 둔다.
    if (isSameDayTurnover({ moveIn, moveOut: newOut || null }, hit)) return true
    const ok = await confirmDialog({
      title: `${hit.tenantName}님 퇴실 예정일과 겹칩니다`,
      message: `${fmtRoomNo(room.roomNo)}은 ${hit.tenantName}님이 ${fmtMD(hit.moveOut)}에 퇴실 예정입니다. 희망 입주일 ${fmtMD(moveIn)}과 겹치는데 이대로 예약을 확정할까요. 확정하면 확인된 겹침으로 기록됩니다.`,
      level: 'caution',
      confirmLabel: '예약 확정',
      cancelLabel: '취소',
    })
    if (!ok) return false
    // 승인은 데이터로 남는다 — 서버가 이 표식을 보고 확인된 겹침 한 줄을 적는다(lib/overlapAck).
    fd.set('allowRoomOverlap', 'true')
    return true
  }

  const handleAdd = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    if (!await confirmRoomOverlap(fd)) return
    // 같은 사람을 또 등록하려는가 — 이름과 연락처가 둘 다 같으면 묻는다. 방을 하나 더 주려고
    // 새 입주자를 만드는 순간 그 사람은 앱 안에서 조용히 두 사람이 된다(설계 패널 2026-08-13).
    // 판정은 서버 정본(findDuplicateTenant)이고, 서버는 저장 직전에 한 번 더 본다.
    const dup = await findDuplicateTenant((fd.get('name') as string) || '', (fd.get('contactValue') as string) || '')
    if (dup) {
      const where = dup.roomNo ? `${fmtRoomNo(dup.roomNo)} ` : ''
      const ok = await confirmDialog({
        title: `${dup.name}님은 이미 등록돼 있습니다`,
        message: `${where}${STATUS_LABEL[dup.status ?? ''] ?? '등록됨'} 상태로 같은 연락처가 저장돼 있습니다. 방을 하나 더 드리는 것이라면 그 입주자 상세의 '계약 추가'를 쓰세요. 동명이인이라 정말 새 입주자면 그대로 등록합니다.`,
        level: 'caution',
        confirmLabel: '새 입주자로 등록',
        cancelLabel: '취소',
      })
      if (!ok) return
      fd.set('allowDuplicateTenant', '1')
    }
    startTransition(async () => {
      const res = await withSave(() => addTenant(fd), { success: '입주자 등록됨' })
      if (!res.ok) { setError(res.error); return }
      setShowAdd(false); refresh()
    })
  }

  // 계약 추가 — 사람은 그대로 두고 계약만 하나 더. 방 배정 확인창은 등록·수정과 같은 한 벌이다.
  const handleAddLease = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    if (!await confirmRoomOverlap(fd)) return
    startTransition(async () => {
      const res = await withSave(() => addLeaseToTenant(fd), { success: '계약 추가됨' })
      if (!res.ok) { setError(res.error); return }
      setAddLeaseTenant(null); setAddLeaseDirty(false); refresh()
    })
  }

  const openDepositRefundModal = async (fd: FormData, fromDetail: boolean) => {
    const tenantName    = fd.get('name') as string || '입주자'
    const depositAmount = Number(fd.get('depositAmount')) || 0
    const cleaningFee   = Number(fd.get('cleaningFee')) || 0
    const leaseTermId   = (fd.get('leaseTermId') as string) || ''
    const tenantId      = (fd.get('tenantId') as string) || ''   // 폼 hidden은 tenantId — 'id'로 읽어 빈 값이 넘어가던 잠복 버그(운영자 신고 2026-07-20)
    // 입실 때 청소비를 이미 받았으면 퇴실에서 또 떼지 않는다 — 계약서가 either/or 로 약정한다.
    // 종전에는 둘 다 하는 것을 막지 않아 2만원을 두 번 받는 상태가 실제로 있었다(520호 김민정).
    const comp = leaseTermId ? await getDepositCompositionForLease(leaseTermId) : null
    const cleaningPaid = comp?.cleaningPaid ?? 0
    const deductible = cleaningFeeDeductible(cleaningFee, cleaningPaid)
    // 정산 기준액은 서버 정본(basis) — 계약 보증금이 아니라 실제로 받은 몫이다. 종전에는 폼의 계약값을
    // 그대로 열어, 청소비로 받은 2만이 섞인 계약에서 화면이 5만을 제시하고 저장은 서버가 3만 기준으로 거절했다.
    const depoBase = comp ? comp.basis : depositAmount
    const maxRefund = Math.max(0, depoBase - deductible)
    setDepositReturnAmt(maxRefund)
    setDepoCleaningPaid(cleaningPaid)
    // 청소비만 떼는 정상 퇴실은 답이 정해져 있다 — 프리셀렉트(변경 가능)
    setDepoWithholdReason(deductible > 0 ? '청소비' : '')
    setDepoWithholdEtc('')
    setDepositReturnDate(kstYmdStr())
    setDepositRefundDirty(false)
    // 이용료 환불 미리보기 — 그 기간 선납이 있으면 통합 환불 창에 이용료 섹션 표시.
    //
    // 기준일은 **실제 퇴실일**이다(운영자 확정 2026-08-02). 폼에 '실제 퇴실일'(actualMoveOut) 필드가
    // 따로 있는데 종전에는 예정일(expectedMoveOut)로 계산해, 계약상 21일인데 19일에 나간 경우
    // 이틀치가 어긋났다. 실제 퇴실일 기록 자체는 이미 그 필드를 쓰고 있었다(2026-07-28 오더).
    // 그 필드는 퇴실 상태에서만 렌더되므로, 없으면 예정일로 폴백해 기존 동작을 유지한다.
    const actualOutYmd = ((fd.get('actualMoveOut') as string) || '').slice(0, 10)
    const expectedOutYmd = ((fd.get('expectedMoveOut') as string) || '').slice(0, 10)
    const moveOutYmd = actualOutYmd || expectedOutYmd || kstYmdStr()
    setRentMoveOutYmd(moveOutYmd)
    setRentRefundPreview(null); setRentRefundAmt(0); setRentPenaltyPctInput('')
    if (leaseTermId) {
      void previewCheckoutRefund(leaseTermId, moveOutYmd, 'legal', null).then(r => {
        if (r.ok && r.prepaidAmount > 0) {
          setRentRefundPreview({ prepaidAmount: r.prepaidAmount, refund: r.refund, defaultPenaltyPct: r.defaultPenaltyPct, appliedProration: r.appliedProration })
          // 퇴실 정산이 먼저 적용돼 있으면 그 확정값을 이어받는다(이중 수정 방지) — 환불 기본값 = 결제액 − 확정 청구
          setRentRefundAmt(r.appliedProration != null ? Math.max(0, r.prepaidAmount - r.appliedProration) : r.refund.refund)
        }
      }).catch(() => {})
    }
    setDepositRefundModal({ fd, tenantName, depositAmount: depoBase, cleaningFee, fromDetail, leaseTermId, tenantId, compositionLabel: comp ? depositCompositionLabel(comp) : null })
  }

  // 위약금율 입력(0~10, 빈 값 = 영업장 기본) — 서버 재계산 후 환불 기본값 갱신. 캡은 서버가 재클램프.
  const handleRentPct = (raw: string) => {
    const clean = raw.replace(/[^0-9]/g, '').slice(0, 2)
    setRentPenaltyPctInput(clean); setDepositRefundDirty(true)
    const m = depositRefundModal
    if (!m?.leaseTermId || !rentMoveOutYmd) return
    const pctNum = clean === '' ? null : Math.min(LEGAL_PENALTY_PCT, Math.max(0, parseInt(clean, 10) || 0))
    void previewCheckoutRefund(m.leaseTermId, rentMoveOutYmd, 'legal', pctNum).then(r => {
      if (r.ok && r.prepaidAmount > 0) {
        setRentRefundPreview({ prepaidAmount: r.prepaidAmount, refund: r.refund, defaultPenaltyPct: r.defaultPenaltyPct, appliedProration: r.appliedProration })
        if (r.appliedProration == null) setRentRefundAmt(r.refund.refund)
      }
    }).catch(() => {})
  }

  // 거주중→공실 변경 시 호실에 예정 가격이 있으면 가격 변동 팝업 표시
  // 팝업이 떴으면 true 반환(이후 처리는 모달 confirm에서)
  const tryOpenRentChangeModal = (fd: FormData, fromDetail: boolean): boolean => {
    const status = fd.get('status') as string
    const roomId = fd.get('roomId') as string
    if (status !== 'CHECKED_OUT' && status !== 'CANCELLED') return false
    if (!roomId) return false
    const room = rooms.find(r => r.id === roomId)
    if (!room || room.scheduledRent == null) return false
    setRentChangeModal({
      fd, fromDetail,
      roomNo: room.roomNo,
      baseRent: room.baseRent,
      scheduledRent: room.scheduledRent,
    })
    return true
  }

  // URL ?edit=1·?tenantId 정리 — 안 지우면 저장/새로고침 후 edit 감지 useEffect 가 폼을 다시 염(깜빡·유지 버그).
  // tenantId 가 사라지면 위 자동 오픈 훅은 openedTenantRef 만 비우고 끝난다(재오픈 없음) — 정리와 재오픈이
  // 서로를 부르는 고리가 되지 않는 지점이라 여기서 명시해 둔다.
  const clearTenantUrlParams = () => {
    if (searchParams.get('edit') === '1' || searchParams.get('tenantId')) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('edit'); params.delete('tenantId')
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    }
  }

  // 이미 보증금 환불이 기록된 계약인지 — 목록에 실려 온 _count 로 판정(추가 왕복 없음)
  const hasDepositRefund = (leaseTermId: string) =>
    !!leaseTermId && initialTenants.some(t =>
      t.leaseTerms.some(lt => lt.id === leaseTermId && (lt._count?.depositRefunds ?? 0) > 0))

  // 보증금 환불 또는 즉시 업데이트로 진행 (가격 모달 처리 이후 호출)
  const proceedAfterRentDecision = (fd: FormData, fromDetail: boolean) => {
    const status        = fd.get('status') as string
    const depositAmount = Number(fd.get('depositAmount')) || 0
    // 환불이 이미 있으면 모달을 열지 않는다 — 퇴실 상태 재저장이 환불을 또 만들던 중복(13438ec9)
    if (status === 'CHECKED_OUT' && depositAmount > 0 && !hasDepositRefund((fd.get('leaseTermId') as string) || '')) {
      openDepositRefundModal(fd, fromDetail)
      return
    }
    // 이 저장으로 퇴실 예정일이 비워지는가 — 단기 해제(퇴실일 칸이 화면에서 사라짐)나 퇴실일 삭제가
    // 조용히 지나가지 않게 알린다. 서버가 같은 사실을 이미 고지한 경우(거주중 복귀)는 겹치지 않게 건너뛴다.
    const clearsMoveOut = !!(fd.get('prevExpectedMoveOut') as string | null)
      && (fd.get('expectedMoveOut') as string | null) === ''
    startTransition(async () => {
      const res = await withSave(() => updateTenant(fd), { success: '입주자 정보 수정됨' })
      if (!res.ok) { setError(res.error); return }
      if (res.notice) pushToast('info', res.notice)
      else if (clearsMoveOut) pushToast('info', '퇴실 예정일도 함께 지웠습니다')
      // 단기 청구가 함께 조정된 저장 — 결과를 알리고 되돌릴 길을 같이 준다(적용취소 원칙).
      if (res.shortSync) {
        const { leaseTermId, diff, newRent, kind } = res.shortSync
        const diffLabel = kind === 'decrease' ? `청구 감액 ${fmtWon(Math.abs(diff))}` : `추가 청구 ${fmtWon(diff)}`
        pushToast('success', `단기 이용료 ${fmtWon(newRent)}로 청구 반영됨 · ${diffLabel}`, {
          detail: '적용취소하면 이용료·퇴실일만 되돌립니다.',
          action: {
            label: '적용취소',
            run: () => {
              void undoShortStayExtension(leaseTermId).then(r => {
                if (r.ok) { pushToast('info', '단기 청구 반영을 적용취소했습니다'); refresh() }
                else pushToast('error', r.error)
              })
            },
          },
        })
      }
      if (fromDetail) { setDetailTenant(null); setDetailEditMode(false); clearTenantUrlParams() }
      else setEditTenant(null)
      refresh()
    })
  }

  // 단기 연장 정리 — 퇴실 예정 상태 그대로 퇴실일만 미래로 바꾸면 거주중 복귀를 확인(자동 전환 연장 흐름, 2026-07-11)
  const maybeConfirmExtension = async (fd: FormData): Promise<void> => {
    const prevStatus = fd.get('prevStatus') as string | null
    const newStatus = fd.get('status') as string | null
    const prevOut = (fd.get('prevExpectedMoveOut') as string | null) ?? ''
    const newOut = (fd.get('expectedMoveOut') as string | null) ?? ''
    if (prevStatus !== 'CHECKOUT_PENDING' || newStatus !== 'CHECKOUT_PENDING') return
    if (!newOut || newOut === prevOut) return
    if (newOut <= kstYmdStr()) return
    const revert = await confirmDialog({
      title: '퇴실일이 미래로 변경됐습니다',
      message: '연장이라면 상태를 거주중으로 되돌리는 것을 권합니다. 되돌리면 새 퇴실일 하루 전에 다시 퇴실 예정으로 자동 전환됩니다(단기).',
      confirmLabel: '거주중으로 변경', cancelLabel: '퇴실 예정 유지',
    })
    if (revert) fd.set('status', 'ACTIVE')
  }

  // 보증금을 올려 저장하는 순간의 그물 — 청소비를 이미 받은 계약이라면 그 몫을 두 번 잡는 길이다.
  // 단기 해제 프리필이 50,000 을 채우고 그대로 저장된 사고(520호)가 정확히 이 경로였다.
  // 차단이 아니라 확인이다. 체크 시 이미 물었으면(A-3) 두 번 묻지 않는다.
  const confirmDepositRaise = async (fd: FormData): Promise<boolean> => {
    if (fd.get('depositRaiseAcked') === '1') return true
    const leaseTermId = (fd.get('leaseTermId') as string) || ''
    if (!leaseTermId) return true
    const next = Number(fd.get('depositAmount')) || 0
    const prev = Number(fd.get('prevDepositAmount')) || 0
    if (next <= prev) return true
    let cleaningPaid = 0
    try { cleaningPaid = (await getDepositCompositionForLease(leaseTermId)).cleaningPaid }
    catch { return true }   // 조회 실패가 저장을 막으면 안 된다
    if (cleaningPaid <= 0) return true
    return confirmDialog({
      title: '청소비를 이미 받았습니다',
      message: `이 계약은 입실 때 청소비 ${fmtWon(cleaningPaid)}을 이미 받았습니다.\n`
        + `보증금을 ${fmtWon(prev)}에서 ${fmtWon(next)}으로 올리면, 보증금에 청소비가 포함되는 방식일 때 같은 돈이 두 번 잡힙니다.\n`
        + `현금으로 받을 몫은 ${fmtWon(Math.max(0, next - cleaningPaid))}입니다. 이대로 저장할까요?`,
      level: 'caution', confirmLabel: '이대로 저장',
    })
  }

  const handleUpdate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    if (!await confirmRoomOverlap(fd)) return
    if (!await confirmDepositRaise(fd)) return
    await maybeConfirmExtension(fd)
    if (tryOpenRentChangeModal(fd, false)) return
    proceedAfterRentDecision(fd, false)
  }

  // 상세 모달 내 편집 저장
  const handleUpdateFromDetail = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    if (!await confirmRoomOverlap(fd)) return
    if (!await confirmDepositRaise(fd)) return
    await maybeConfirmExtension(fd)
    if (tryOpenRentChangeModal(fd, true)) return
    proceedAfterRentDecision(fd, true)
  }

  const handleRentChangeChoice = (apply: boolean) => {
    if (!rentChangeModal) return
    const { fd, fromDetail } = rentChangeModal
    fd.set('applyScheduledRent', apply ? '1' : '0')
    setRentChangeModal(null)
    proceedAfterRentDecision(fd, fromDetail)
  }


  const handleDepositRefundConfirm = async () => {
    if (!depositRefundModal) return
    const { fd, tenantName, depositAmount, cleaningFee, fromDetail, leaseTermId, tenantId } = depositRefundModal
    const rp = rentRefundPreview
    // 전액 환불(사용분·위약금까지 반환)은 명시적 확인(§14) — 계산값 초과 여부와 무관하게 결제액 전액이면 묻는다
    if (rp && rentRefundAmt > 0 && rentRefundAmt >= rp.prepaidAmount) {
      const okAll = await confirmDialog({
        title: '이용료를 전액 환불할까요?',
        message: `사용분까지 모두 돌려주는 금액입니다. 총 환불액 ${fmtWon(rentRefundAmt + depositReturnAmt)}.`,
        confirmLabel: '전액 환불', cancelLabel: '다시 확인',
      })
      if (!okAll) return
    }
    startTransition(async () => {
      const release = trackSave()
      try {
        // 순서 중요(적대검증 P0): updateTenant(퇴실 저장·일할 재계산)를 먼저, 환불 확정을 나중에 —
        // 반대로 하면 updateTenant의 일할 재계산이 환불 확정 청구액을 덮어쓴다.
        const updateRes = await updateTenant(fd)
        if (!updateRes.ok) { setError(updateRes.error); pushToast('error', updateRes.error); return }
        if (updateRes.notice) pushToast('info', updateRes.notice)
        // 이용료 환불 — 퇴실월 수납 record를 회사 귀속액으로 재기록(매출에서 환불분 제외, 원 기록 소프트삭제 보존)
        let rentRefunded = false
        let taxNotice: RentRefundTaxNotice | undefined
        if (rp && rentRefundAmt > 0) {
          const rr = await finalizeRentRefund({ leaseTermId, moveOutYmd: rentMoveOutYmd, rentRefundAmount: rentRefundAmt })
          if (rr.ok) { rentRefunded = true; taxNotice = rr.taxNotice }
          else if (rr.error.startsWith('이미 환불 처리된')) rentRefunded = true   // 재시도(멱등) — 계속 진행
          else { setError(rr.error); pushToast('error', rr.error); return }
        }
        // 미환불이 있으면 사유는 필수다. 종전에는 금액이 청소비와 정확히 같을 때만 자동 추론했고
        // 나머지는 사유 없이 몰취가 기록됐다. 이제 운영자가 고른 값을 쓴다(청소비는 프리셀렉트).
        const withheld = Math.max(0, depositAmount - depositReturnAmt)
        if (withheld > 0 && !buildWithholdReason(depoWithholdReason, depoWithholdEtc)) {
          setError('미환불 사유를 선택해 주세요.'); pushToast('error', '미환불 사유를 선택해 주세요.'); return
        }
        if (depositReturnAmt === 0 && depositAmount > 0) {
          const mon = kstYmdStr().slice(0, 7)
          if (!(await confirmDialog({
            title: '보증금을 전액 돌려주지 않고 퇴실 처리할까요?',
            // 카테고리는 성격대로 갈린다 — 보증금 안의 청소비 몫은 청소비, 그 몫을 넘는 차감만 몰취다.
            message: `${fmtWon(depositAmount)}이 ${Number(mon.slice(0, 4))}년 ${Number(mon.slice(5))}월 ${withheldDestinationLabel(depositAmount, cleaningFeeDeductible(cleaningFee, depoCleaningPaid), fmtWon)} 기록됩니다.\n사유: ${buildWithholdReason(depoWithholdReason, depoWithholdEtc)}.`,
            level: 'caution', confirmLabel: '전액 미환불로 처리',
          }))) return
        }
        const refundRes = await recordDepositReturn({
          leaseTermId,
          tenantId,
          depositAmount,
          returnedAmount: depositReturnAmt,
          date: depositReturnDate,
          tenantName,
          ...(buildWithholdReason(depoWithholdReason, depoWithholdEtc) ? { reason: buildWithholdReason(depoWithholdReason, depoWithholdEtc) } : {}),
        })
        if (!refundRes.ok) { setError(refundRes.error); pushToast('error', refundRes.error); return }
        setDepositRefundModal(null)
        if (fromDetail) { setDetailTenant(null); setDetailEditMode(false); clearTenantUrlParams() }
        else setEditTenant(null)
        refresh()
        const { refundId, extraIncomeIds } = refundRes
        const totalRefunded = (rp ? rentRefundAmt : 0) + depositReturnAmt
        // 홈택스 조치 안내 — 앱과 국세청은 연동되지 않아 앱이 대신 취소해 줄 수 없다.
        // 확인창으로 막지 않는다(환불 확정은 이미 여러 단계를 거친 뒤라 습관적으로 넘기게 된다).
        // 앱이 하지 않은 일을 완료형으로 쓰지 않는다 — 취소는 운영자가 홈택스에서 한다.
        // 지난 달 장부가 바뀌는 경우 먼저 알린다 — 이 앱엔 월 마감이 없어 조용히 바뀌면 아무도 모른다
        if (taxNotice?.pastMonth) pushToast('info', taxNotice.pastMonth)
        if (taxNotice?.cashReceipt) {
          const { amount, ymd } = taxNotice.cashReceipt
          const full = taxNotice.companyKeeps === 0
          pushToast('info', full
            ? `홈택스에서 현금영수증 발행을 취소해 주세요. ${ymd} 발행 ${fmtWon(amount)}. 앱 매출에서는 뺐지만 현금영수증 취소는 따로 하셔야 합니다.`
            : `현금영수증을 다시 발행해야 합니다. 홈택스에서 ${ymd} 발행 ${fmtWon(amount)}을 취소하고 확정액 ${fmtWon(taxNotice.companyKeeps)}으로 재발행한 뒤, 수납 기록에서 현금영수증 표시를 다시 켜 주세요.`)
        }
        if (taxNotice?.card) {
          pushToast('info', `카드로 받은 ${fmtWon(taxNotice.card.amount)}입니다. 카드 승인을 취소하면 카드 매출 자료도 함께 줄지만, 승인을 두고 계좌로 돌려주면 카드 매출은 그대로 남습니다. 어느 쪽으로 처리하셨는지 확인해 주세요.`)
        }
        pushToast('success', `환불 + 퇴실 처리됨 · 총 ${fmtWon(totalRefunded)}`, {
          action: {
            label: '환불기록 취소',
            run: () => {
              void (async () => {
                if (rentRefunded) {
                  const ru = await undoRentRefund(leaseTermId)   // 스냅샷은 서버에 영속 — id 전달 불필요
                  if (!ru.ok) { pushToast('error', ru.error); return }
                }
                const r = await undoDepositReturn(refundId, extraIncomeIds)
                if (r.ok) { pushToast('info', '환불 기록을 지웠습니다 (퇴실 상태는 유지 — 필요 시 상태 변경으로 복구)'); refresh() }
                else pushToast('error', r.error)
              })()
            },
          },
        })
      } finally { release() }
    })
  }

  const openPayModal = async (tenant: Tenant, lease: LeaseTerm) => {
    setPayTarget({ tenant, lease })
    setPayAmount(lease.rentAmount)
    setPayDateVal(kstYmdStr())
    setIsDepositMode(false)
    setShowPayForm(false)
    setError('')
    setDistNotice(null)
    setPaySettlement(null)
    const { records, windowRecords, acquisitionDate } = await getPaymentsByLease(lease.id, targetMonth)
    // 청구 조정 전표(단기 연장·감액 마커)는 수납이 아니라 청구 락 조정용 — 납부 내역에 그리지 않는다.
    setPayHistory(records.filter(r => !r.isBillingAdjust) as PayRecord[]); setPayWindow(windowRecords as PayRecord[]); setPayReloadKey(k => k + 1)
    setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
  }

  // 청구·잔액 정본 재조회 — 모달 열림·저장/수정/삭제(payHistory 갱신) 때마다 서버 값으로 맞춘다.
  const payLeaseId = payTarget?.lease.id ?? null
  // 보증금 패널 재조회 신호 — 패널 밖(수납 폼·목록)에서 보증금이 바뀌었을 때 패널도 따라오게 한다.
  const [payReloadKey, setPayReloadKey] = useState(0)
  const reloadPay = async () => {
    if (!payLeaseId) return
    const { records, windowRecords } = await getPaymentsByLease(payLeaseId, targetMonth)
    setPayHistory(records.filter(r => !r.isBillingAdjust) as PayRecord[]); setPayWindow(windowRecords as PayRecord[])
    setPayReloadKey(k => k + 1)
    refresh()
  }
  useEffect(() => {
    if (!payLeaseId) { setPaySettlement(null); return }
    let active = true
    getLeaseSettlementInfo(payLeaseId, targetMonth)
      .then(d => { if (active) setPaySettlement(d) })
      .catch(() => { if (active) setPaySettlement(null) })
    return () => { active = false }
  }, [payLeaseId, targetMonth, payHistory])

  const closePayModal = () => {
    setPayTarget(null); setPayHistory([]); setPayWindow([]); setShowPayForm(false); setError(''); setDistNotice(null); setPaySettlement(null)
    setShowOverrideForm(false); setOverrideDateInput(''); setOverrideReason(''); setConfirmClearOverride(false)
    setIsDepositMode(false); setPayDateVal(kstYmdStr())
  }

  const handleSavePayment = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    if (!payTarget) return
    const fd = new FormData(e.currentTarget)
    const payMethod = fd.get('payMethod') as string
    const memo = fd.get('memo') as string
    const cashReceiptIssued = fd.get('cashReceipt') === 'on'   // 현금영수증 발행 표시(오류신고 2bd8befa)
    // 보증금 수납 전 청소비 중복 확인 — 정본 lib/depositEntryGuard(신고 a5edc93e 후속, 두 폼 공용)
    if (isDepositMode && !(await confirmDepositCleaningOverlap({
      leaseTermId: payTarget.lease.id, depositAmount: payTarget.lease.depositAmount, payAmount, cleaningFee: payTarget.lease.cleaningFee,
    }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        if (isDepositMode) {
          const depRes = await saveDepositPayment({
            leaseTermId:   payTarget.lease.id,
            tenantId:      payTarget.tenant.id,
            targetMonth,
            depositAmount: payTarget.lease.depositAmount,
            rentAmount:    payTarget.lease.rentAmount,
            totalPaid:     payAmount,
            payDate:       payDateVal,
            payMethod,
            memo:          memo || undefined,
            cashReceiptIssued,
          })
          // 중복 입력 가드 — 이미 받은 돈을 못 보고 총액을 다시 넣는 경우를 막는다
          if (!depRes.ok) { pushToast('error', depRes.error); return }
        } else {
          const result = await savePayment({
            leaseTermId:    payTarget.lease.id,
            tenantId:       payTarget.tenant.id,
            targetMonth,
            expectedAmount: payTarget.lease.rentAmount,
            actualAmount:   payAmount,
            payDate:        payDateVal,
            payMethod,
            memo,
            cashReceiptIssued,
          })
          const otherMonths = result.allocations.length > 0
            ? result.allocations.filter(a => a.targetMonth !== result.inputMonth)
            : []
          if (otherMonths.length > 0) {
            const summary = otherMonths
              .map(a => `${Number(a.targetMonth.slice(5))}월분 ${fmtWon(a.amount)}`)
              .join(', ')
            setDistNotice(`이번 입력은 ${summary}으로 나뉘어 반영되었습니다. 미수가 가장 오래된 월부터 충당됩니다.`)
          } else {
            setDistNotice(null)
          }
        }
        setShowPayForm(false)
        const { records, windowRecords } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records.filter(r => !r.isBillingAdjust) as PayRecord[]); setPayWindow(windowRecords as PayRecord[]); setPayReloadKey(k => k + 1)
        refresh()
        pushToast('success', isDepositMode ? '보증금 수납됨' : '월 이용료 수납됨')
      } catch (err: unknown) {
        const msg = (err as Error).message
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  // 어느 달 매출이 얼마 바뀌는지 알려준다 — 종전에는 '이 수납 기록을 삭제할까요?' 한 줄뿐이었다(A페이즈).
  // level 은 caution — 소프트삭제라 되살릴 수 있는데 danger 는 '되돌릴 수 없습니다'를 자동으로 붙여 거짓말이 된다.
  // 같은 삭제인데 프리즘 경로(PaymentRecordList)에만 적용취소가 있던 불일치도 함께 봉합한다.
  const handleDeletePayRecord = async (p: PayRecord) => {
    if (!(await confirmDeletePayment(p))) return
    const paymentId = p.id
    startTransition(async () => {
      // 적용취소는 토스트 액션으로 — 프리즘(PaymentRecordList)과 같은 패턴
      const res = await withSave(() => deletePayment(paymentId), { success: '' })
      if (!res.ok) { setError(res.error); return }
      pushToast('success', '수납 기록 삭제됨', {
        action: { label: '적용취소', run: () => { void restorePayment(paymentId).then(r => { if (r.ok) refresh(); else pushToast('error', r.error) }) } },
      })
      if (payTarget) {
        const { records, windowRecords } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records.filter(r => !r.isBillingAdjust) as PayRecord[]); setPayWindow(windowRecords as PayRecord[]); setPayReloadKey(k => k + 1)
      }
      refresh()
    })
  }

  const handleUpdatePayRecord = (p: PayRecord) => {
    setEditingPayId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
  }

  const handleSaveEdit = async () => {
    if (!editingPayId) return
    startTransition(async () => {
      const res = await withSave(() => updatePayment(editingPayId, {
        actualAmount: editAmount,
        payDate:      editDate,
        payMethod:    editPayMethod,
        memo:         editMemo || undefined,
      }), { success: '수납 기록 수정됨' })
      if (!res.ok) { setError(res.error); return }
      if (payTarget) {
        const { records, windowRecords, acquisitionDate } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records.filter(r => !r.isBillingAdjust) as PayRecord[]); setPayWindow(windowRecords as PayRecord[]); setPayReloadKey(k => k + 1)
        setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
      }
      setEditingPayId(null)
      refresh()
    })
  }

  const handleDelete = async (tenantId: string, name: string) => {
    const id = tenantId
    const ok = await confirmDialog({
      title: `${name}님을 완전 삭제할까요?`,
      message: '수납 기록, 계약 이력, 연락처 등 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다. 거주중이었다면 해당 호실은 공실로 전환됩니다.',
      level: 'danger',
      confirmLabel: '영구 삭제',
    })
    if (!ok) return
    startTransition(async () => {
      const res = await withSave(() => deleteTenant(id), { success: `${name}님 삭제됨`, silentError: true })
      // 계약·수납 이력 — 건수를 보여주는 영향 고지형 다이얼로그(v2.0 §14) 동의 후에만 영구 삭제
      if (!res.ok && res.needsForce) {
        const force = await confirmDialog({
          title: `${name}님 기록을 영구 삭제할까요?`,
          message: '매출 통계·과거 조회에서도 함께 사라집니다.',
          level: 'danger', confirmLabel: '영구 삭제',
          impact: [
            { label: '계약', count: res.leases ?? 0 },
            { label: '수납 기록', count: res.payments ?? 0 },
          ],
        })
        if (!force) return
        const res2 = await withSave(() => deleteTenant(id, { force: true }), { success: `${name}님 삭제됨` })
        if (!res2.ok) { setError(res2.error); return }
        setDetailTenant(null); refresh()
        return
      }
      if (!res.ok) { pushToast('error', res.error); return }
      setDetailTenant(null); refresh()
    })
  }

  // ── 정렬 헤더 ─────────────────────────────────────────────────

  function ResizableTh({ label, colKey, onClick, isActive }: {
    label: string; colKey: string; onClick?: () => void; isActive?: boolean
  }) {
    const w = colWidths[colKey] ?? 100
    return (
      <th
        onClick={onClick}
        className={`relative text-left text-xs font-medium px-4 py-3 select-none overflow-hidden ${
          onClick ? 'cursor-pointer transition-colors' : ''
        } ${isActive ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}
        style={{ width: w, minWidth: w, maxWidth: w }}
      >
        <span className="truncate block">{label}{isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
        {/* 드래그 핸들 */}
        <div
          onMouseDown={e => startResize(colKey, e)}
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize group"
          style={{ userSelect: 'none' }}
        >
          <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
        </div>
      </th>
    )
  }

  function SortTh({ label, sKey, colKey }: { label: string; sKey: SortKey; colKey: string }) {
    const active = sortKey === sKey
    return (
      <ResizableTh
        label={label}
        colKey={colKey}
        onClick={() => handleSort(sKey)}
        isActive={active}
      />
    )
  }

  // ── 인원수 ────────────────────────────────────────────────────

  const statusOf = (t: typeof initialTenants[0]) => mainLease(t)?.status ?? ''
  const cntBy = (pred: (s: string) => boolean) => initialTenants.filter(t => pred(statusOf(t))).length
  const countAll       = initialTenants.length
  const countCheckout  = cntBy(s => s === 'CHECKOUT_PENDING')
  const countLiving    = cntBy(s => ['ACTIVE', 'CHECKOUT_PENDING'].includes(s))   // 거주중 = 거주중+퇴실예정
  const countNonRes    = cntBy(s => s === 'NON_RESIDENT')
  // 입실 예정 = 예약 확정. 문의·예약에서 빠져나온 만큼 그대로 여기 선다(두 그룹의 합 = 종전 문의·예약).
  const countConfirmed = initialTenants.filter(t => isConfirmedReservation(mainLease(t))).length
  // 문의·예약 = 아직 방이 안 정해진 리드. 확정자를 뺀다 — 그룹 술어(isInquiry)와 같은 식이라야
  // 칩 숫자와 목록 길이가 안 갈린다.
  const countInquiry   = initialTenants.filter(t =>
    (WISH_LEAD_STATUSES as readonly string[]).includes(statusOf(t)) && !isConfirmedReservation(mainLease(t))).length
  const countCancelled = cntBy(s => s === 'CANCELLED')
  // 항등식 — 전체는 서로 겹치지 않는 그룹들로 정확히 쪼개진다. 입실 예정을 새로 빼 놓고 여기서
  // 안 빼면 그만큼이 '퇴실'로 굴러떨어진다(목록 술어 isPast 는 리드 전체를 빼므로 화면과도 어긋난다).
  const countPast      = countAll - countLiving - countNonRes - countInquiry - countConfirmed - countCancelled
  // 퍼널 단계별 카운트 — 2차 필터 라벨용(파생 단계는 status만으론 못 세서 lease 기준)
  const cntStage = (st: Exclude<InquiryStage, ''>) => initialTenants.filter(t => inquiryStageOf(mainLease(t)) === st).length
  const stageCounts = { INQUIRY: cntStage('INQUIRY'), TOUR: cntStage('TOUR'), RESERVED: cntStage('RESERVED') }

  // function 선언 — 호이스팅되어 위쪽 필터(.filter, 478번 줄)에서도 TDZ 없이 안전하게 호출됨
  function getTenantFloor(t: typeof initialTenants[0]) {
    const room = mainLease(t)?.room
    if (!room) return ''
    if (room.floor) return room.floor
    const n = room.roomNo.replace(/[^0-9]/g, '')
    return n.length >= 3 ? n.slice(0, n.length - 2) : ''
  }
  const allFloors = [...new Set(initialTenants.map(t => getTenantFloor(t)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {showNoticeSms && <NoticeSmsModal onClose={() => setShowNoticeSms(false)} />}

      {/* 헤더 — §23 정본(호실 관리 3140975)과 같은 구조. 제목 + 우측 CTA 둘.
          shrink-0 이 없으면 360dp 이하에서 flex 가 버튼을 압축해 글자가 낱자로 쪼개진다(신고 aea83d6b 클래스).
          ml-auto 는 두 줄로 접혔을 때도 버튼군을 우측에 붙여 둔다. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">입주자 관리</h1>
        {/* 뷰어(STAFF)에게는 편집 진입 숨김 — 서버 requireEdit가 최종 방어(감사 D3) */}
        {canEdit && (
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <Btn type="button" variant="secondary" size="md" onClick={() => setShowNoticeSms(true)}>
            단체 문자
          </Btn>
          <Btn variant="primary" size="md"
            onClick={() => { setAddTenantDirty(false); setShowAdd(true); setError('') }}>
            + 입주자 등록
          </Btn>
        </div>
        )}
      </div>

      {/* 검색바 + 필터 토글 — v2.0 §23 정본(호실관리) 패턴. 스크롤 시 상단 고정(운영자 지시 2026-07-13) */}
      <div className="flex gap-2 sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={search} onChange={setSearch} placeholder="이름, 호실, 전화번호, 국적, 직업 검색" className="flex-1" />
        <button type="button" onClick={() => setShowFilters(v => !v)}
          className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
            showFilters || activeFilterCount > 0
              ? 'bg-[var(--coral)] text-[var(--on-solid)]'
              : 'bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)]'
          }`}>
          필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
      </div>

      {/* 접이식 필터 패널 — §23 정본 문법(grid-cols-2·label 12px). 납부일·거주기간은 유효 탭에서만 렌더 */}
      {showFilters && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {allFloors.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <select value={floorFilter} onChange={e => setFloorFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체 층</option>
                  {allFloors.map(f => <option key={f} value={f}>{f}층</option>)}
                </select>
              </div>
            )}
            {natOptions.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">국적</label>
                <select value={natFilter} onChange={e => setNatFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  {natOptions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {genderOptions.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">성별</label>
                <select value={genderFilter} onChange={e => setGenderFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  {genderOptions.map(g => <option key={g} value={g}>{GENDER_LABEL[g] ?? g}</option>)}
                </select>
              </div>
            )}
            {dueDayFilterValid && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">납부일</label>
                <select value={dueDayFilter} onChange={e => setDueDayFilter(e.target.value as '' | DueDayBucket)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  {DUE_DAY_BUCKET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {stayFilterValid && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">거주기간</label>
                <select value={stayFilter} onChange={e => setStayFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  <option value="lt1">1개월 미만</option>
                  <option value="m1_6">1~6개월</option>
                  <option value="m6_12">6개월~1년</option>
                  <option value="y1_2">1~2년</option>
                  <option value="y2p">2년 이상</option>
                </select>
              </div>
            )}
          </div>
          {!hideMoney && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">월 이용료 범위 (원)</label>
              <div className="flex items-center gap-2">
                <MoneyInput value={rentMinFilter} onChange={v => setRentMinFilter(v && v > 0 ? v : undefined)} placeholder="최소" />
                <span className="text-[var(--warm-muted)] text-sm">~</span>
                <MoneyInput value={rentMaxFilter} onChange={v => setRentMaxFilter(v && v > 0 ? v : undefined)} placeholder="최대" />
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Btn type="button" variant="secondary" size="sm" className="flex-1" onClick={resetFilters}>초기화</Btn>
            <Btn type="button" variant="primary" size="sm" className="flex-1" onClick={() => setShowFilters(false)}>닫기</Btn>
          </div>
        </div>
      )}

      {/* 상태 필터 — v2.0 §23 단일 SegmentedControl(탭+하위 2단계를 생애주기 한 줄로 평탄화) */}
      <div className="flex gap-2 flex-wrap items-center">
        <SegmentedControl
          size="md"
          scroll
          ariaLabel="상태 필터"
          value={statusFilter}
          onChange={changeStatusFilter}
          options={[
            // 라벨은 숫자까지 — 괄호 설명은 §19 InfoHint 로 뺀다. 칩 안에 문장을 넣으면 좁은 폭에서
            // 이 칩 하나가 트랙을 밀어내 뒤쪽 그룹이 스크롤 밖으로 숨는다.
            { value: 'living',           label: `거주중 ${countLiving}` },
            { value: 'CHECKOUT_PENDING', label: `퇴실 예정 ${countCheckout}` },
            // 나가는 사람 바로 옆에 들어오는 사람 — 방을 넘겨받는 두 축이 나란히 선다(운영자 확정).
            { value: 'confirmed',        label: `입실 예정 ${countConfirmed}` },
            { value: 'NON_RESIDENT',     label: `비거주자 ${countNonRes}` },
            { value: 'inquiry',          label: `문의·예약 ${countInquiry}` },
            { value: 'CANCELLED',        label: `입실 취소 ${countCancelled}` },
            { value: 'past',             label: `퇴실 ${countPast}` },
            { value: 'all',              label: `전체 ${countAll}` },
          ]}
        />
        {/* 그룹 경계 설명 — 호실 관리 상태 필터와 같은 자리·같은 문법(§19 InfoHint) */}
        <InfoHint title="상태 그룹">
          <span className="block">거주중에는 퇴실 예정도 들어갑니다. 퇴실 예정은 아직 사는 사람이라 두 곳에 함께 셉니다.</span>
          <span className="block mt-1.5">입실 예정은 방과 날짜가 잡힌 예약 확정입니다. 아직 방이 안 정해진 사람은 문의·예약에 있습니다.</span>
        </InfoHint>

        {/* 선택 · 표시 항목 — 목록 조작은 헤더가 아니라 이 줄에 선다(형제 수납 관리와 같은 ml-auto 그룹).
            새 줄로 떨어져도 우측 정렬을 유지해 드롭다운이 화면 왼쪽으로 잘리지 않는다. */}
        <div className="ml-auto flex gap-2 items-center">
          {/* 뷰어(STAFF)에겐 숨김 — 헤더의 묶음 canEdit 가드에서 빠져나왔으므로 개별로 단다(감사 D3) */}
          {canEdit && (
            <Btn type="button" variant="secondary" size="md"
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
              {selectMode ? '선택 취소' : '선택'}
            </Btn>
          )}

          {/* 표시 항목 — 데스크탑 표 열. v2.0 §23 공용 DisplayFieldsMenu(다른 페이지와 동일) */}
          <DisplayFieldsMenu
            className="hidden sm:block"
            fields={COL_DEFS.filter(c => (c.tabs as readonly string[]).includes(cat) && !(hideMoney && MONEY_COLS.includes(c.key)))}
            visible={colVis as Record<string, boolean>}
            onToggle={k => updateColVis(k as ColKey, !colVis[k as ColKey])}
            heading="표에 표시할 항목"
          />
        </div>
      </div>

      {/* 문의·예약 단계 2차 필터 — 요청관리 2단 필터 정본 문법(sm 세그먼트, e1b81629).
          그룹 선택 시에만 노출, 개별 카드 단계는 배지가 구분 */}
      {statusFilter === 'inquiry' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--warm-muted)]">단계</span>
          <SegmentedControl
            size="sm"
            scroll
            ariaLabel="문의·예약 단계 필터"
            value={inquiryStage}
            onChange={setInquiryStage}
            options={[
              { value: '',          label: `전체 ${countInquiry}` },
              { value: 'INQUIRY',   label: `문의 ${stageCounts.INQUIRY}` },
              { value: 'TOUR',      label: `투어 ${stageCounts.TOUR}` },
              { value: 'RESERVED',  label: `입실 예약 ${stageCounts.RESERVED}` },
              // '예약 확정' 단계는 2026-08-12 에 상위 '입실 예정' 그룹으로 승격돼 여기서 뺐다.
            ]}
          />
        </div>
      )}

      {/* 모바일 검색바는 상단 공용 SearchBar(전 사이즈)로 통일 — 중복 제거 */}

      {/* 모바일 정렬 + 표시 항목 */}
      <div className="sm:hidden flex items-center justify-between gap-2">
        <SortSelect<SortKey>
          ariaLabel="입주자 정렬 기준"
          value={sortKey}
          dir={sortDir}
          onChange={sk => { setSortKey(sk); setSortDir('asc') }}
          onToggleDir={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          options={[
            { value: 'status',        label: '상태' },
            { value: 'roomNo',        label: '호실순' },
            { value: 'name',          label: '이름' },
            ...(hideMoney ? [] : [
              { value: 'rentAmount' as const,    label: '이용료' },
              { value: 'depositAmount' as const, label: '보증금' },
            ]),
            { value: 'dueDay',        label: '납부일' },
            { value: 'stayPeriod',    label: '거주기간' },
            { value: 'moveInDate',    label: '입실일' },
          ]}
        />
        <DisplayFieldsMenu fields={tenantCardFields} visible={cardFields} onToggle={toggleCardField} />
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-xl p-3">
          <p className="text-[var(--danger-fg)] text-sm">{error}</p>
        </div>
      )}


      {/* 보증금 환불 모달 — 대시보드 알림 퇴실 처리와 동일 UI */}
      {depositRefundModal && (() => {
        const dep = depositRefundModal.depositAmount
        const fee = depositRefundModal.cleaningFee
        const maxRefund = Math.max(0, dep - fee)
        const unreturned = dep - depositReturnAmt
        const exceedsMax = depositReturnAmt > maxRefund
        const rp = rentRefundPreview
        const rentLocked = rp?.appliedProration != null   // 퇴실 정산 위젯이 먼저 확정 — 창에서 재계산 금지
        const rentCalcDefault = rp ? (rentLocked ? Math.max(0, rp.prepaidAmount - (rp.appliedProration ?? 0)) : rp.refund.refund) : 0
        const rentDiff = rp ? rentRefundAmt - rentCalcDefault : 0
        const rentExceeds = !!rp && rentRefundAmt > rp.prepaidAmount
        const totalRefund = (rp ? rentRefundAmt : 0) + depositReturnAmt
        // z 280 — 상세 경유 '입주자 정보 수정' 창이 260이라 같은 층이면 이 창이 뒤에 깔려
        // 저장을 눌러도 아무 일도 없는 것처럼 보였다(운영자 신고 2026-07-20). 가격 변동 확인창과 동일 층.
        // dirty는 금액·날짜를 실제로 만졌을 때만(§12) — 종전 하드코딩은 그냥 닫아도 확인을 물었다.
        return (
          <Modal open z={280} width="sm" dirty={depositRefundDirty}
            onClose={() => setDepositRefundModal(null)}
            // 풀블리드 — 본문과 하단 버튼 행이 각자 여백을 갖는 구조라 기본 패딩을 쓰면 이중 여백이 된다.
            bodyClassName=""
            title="환불" subtitle={`${depositRefundModal.tenantName}님 퇴실 정산`}>

              <div className="px-5 py-4 space-y-3">
                {/* 이용료 정산 — 퇴실월 선납이 있을 때만. 계산은 참고 표시, 최종 금액은 운영자 확정(승인 2026-07-20).
                    차감 행은 라벨 앞 −(U+2212) 세로 수식 문법 — 퇴실 정산 위젯 환불 미리보기와 동일. */}
                {rp && (
                  <div className="bg-[var(--canvas)] rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="font-semibold text-[var(--warm-mid)]">이용료 정산</span>
                      <span className="tabular-nums text-[var(--warm-dark)]">결제액 {fmtWon(rp.prepaidAmount)}</span>
                    </div>
                    {rentLocked ? (
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                        퇴실 정산 적용됨 · 이달 청구 {fmtWon(rp.appliedProration ?? 0)} · 변경은 상세의 퇴실 정산에서.
                      </p>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[var(--warm-muted)]">− 사용분 ({rp.refund.daysUsed}일 × {fmtWon(rp.refund.dailyRate)})</span>
                          <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(rp.refund.usedAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[var(--warm-muted)] flex items-center gap-1">
                            − 위약금 (결제액의
                            <input type="text" inputMode="numeric" value={rentPenaltyPctInput} placeholder={String(rp.defaultPenaltyPct)}
                              onChange={e => handleRentPct(e.target.value)}
                              className="w-11 bg-[var(--surface)] border border-[var(--warm-border)] rounded-sm px-1.5 py-1 text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                            %)
                          </span>
                          <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(rp.refund.penalty)}</span>
                        </div>
                        <p className="text-[0.65625rem] text-[var(--warm-muted)]">위약금율 기본 {rp.defaultPenaltyPct}% · 최대 {LEGAL_PENALTY_PCT}% (공정위 기준)</p>
                      </>
                    )}
                    <div className="border-t border-[var(--warm-border)] pt-1.5 space-y-1">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">이용료 환불액</label>
                      <MoneyInput value={rentRefundAmt} onChange={v => { setRentRefundAmt(v); setDepositRefundDirty(true) }} placeholder="0원" />
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">계산값 {fmtWon(rentCalcDefault)} · 필요시 수정</p>
                      {rentExceeds && (
                        <p className="text-[0.6875rem] text-[var(--danger-fg)]">결제액 {fmtWon(rp.prepaidAmount)}을 초과할 수 없습니다.</p>
                      )}
                      {!rentExceeds && rentDiff > 0 && (
                        <p className="text-[0.6875rem] text-[var(--warning-fg)]">계산값보다 {fmtWon(rentDiff)} 많습니다.</p>
                      )}
                      {!rentExceeds && rentDiff < 0 && (
                        <p className="text-[0.6875rem] text-[var(--warm-muted)]">계산값보다 {fmtWon(-rentDiff)} 적습니다. 차액은 회사 귀속으로 기록됩니다.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* 보증금 — 이용료 섹션과 같은 카드·행 문법 */}
                <div className="bg-[var(--canvas)] rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold text-[var(--warm-mid)]">보증금</span>
                    <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(dep)}</span>
                  </div>
                  {/* 청소비가 보증금 몫을 채운 계약은 구성을 병기한다(DepositStatusPanel 정본 문법). */}
                  {depositRefundModal.compositionLabel && (
                    <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">{depositRefundModal.compositionLabel}</p>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[var(--warm-muted)]">− 청소비</span>
                    <span className={`tabular-nums ${fee > 0 && depoCleaningPaid === 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-mid)]'}`}>
                      {depoCleaningPaid > 0 ? '입실 때 받음 · 공제 안 함' : fee > 0 ? fmtWon(fee) : '없음'}
                    </span>
                  </div>
                  <div className="border-t border-[var(--warm-border)] pt-1.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">보증금 환불 (최대 {fmtWon(maxRefund)})</label>
                    </div>
                    {/* 세 경로가 같은 문법을 쓴다 — 상태 전환 미니폼·홈 알림과 동일한 SegmentedControl 정본. */}
                    <SegmentedControl size="sm" ariaLabel="보증금 환불 여부"
                      value={depositReturnAmt === 0 ? 'none' : 'refund'}
                      onChange={v => { if ((v === 'none') !== (depositReturnAmt === 0)) { setDepositReturnAmt(v === 'none' ? 0 : maxRefund); setDepositRefundDirty(true) } }}
                      options={[{ value: 'refund', label: '환불함' }, { value: 'none', label: '환불 안 함' }]} />
                    <MoneyInput value={depositReturnAmt} onChange={v => { setDepositReturnAmt(v); setDepositRefundDirty(true) }} placeholder="0원" />
                    {dep - depositReturnAmt > 0 && (
                      <div className="space-y-1.5 pt-0.5">
                        <label className="text-xs font-medium text-[var(--warm-mid)] block">미환불 사유 <span className="font-normal opacity-60">(필수)</span></label>
                        <select value={depoWithholdReason} onChange={e => { setDepoWithholdReason(e.target.value); setDepositRefundDirty(true) }}
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                          <option value="">선택하세요</option>
                          {WITHHOLD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {depoWithholdReason === '기타' && (
                          <input type="text" value={depoWithholdEtc} onChange={e => { setDepoWithholdEtc(e.target.value); setDepositRefundDirty(true) }}
                            placeholder="사유를 직접 입력하세요"
                            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                        )}
                      </div>
                    )}
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">미환불분은 {withheldDestinationLabel(Math.max(0, unreturned), cleaningFeeDeductible(fee, depoCleaningPaid), fmtWon)} 입금수단 &apos;보유 보증금&apos;으로 자동 기록됩니다.</p>
                    {exceedsMax && (
                      <p className="text-[0.6875rem] text-[var(--danger-fg)]">환불 금액은 최대 {fmtWon(maxRefund)}입니다.</p>
                    )}
                  </div>
                </div>

                {/* 합계 — 자동 합산 읽기전용(§12). 총 환불액만 bold·success 강조 */}
                <div className="rounded-lg px-3 py-2.5 text-xs space-y-1" style={{ background: 'color-mix(in srgb, var(--coral) 8%, transparent)', color: 'var(--warm-dark)' }}>
                  {rp && (
                    <div className="flex justify-between">
                      <span className="text-[var(--warm-muted)]">이용료 환불</span>
                      <span className="font-medium tabular-nums">{fmtWon(rentRefundAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[var(--warm-muted)]">보증금 환불</span>
                    <span className="font-medium tabular-nums">{fmtWon(depositReturnAmt)}</span>
                  </div>
                  {unreturned > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[var(--warm-muted)]">부가수익 귀속</span>
                      <span className="font-medium tabular-nums">{fmtWon(unreturned)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-1" style={{ borderColor: 'var(--warm-border)' }}>
                    <span className="font-semibold">총 환불액</span>
                    <span className="font-bold tabular-nums text-[var(--success-fg)]">{fmtWon(totalRefund)}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">환불일</label>
                  <DatePicker value={depositReturnDate} onChange={v => { setDepositReturnDate(v); setDepositRefundDirty(true) }}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                </div>

                <p className="text-[0.65625rem] text-[var(--warm-muted)]">이 창의 퇴실 처리를 눌러야 퇴실이 저장됩니다.</p>
                {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
              </div>

              <div className="px-5 pb-5 pt-1 flex gap-2">
                <button type="button" onClick={() => setDepositRefundModal(null)} disabled={isPending}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-[var(--warm-border)] text-[var(--warm-mid)] hover:opacity-70 transition-opacity disabled:opacity-50">
                  취소
                </button>
                <button type="button" onClick={handleDepositRefundConfirm} disabled={isPending || exceedsMax || rentExceeds}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ background: 'var(--warning-solid)', color: 'var(--on-solid)' }}>
                  {isPending ? '처리 중…' : '퇴실 처리'}
                </button>
              </div>
          </Modal>
        )
      })()}

      {/* 가격 변동 적용 확인 모달 */}
      {rentChangeModal && (() => {
        const diff = rentChangeModal.scheduledRent - rentChangeModal.baseRent
        const dirLabel = diff > 0 ? '인상' : diff < 0 ? '인하' : '동결'
        const dirColor = diff > 0 ? 'text-[var(--danger-fg)]' : diff < 0 ? 'text-[var(--success-fg)]' : 'text-[var(--warm-dark)]'
        return (
          <Modal open z={280} width="sm" onClose={() => setRentChangeModal(null)}
            title="가격 변동 적용" bodyClassName="px-5 sm:px-6 py-4 space-y-4">
              <p className="text-sm text-[var(--warm-mid)] leading-relaxed">
                <span className="font-semibold text-[var(--warm-dark)]">{fmtRoomNo(rentChangeModal.roomNo)}</span>가 공실로 변경됩니다. 예정된 가격 변동을 즉시 적용할까요?
              </p>
              <div className="bg-[var(--canvas)] rounded-sm px-3 py-2.5 text-sm flex items-center justify-center gap-2 flex-wrap">
                <span className="text-[var(--warm-muted)]">기존</span>
                <span className="font-semibold text-[var(--warm-dark)]">{fmtWon(rentChangeModal.baseRent)}</span>
                <span className="text-[var(--warm-muted)]" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
                <span className={`font-semibold ${dirColor}`}>{dirLabel} {fmtWon(rentChangeModal.scheduledRent)}</span>
              </div>
              <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
                네: 즉시 적용 (예정일 무시) · 아니오: 변경 예정일에 자동 적용
              </p>
              <div className="flex gap-2 pt-1">
                <Btn type="button" variant="secondary" size="md" disabled={isPending}
                  onClick={() => handleRentChangeChoice(false)} className="flex-1">
                  아니오
                </Btn>
                <Btn type="button" variant="primary" size="md" disabled={isPending}
                  onClick={() => handleRentChangeChoice(true)} className="flex-1">
                  네, 즉시 적용
                </Btn>
              </div>
          </Modal>
        )
      })()}


      {/* 모바일 카드 뷰 — 빈 상태는 v2.0 §17 공용 EmptyState */}
      {sorted.length === 0 ? (
        <EmptyState
          className="sm:hidden"
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" /></svg>}
          title={search.trim() ? '검색 결과가 없습니다' : '입주자가 없습니다'}
          description={search.trim() ? '다른 검색어로 시도해 보세요.' : '입주자를 등록하면 이곳에 표시됩니다.'}
        />
      ) : (
        <div className="sm:hidden space-y-2">
          {sorted.map(tenant => {
            const lease   = mainLease(tenant)
            const primary = tenant.contacts.find(c => c.isPrimary) ?? tenant.contacts[0]
            const status  = lease?.status ?? ''
            const stayPeriod = calcStayPeriod(lease?.moveInDate, lease?.moveOutDate ?? undefined, today)
            const tipTone = leaseTipTone(status)
            return (
              <RoomCard key={tenant.id}
                kind={leaseCardKind(status)}
                tipColor={tipTone ? statusTipColor(tipTone) : undefined}
                tipBg={tipTone ? statusRowTint(tipTone) : undefined}
                selected={selectMode && selectedIds.has(tenant.id)}
                onClick={() => selectMode ? toggleSelectTenant(tenant.id) : openTenantPrism(tenant)}
                onLongPress={!selectMode ? () => { setSelectMode(true); toggleSelectTenant(tenant.id) } : undefined}
                className="p-4"
              >
                {/* 첫 줄: 호실(또는 희망 조건/미배정) + 이름 + 상태 */}
                {/* CANCELLED 칩이 처음으로 보이게 되면서 우측 폭이 길어졌다. 가드가 없으면
                    이름이 긴 입주자에서 줄바꿈으로 행 높이가 늘어난다(§20). */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {lease?.room?.roomNo ? (
                      <>
                        {/* 표의 호실 칸과 같은 꼬리 — 카드에만 없으면 좁은 화면에서 그 사실이 사라진다. */}
                        <span className="min-w-0 truncate text-sm font-bold tnum text-[var(--warm-dark)]">
                          {fmtRoomNo(lease.room.roomNo)}
                          {(() => { const s = extraRoomSuffix(tenant, lease); return s ? <span className="font-normal text-[var(--warm-muted)]">{s}</span> : null })()}
                        </span>
                        {lease.room.floor && <span className="text-[0.65625rem] px-1.5 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">{lease.room.floor}층</span>}
                      </>
                    ) : (() => {
                      // 호실 미배정자 — wishRooms > wishConditions > '미배정' 순으로 라벨 결정
                      const wishRoomList = (lease?.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
                      const cond = parseWishConditions(lease?.wishConditions)
                      const condParts: string[] = []
                      if (cond.floor) condParts.push(`${cond.floor}층`)
                      if (cond.windowType) condParts.push(WISH_WINDOW_LABEL[cond.windowType] ?? cond.windowType)
                      if (cond.type) condParts.push(cond.type)
                      if (cond.direction) condParts.push(cond.direction)
                      const minR = cond.minRent ?? 0; const maxR = cond.maxRent ?? 400000
                      if (minR !== 0 || maxR !== 400000) condParts.push(`${(minR/10000).toFixed(0)}~${(maxR/10000).toFixed(0)}만`)
                      let label: string
                      if (wishRoomList.length > 0) {
                        label = `희망 ${wishRoomList[0]}호${wishRoomList.length > 1 ? ` 외 ${wishRoomList.length - 1}` : ''}`
                      } else if (condParts.length > 0) {
                        label = condParts.join('·')
                      } else {
                        label = '미배정'
                      }
                      return (
                        <span className="text-[0.6875rem] px-1.5 py-0.5 rounded-md bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-muted)] font-medium">
                          {label}
                        </span>
                      )
                    })()}
                    {/* 카드에 부를 이름 — 입주자 정보의 '카드 표시 이름' 선택을 따른다(lib/displayName 정본).
                        홈 방 현황 타일과 같은 규칙이다. 원천이 비면 한글 이름으로 돌아온다. */}
                    <span className="min-w-0 truncate text-sm font-semibold text-[var(--warm-dark)]">{displayName(tenant, tenant.displayNameStyle)}</span>
                  </div>
                  {/* CANCELLED 를 게이트에 더한다 — statusException('CANCELLED') 이 null 이라
                      이 조건이 항상 false 였고, 바로 아래 quietSub 삼항식은 **실행되지 않는 죽은 코드**였다.
                      모바일에서 취소 단계가 한 번도 보인 적이 없다(신고 ad517231). */}
                  {(status === 'RESERVED' || status === 'CANCELLED' || statusException(status)) && (
                    <span className="shrink-0"><StatusChip status={status} confirmed={!!lease?.reservationConfirmedAt} moveInDate={lease?.moveInDate} today={today} hasTourDate={!!lease?.tourDate}
                      quietSub={status === 'CANCELLED' ? cancelStageText(lease) : undefined} /></span>
                  )}
                </div>
                {/* 종료 사유 캡션 — 입실 취소·퇴실 사유. 칩에는 단계까지만 넣고(짧은 값 자리)
                    길이 제한이 없는 사유는 여기 한 줄로 내린다. 없으면 줄을 아예 안 그린다. */}
                {endReasonText(lease) && ENDED_STATUSES.includes(status) && (
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-2 truncate">
                    {status === 'CANCELLED' ? '취소 사유' : '퇴실 사유'}: {endReasonText(lease)}
                  </p>
                )}
                {/* 매칭 제외 사유 — 희망한 방이 하나 이상 있었는데 전부 입주 희망일과 안 맞아 후보에서 빠졌다.
                    홈 알림은 수만 알려 준다("제외 N명"). 누구인지 여기서 짚어야 그분께 연락할 수 있다. */}
                {lease && wishDateNoticeSet.has(lease.id) && (
                  <p className="text-[0.65625rem] text-[var(--warning-fg)] mb-2 truncate">
                    현재 희망일에 맞는 방 없음
                  </p>
                )}
                {/* 연락처 — 탭하면 바로 전화 */}
                {cardFields.contact && primary && (
                  <a href={`tel:${primary.contactValue.replace(/[^0-9+]/g, '')}`} onClick={e => e.stopPropagation()}
                    className="text-xs text-[var(--coral)] mb-2 inline-block hover:underline underline-offset-2">{formatPhone(primary.contactValue)}</a>
                )}
                {/* 이용료 · 납부일 — 단기는 rentAmount가 체류 전체 사용료라 라벨 '이용료',
                    매월 반복 납부 개념이 없어 납부일 대신 청소비 병기(신고 64bebb05, 운영자 승인 2026-07-20) */}
                {!hideMoney && cardFields.payment && (
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="text-[var(--warm-muted)]">{lease?.isShortTerm ? '이용료' : '월이용료'}</span>
                    <span className="font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={lease?.rentAmount ?? 0} /></span>
                    {/* 단기 계약 단위 — 연장 시 몇 주째인지 한눈에(정책 unitDays 기준, 날짜 결측 시 생략) */}
                    {lease?.isShortTerm && (() => {
                      const din = lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null
                      const dout = lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10)
                        : lease.moveOutDate ? new Date(lease.moveOutDate).toISOString().slice(0, 10) : null
                      const days = din && dout ? stayDaysOf(din, dout) : null
                      if (days == null) return null
                      return (
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">
                          ({shortStayUnitDays === 7 ? `${Math.ceil(days / shortStayUnitDays)}주` : `${days}일`})
                        </span>
                      )
                    })()}
                    {lease?.isShortTerm ? (
                      lease.cleaningFee > 0 && (
                        <>
                          <span className="text-[var(--warm-border)]">·</span>
                          <span className="text-[var(--warm-muted)]">청소비</span>
                          <span className="font-medium text-[var(--warm-dark)]"><MoneyDisplay amount={lease.cleaningFee} /></span>
                        </>
                      )
                    ) : !['RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CANCELLED'].includes(lease?.status ?? '') ? (
                      // 거주 전 상태는 납부일 표시 안 함 — 아직 정해지지 않은 값(운영자 지적 2026-07-30, 단기 문법과 동일)
                      <>
                        <span className="text-[var(--warm-border)]">·</span>
                        <span className="text-[var(--warm-muted)]">납부일</span>
                        <span className="font-medium text-[var(--warm-dark)]">{fmtDueDay(lease?.dueDay)}</span>
                      </>
                    ) : null}
                    {lease && (
                      <button type="button" onClick={e => { e.stopPropagation(); openPayModal(tenant, lease) }}
                        className="ml-auto shrink-0 inline-flex items-center justify-center min-h-[44px] -my-2 px-3 text-xs font-semibold text-[var(--coral)]">
                        수납
                      </button>
                    )}
                  </div>
                )}
                {/* 보증금 · 거주기간 */}
                {cardFields.deposit && ((lease?.depositAmount ?? 0) > 0 || lease?.moveInDate) && (() => {
                  const isReservation = lease && ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CANCELLED'].includes(lease.status)
                  // 확정 예약자는 받은 돈이 예약금(보증금 선수납)이라 라벨을 '예약금'으로 명시(운영자 요청 2026-07-15).
                  // 판정은 '입실 예정' 그룹과 같은 정본 함수 — 같은 사실을 두 식으로 적으면 언젠가 갈린다.
                  const confirmedResv = isConfirmedReservation(lease)
                  // 예약자는 예약금 모드에 따라 라벨 분기 — prepaid: 선납, none: 표시 안 함, 그 외: 예약금.
                  const resvMode = lease?.status === 'RESERVED'
                    ? resolveReservationDepositMode(lease.reservationDepositMode, propertyReservationDepositMode, lease.isShortTerm, shortStayReservationMode)
                    : null
                  const showDeposit = !hideMoney && (lease?.depositAmount ?? 0) > 0 && resvMode !== 'none'
                  const depositLabel = resvMode === 'prepaid' ? '이용료 선납' : confirmedResv ? '예약금' : '보증금'
                  return (
                    <div className="flex items-center gap-2 text-xs flex-wrap mt-1">
                      {showDeposit && (
                        <>
                          <span className="text-[var(--warm-muted)]">{depositLabel}</span>
                          <span className="font-medium text-[var(--warm-dark)]"><MoneyDisplay amount={lease!.depositAmount} /></span>
                        </>
                      )}
                      {showDeposit && lease?.moveInDate && (
                        <span className="text-[var(--warm-border)]">·</span>
                      )}
                      {lease?.moveInDate && (
                        <>
                          <span className="text-[var(--warm-muted)]">{isReservation ? '입주 희망일' : '거주기간'}</span>
                          <span className="font-medium text-[var(--warm-dark)]">{isReservation ? fmtDate(lease.moveInDate) : stayPeriod}</span>
                        </>
                      )}
                    </div>
                  )
                })()}
              </RoomCard>
            )
          })}
        </div>
      )}

      {/* 데스크탑 테이블 — 빈 상태는 v2.0 §17 공용 EmptyState */}
      {sorted.length === 0 ? (
        <EmptyState
          className="hidden sm:block"
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" /></svg>}
          title={search.trim() ? '검색 결과가 없습니다' : '입주자가 없습니다'}
          description={search.trim() ? '다른 검색어로 시도해 보세요.' : '입주자를 등록하면 이곳에 표시됩니다.'}
        />
      ) : (
        <div className="hidden sm:block relative bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100dvh-310px)]">
          {/* 저장 후 서버 재요청 완료 전 클릭 차단 오버레이 */}
          {(isPending || isRefreshing) && (
            <div className="absolute inset-0 z-40 rounded-xl bg-[var(--cream)]/60 backdrop-blur-[1px] flex items-center justify-center">
              <div className="flex items-center gap-2 text-xs text-[var(--warm-muted)]">
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                업데이트 중…
              </div>
            </div>
          )}
          <table className="w-full" style={{ tableLayout: 'fixed', minWidth: colWidths.roomNo + colWidths.name + visibleCols.reduce((s, c) => s + (colWidths[c.key] ?? 100), 0) }}>
            <thead className="sticky top-0 z-30 bg-[var(--cream)]">
              <tr className="border-b border-[var(--warm-border)]">
                {/* sticky — 호실 */}
                <th
                  onClick={() => handleSort('roomNo')}
                  className={`relative sticky left-0 z-40 bg-[var(--cream)] text-left text-xs font-medium px-4 py-3 cursor-pointer select-none overflow-hidden transition-colors ${sortKey === 'roomNo' ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}
                  style={{ width: colWidths.roomNo, minWidth: colWidths.roomNo, maxWidth: colWidths.roomNo }}
                >
                  <span className="truncate block">호실{sortKey === 'roomNo' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
                  <div onMouseDown={e => startResize('roomNo', e)} onClick={e => e.stopPropagation()}
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize group" style={{ userSelect: 'none' }}>
                    <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
                  </div>
                </th>
                {/* sticky — 이름 */}
                <th
                  onClick={() => handleSort('name')}
                  className={`relative sticky z-40 bg-[var(--cream)] text-left text-xs font-medium px-4 py-3 cursor-pointer select-none overflow-hidden transition-colors ${sortKey === 'name' ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}
                  style={{ left: colWidths.roomNo, width: colWidths.name, minWidth: colWidths.name, maxWidth: colWidths.name }}
                >
                  <span className="truncate block">이름{sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
                  <div onMouseDown={e => startResize('name', e)} onClick={e => e.stopPropagation()}
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize group" style={{ userSelect: 'none' }}>
                    <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
                  </div>
                </th>
                {visibleCols.map(c => {
                  const sortMap: Partial<Record<ColKey, SortKey>> = {
                    rentAmount: 'rentAmount', depositAmount: 'depositAmount',
                    moveOutDate: 'moveOutDate', status: 'status',
                    nationality: 'nationality', gender: 'gender',
                    stayPeriod: 'stayPeriod', dueDay: 'dueDay',
                  }
                  const sk = sortMap[c.key]
                  return sk
                    ? <SortTh key={c.key} label={c.label} sKey={sk} colKey={c.key} />
                    : <ResizableTh key={c.key} label={c.label} colKey={c.key} />
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map(tenant => {
                const lease   = mainLease(tenant)
                const primary = tenant.contacts.find(c => c.isPrimary)
                const status  = lease?.status ?? ''
                const sched   = getScheduledDate(lease)
                const tipTone = leaseTipTone(status)
                // 고정(sticky) 열은 가로 스크롤 대비 불투명 배경이 필요해 행(tr)의 반투명 hover·선택 배경이 가려진다.
                // 같은 결과색을 color-mix 로 직접 재현해 호실·이름 열도 함께 하이라이트되게 한다.
                const stickyRowBg = selectMode && selectedIds.has(tenant.id)
                  ? 'bg-[color-mix(in_srgb,var(--coral)_5%,var(--cream))]'
                  : 'bg-[var(--cream)] group-hover:bg-[color-mix(in_srgb,var(--canvas)_40%,var(--cream))]'

                return (
                  <tr key={tenant.id}
                    onClick={() => selectMode ? toggleSelectTenant(tenant.id) : openTenantPrism(tenant)}
                    {...press(!selectMode ? () => { setSelectMode(true); toggleSelectTenant(tenant.id) } : undefined)}
                    className={`group border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 active:bg-[var(--canvas)] active:opacity-80 transition-colors cursor-pointer ${selectMode && selectedIds.has(tenant.id) ? 'bg-[var(--coral)]/5 ring-inset ring-1 ring-[var(--coral)]/30' : ''}`}
                  >
                    {/* sticky — 호실 (클릭 시 호실 관리 페이지로) */}
                    <td className={`sticky left-0 z-20 px-4 py-3 text-sm font-semibold overflow-hidden transition-colors ${stickyRowBg}`}
                      style={{ maxWidth: colWidths.roomNo, borderLeft: tipTone ? `3px solid ${statusTipColor(tipTone)}` : undefined }}
                      onClick={e => { e.stopPropagation(); if (lease?.room?.id) setRoomDetailId(lease.room.id) }}>
                      {/* 방을 둘 쓰는 사람은 꼬리로 나머지 호실을 적는다 — 이 칸은 메인 계약 하나만
                          말해 왔고, 그 사실이 표 어디에도 없었다(프리즘 '추가 계약' 줄과 같은 술어).
                          꼬리는 링크가 아니라 사실 표기라 코랄을 안 쓴다. 칸이 좁으면 종전대로 잘린다. */}
                      <span className="block truncate text-[var(--coral)] cursor-pointer underline-offset-2 hover:underline">
                        {fmtRoomNo(lease?.room?.roomNo)}
                        {(() => { const s = extraRoomSuffix(tenant, lease); return s ? <span className="font-normal text-[var(--warm-muted)]">{s}</span> : null })()}
                      </span>
                    </td>
                    {/* sticky — 이름 */}
                    <td className={`sticky z-20 px-4 py-3 overflow-hidden transition-colors ${stickyRowBg}`}
                      style={{ left: colWidths.roomNo, maxWidth: colWidths.name }}>
                      {/* 카드와 같은 이름 — 같은 목록의 두 표현이라 부르는 말이 갈리면 안 된다(lib/displayName). */}
                      <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{displayName(tenant, tenant.displayNameStyle)}</p>
                      {/* 매칭 제외 사유 — 카드와 같은 문장. 표는 열이 정해져 있어 이름 아래 캡션으로 내린다. */}
                      {lease && wishDateNoticeSet.has(lease.id) && (
                        <p className="text-[0.65625rem] text-[var(--warning-fg)] truncate">현재 희망일에 맞는 방 없음</p>
                      )}
                    </td>
                    {visibleCols.map(c => {
                      const tdBase = 'px-4 py-3 overflow-hidden'
                      switch (c.key) {
                        case 'nationality': {
                          const f = flagByName(tenant.nationality)
                          return (
                            <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-dark)]`}>
                              <span className="block truncate">{tenant.nationality ? `${f} ${tenant.nationality}` : '—'}</span>
                            </td>
                          )
                        }
                        case 'gender':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{GENDER_LABEL[tenant.gender] ?? '—'}</span></td>
                        case 'englishName':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{tenant.englishName || '—'}</span></td>
                        case 'job':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{tenant.job || '—'}</span></td>
                        case 'contact':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{primary?.contactValue ? formatPhone(primary.contactValue) : '—'}</span></td>
                        case 'payMethod':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{lease?.payMethod || '—'}</span></td>
                        case 'depositAmount':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-dark)]`}><span className="block truncate">{lease && lease.depositAmount > 0 ? <MoneyDisplay amount={lease.depositAmount} /> : '—'}</span></td>
                        case 'rentAmount':
                          return (
                            <td key={c.key}
                              onClick={e => { e.stopPropagation(); if (lease) openPayModal(tenant, lease) }}
                              className={`${tdBase} text-sm text-[var(--warm-dark)] transition-colors ${lease ? 'cursor-pointer hover:text-[var(--coral)]' : ''}`}>
                              {lease ? (
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <span className="truncate underline decoration-dotted decoration-[var(--coral)]/50 underline-offset-2"><MoneyDisplay amount={lease.rentAmount} /></span>
                                  {lease.isShortTerm && lease.cleaningFee > 0 && (
                                    <span className="shrink-0 text-[0.65625rem] text-[var(--warm-muted)]">청소비 <MoneyDisplay amount={lease.cleaningFee} /></span>
                                  )}
                                  <span className="shrink-0 text-[0.625rem] font-medium text-[var(--coral)]">수납</span>
                                </span>
                              ) : <span className="block truncate">—</span>}
                            </td>
                          )
                        case 'dueDay':
                          // 단기는 입주월 1회 전액 청구라 '매월 N일'이 없다 — 카드 뷰와 같은 규칙으로 비운다.
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{lease?.isShortTerm ? '—' : fmtDueDay(lease?.dueDay)}</span></td>
                        case 'stayPeriod':
                          return (
                            <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}>
                              <span className="block truncate">{calcStayPeriod(lease?.moveInDate, lease?.moveOutDate ?? undefined, today)}</span>
                            </td>
                          )
                        case 'status': {
                          const ddLabel = sched ? fmtDDay(sched.date, today) : null
                          const ddColor = sched?.label === '입실' ? 'text-[var(--warm-mid)]' : 'text-[var(--coral)]'
                          return (
                            <td key={c.key} className={tdBase}>
                              <div className="flex flex-col gap-0.5">
                                <span className="self-start"><StatusChip status={status} confirmed={!!lease?.reservationConfirmedAt} hasTourDate={!!lease?.tourDate}
                                  quietSub={status === 'CANCELLED' ? cancelStageText(lease) : undefined} /></span>
                                {ddLabel && <span className={`text-xs font-medium pl-1 whitespace-nowrap ${ddColor}`}>{ddLabel}</span>}
                              </div>
                            </td>
                          )
                        }
                        case 'scheduledDate':
                          return (
                            <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}>
                              <span className="block truncate">{sched ? fmtShortDate(sched.date) : '—'}</span>
                            </td>
                          )
                        case 'moveOutDate':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{fmtDate(lease?.moveOutDate)}</span></td>
                        case 'checkoutReason':
                        case 'cancelReason':
                          // 카드와 같은 상태 가드를 건다. past 탭에는 NON_RESIDENT 도 들어와서,
                          // 가드가 없으면 '퇴실 사유' 열에 옛 입실 취소 사유가 찍힌다.
                          // 표는 열 정렬이 있어 빈 값에 대시를 찍는다(카드는 줄을 아예 안 그린다 — 매체 차이).
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{ENDED_STATUSES.includes(status) ? (endReasonText(lease) ?? '—') : '—'}</span></td>
                        default: return null
                      }
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 편집 폼 모달 — 페이지 종속 (상세 팝업은 전역 Prism 셸이 담당, Phase 2.3c) */}
      {detailTenant && detailEditMode && (() => {
        const t = detailTenant
        // 세그먼트가 고른 계약. 값이 이 사람의 것이 아니면 메인 계약으로 되돌아간다.
        const editLease = t.leaseTerms.find(l => l.id === detailEditLeaseId) ?? mainLease(t)
        const closeEdit = () => {
          setDetailEditMode(false); setDetailTenant(null); setError('')
          clearTenantUrlParams()
        }
        return (
          <Modal open z={260} width="lg" dirty={detailEditDirty}
            onClose={() => { setDetailEditDirty(false); closeEdit() }}
            // 풀블리드 — 스크롤 본문과 폭 전체 구분선 액션 바를 children 의 form 이 직접 구성한다.
            bodyClassName=""
            title={`입주자 정보 수정 · ${t.name}`}>
              <form key={t.id} onSubmit={handleUpdateFromDetail} className="flex flex-col flex-1 overflow-hidden"
                onInput={() => requestAnimationFrame(() => setDetailEditDirty(true))} onChange={() => setDetailEditDirty(true)}>
                <input type="hidden" name="tenantId"    value={t.id} />
                <input type="hidden" name="leaseTermId" value={editLease?.id ?? ''} />
                <div className="overflow-y-auto p-6 space-y-4 flex-1">
                  {/* 계약 전환 세그먼트 + 계약별 폼. 방을 둘 쓰는 사람에게만 세그먼트가 뜨고,
                      오가는 동안 각 계약의 미저장 입력은 그대로 남는다(목록 경유 수정 창과 같은 한 벌). */}
                  <LeaseEditForms key={t.id} tenant={t} activeLeaseId={editLease?.id ?? ''} onChangeLease={setDetailEditLeaseId} rooms={rooms}
                    error={error} defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} contactLeadDays={contactLeadDays} />
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex flex-wrap gap-2 shrink-0">
                  {/* 계약 추가 — 목록 경유 수정 모달과 같은 문. 수정 창이 두 벌이라 한쪽에만 두면
                      프리즘 경유(운영자 주 동선)에서 문이 안 보인다(2026-08-13 실기 신고). */}
                  <Btn type="button" variant="secondary" size="md"
                    onClick={() => { setDetailEditMode(false); setDetailTenant(null); setDetailEditDirty(false); setError(''); clearTenantUrlParams(); setAddLeaseTenant(t) }}
                    className="basis-full sm:flex-1 sm:basis-0">
                    계약 추가
                  </Btn>
                  <Btn type="button" variant="secondary" size="md" onClick={closeEdit} className="flex-1">취소</Btn>
                  <Btn type="submit" variant="primary" size="md" disabled={isPending} className="flex-1">
                    {isPending ? '저장 중…' : '저장'}
                  </Btn>
                </div>
              </form>
          </Modal>
        )
      })()}


      {/* ── 배치 편집 모달 ─────────────────────────────────────────── */}
      {showBatchEdit && (
        <BatchEditTenantsModal
          selectedIds={Array.from(selectedIds)}
          onClose={() => setShowBatchEdit(false)}
          onDone={() => { setShowBatchEdit(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 배치 액션 바 — v2.0 §22 공용 SelectionPillBar */}

      {selectMode && selectedIds.size > 0 && (
        <SelectionPillBar count={selectedIds.size} unit="명" onClose={exitSelectMode}>
          <PillButton primary onClick={() => setShowBatchEdit(true)}>일괄 편집</PillButton>
        </SelectionPillBar>
      )}

      {/* ── 입주자 추가 모달 ────────────────────────────────────────── */}
      {showAdd && (
        <Modal open width="lg" dirty={addTenantDirty}
          onClose={() => { setShowAdd(false); setAddTenantDirty(false) }} title="입주자 등록">
            <form onSubmit={handleAdd} className="space-y-4"
              onInput={() => requestAnimationFrame(() => setAddTenantDirty(true))} onChange={() => setAddTenantDirty(true)}>
              <TenantForm rooms={rooms} error={error} defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} contactLeadDays={contactLeadDays} />
              <div className="flex gap-2 pt-2">
                <Btn type="button" variant="secondary" size="md" onClick={() => setShowAdd(false)}
                  className="flex-1">
                  취소
                </Btn>
                <Btn type="submit" variant="primary" size="md" disabled={isPending}
                  className="flex-1">
                  {isPending ? '저장 중…' : '저장'}
                </Btn>
              </div>
            </form>
        </Modal>
      )}

      {/* ── 입주자 수정 모달 ────────────────────────────────────────── */}
      {editTenant && (() => {
        // 세그먼트가 고른 계약. 값이 이 사람의 것이 아니면 메인 계약으로 되돌아간다.
        const editLease = editTenant.leaseTerms.find(l => l.id === editLeaseId) ?? mainLease(editTenant)
        return (
        <Modal open width="lg" dirty={editTenantDirty}
          onClose={() => { setEditTenant(null); setEditTenantDirty(false) }}
          title={`수정 · ${editTenant.name}`}>
            <form key={editTenant.id} onSubmit={handleUpdate} className="space-y-4"
              onInput={() => requestAnimationFrame(() => setEditTenantDirty(true))} onChange={() => setEditTenantDirty(true)}>
              <input type="hidden" name="tenantId"    value={editTenant.id} />
              <input type="hidden" name="leaseTermId" value={editLease?.id ?? ''} />
              {/* 계약 전환 세그먼트 + 계약별 폼(프리즘 경유 수정 창과 같은 한 벌). */}
              <LeaseEditForms key={editTenant.id} tenant={editTenant} activeLeaseId={editLease?.id ?? ''} onChangeLease={setEditLeaseId} rooms={rooms}
                error={error} defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} contactLeadDays={contactLeadDays} />
              {/* 320px 에서 셋을 한 줄에 두면 버튼 안쪽 폭이 56px 로 눌려 '계약 추가'가 두 줄로 접힌다
                  (280px 본문 − 간격 16px ÷ 3 − 좌우 여백 32px). 좁은 화면에서는 제 줄을 갖고, 넓어지면
                  종전대로 취소·저장 옆에 선다. §22 solid 는 여전히 '저장' 하나뿐이다. */}
              <div className="flex flex-wrap gap-2 pt-2">
                {/* 계약 추가 — 이 사람에게 방을 하나 더(창고·사무실 명의 등). 수정 폼 옆에 두는 것은
                    같은 사람을 새 입주자로 또 등록하는 길목이 여기이기 때문이다. */}
                <Btn type="button" variant="secondary" size="md"
                  onClick={() => { const t = editTenant; setEditTenant(null); setEditTenantDirty(false); setError(''); setAddLeaseTenant(t) }}
                  className="basis-full sm:flex-1 sm:basis-0">
                  계약 추가
                </Btn>
                <Btn type="button" variant="secondary" size="md" onClick={() => setEditTenant(null)}
                  className="flex-1">
                  취소
                </Btn>
                <Btn type="submit" variant="primary" size="md" disabled={isPending}
                  className="flex-1">
                  {isPending ? '저장 중…' : '저장'}
                </Btn>
              </div>
            </form>
        </Modal>
        )
      })()}

      {/* ── 계약 추가 모달 ─────────────────────────────────────────── */}
      {addLeaseTenant && (
        <Modal open width="lg" dirty={addLeaseDirty}
          onClose={() => { setAddLeaseTenant(null); setAddLeaseDirty(false) }}
          title={`계약 추가 · ${addLeaseTenant.name}`}
          subtitle="이 입주자에게 계약을 하나 더 만듭니다. 이름·연락처 등 입주자 정보는 바뀌지 않습니다.">
            <form key={`lease-${addLeaseTenant.id}`} onSubmit={handleAddLease} className="space-y-4"
              onInput={() => requestAnimationFrame(() => setAddLeaseDirty(true))} onChange={() => setAddLeaseDirty(true)}>
              <input type="hidden" name="tenantId" value={addLeaseTenant.id} />
              {/* 맥락 배너 — 이 창이 '새 사람 등록'이 아니라 '있는 사람에게 방을 하나 더'라는 것을 본문 첫 줄에서 말한다.
                  운영자 실기 지적(2026-08-13): 본문이 등록 창과 같은 폼이라 "아까 분명 입력했는데 왜 빈칸이지?" 로 읽힌다.
                  제목(계약 추가 · 이름)과 부제만으로는 안 걸렸다 — 부제는 10.5px muted 라 시선에 안 잡힌다.
                  문법은 이 페이지가 이미 쓰는 --info-* 인라인 배너(수납 모달 양도인 귀속·자동 분배 요약)를 그대로 쓴다.
                  새 패턴을 신설하지 않는 이유는 §27 — 가이드 등재 없는 임의 신설 금지다. 순서는 roomLeaseRowOrder 정본
                  (거주 → 예약 → 비거주)이라 수납 폼의 계약 세그먼트와 같은 줄 순서로 읽힌다. */}
              {(() => {
                const alive = addLeaseTenant.leaseTerms.filter(l => !['CHECKED_OUT', 'CANCELLED'].includes(l.status))
                const ordered = roomLeaseRowOrder(alive)
                // roomLeaseRowOrder 는 거주·예약·비거주 세 층만 세운다 — 문의·투어 단계는 층이 없어 빠진다.
                // 이 배너의 일은 '지금 가진 계약'을 빠짐없이 보이는 것이라, 남은 단계를 뒤에 잇는다.
                // 빠뜨리면 배너가 바로 그 오해("이거 말고 또 있었나?")를 새로 만든다.
                const existing = [...ordered, ...alive.filter(l => !ordered.includes(l))]
                if (existing.length === 0) return null
                return (
                  <div className="bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-xl px-3 py-2.5 space-y-1.5">
                    <p className="text-xs font-semibold text-[var(--info-fg)]">{addLeaseTenant.name} 님이 지금 가진 계약</p>
                    <ul className="space-y-0.5">
                      {existing.map(l => (
                        <li key={l.id} className="text-xs text-[var(--info-fg)] leading-relaxed">
                          {[fmtRoomNo(l.room?.roomNo, ''), STATUS_LABEL[l.status] ?? l.status, l.rentAmount > 0 ? fmtWon(l.rentAmount) : '']
                            .filter(Boolean).join(' · ')}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-[var(--info-fg)] leading-relaxed opacity-80">아래 칸은 여기에 더할 새 계약이라 비어 있습니다.</p>
                  </div>
                )
              })()}
              {/* tenant 를 넘기지 않는다 — 넘기면 기존 계약 값이 프리필돼 새 계약이 옛 계약의 사본이 된다.
                  parentLeases 만 예외다. 값이 아니라 '고를 수 있는 계약 목록'이라 프리필이 아니고,
                  단독 계약 불가 방(창고)을 고르면 이 칸이 필수가 된다. */}
              <TenantForm rooms={rooms} leaseOnly parentLeases={parentLeaseOptions(addLeaseTenant)}
                error={error} defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} contactLeadDays={contactLeadDays} />
              <div className="flex gap-2 pt-2">
                <Btn type="button" variant="secondary" size="md" onClick={() => setAddLeaseTenant(null)}
                  className="flex-1">
                  취소
                </Btn>
                <Btn type="submit" variant="primary" size="md" disabled={isPending}
                  className="flex-1">
                  {isPending ? '저장 중…' : '계약 추가'}
                </Btn>
              </div>
            </form>
        </Modal>
      )}

      {/* ── 수납 모달 ─────────────────────────────────────────────── */}
      {payTarget && (() => {
        const { tenant, lease } = payTarget
        // 이 사람의 청구 계약들 — 둘 이상이면 수납 폼이 어느 계약에 넣는지 고를 수 있어야 한다.
        // 기본 선택은 메인 계약(openPayModal 이 mainLease 로 연다)이고, 여기서 다른 계약으로 넘어간다.
        // 미납을 다른 계약에서 자동으로 충당하지는 않는다 — 청구는 계약별이고 합산은 표시뿐이다
        // (운영자 확정 2026-08-13). 고르는 일은 사람이 한다.
        const payableLeases = roomLeaseRowOrder(
          tenant.leaseTerms.filter(l => ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'RESERVED'].includes(l.status)),
        )
        const adjRecords = payHistory.filter(p => p.memo?.startsWith('[납입일변경]'))
        const regularRecords = payHistory.filter(p => !p.memo?.startsWith('[납입일변경]') && !p.isDeposit)
        // 목록에 그릴 집합 — 3개월 창. 위 regularRecords 는 금액 계산용이라 조회월 기준 그대로 둔다.
        const regularWindow = payWindow.filter(p => !p.memo?.startsWith('[납입일변경]'))
        const isPreAcq = (p: PayRecord) => !!(payAcquisitionDate && new Date(p.payDate) < payAcquisitionDate)
        const prevOwnerPaid = regularRecords.filter(isPreAcq).reduce((s, p) => s + p.actualAmount, 0)
        const regularPaid = regularRecords.reduce((s, p) => s + p.actualAmount, 0) - prevOwnerPaid
        const adjNet = adjRecords.reduce((s, p) => s + p.actualAmount, 0)
        // 청구·잔액은 서버 정본 — 클라에서 lease.rentAmount(원가)로 빼면 할인·인상이 빠진다(신고 50a2a69b).
        const expected = paySettlement?.expected ?? lease.rentAmount
        const balance = paySettlement?.balance ?? null
        // 예약 단계는 잔액이 0으로 잠겨 있어 '입주 시 낼 금액'(할인 반영 이용료 − 선납)으로 대신 보여준다.
        const resvPaid = lease.status === 'RESERVED' ? (paySettlement?.reservationPaid ?? null) : null
        const resvDue = resvPaid ? Math.max(0, expected - resvPaid.prepaid) : 0
        const DAYS = ['일', '월', '화', '수', '목', '금', '토']
        const fmtPayDate = (d: Date | string) => {
          const dt = new Date(d)
          return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
        }
        return (
          <Modal open width="md" onClose={closePayModal} dirty={showPayForm}
            // 풀블리드 — 스크롤 본문과 폭 전체 구분선 액션 바를 children 이 직접 구성한다.
            bodyClassName=""
            title={`${lease.room?.roomNo ? `${fmtRoomNo(lease.room.roomNo)} — ` : ''}${tenant.name}`}
            subtitle={`${targetMonth} · ${paySettlement?.noBillReason ? '청구 없음' : `예정 ${fmtWon(expected)}`}`}>

              {/* 계약 전환 — 방을 둘 쓰는 사람에게만 뜬다. 계약이 하나면 세그먼트가 없다(픽셀 무변동). */}
              {payableLeases.length > 1 && (
                <div className="px-6 pt-4">
                  <SegmentedControl
                    ariaLabel="수납할 계약"
                    size="sm"
                    scroll
                    value={lease.id}
                    options={payableLeases.map(l => ({ value: l.id, label: fmtRoomNo(l.room?.roomNo, '호실 미지정') }))}
                    onChange={id => { const next = payableLeases.find(l => l.id === id); if (next && next.id !== lease.id) void openPayModal(tenant, next) }}
                  />
                </div>
              )}

              {/* ── 읽기 전용 ── */}
              {!showPayForm && (
                <>
                  <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* 요약 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                        <p className="text-xs text-[var(--warm-muted)]">총 수납</p>
                        {/* 예약자는 조회월 무관 실수납 합(예약금+선납) — 프리즘 카드와 동일 숫자(신고 50a2a69b 잔여 정합) */}
                        <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]">
                          <MoneyDisplay amount={lease.status === 'RESERVED' && paySettlement?.reservationPaid
                            ? paySettlement.reservationPaid.deposit + paySettlement.reservationPaid.prepaid + paySettlement.reservationPaid.cleaning
                            : regularPaid} />
                        </p>
                        {lease.status === 'RESERVED' && paySettlement?.reservationPaid && (paySettlement.reservationPaid.deposit > 0 || paySettlement.reservationPaid.prepaid > 0 || paySettlement.reservationPaid.cleaning > 0) && (
                          <p className="text-[0.65625rem] mt-0.5 text-[var(--warm-muted)]">예약금 {fmtWon(paySettlement.reservationPaid.deposit + paySettlement.reservationPaid.prepaid + paySettlement.reservationPaid.cleaning)} 포함</p>
                        )}
                        {paySettlement?.noBillReason && fmtNoBillCovered({ month: paySettlement.noBillCoveredMonth, date: paySettlement.noBillCoveredDate, amount: paySettlement.noBillCoveredAmount }) ? (
                          <p className="text-[0.65625rem] mt-0.5 text-[var(--warm-muted)]">
                            {fmtNoBillCovered({ month: paySettlement.noBillCoveredMonth, date: paySettlement.noBillCoveredDate, amount: paySettlement.noBillCoveredAmount })}
                          </p>
                        ) : null}
                        {adjNet !== 0 && (
                          <p className="text-[0.65625rem] mt-0.5 font-medium"
                            style={{ color: adjNet > 0 ? 'var(--success-fg)' : 'var(--danger-fg)' }}>
                            조정 {adjNet > 0 ? '+' : ''}{fmtWon(adjNet)}
                          </p>
                        )}
                      </div>
                      <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                        <p className="text-xs text-[var(--warm-muted)] leading-tight">{resvPaid ? '입주 시 납부 예정' : paySettlement?.noBillReason ? '이 달 청구' : '잔액'}</p>
                        {resvPaid ? (
                          // 선납·미수(+/−)가 아니라 '앞으로 낼 금액' — 부호 없이 표기해 구분한다.
                          // 예정 톤(info) — PaymentSummaryCards 의 같은 타일과 반드시 동색(신고 d9e6ecd2).
                          <>
                            <p className="text-sm font-bold mt-0.5 text-[var(--info-fg)]">{fmtWon(resvDue)}</p>
                            {paySettlement?.moveInDate && targetMonth < paySettlement.moveInDate.slice(0, 7) && (
                              <p className="text-[0.65625rem] mt-0.5 text-[var(--warm-muted)]">이번 달 청구 없음 · {Number(paySettlement.moveInDate.slice(5, 7))}월 입주 예정</p>
                            )}
                          </>
                        ) : paySettlement?.noBillReason ? (
                          // 청구 없는 달 — 0원이 '안 냄'으로 읽히던 것을 사정대로(운영자 지적 2026-08-02).
                          // 수납관리 뱃지·모달 3카드와 같은 말을 해야 화면끼리 어긋나지 않는다.
                          <>
                            <p className="text-sm font-bold mt-0.5 text-[var(--warm-muted)]">청구 없음</p>
                            <p className="text-[0.65625rem] mt-0.5 text-[var(--warm-muted)]">
                              {paySettlement.noBillReason === 'shortTermPrepaid'
                                ? '입주월에 전액 납부'
                                : paySettlement.expectedMoveOut
                                  ? `${Number(paySettlement.expectedMoveOut.slice(5, 7))}/${Number(paySettlement.expectedMoveOut.slice(8))} 퇴실까지 납부됨`
                                  : '퇴실일까지 납부됨'}
                            </p>
                          </>
                        ) : balance === null ? (
                          <p className="text-sm font-bold mt-0.5 text-[var(--warm-muted)]">—</p>
                        ) : (
                          <p className={`text-sm font-bold mt-0.5 ${balance >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
                            {balance > 0
                              ? <MoneyDisplay amount={balance} prefix="+" />
                              : balance < 0
                                ? <MoneyDisplay amount={Math.abs(balance)} prefix="-" />
                                : '0원'}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* 보증금 — 계약 단위 정본. 종전 '보증금 수납 내역' 섹션은 조회월 목록을 걸러 만든 것이라
                        결제일이 조회월 밖이면 아무 메시지 없이 사라졌다(운영자 지적 2026-08-02).
                        수납 정보 모달과 같은 컴포넌트를 쓴다 — 두 화면이 갈렸던 이유가 각자 그렸기 때문이다. */}
                    {payLeaseId && paySettlement && (
                      <DepositStatusPanel
                        leaseTermId={payLeaseId}
                        status={paySettlement.status}
                        depositAmount={paySettlement.depositAmount}
                        cleaningFee={paySettlement.cleaningFee}
                        reservationDepositMode={paySettlement.reservationDepositMode}
                        canEdit={canEdit}
                        reloadSignal={payReloadKey}
                        onChanged={reloadPay}
                        tenantId={paySettlement.tenantId}
                        tenantName={paySettlement.tenantName}
                      />
                    )}

                    {prevOwnerPaid > 0 && (
                      <div className="flex items-center justify-between bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-xl px-3 py-2">
                        <p className="text-xs text-[var(--info-fg)]">양도인 귀속 (인수일 이전 납부)</p>
                        <p className="text-xs font-semibold text-[var(--info-fg)]">{fmtWon(prevOwnerPaid)}</p>
                      </div>
                    )}

                    {/* 자동 분배 요약 — 저장 후 모달 안에 지속 표시(닫을 때까지). 여러 달에 걸쳐 충당·이월된 내역 확인용 */}
                    {distNotice && (
                      <div className="flex items-start gap-2 bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-xl px-3 py-2.5">
                        <p className="text-xs font-medium text-[var(--info-fg)] leading-relaxed">{distNotice}</p>
                      </div>
                    )}

                    {/* 납입일 변경 조정 내역 */}
                    {adjRecords.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>납입일 변경 조정</p>
                        {adjRecords.map(p => {
                          const isExtra = p.actualAmount < 0
                          const absAmt = Math.abs(p.actualAmount)
                          const label = p.memo?.replace('[납입일변경] ', '') ?? ''
                          return (
                            <div key={p.id} className="flex items-center justify-between rounded-sm px-3 py-2.5"
                              style={{
                                background: isExtra ? 'var(--danger-bg)' : 'var(--success-bg)',
                                border: `1px solid ${isExtra ? 'var(--danger-ring)' : 'var(--success-ring)'}`,
                              }}>
                              <div>
                                <p className="text-xs font-semibold"
                                  style={{ color: isExtra ? 'var(--danger-fg)' : 'var(--success-fg)' }}>
                                  {isExtra ? '추가납부 필요' : '과입금 처리'}
                                </p>
                                {label && (
                                  <p className="text-[0.65625rem] mt-0.5" style={{ color: 'var(--warm-muted)' }}>{label}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold"
                                  style={{ color: isExtra ? 'var(--danger-fg)' : 'var(--success-fg)' }}>
                                  {isExtra ? '-' : '+'}{fmtWon(absAmt)}
                                </span>
                                <button onClick={() => handleDeletePayRecord(p)}
                                  className="text-xs font-medium px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] transition-colors">삭제</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 납부 내역 */}
                    {regularWindow.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <p className="text-xs font-medium text-[var(--warm-mid)]">수납 내역</p>
                          <p className="text-[0.65625rem] text-[var(--warm-muted)]">최근 3개월 · 입금일과 귀속월 모두</p>
                        </div>
                        {regularWindow.map(p => {
                          const prevOwner = isPreAcq(p)
                          if (editingPayId === p.id) {
                            return (
                              <div key={p.id} className={`rounded-xl border px-3 py-2.5 space-y-2 ${prevOwner ? 'border-[var(--info-ring)] bg-[var(--info-bg)]' : 'border-[var(--coral)] bg-[var(--canvas)]'}`}>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>금액</p>
                                    <input type="text" inputMode="numeric"
                                      value={editAmount.toLocaleString()}
                                      onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>납부일</p>
                                    <DatePicker value={editDate} onChange={setEditDate}
                                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>납부방법</p>
                                    {/* 자유 입력이던 것을 정본 select로 통일 — '카드' 등 변형 표기가 카드 수납 합계에서 누락되는 것 방지(적대검증 필수) */}
                                    <select value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                                      {!['계좌이체', '현금', '신용카드', '결제선생', '기타'].includes(editPayMethod) && editPayMethod && (
                                        <option value={editPayMethod}>{editPayMethod}</option>
                                      )}
                                      <option value="계좌이체">계좌이체</option>
                                      <option value="현금">현금</option>
                                      <option value="신용카드">신용카드</option>
                                      <option value="결제선생">결제선생</option>
                                      <option value="기타">기타</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>메모</p>
                                    <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <Btn variant="secondary" size="sm" onClick={() => setEditingPayId(null)}>취소</Btn>
                                  <Btn variant="primary" size="sm" onClick={handleSaveEdit} disabled={isPending}>저장</Btn>
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div key={p.id} className={`flex items-center justify-between rounded-sm px-3 py-2.5 ${prevOwner ? 'bg-[var(--info-bg)] border border-[var(--info-ring)]' : 'bg-[var(--canvas)]'}`}>
                              <div>
                                <p className={`text-xs ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-mid)]'}`}>
                                  {p.seqNo}회차 · {fmtPayDate(p.payDate)} · {p.payMethod ?? '—'}
                                  {p.cashReceiptIssuedAt && <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1 py-0.5 whitespace-nowrap">현금영수증</span>}
                                  {prevOwner && <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--info-bg)] text-[var(--info-fg)] rounded px-1 py-0.5">양도인</span>}
                                  {/* 몇 월분인지 항상 적는다(운영자 요청). 낸 달과 귀속월이 다를 때만 그 사실을 덧붙인다 —
                                      '조회월과 다른가' 기준으로 두면 3개월 창에서 대부분 켜져 표식 구실을 못 한다. */}
                                  {!p.isDeposit && (() => {
                                    const paidMonth = new Date(p.payDate).toISOString().slice(0, 7)
                                    const late = paidMonth > p.targetMonth, prepay = paidMonth < p.targetMonth
                                    return (
                                      <span className={`ml-1.5 text-[0.65625rem] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${
                                        late ? 'bg-[var(--warning-bg)] text-[var(--warning-fg)]'
                                        : prepay ? 'bg-[var(--info-bg)] text-[var(--info-fg)]'
                                        : 'bg-[var(--cream-2)] text-[var(--warm-mid)]'
                                      }`}>
                                        {Number(p.targetMonth.slice(5))}월분{late ? ' 지연' : prepay ? ' 선납' : ''}
                                      </span>
                                    )
                                  })()}
                                </p>
                                {p.memo && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-dark)]'}`}>{fmtWon(p.actualAmount)}</span>
                                {/* 이 화면에는 조회 월 선택 UI 가 없다. 다른 달 귀속 행의 편집을 막으면
                                    방금 등록한 수납이 자동 분배로 지난달에 귀속됐을 때 그 자리에서 고칠 방법이 사라진다.
                                    삭제 확인창이 이미 영향 월을 고지하므로(handleDeletePayRecord) 여기서는 열어 둔다. */}
                                {/* 뷰어(STAFF)에게는 편집 진입 숨김 — 서버 requireEdit 가 최종 방어(감사 D3) */}
                                {canEdit && (
                                  <div className="flex gap-2 ml-1">
                                    <RowActionBtn tone="neutral" onClick={() => handleUpdatePayRecord(p)}>수정</RowActionBtn>
                                    <RowActionBtn tone="danger" onClick={() => handleDeletePayRecord(p)}>삭제</RowActionBtn>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {regularWindow.length === 0 && (
                      <p className="text-sm text-[var(--warm-muted)] text-center py-4">최근 3개월 수납 기록이 없습니다.</p>
                    )}
                  </div>

                  {/* 납부일 임시 조정 — 항상 보이는 영역 */}
                  {(() => {
                    const isOverrideActive = lease.overrideDueDayMonth === targetMonth && !!lease.overrideDueDay
                    const fmtOvr = (v: string | null | undefined) => {
                      if (!v) return ''
                      if (v.includes('-')) { const d = new Date(v + 'T00:00:00'); return `${d.getMonth()+1}월 ${d.getDate()}일` }
                      return v.includes('말') ? '말일' : `${v}일`
                    }
                    return (
                      <div className="border-t border-[var(--warning-ring)] bg-[var(--warning-solid)]/5 px-6 py-3 space-y-2 shrink-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--warning-fg)]">납부일 임시 조정</span>
                            {isOverrideActive && (
                              <span className="text-xs bg-[var(--warning-solid)]/20 text-[var(--warning-fg)] px-1.5 py-0.5 rounded-full">
                                {targetMonth} · {fmtOvr(lease.overrideDueDay)}로 적용 중
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isOverrideActive && !showOverrideForm && (
                              confirmClearOverride ? (
                                <div className="flex items-center gap-2 bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-lg px-2.5 py-1.5">
                                  <span className="text-xs text-[var(--danger-fg)]">정말 삭제할까요?</span>
                                  <button type="button" onClick={() => setConfirmClearOverride(false)}
                                    className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-1.5 py-0.5 rounded">취소</button>
                                  <button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() => {
                                      const leaseId = lease.id
                                      setConfirmClearOverride(false)
                                      setDetailTenant(prev => {
                                        if (!prev) return prev
                                        return {
                                          ...prev,
                                          leaseTerms: prev.leaseTerms.map(lt =>
                                            lt.id === leaseId
                                              ? { ...lt, overrideDueDay: null, overrideDueDayMonth: null, overrideDueDayReason: null }
                                              : lt
                                          ),
                                        }
                                      })
                                      startTransition(async () => {
                                        const release = trackSave()
                                        try {
                                          await clearDueDayOverride(leaseId)
                                          refresh()
                                          pushToast('success', '이번 달 납부일 임시 변경 해제됨')
                                        } finally { release() }
                                      })
                                    }}
                                    className="text-xs bg-[var(--danger-bg)] hover:bg-[var(--danger-ring)] text-[var(--danger-fg)] font-semibold px-2 py-0.5 rounded disabled:opacity-40">
                                    삭제
                                  </button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => setConfirmClearOverride(true)}
                                  className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] border border-[var(--danger-ring)] rounded px-2 py-0.5 transition-colors">
                                  삭제
                                </button>
                              )
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const opening = !showOverrideForm
                                setShowOverrideForm(opening)
                                if (opening) {
                                  const existingVal = isOverrideActive ? lease.overrideDueDay : null
                                  let initDate = ''
                                  if (existingVal) {
                                    if (existingVal.includes('-')) {
                                      initDate = existingVal
                                    } else if (existingVal.includes('말')) {
                                      const [y, m] = targetMonth.split('-').map(Number)
                                      initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
                                    } else {
                                      const n = parseInt(existingVal)
                                      if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
                                    }
                                  } else {
                                    const baseDay = lease.dueDay
                                    if (baseDay?.includes('말')) {
                                      const [y, m] = targetMonth.split('-').map(Number)
                                      initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
                                    } else if (baseDay) {
                                      const n = parseInt(baseDay)
                                      if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
                                    }
                                  }
                                  setOverrideDateInput(initDate || kstYmdStr())
                                  setOverrideReason(isOverrideActive ? (lease.overrideDueDayReason ?? '') : '')
                                }
                              }}
                              className="text-xs text-[var(--warning-fg)] hover:text-[var(--warning-fg)] transition-colors">
                              {showOverrideForm ? '닫기' : isOverrideActive ? '수정' : '조정하기'}
                            </button>
                          </div>
                        </div>

                        {isOverrideActive && !showOverrideForm && (
                          <p className="text-xs text-[var(--warm-muted)]">
                            기준 {fmtDueDay(lease.dueDay)} → 이번달 {fmtOvr(lease.overrideDueDay)}
                            {lease.overrideDueDayReason ? ` · ${lease.overrideDueDayReason}` : ''}
                          </p>
                        )}

                        {showOverrideForm && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <div className="flex-1 space-y-1">
                                <label className="text-xs text-[var(--warm-muted)]">조정 납부일</label>
                                <DatePicker
                                  value={overrideDateInput}
                                  onChange={setOverrideDateInput}
                                  minDate={`${targetMonth}-01`}
                                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--warm-dark)] focus:border-[var(--warning-ring)]"
                                />
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="text-xs text-[var(--warm-muted)]">사유 (선택)</label>
                                <input
                                  type="text"
                                  value={overrideReason}
                                  onChange={e => setOverrideReason(e.target.value)}
                                  placeholder="예: 급여일 변경"
                                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--warning-ring)]"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={isPending || !overrideDateInput}
                              onClick={() => {
                                if (!overrideDateInput) return
                                const d = new Date(overrideDateInput + 'T00:00:00')
                                const selectedYM = overrideDateInput.slice(0, 7)
                                let val: string
                                if (selectedYM !== targetMonth) {
                                  val = overrideDateInput
                                } else {
                                  const dayNum = d.getDate()
                                  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
                                  val = dayNum >= lastDay ? '말일' : String(dayNum)
                                }
                                const reason = overrideReason.trim()
                                const leaseId = lease.id
                                setShowOverrideForm(false)
                                setDetailTenant(prev => {
                                  if (!prev) return prev
                                  return {
                                    ...prev,
                                    leaseTerms: prev.leaseTerms.map(lt =>
                                      lt.id === leaseId
                                        ? { ...lt, overrideDueDay: val, overrideDueDayMonth: targetMonth, overrideDueDayReason: reason || null }
                                        : lt
                                    ),
                                  }
                                })
                                startTransition(async () => {
                                  const release = trackSave()
                                  try {
                                    await setDueDayOverride(leaseId, targetMonth, val, reason)
                                    refresh()
                                    pushToast('success', '이번 달 납부일 임시 변경됨')
                                  } finally { release() }
                                })
                              }}
                              className="w-full py-2 bg-[var(--warning-solid)] active:bg-[var(--warning-solid)] text-[var(--on-solid)] text-sm font-semibold rounded-lg transition-colors disabled:opacity-40">
                              {isPending ? '저장 중…' : (() => {
                                if (!overrideDateInput) return '날짜를 선택하세요'
                                const selectedYM = overrideDateInput.slice(0, 7)
                                if (selectedYM !== targetMonth) {
                                  const d2 = new Date(overrideDateInput + 'T00:00:00')
                                  return `${d2.getMonth() + 1}월 ${d2.getDate()}일로 조정`
                                }
                                const d = new Date(overrideDateInput + 'T00:00:00')
                                const dayNum = d.getDate()
                                const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
                                const label = dayNum >= lastDay ? '말일' : `${dayNum}일`
                                return `${targetMonth} 납부일을 ${label}로 조정`
                              })()}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                    <div className="flex-1" />
                    <Btn variant="primary" size="md"
                      onClick={() => { setShowPayForm(true); setError('') }}>
                      수납 등록
                    </Btn>
                  </div>
                </>
              )}

              {/* ── 예약자 수납 — 예약금 모드(3택) 정본 폼 재사용 ── */}
              {showPayForm && lease.status === 'RESERVED' && (
                <div className="flex-1 overflow-y-auto p-6">
                  <PaymentEntryForm
                    depositPaidTotal={paySettlement?.reservationPaid?.deposit ?? 0}
                    room={{
                      leaseTermId: lease.id,
                      tenantId: tenant.id,
                      expected,
                      balance: 0,
                      depositAmount: lease.depositAmount,
                      cleaningFee: lease.cleaningFee,
                      moveInDate: lease.moveInDate ? kstYmdStr(new Date(lease.moveInDate)) : null,
                      roomNo: lease.room?.roomNo ?? null,
                      status: 'RESERVED',
                      reservationDepositMode: resolveReservationDepositMode(lease.reservationDepositMode, propertyReservationDepositMode, lease.isShortTerm, shortStayReservationMode),
                      isShortTerm: lease.isShortTerm,
                      shortStayReservationMode,
                      shortStayDeposit,
                    }}
                    targetMonth={targetMonth}
                    onSaved={async () => { setShowPayForm(false); const { records, windowRecords } = await getPaymentsByLease(lease.id, targetMonth); setPayHistory(records.filter(r => !r.isBillingAdjust) as PayRecord[]); setPayWindow(windowRecords as PayRecord[]); setPayReloadKey(k => k + 1); refresh() }}
                    onCancel={() => setShowPayForm(false)}
                  />
                </div>
              )}

              {/* ── 수납 등록 폼 ── */}
              {showPayForm && lease.status !== 'RESERVED' && (
                <form onSubmit={handleSavePayment} className="flex flex-col flex-1 overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-6 space-y-3">
                    {!isDepositMode && (
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-2.5 py-1.5 leading-relaxed">
                        미수가 있는 가장 오래된 월부터 자동으로 충당됩니다 (발생주의). 입력 금액이 한 달 이용료를 초과하면 다음 달로 이월됩니다.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                        <DatePicker name="payDate" value={payDateVal} onChange={setPayDateVal}
                          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-[var(--warm-muted)]">금액</label>
                        <MoneyInput name="amount" value={payAmount} onChange={setPayAmount} placeholder="0원" />
                      </div>
                    </div>
                    {lease.depositAmount > 0 && (
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isDepositMode}
                            onChange={e => {
                              const checked = e.target.checked
                              setIsDepositMode(checked)
                              if (checked) {
                                setPayAmount(lease.depositAmount)
                                const mi = lease.moveInDate ? kstYmdStr(new Date(lease.moveInDate)) : null
                                setPayDateVal(mi ?? kstYmdStr())
                              } else {
                                setPayDateVal(kstYmdStr())
                              }
                            }}
                            className="w-4 h-4 accent-[var(--coral)]"
                          />
                          <span className="text-xs text-[var(--warm-mid)]">
                            보증금 수납 ({fmtWon(lease.depositAmount)})
                          </span>
                        </label>
                        {isDepositMode && payAmount > lease.depositAmount && (
                          <p className="text-xs text-[var(--success-fg)]">
                            초과금 {fmtWon((payAmount - lease.depositAmount))} → {targetMonth} 이용료 처리
                          </p>
                        )}
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--warm-muted)]">결제 수단</label>
                      <select name="payMethod"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="계좌이체">계좌이체</option>
                        <option value="현금">현금</option>
                        <option value="신용카드">신용카드</option>
                        <option value="결제선생">결제선생</option>
                        <option value="기타">기타</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" name="cashReceipt" className="w-3.5 h-3.5 accent-[var(--coral)]" />
                      <span className="text-xs text-[var(--warm-dark)]">현금영수증 발행함</span>
                    </label>
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--warm-muted)]">메모</label>
                      <input type="text" name="memo" placeholder="메모 (선택)"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)]" />
                    </div>
                    {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
                  </div>
                  <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                    <Btn type="button" variant="secondary" size="md" onClick={() => { setShowPayForm(false); setError('') }}
                      className="flex-1">
                      취소
                    </Btn>
                    <Btn type="submit" variant="primary" size="md" disabled={isPending}
                      className="flex-1">
                      {isPending ? '저장 중…' : '저장'}
                    </Btn>
                  </div>
                </form>
              )}
          </Modal>
        )
      })()}

      {/* ── 호실 미니 모달 ─────────────────────────────────────────── */}
      {roomDetailId && (() => {
        const room = rooms.find(r => r.id === roomDetailId)
        return (
          <Modal open width="sm" onClose={() => setRoomDetailId(null)}
            title={`${fmtRoomNo(room?.roomNo)} 정보`} bodyClassName="px-5 sm:px-6 py-4 space-y-3">
              {room ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-[var(--warm-muted)]">상태</span><span className={room.isVacant ? 'text-[var(--warm-mid)]' : 'text-[var(--success-fg)]'}>{room.currentLeaseStatus === 'NON_RESIDENT' && !room.nonResidentVacant ? '비거주 점유' : room.isVacant ? '공실' : '거주중'}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--warm-muted)]">기본 이용료</span><span className="text-[var(--warm-dark)]"><MoneyDisplay amount={room.baseRent} /></span></div>
                </div>
              ) : (
                <p className="text-[var(--warm-muted)] text-sm">호실 정보를 찾을 수 없습니다.</p>
              )}
              <a href="/room-manage" className="block w-full text-center py-2 mt-2 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-lg transition-colors">
                호실 관리 페이지로 →
              </a>
          </Modal>
        )
      })()}
    </div>
  )
}

// ── 희망 호실 선택기 ──────────────────────────────────────────────

const WISH_WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const WISH_DIR_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}
const WISH_RANK = ['1순위', '2순위', '3순위', '4순위', '5순위']

function getFloor(roomNo: string): string {
  const n = roomNo.replace(/[^0-9]/g, '')
  if (n.length >= 3) return n.slice(0, n.length - 2)
  return ''
}

function KeepAlertCheckbox({ defaultValue }: { defaultValue: boolean }) {
  const [checked, setChecked] = useState(defaultValue)
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--warm-mid)] cursor-pointer select-none">
      <input type="hidden" name="keepAlertAfterInquiry" value={checked ? 'true' : 'false'} />
      <input
        type="checkbox"
        checked={checked}
        onChange={e => setChecked(e.target.checked)}
        className="w-4 h-4 rounded border-[var(--warm-border)] accent-[var(--coral)]"
      />
      <span>입주 희망일이 지나도 알림 유지 <span className="opacity-60">(희망일이 명확하지 않은 경우)</span></span>
    </label>
  )
}

type WishConditionsObj = { floor?: string; windowType?: string; type?: string; direction?: string; minRent?: number; maxRent?: number }

function parseWishConditions(raw: string | null | undefined): WishConditionsObj {
  if (!raw) return {}
  try { return JSON.parse(raw) as WishConditionsObj } catch { return {} }
}

function WishSelector({ rooms, lease, allowConditions, isMove }: {
  rooms: Room[]
  lease?: LeaseTerm
  allowConditions: boolean
  isMove?: boolean           // ACTIVE/NON_RESIDENT 상태 — 라벨을 "이동 희망"으로
}) {
  const initialRooms = (lease?.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const initialCond  = parseWishConditions(lease?.wishConditions)
  // 기존 lease 데이터에 따라 모드 추론, 신규/미설정은 '조건만 선택' 디폴트
  const initialMode: 'rooms' | 'conditions' =
    !allowConditions ? 'rooms'
    : initialRooms.length > 0 ? 'rooms'
    : 'conditions'

  const [mode, setMode] = useState<'rooms' | 'conditions'>(initialMode)

  // 호실 모드 상태
  const [selected, setSelected] = useState<string[]>(initialRooms.slice(0, 5))
  const [floorF, setFloorF]     = useState('')
  const [windowF, setWindowF]   = useState('')
  const [typeF, setTypeF]       = useState('')
  const [directionF, setDirF]   = useState('')

  // 조건 모드 상태
  const [condFloor, setCondFloor]       = useState(initialCond.floor ?? '')
  const [condWindow, setCondWindow]     = useState(initialCond.windowType ?? '')
  const [condType, setCondType]         = useState(initialCond.type ?? '')
  const [condDirection, setCondDirection] = useState(initialCond.direction ?? '')
  const [rentEnabled, setRentEnabled]   = useState(initialCond.minRent !== undefined || initialCond.maxRent !== undefined)
  const [condMinRent, setCondMinRent]   = useState(initialCond.minRent ?? 0)
  const [condMaxRent, setCondMaxRent]   = useState(initialCond.maxRent ?? 400000)

  // status 변경에 따른 allowConditions 토글 시 모드 재설정
  // 신규 등록은 status=ACTIVE로 시작 → allowConditions=false → mode='rooms'로 초기화됨.
  // 사용자가 RESERVED/WAITING_TOUR로 바꾸면 allowConditions가 true가 되는데,
  // 이때 mode가 자동으로 '조건만 선택'(conditions)으로 전환되도록 동기화.
  const prevAllowConditionsRef = useRef(allowConditions)
  useEffect(() => {
    if (prevAllowConditionsRef.current === allowConditions) return
    prevAllowConditionsRef.current = allowConditions
    if (!allowConditions) {
      setMode('rooms')
    } else if (initialRooms.length === 0) {
      setMode('conditions')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowConditions])

  const getRoomFloor = (r: Room) => r.floor || getFloor(r.roomNo)
  const floors     = [...new Set(rooms.map(r => getRoomFloor(r)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))
  const windowTypes = [...new Set(rooms.map(r => r.windowType).filter(Boolean))] as string[]
  const types      = [...new Set(rooms.map(r => r.type).filter(Boolean))] as string[]
  const directions = [...new Set(rooms.map(r => r.direction).filter(Boolean))] as string[]

  const filtered = rooms.filter(r => {
    if (floorF && getRoomFloor(r) !== floorF) return false
    if (windowF && r.windowType !== windowF) return false
    if (typeF && r.type !== typeF) return false
    if (directionF && r.direction !== directionF) return false
    return true
  })

  const add = (roomNo: string) => {
    if (!roomNo || selected.includes(roomNo) || selected.length >= 5) return
    setSelected(prev => [...prev, roomNo])
  }
  const remove = (roomNo: string) => setSelected(prev => prev.filter(r => r !== roomNo))

  // 폼 제출용 hidden 값 — 모드에 따라 한 쪽만 채움
  const wishRoomsValue = mode === 'rooms' ? selected.join(',') : ''
  const condObj: WishConditionsObj = {}
  if (mode === 'conditions') {
    if (condFloor)     condObj.floor       = condFloor
    if (condWindow)    condObj.windowType  = condWindow
    if (condType)      condObj.type        = condType
    if (condDirection) condObj.direction   = condDirection
    if (rentEnabled) {
      condObj.minRent = condMinRent
      condObj.maxRent = condMaxRent
    }
  }
  // 조건 모드 빈 객체("{}") = "조건 무관, 모든 빈 방 매칭" — 호실 미지정 예약자(seeker)에게만 유효한 의도.
  // 거주중 이동희망(isMove)은 조건 미입력이면 '희망 없음'이므로 "{}" 대신 빈값(null) 저장 — 잔여 "{}" 재발 방지.
  const wishConditionsValue = mode === 'conditions'
    ? (isMove && Object.keys(condObj).length === 0 ? '' : JSON.stringify(condObj))
    : ''

  const selCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] w-full'

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-[var(--warm-mid)]">
        {isMove ? '이동 희망' : '입실 희망'} {allowConditions ? '호실 / 조건' : '호실'} <span className="font-normal opacity-60">(공실/퇴실 예정 시 대시보드 알림)</span>
      </label>
      <input type="hidden" name="wishRooms"      value={wishRoomsValue} />
      <input type="hidden" name="wishConditions" value={wishConditionsValue} />

      {allowConditions && (
        <SegmentedControl
          size="sm"
          ariaLabel="희망 모드"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'rooms',      label: '구체적 호실 선택' },
            { value: 'conditions', label: '조건만 선택' },
          ]}
        />
      )}

      {mode === 'rooms' ? (
        <>
          {/* 필터 */}
          <div className="grid grid-cols-4 gap-2">
            <select value={floorF} onChange={e => setFloorF(e.target.value)} className={selCls}>
              <option value="">층 전체</option>
              {floors.map(f => <option key={f} value={f}>{f}층</option>)}
            </select>
            <select value={windowF} onChange={e => setWindowF(e.target.value)} className={selCls}>
              <option value="">창문 전체</option>
              {windowTypes.map(w => <option key={w} value={w}>{WISH_WINDOW_LABEL[w] ?? w}</option>)}
            </select>
            <select value={typeF} onChange={e => setTypeF(e.target.value)} className={selCls}>
              <option value="">타입 전체</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={directionF} onChange={e => setDirF(e.target.value)} className={selCls}>
              <option value="">방향 전체</option>
              {directions.map(d => <option key={d} value={d}>{WISH_DIR_LABEL[d] ?? d}</option>)}
            </select>
          </div>

          {/* 호실 선택 (최대 5개) */}
          <select
            value=""
            onChange={e => { add(e.target.value); e.target.value = '' }}
            disabled={selected.length >= 5}
            className={selCls}
          >
            <option value="">호실 선택… {allowConditions ? '(선택사항, 최대 5개)' : '(최대 5개)'}</option>
            {filtered.filter(r => !selected.includes(r.roomNo)).map(r => (
              <option key={r.id} value={r.roomNo}>
                {/* 비거주 점유 방은 공실이라 부르지 않는다. 종전엔 '가장 최근 계약 하나'로 물어
                    비거주가 최신이 아닌 방에서 판정이 샜다 — 방 단위 정본 술어로 바꾼다. */}
                {fmtRoomNo(r.roomNo)}{r.isVacant && !r.vacancyExcluded ? ' (공실)' : ''}
              </option>
            ))}
          </select>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((roomNo, i) => (
                <span key={roomNo} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--coral)]/20 text-[var(--coral)]">
                  {WISH_RANK[i]} {fmtRoomNo(roomNo)}
                  <button type="button" onClick={() => remove(roomNo)}
                    className="leading-none hover:text-[var(--danger-fg)] transition-colors">×</button>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed">
            지정 항목과 일치하는 방이 공실/퇴실 예정이 되면 대시보드 알림이 표시됩니다. 선택하지 않은 항목은 무시됩니다.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <select value={condFloor} onChange={e => setCondFloor(e.target.value)} className={selCls}>
              <option value="">층 무관</option>
              {floors.map(f => <option key={f} value={f}>{f}층</option>)}
            </select>
            <select value={condWindow} onChange={e => setCondWindow(e.target.value)} className={selCls}>
              <option value="">창문 무관</option>
              {windowTypes.map(w => <option key={w} value={w}>{WISH_WINDOW_LABEL[w] ?? w}</option>)}
            </select>
            <select value={condType} onChange={e => setCondType(e.target.value)} className={selCls}>
              <option value="">타입 무관</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={condDirection} onChange={e => setCondDirection(e.target.value)} className={selCls}>
              <option value="">방향 무관</option>
              {directions.map(d => <option key={d} value={d}>{WISH_DIR_LABEL[d] ?? d}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rentEnabled}
                onChange={e => setRentEnabled(e.target.checked)}
                className="accent-[var(--coral)] w-3.5 h-3.5"
              />
              <span className="text-[0.6875rem] text-[var(--warm-muted)]">이용료 범위 설정</span>
            </label>
            {rentEnabled ? (
              <div className="flex items-center gap-2">
                <MoneyInput value={condMinRent} onChange={setCondMinRent} placeholder="최소 0원" />
                <span className="text-sm text-[var(--warm-muted)] flex-shrink-0">~</span>
                <MoneyInput value={condMaxRent} onChange={setCondMaxRent} placeholder="최대 400,000원" />
              </div>
            ) : (
              <p className="text-[0.6875rem] text-[var(--warm-muted)] pl-0.5">제한 없음 · 이용료 무관하게 매칭</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── 폼 컴포넌트 (추가/수정 공용) ─────────────────────────────────

function TenantForm({ rooms, tenant, error, defaultDeposit, defaultCleaningFee, contactLeadDays = 14, leaseOnly = false, leaseId, parentLeases = [], liveValues, onLiveChange }: {
  rooms: Room[]; tenant?: Tenant; error?: string
  defaultDeposit?: number | null; defaultCleaningFee?: number | null; contactLeadDays?: number
  // 계약만 더하는 모드('계약 추가') — 사람 칸(기본 정보·연락처·메모)을 아예 그리지 않는다.
  // 안 그리는 것이 곧 안 보내는 것이고, 서버(addLeaseToTenant)도 사람 칸을 읽지 않는다.
  // 계약을 하나 더하는 일이 사람 정보를 덮는 일이 되면 안 된다.
  leaseOnly?: boolean
  // 이 폼이 편집하는 계약(2026-08-13, 실기 신고 — 부계약을 고칠 입구가 없었다).
  // 없거나 이 사람의 계약이 아니면 종전대로 메인 계약이다. 수정 창의 계약 세그먼트가 이 값을 준다.
  leaseId?: string
  // '메인 계약' 셀렉트의 선택지. 비면 칸 자체를 그리지 않는다 — 고를 것이 없는데 필수로 막으면
  // 운영자에게 출구 없는 오류를 주는 것이다(칸이 없으면 서버도 종속을 편집하지 않는 저장으로 읽는다).
  parentLeases?: LeaseTerm[]
  // 같은 수정 창에 떠 있는 형제 폼들의 미저장 값(계약 id 로 색인). 메인 계약의 폼이 함께 떠 있으면
  // '같음' 칸이 저장값 대신 이 값을 비춘다. 없으면 종전대로 저장된 부모 값이다(신고 eb66b990).
  liveValues?: Record<string, LeaseFormLiveValues>
  // 이 폼의 값이 바뀔 때마다 위로 올린다. 수정 창 밖(등록·계약 추가)에서는 넘기지 않는다.
  onLiveChange?: (leaseId: string, v: LeaseFormLiveValues) => void
}) {
  const lease     = (leaseId ? tenant?.leaseTerms.find(l => l.id === leaseId) : undefined) ?? mainLease(tenant)
  // 이 폼 한 벌의 고유 접두사 — 수정 창은 계약마다 폼을 한 벌씩 들고 있어서(LeaseEditForms)
  // 고정 id 를 쓰면 문서에 같은 id 가 여럿 생기고 라벨이 늘 첫 번째 폼을 가리킨다.
  const formUid   = useId()
  const primary   = tenant?.contacts.find(c => c.isPrimary)
  const emergency = tenant?.contacts.find(c => c.isEmergency)
  const homeCountry = tenant?.contacts.find(c => c.isHomeCountry)

  // 신규 등록의 기본 상태는 문의다 — 실제 유입은 문의부터 시작하고, 거주중 기본은 실수로
  // 문의자를 입주자로 등록하게 만들었다(운영자 지시 2026-08-12). 수정 폼은 기존 상태 유지.
  const [statusVal, setStatusVal]   = useState(lease?.status ?? 'WAITING_TOUR')
  // 수정 폼에서 입실 취소로 바꿀 때도 사유를 받는다 — 상태전환 미니폼과 같은 선택지(운영자 지시 2026-07-27)
  const [cancelReasonVal, setCancelReasonVal] = useState('')
  const [cancelReasonEtc, setCancelReasonEtc] = useState('')
  const [natVal, setNatVal]         = useState(tenant?.nationality ?? '')   // 국적 연동(본국 연락처 숨김)
  const [contactTypeVal, setContactTypeVal] = useState(primary?.contactType ?? 'PHONE')   // 연락수단 연동(연락처 예시·포맷 분기)
  const [selectedRoomId, setSelectedRoomId] = useState(lease?.room?.id ?? '')
  // '메인 계약' 선택 — 창고류 방(공실 집계 제외)이 묶일 때 비거주자 권고 힌트를 구동한다(운영자 오더 2026-08-13).
  const [parentVal, setParentVal] = useState(lease?.parentLeaseTermId ?? '')
  const [rentAmount, setRentAmount] = useState<number | undefined>(lease?.rentAmount)
  const [actualOut, setActualOut]   = useState(toDateInput(lease?.moveOutDate))   // 실제 퇴실일 — 퇴실 상태에서만 렌더
  // 이사일 — 호실을 바꿀 때만 렌더. 기본은 오늘(KST)이고 뒤늦은 입력만 고친다(실제 퇴실일과 같은 규칙).
  const [moveDateVal, setMoveDateVal] = useState(kstYmdStr())
  const [tourDateVal, setTourDateVal] = useState(toDateInput(lease?.tourDate))
  // 문의/투어 예정 = 같은 WAITING_TOUR의 표시 구분(파생) — select 옵션 분리용 UI 상태(운영자 승인 2026-07-19).
  // 투어일이 있으면 '투어 예정' 강제('문의' 옵션 비활성), 투어일을 비우면 '문의'로 자동 복귀. 시스템이 투어일을 지우는 일은 없다.
  const [uiWaitingKind, setUiWaitingKind] = useState<'INQUIRY' | 'TOUR'>(lease?.tourDate ? 'TOUR' : 'INQUIRY')
  // 지난 투어일 판정 기준(KST) — 폼은 모달로 클라이언트에서만 마운트되므로 렌더 시 계산 안전
  const [formToday] = useState(() => kstYmdStr())
  const initialInquiry = splitDateTime(lease?.inquiryAt)
  const [inquiryDateVal, setInquiryDateVal] = useState(initialInquiry.date)
  const [inquiryTimeVal, setInquiryTimeVal] = useState(initialInquiry.time)
  // 투어 시각 — 값은 name 으로 제출되고 여기 state 는 '문의 이후' 검증에만 쓴다.
  // value 로 묶지 않는다(묶으면 미완성 입력이 '' 로 덮여 오전/오후를 못 넣는다).
  const [tourTimeVal, setTourTimeVal] = useState(lease?.tourTime ?? '')
  // 투어는 문의보다 앞설 수 없다 — 같은 날일 때만 문의 시각을 하한으로 건다(다른 날이면 제약 없음).
  const tourMinTime = tourDateVal && inquiryDateVal && tourDateVal === inquiryDateVal && inquiryTimeVal
    ? inquiryTimeVal : undefined
  const tourTimeTooEarly = !!tourMinTime && !!tourTimeVal && tourTimeVal < tourMinTime
  // 문의 시각 입력은 uncontrolled(defaultValue+ref) — controlled 면 미완성 입력이 '' 로 덮여 오전/오후를 못 넣는다.
  // state 는 inquiryAt 조합에만 쓰고, 자동 채움 시 DOM 값도 ref 로 함께 세팅한다.
  const inquiryTimeRef = useRef<HTMLInputElement>(null)
  const [reservationConfirmed, setReservationConfirmed] = useState(!!lease?.reservationConfirmedAt)
  const [isShortTerm, setIsShortTerm] = useState(!!lease?.isShortTerm)
  // 단기 요금 자동 계산 — 홈 '단기 요금 계산'과 동일 로직(calcShortStay), 운영자 요청 2026-07-09
  const [shortQuoteData, setShortQuoteData] = useState<Awaited<ReturnType<typeof getRoomsForQuote>> | null>(null)
  // 단기 박스의 날짜 칸은 아래 입주일(moveInVal)과 같은 값이다(운영자 지적 2026-07-10: 따로 입력할 필요 없음).
  // 라벨도 moveInLabel 하나를 공유한다 — 같은 칸을 두 이름으로 부르면 두 칸으로 읽힌다.
  const [shortOut, setShortOut] = useState(toDateInput(lease?.expectedMoveOut))
  const [contactAlertVal, setContactAlertVal] = useState(toDateInput(lease?.contactAlertDate ?? null))
  useEffect(() => {
    if (!isShortTerm || shortQuoteData) return
    getRoomsForQuote().then(setShortQuoteData).catch(() => { /* 정책 로드 실패 시 계산기만 미표시 */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShortTerm])
  const inquiryAtCombined = inquiryDateVal
    ? `${inquiryDateVal}T${inquiryTimeVal || '00:00'}`
    : ''

  const handleRoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const roomId = e.target.value
    setSelectedRoomId(roomId)
    if (isShortTerm) return  // 단기 희망: 호실 표준가 자동입력 건너뛰기(수동 입력값이라 해제해도 보존)
    const room = rooms.find(r => r.id === roomId)
    // 호실을 '호실 선택'(빈 값)으로 되돌리면 자동으로 채웠던 이용료도 함께 비운다 —
    // 종전엔 여기서 그냥 return 이라 직전 호실의 이용료가 남았음(오류신고 d3bd5717).
    if (!room) { setRentAmount(undefined); return }
    const isNR = statusVal === 'NON_RESIDENT'
    setRentAmount(isNR && room.nonResidentRent != null ? room.nonResidentRent : room.baseRent)
  }

  // 비거주자 ↔ 일반 전환 시 해당 호실의 적정 이용료로 자동 교체
  useEffect(() => {
    if (isShortTerm || !selectedRoomId) return
    const room = rooms.find(r => r.id === selectedRoomId)
    if (!room) return
    const isNR = statusVal === 'NON_RESIDENT'
    setRentAmount(isNR && room.nonResidentRent != null ? room.nonResidentRent : room.baseRent)
  }, [statusVal]) // eslint-disable-line react-hooks/exhaustive-deps

  // 이사 판정 — 살던 방이 있는데 다른 방으로 바뀌는 저장. 서버가 거주 구간을 쪼개는 조건
  // (syncRoomStayOnSave 가 recordRoomChange 를 부르는 조건)과 **같은 자**를 쓴다. 어긋나면
  // 칸이 안 뜬 채로 구간이 쪼개지는 경로가 남고, 그 경계는 다시 '저장을 누른 날'로 박힌다.
  // 신규 배정(방이 처음 정해지는 것)은 이사가 아니라 입주라 여기 안 걸린다.
  const isRoomMove = !!lease?.room?.id && !!selectedRoomId && selectedRoomId !== lease.room.id
    && (STAY_ELIGIBLE_STATUSES as string[]).includes(statusVal)

  // WAITING_TOUR/TOUR_DONE/RESERVED는 호실 필수 아님 (단, 예약 확정 시 RESERVED는 호실 필수)
  const roomIsOptional = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'].includes(statusVal) && !(statusVal === 'RESERVED' && reservationConfirmed)
  // 호실 입력 강제 여부 — 예약확정이라도 RESERVED 면 '미지정' 허용(만실 맞바꾸기 임시 파킹용). 라벨·날짜 로직은 roomIsOptional 그대로.
  const roomCanBeEmpty = roomIsOptional || statusVal === 'RESERVED'
  // ACTIVE, CHECKOUT_PENDING + 예약 확정 → 입주중/퇴실예정 방만 비활성화 (공실 + 퇴실예정만 선택 가능)
  const activeOnlyStatus = ['ACTIVE', 'CHECKOUT_PENDING'].includes(statusVal) || (statusVal === 'RESERVED' && reservationConfirmed)
  const isWaitingTourStatus = statusVal === 'WAITING_TOUR' || (statusVal === 'RESERVED' && reservationConfirmed)

  // 보증금/청소비 자동 입력 제외 상태 — 취소(이탈)·비거주자(요금 개념이 다름)만.
  // 투어예정·투어완료·예약은 계약 준비 단계라 기본값을 채운다(신고 2555362e, 운영자 승인 2026-07-24).
  // 방 선택 시 월이용료는 이미 상태 무관으로 채워지는데 보증금·청소비만 빈칸이던 어긋남을 없앤다.
  // 안전 근거: 청구·미납(unpaid.ts)·대시보드 보증금은 거주 상태 계약만 보므로 리드에 값이 있어도 영향 없음.
  // 단기 희망(isShortTerm)은 계속 제외 — 단기는 환경설정이 아니라 단기 정책값(shortStay)에서 와야 금액이 맞다.
  const NO_AUTOFILL_STATUSES = ['CANCELLED', 'NON_RESIDENT']
  const isNoAutoFill = (s: string, shortTerm: boolean) => shortTerm || NO_AUTOFILL_STATUSES.includes(s)
  // 저장값이 0(미입력)이면 계약 단계에서 기본값 프리필 — LeaseTerm.depositAmount 는 @default(0) non-null 이라
  // '미입력'과 '0원'이 같은 값이다. 이미 입력된 값(계약자)은 유지, 리드·단기는 프리필 제외.
  // 계약서 발급 전 빈 보증금·청소비에 환경설정 기본값을 채운다(운영자 승인 2026-07-23, 이상경 418호 건).
  const pickAutoFill = (saved: number | undefined, dflt: number | null | undefined, s: string, shortTerm: boolean): number | undefined => {
    if (saved && saved > 0) return saved
    if (isNoAutoFill(s, shortTerm)) return undefined
    return dflt ?? undefined
  }
  const [depositAmountVal, setDepositAmountVal] = useState<number | undefined>(
    pickAutoFill(lease?.depositAmount, defaultDeposit, statusVal, isShortTerm)
  )
  const [cleaningFeeVal, setCleaningFeeVal] = useState<number | undefined>(
    pickAutoFill(lease?.cleaningFee, defaultCleaningFee, statusVal, isShortTerm)
  )
  // status 또는 단기 토글 변경 시 default 재적용
  useEffect(() => {
    setDepositAmountVal(pickAutoFill(lease?.depositAmount, defaultDeposit, statusVal, isShortTerm))
    setCleaningFeeVal(pickAutoFill(lease?.cleaningFee, defaultCleaningFee, statusVal, isShortTerm))
  }, [statusVal, isShortTerm]) // eslint-disable-line react-hooks/exhaustive-deps
  // 저장값 없이 환경설정 기본값이 프리필된 상태인지 — 무보증(0원) 계약이 조용히 덮이지 않도록 안내 캡션용(패널 지적)
  const isAutoFilled = (val: number | undefined, saved: number | undefined, dflt: number | null | undefined) =>
    !isNoAutoFill(statusVal, isShortTerm) && !(saved && saved > 0) && (dflt ?? 0) > 0 && val === dflt

  // 이 계약의 보증금 구성 — 입실 때 청소비를 이미 받았는지 본다(2026-08-10 설계 감사).
  // 사고의 발화점이 수납 폼이 아니라 이 폼이었다. 단기 체크를 해제하는 순간 환경설정 기본값 50,000 이
  // 자동 프리필됐고, 캡션은 기본값 안내 한 줄뿐이라 이미 받은 청소비 20,000 을 언급하지 않았다.
  const [depoCleaningPaidForm, setDepoCleaningPaidForm] = useState(0)
  const [depositReceivedOn, setDepositReceivedOn] = useState(false)
  const [depositReceivedAmt, setDepositReceivedAmt] = useState<number | null>(null)
  const [depositChoiceAsked, setDepositChoiceAsked] = useState(false)
  useEffect(() => {
    const id = lease?.id
    if (!id) return
    let alive = true
    getDepositCompositionForLease(id)
      .then(c => { if (alive) setDepoCleaningPaidForm(c.cleaningPaid) })
      .catch(() => { /* 조회 실패가 폼을 막으면 안 된다 — 캡션만 안 뜬다 */ })
    return () => { alive = false }
  }, [lease?.id])
  // 현금으로 받을 몫 — 보증금에 청소비가 포함되는 방식일 때의 금액. 판정이 아니라 안내라 설정과 무관하게 계산한다
  // (별도 수령 영업장 운영자는 이 안내를 보고 그대로 두면 된다 — 차단이 아니다).
  const depoCashPortionForm = Math.max(0, (depositAmountVal ?? 0) - depoCleaningPaidForm)

  // '보증금 실제로 받음' 체크 — 얼마를 기록할지 되묻는다. 종전에는 체크 한 번에 계약액 전액이
  // 무확인으로 record 되어, 청소비로 이미 받은 몫이 두 번 잡혔다.
  const toggleDepositReceived = async (next: boolean) => {
    if (!next) { setDepositReceivedOn(false); setDepositReceivedAmt(null); return }
    const contract = depositAmountVal ?? 0
    if (depoCleaningPaidForm <= 0 || depoCashPortionForm >= contract) {
      setDepositReceivedOn(true); setDepositReceivedAmt(null); return
    }
    const choice = await choiceDialog({
      title: '얼마를 받은 것으로 기록할까요?',
      message: `이 계약은 입실 때 청소비 ${depoCleaningPaidForm.toLocaleString()}원을 이미 받았습니다.\n`
        + `보증금 ${contract.toLocaleString()}원에 청소비가 포함되는 방식이라면 현금으로 받은 몫은 ${depoCashPortionForm.toLocaleString()}원입니다.`,
      confirmLabel: `${depoCashPortionForm.toLocaleString()}원으로 기록`,
      altLabel: `${contract.toLocaleString()}원 전액`,
      level: 'caution',
    })
    if (choice === null) { setDepositReceivedOn(false); setDepositReceivedAmt(null); return }
    setDepositReceivedOn(true)
    setDepositReceivedAmt(choice === 'alt' ? null : depoCashPortionForm)
    setDepositChoiceAsked(true)
  }

  // 납부일 상태 — raw 값(숫자 또는 '말일')과 표시 문자열 분리
  const [dueDayRaw, setDueDayRaw] = useState(() => dueDayParts(lease?.dueDay).raw)
  const [dueDayDisp, setDueDayDisp] = useState(() => dueDayParts(lease?.dueDay).disp)
  // 메인 계약이 정해져 있으면 납부일은 그 계약과 같은 날이 기본이다(운영자 오더 2026-08-13).
  // 한 사람이 방을 둘 쓰면 돈은 대개 같은 날 한 번에 들어온다. 다르게 받고 싶은 경우가 있으니
  // 잠그지 않고 '따로 정하기'로 푼다. 기존 계약을 열 때는 저장된 값이 부모와 다르면 따로 모드로 시작한다.
  const [dueSeparate, setDueSeparate] = useState(() => {
    const p = parentLeases.find(l => l.id === lease?.parentLeaseTermId)
    if (!p || !lease?.dueDay) return false
    return !sameDueDay(lease.dueDay, p.dueDay)
  })
  const parentLease = parentVal ? parentLeases.find(l => l.id === parentVal) : undefined
  // 메인 계약 폼이 같은 창에 떠 있으면 그 폼의 **지금 값**이 진실이다(신고 eb66b990).
  // 떠 있지 않으면(아직 안 들른 계약) 종전대로 저장된 값을 본다.
  const parentLive = parentVal ? liveValues?.[parentVal] : undefined
  // 고를 수 없는 부모(퇴실·취소로 목록에서 빠진 계약)면 상속할 값을 알 수 없으니 종전대로 직접 입력이다.
  const dueSameAsParent = !!parentLease && !dueSeparate
  const parentDue = dueDayParts(parentLive ? parentLive.dueDay : parentLease?.dueDay)
  // 신규 등록은 입주일 기본값을 오늘로 프리필(청구 상태 저장 시 필수 — 미납 오탐 방지). 편집은 기존값 유지.
  const [moveInDateVal, setMoveInDateVal] = useState(tenant ? toDateInput(lease?.moveInDate) : toDateInput(new Date()))
  // 입주일도 메인 계약과 같은 날이 기본이다(신고 eb66b990). 문법은 바로 위 납부일과 같은 한 벌이다.
  // 판정은 서버 전파(lib/moveInDate propagateMoveInDateToSubLeases)가 '따라올 자식'을 가르는 그
  // 함수를 그대로 쓴다. 화면이 '같음'이라 부르는 것과 서버가 옮기는 것이 어긋나면 안 된다.
  const [moveInSeparate, setMoveInSeparate] = useState(() => {
    const p = parentLeases.find(l => l.id === lease?.parentLeaseTermId)
    if (!p || !lease?.moveInDate) return false
    return !sameMoveInDate(lease.moveInDate, p.moveInDate)
  })
  const moveInSameAsParent = !!parentLease && !moveInSeparate
  const parentMoveIn = parentLive ? parentLive.moveInDate : toDateInput(parentLease?.moveInDate)
  // 이 폼이 실제로 제출·계산에 쓰는 입주일. 같음 모드면 메인 계약의 지금 값이다.
  // state 를 되쓰지 않고 여기서 가르는 이유는, 되쓰면 한 값에 진실이 둘(내 state 와 부모 값)이
  // 생겨 렌더 순서에 따라 화면과 제출값이 갈리기 때문이다. 아래 파생 계산(단기 일수·연락 알림일·
  // 겹침 경고)도 전부 이 값을 읽는다.
  const moveInVal = moveInSameAsParent ? parentMoveIn : moveInDateVal
  const setMoveIn = (v: string) => { if (!moveInSameAsParent) setMoveInDateVal(v) }
  // 비추고 있는 값이 아직 저장 전인가 — 그렇다면 그렇다고 말한다.
  // 수정 창은 지금 고른 계약 하나만 저장한다. 메인 폼에서 날짜를 바꾸고 이 계약 쪽에서 저장하면
  // 이 계약만 새 날로 가고 메인 계약은 옛 날에 남는다. 두 날이 갈리는 유일한 길이라 미리 말해 준다.
  const parentMoveInUnsaved = !!parentLive && !sameMoveInDate(parentMoveIn, parentLease?.moveInDate ?? null)
  const parentDueUnsaved = !!parentLive && !sameDueDay(parentLive.dueDay, parentLease?.dueDay ?? null)
  // 내 값을 형제 폼들에게 알린다. 딸린 계약의 '같음' 칸이 이 값을 비춘다.
  // 값이 같으면 위(LeaseEditForms)에서 상태를 새로 만들지 않으므로 되먹임이 돌지 않는다.
  useEffect(() => {
    if (!onLiveChange || !leaseId) return
    onLiveChange(leaseId, { moveInDate: moveInVal, dueDay: dueSameAsParent ? parentDue.raw : dueDayRaw })
  }, [onLiveChange, leaseId, moveInVal, dueSameAsParent, parentDue.raw, dueDayRaw])
  // 일정 조절 가능 여부 — 빈 문자열이 '미확인'(DB null)이다. SegmentedControl 은 값이 목록에 없으면
  // activeIdx 가 -1 이라 칩이 그려지지 않고 어느 세그먼트도 활성으로 보이지 않는다(미선택 표현).
  const [moveInFlexVal, setMoveInFlexVal] = useState<MoveInFlexValue>(
    lease?.moveInFlexible === true ? 'yes' : lease?.moveInFlexible === false ? 'no' : '')

  // 카드 표시 이름 — 고를 수 있는 표기는 값이 실제로 들어 있는 칸뿐이다(lib/displayName 이 정본).
  // 그래서 별칭·영어이름 두 칸을 controlled 로 들고 있는다: 지금 타이핑한 별칭이 곧바로
  // 선택지에 뜨지 않으면, 적어 놓고도 왜 못 고르는지 알 수 없다.
  // OCR 자동 채움(setInputByName)은 네이티브 setter + input 이벤트라 controlled 에서도 그대로 반영된다.
  const [englishNameVal, setEnglishNameVal] = useState(tenant?.englishName ?? '')
  const [nicknameVal, setNicknameVal] = useState(tenant?.nickname ?? '')
  const [displayStyleVal, setDisplayStyleVal] = useState<DisplayNameStyle>(asDisplayNameStyle(tenant?.displayNameStyle))
  const displayStyleOptions = displayNameStyles({ name: '', englishName: englishNameVal, nickname: nicknameVal })

  const applyDueDay = (input: string) => {
    const t = input.trim()
    if (!t) { setDueDayRaw(''); setDueDayDisp(''); return }
    if (/^[ㅁ마말]/.test(t) || t === '말일') {
      setDueDayRaw('말일'); setDueDayDisp('말일'); return
    }
    const n = parseInt(t.replace(/\D/g, ''), 10)
    if (!isNaN(n) && n > 0) {
      if (n >= 30) { setDueDayRaw('말일'); setDueDayDisp('말일') }
      else { setDueDayRaw(String(n)); setDueDayDisp(`${n}일`) }
    } else {
      setDueDayRaw(t); setDueDayDisp(t)
    }
  }

  const handleMoveInChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (!val) return
    const d = new Date(val)
    const day = d.getDate()
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    applyDueDay(day >= lastDay ? '말일' : String(day))
  }

  // 신규 등록: 입주일 기준으로 납부일 자동 파생. 입주일 onChange 도 파생하지만 입주일을 손대지 않으면
  // 납부일이 빈 채로 저장되던 문제(운영자 요청 2026-07-23). 상태 전환(리드→거주 등) 시에도 재파생해
  // '리드로 등록 후 거주로 바꾸면 빈 납부일' 흐름까지 봉합(패널 지적). 기존 lease.dueDay 는 안 덮음.
  // 거주 전(문의·투어·예약·취소) 상태 — 납부일이 무의미해 필드를 숨기고 파생도 막는다(운영자 지적 2026-07-30).
  // 서버(addTenant·updateTenant)도 같은 기준으로 비우는 이중 방어. 청구 상태 진입 시 서버가 입주일 기준 재파생.
  const duePending = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'].includes(statusVal)
  useEffect(() => {
    if (!tenant && !dueDayRaw && moveInVal && !roomIsOptional && !duePending) {
      const d = new Date(moveInVal)
      const day = d.getDate()
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      applyDueDay(day >= lastDay ? '말일' : String(day))
    }
  }, [statusVal, roomIsOptional]) // eslint-disable-line react-hooks/exhaustive-deps

  const showExitDate = ['CHECKOUT_PENDING', 'CHECKED_OUT'].includes(statusVal)
  const moveInLabel = roomIsOptional ? '입주희망일' : '입주일'

  // 입주일 칸 한 벌 — 거주 전(입주 희망일)과 거주 단계(입주일) 두 자리가 같은 것을 그린다.
  // 두 자리에 손으로 두 번 적으면 한쪽만 '같음' 잠금을 얻는다(다호실은 예약·비거주가 섞여
  // 어느 자리가 뜰지 고정돼 있지 않다). 컴포넌트가 아니라 함수라 호출해도 다시 마운트되지 않는다.
  const renderMoveInInput = (placeholder: string) => moveInSameAsParent ? (
    <>
      {/* 같음 모드의 제출 지점. 화면 칸은 읽기 전용이라 값을 담지 않는다(납부일과 같은 문법). */}
      <input type="hidden" name="moveInDate" value={moveInVal} />
      <input
        type="text" readOnly value={fmtDateTrigger(moveInVal)} placeholder="없음"
        className="w-full truncate border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm placeholder-[var(--warm-muted)] outline-none bg-[var(--cream)] text-[var(--warm-mid)] cursor-default"
      />
    </>
  ) : (
    <DatePicker
      name="moveInDate"
      value={moveInVal}
      onChange={(v) => {
        setMoveIn(v)
        // 거주 단계에서 입주일을 고르면 납부일을 그 날로 파생한다(종전 거동 그대로).
        if (v && !roomIsOptional) {
          const d = new Date(v)
          const day = d.getDate()
          const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
          applyDueDay(day >= lastDay ? '말일' : String(day))
        }
      }}
      placeholder={placeholder}
      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
    />
  )

  // 입주일 상속 안내 + '따로 정하기' — 납부일 칸의 같은 두 줄과 문장·순서가 같은 한 벌이다.
  const moveInInheritUi = parentLease ? (
    <>
      {moveInSameAsParent && (() => {
        // 어느 계약을 따라가는지 호실로 말한다. 호실이 없는 단계면 '메인 계약'으로 부른다.
        const who = parentLease.room?.roomNo ? `${fmtRoomNo(parentLease.room.roomNo)} 계약` : '메인 계약'
        return (
          <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
            {parentMoveIn ? `${who}과 같은 입주일입니다.` : `${who}에 입주일이 없습니다.`}
            {parentMoveInUnsaved && ' 메인 계약에서 아직 저장하지 않은 값입니다.'}
          </p>
        )
      })()}
      <label className="flex items-start gap-1.5 text-[0.6875rem] text-[var(--warm-mid)] cursor-pointer pt-0.5 leading-snug">
        <input type="checkbox" checked={moveInSeparate}
          onChange={e => {
            const next = e.target.checked
            // 따로 풀 때 내 값이 비어 있으면 부모 값에서 이어 쓴다(납부일 토글과 같은 규칙).
            if (next && !moveInDateVal && parentMoveIn) setMoveInDateVal(parentMoveIn)
            setMoveInSeparate(next)
          }}
          className="w-3.5 h-3.5 accent-[var(--coral)] mt-px shrink-0" />
        입주일 따로 정하기
      </label>
    </>
  ) : null

  return (
    <>
      {/* 사람 칸 — 계약만 더하는 모드에서는 통째로 안 그린다(OCR 도구도 사람 칸을 채우는 도구다). */}
      {!leaseOnly && (
      <>
      <OcrToolbar
        onContract={data => {
          // controlled state
          if (data.rentAmount != null) setRentAmount(data.rentAmount)
          if (data.depositAmount != null) setDepositAmountVal(data.depositAmount)
          if (data.cleaningFee != null) setCleaningFeeVal(data.cleaningFee)
          if (data.roomNo) {
            // '402호' → '402' 매칭
            const norm = (s: string) => s.replace(/[^0-9가-힣A-Za-z]/g, '')
            const target = norm(data.roomNo)
            const m = rooms.find(r => norm(r.roomNo) === target || r.roomNo === data.roomNo)
            if (m) setSelectedRoomId(m.id)
          }
          if (data.dueDay) applyDueDay(data.dueDay)
          if (data.moveInDate) setInputByName('moveInDate', data.moveInDate)
          // uncontrolled
          setInputByName('name', data.name)
          setInputByName('englishName', data.englishName)
          setInputByName('gender', data.gender)
          setInputByName('nationality', data.nationality)
          setInputByName('birthdate', data.birthdate)
          setInputByName('job', data.job)
          setInputByName('contactValue', data.contactPhone)
          setInputByName('emergencyContact', data.emergencyPhone)
          setInputByName('emergencyRelation', data.emergencyRelation)
        }}
        onIdCard={data => {
          setInputByName('name', data.name)
          setInputByName('englishName', data.englishName)
          setInputByName('gender', data.gender)
          setInputByName('nationality', data.nationality)
          setInputByName('birthdate', data.birthdate)
        }}
      />

      <FormSection title="기본 정보">
        <div className="grid grid-cols-2 gap-3">
          <Field label="이름 *" name="name" defaultValue={tenant?.name} placeholder="홍길동" required />
          <Field label="영어이름" name="englishName" value={englishNameVal} onChange={setEnglishNameVal} placeholder="Hong Gildong" />
        </div>
        {/* 현지 표기 이름 — 외국인 전용(국적이 대한민국이면 숨김, 외국인등록번호·본국 연락처와 같은 조건).
            숨겨져도 저장 시 기존 값은 보존된다(칸 부재 = 서버가 건드리지 않음).
            로마자만으로는 성조·한자를 되짚을 수 없어 영문 이름과 다른 사실이다. 서류 성명 표기
            선택지에 '현지'가 이 값으로 붙는다. 인쇄 폰트가 못 그리는 글자(한자·아랍·태국 문자 등)면
            선택지에서 빠지고 값은 여기 그대로 남는다.
            예시는 실존 입주자와 무관한 가상 이름이다(신고 c170be72). 종전 예시가 지금 사는 분의
            실제 현지 표기라 운영자가 거슬려 했다. 로마자를 피한 것은 이 칸이 위 '영어이름'과 다른
            값이라는 것을 예시 한 줄로 보이게 하려는 것이다. */}
        {natVal !== '대한민국' && (
        <div className="space-y-1.5">
          <label htmlFor={`nativeName-${formUid}`} className="text-xs font-medium text-[var(--warm-mid)]">현지 표기 이름 <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal">(본국 표기 그대로 · 서류 성명 표기에서 고를 수 있습니다)</span></label>
          <input
            id={`nativeName-${formUid}`}
            type="text"
            name="nativeName"
            defaultValue={tenant?.nativeName ?? ''}
            maxLength={NATIVE_NAME_MAX}
            placeholder="Иван Иванов"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors min-h-[var(--input-h-touch)] sm:min-h-0"
          />
        </div>
        )}
        {/* 별칭과 카드 표시 이름 — 내국인·외국인 가리지 않는다(국적 가드 밖). '정다솜 (Sasha)'처럼
            이름 칸에 부르는 말을 욱여넣은 사례가 이미 있다. 서류 성명 표기(계약서·확인서)는 별개
            축이라 이 선택의 영향을 받지 않는다(lib/documentName).
            전송 지점(hidden)은 선택지가 하나뿐이라 셀렉트가 안 그려질 때도 항상 렌더한다 —
            칸이 사라져 값이 안 가면 서버의 '부재=보존'이 아니라 여기서는 옛 값이 남는다.
            예시 '미소'도 실존 입주자와 무관한 가상 별칭이다(신고 c170be72). 한국에 사는 외국인이
            스스로 붙이는 한국식 애칭의 결을 보이려는 것이라, 실명이 아니라 누가 봐도 별명인 말을 쓴다. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="별칭" hint="(실제로 부르는 이름 · 카드 표시 이름에서 고를 수 있습니다)"
            name="nickname" value={nicknameVal} onChange={setNicknameVal}
            maxLength={NICKNAME_MAX} placeholder="미소" />
          <input type="hidden" name="displayNameStyle" value={displayStyleVal} />
          {displayStyleOptions.length > 1 && (
            <SelectField label="카드 표시 이름" value={displayStyleVal}
              onChange={v => setDisplayStyleVal(asDisplayNameStyle(v))}>
              {displayStyleOptions.map(s => <option key={s} value={s}>{DISPLAY_NAME_STYLE_LABEL[s]}</option>)}
            </SelectField>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="생년월일" name="birthdate" type="birthdate" defaultValue={toDateInput(tenant?.birthdate)} />
          <SelectField label="성별" name="gender" defaultValue={tenant?.gender}>
            <option value="UNKNOWN">미기재</option>
            <option value="MALE">남성</option>
            <option value="FEMALE">여성</option>
            <option value="OTHER">기타</option>
          </SelectField>
          <SelectField label="기초수급자" name="isBasicRecipient" defaultValue={tenant?.isBasicRecipient ? 'true' : 'false'}>
            <option value="false">아니오/해당없음</option>
            <option value="true">예/대상자</option>
          </SelectField>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">국적</label>
            <CountrySelect name="nationality" defaultValue={tenant?.nationality} onChange={v => setNatVal(v ?? '')} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">직업</label>
            <JobSelect name="job" defaultValue={tenant?.job} />
          </div>
          <SelectField label="흡연 여부" name="smoking" defaultValue={tenant?.smoking ? 'true' : 'false'}>
            <option value="false">비흡연</option>
            <option value="true">흡연</option>
          </SelectField>
        </div>
        {/* 외국인등록번호 — 본국 연락처와 같은 조건(국적이 대한민국이면 숨김).
            숨겨져도 저장 시 기존 값은 보존된다(빈 값 = 서버가 건드리지 않음). */}
        {natVal !== '대한민국' && (
          <ForeignRegNoField tenantId={tenant?.id} masked={tenant?.foreignRegNoMasked ?? null} />
        )}
      </FormSection>

      <FormSection title="연락처">
        <div className="grid grid-cols-3 gap-2">
          <SelectField label="연락 수단" name="contactType" value={contactTypeVal} onChange={setContactTypeVal}>
            <option value="PHONE">휴대전화</option>
            <option value="LANDLINE">일반전화</option>
            <option value="KAKAO">카카오</option>
            <option value="WECHAT">위챗</option>
            <option value="LINE">라인</option>
            <option value="TELEGRAM">텔레그램</option>
            <option value="FACEBOOK">페이스북</option>
          </SelectField>
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">연락처</label>
            <ContactValueInput name="contactValue" defaultValue={primary?.contactValue ?? ''} contactType={contactTypeVal} />
          </div>
        </div>
        <Field label="이메일" name="email" type="email" defaultValue={tenant?.email ?? ''} placeholder="example@email.com" />
        <div className="grid grid-cols-3 gap-2">
          <Field label="비상연락 관계" name="emergencyRelation" defaultValue={emergency?.emergencyRelation ?? ''} placeholder="부모님" />
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">비상 연락처</label>
            <PhoneInput name="emergencyContact" defaultValue={emergency?.contactValue ?? ''} />
          </div>
        </div>
        {/* 본국 연락처 — 외국인 전용. 국적이 대한민국이면 숨김(운영자 요청 2026-07-11).
            숨겨져도 저장 시 기존 값은 보존(필드 부재 = 서버가 건드리지 않음).
            국가는 국적을 따라간다(신고 aed91367). 저장된 국가가 있으면 그것이 먼저다 —
            국적이 미국인데 일본에 사는 경우가 있어 국적이 저장값을 덮으면 안 된다.
            마운트 뒤 국적을 바꾸는 흐름은 syncCountry 가 받는다(번호가 비어 있을 때만). */}
        {natVal !== '대한민국' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">본국 연락처 <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal">(외국인 입주자 · 국가 선택 시 자동 포맷)</span></label>
          <IntlPhoneInput
            name="homeCountryContact"
            countryName="homeCountryCode"
            defaultValue={homeCountry?.contactValue ?? ''}
            defaultCountry={homeCountry?.countryCode ?? codeByName(natVal) ?? 'KR'}
            syncCountry={codeByName(natVal)}
            placeholder="국가 선택 후 번호 입력"
          />
        </div>
        )}
      </FormSection>
      </>
      )}

      <FormSection title="계약 정보">
        <div className="grid grid-cols-2 gap-3">
          {/* 상태 — controlled: 호실 선택 가능 여부 및 퇴실일 표시 결정 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">상태</label>
            {/* 생애주기 순 optgroup — 상태 정의 혼란 해소(e1b81629). 저장 값은 hidden input(항상 enum)이 담당하고,
                select는 '문의'(UI 전용 값 INQUIRY, 저장 시 WAITING_TOUR)를 포함한 표시 컨트롤(운영자 승인 2026-07-19) */}
            <input type="hidden" name="status" value={statusVal} />
            <select
              value={statusVal !== 'WAITING_TOUR' ? statusVal : (!tourDateVal && uiWaitingKind === 'INQUIRY' ? 'INQUIRY' : 'WAITING_TOUR')}
              onChange={e => {
                const v = e.target.value
                if (v === 'INQUIRY')           { setStatusVal('WAITING_TOUR'); setUiWaitingKind('INQUIRY') }
                else if (v === 'WAITING_TOUR') { setStatusVal('WAITING_TOUR'); setUiWaitingKind('TOUR') }
                else                           setStatusVal(v)
              }}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <optgroup label="문의·예약">
                {/* 투어일이 있으면 '문의' 선택 불가 — 문의로 두려면 투어일을 먼저 비운다(자동으로 문의 복귀) */}
                <option value="INQUIRY" disabled={!!tourDateVal}>문의</option>
                <option value="WAITING_TOUR">투어 예정</option>
                <option value="TOUR_DONE">투어 완료</option>
                <option value="RESERVED">입실 예약</option>
              </optgroup>
              <optgroup label="거주">
                <option value="ACTIVE">거주중</option>
                <option value="CHECKOUT_PENDING">퇴실 예정</option>
                <option value="NON_RESIDENT">비거주자</option>
              </optgroup>
              <optgroup label="종료">
                <option value="CHECKED_OUT">퇴실</option>
                <option value="CANCELLED">입실 취소</option>
              </optgroup>
            </select>
            {/* 딸린 계약 경고 — 메인 계약을 끝내도 추가 계약은 따라 정리되지 않는다(다호실 마무리 2026-08-17).
                막지 않고 알린다. 창고만 남기고 방을 빼는 것도 정당한 저장이라 서버는 그대로 받는다.
                상태전환 미니폼의 같은 경고와 문장 한 벌이다. */}
            {(() => {
              const closing: string[] = CLOSED_STATUSES
              const subs = statusVal !== lease?.status && closing.includes(statusVal)
                ? liveSubLeases(tenant, lease?.id) : []
              if (subs.length === 0) return null
              return (
                <p className="mt-1 text-[0.65625rem] text-[var(--warning-fg)] leading-relaxed break-keep">
                  이 계약에 딸린 추가 계약 {subs.length}건({fmtRoomList(subs.map(l => l.room?.roomNo))})은 자동으로 정리되지 않습니다. 각 계약에서 따로 처리해 주세요.
                </p>
              )
            })()}
            {/* 상태를 바꾸는 저장 — 상태전환 미니폼과 같은 사유 수집(수정 폼 경로 누락 봉합, 2026-07-27).
                어떤 전이에서 받을지는 statusReasons 정본이 정한다. 입실 취소에 더해 퇴실 계열도 받는다
                (운영자 오더 2026-08-03). 폼과 미니폼이 각자 조건을 들면 또 갈린다. */}
            {(() => {
              const opts = statusVal !== lease?.status ? reasonsForStatus(statusVal) : null
              if (!opts) return null
              return (
                <div className="mt-2 space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">{reasonLabel(statusVal)} <span className="font-normal opacity-60">(선택)</span></label>
                  <select value={cancelReasonVal} onChange={e => setCancelReasonVal(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    <option value="">기록 안 함</option>
                    {opts.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {cancelReasonVal === '기타' && (
                    <input type="text" value={cancelReasonEtc} onChange={e => setCancelReasonEtc(e.target.value)}
                      placeholder="사유를 직접 입력하세요"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                  )}
                  <input type="hidden" name="cancelReason" value={buildReason(cancelReasonVal, cancelReasonEtc)} />
                </div>
              )
            })()}
            {/* 처음 보는 상태 정의 — 선택했을 때만 한 줄(신규유저 감사 #5, e1b81629로 전 단계 확장) */}
            {statusVal === 'WAITING_TOUR' && !tourDateVal && uiWaitingKind === 'INQUIRY' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">문의 = 연락만 받은 상태 · 투어일을 잡으면 &lsquo;투어 예정&rsquo;으로 바뀝니다</p>
            )}
            {statusVal === 'WAITING_TOUR' && !tourDateVal && uiWaitingKind === 'TOUR' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">투어일을 넣어야 &lsquo;투어 예정&rsquo;으로 표시됩니다 · 비워 두면 &lsquo;문의&rsquo;</p>
            )}
            {statusVal === 'WAITING_TOUR' && !!tourDateVal && tourDateVal >= formToday && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">투어 예정 = 보러 오기로 한 상태</p>
            )}
            {/* 폼을 다시 열었더니 투어일이 이미 지난 경우 — 자동 변경 금지, 제안만(전문가 패널 합의) */}
            {statusVal === 'WAITING_TOUR' && !!tourDateVal && tourDateVal < formToday && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                투어일이 지났습니다 ·{' '}
                <button type="button" onClick={() => setStatusVal('TOUR_DONE')}
                  className="underline text-[var(--coral)] font-medium">투어 완료로 변경</button>
              </p>
            )}
            {statusVal === 'TOUR_DONE' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                {tourDateVal && tourDateVal > formToday
                  ? <>투어 날짜가 미래입니다 · 아직 안 다녀갔다면 &lsquo;투어 예정&rsquo;을 선택하세요</>
                  : <>투어 완료 = 둘러보고 간 뒤 결정을 기다리는 상태</>}
              </p>
            )}
            {statusVal === 'NON_RESIDENT' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">비거주자 = 방에 살지는 않지만 계약·요금이 있는 경우 (창고·사무실 임대 등)</p>
            )}
            {statusVal === 'RESERVED' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">입실 예약 = 입주 의사만 받은 상태 · 아래 &lsquo;예약 확정&rsquo;을 체크하면 방을 실제로 잡아둡니다</p>
            )}
            {statusVal === 'CANCELLED' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">입실 취소 = 문의·투어·예약이 더 진행되지 않은 경우 (기록은 보존됩니다)</p>
            )}
          </div>
          <SelectField label="선납/후납" name="paymentTiming" defaultValue={lease?.paymentTiming ?? 'PREPAID'}>
            <option value="PREPAID">선납</option>
            <option value="POSTPAID">후납</option>
          </SelectField>
        </div>

        {/* 연장 확인용 이전 값 — 제출 핸들러가 '퇴실 예정인데 퇴실일만 미래로 변경'을 감지 */}
        {lease && <input type="hidden" name="prevStatus" value={lease.status} />}
        {lease && <input type="hidden" name="prevExpectedMoveOut" value={toDateInput(lease.expectedMoveOut)} />}
        {/* 상태별 단계 정보 — 상태에 따라 관련 입력이 상태 바로 아래에 표시됨 */}
        {/* 입실 문의 일시 (예약/투어/취소 — 예약자 순번 기준. 취소자도 이력 보존·열람) */}
        {(statusVal === 'RESERVED' || statusVal === 'WAITING_TOUR' || statusVal === 'TOUR_DONE' || statusVal === 'CANCELLED') && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">
              입실 문의 일시 <span className="font-normal opacity-60">(예약자 순번 기준)</span>
            </label>
            <input type="hidden" name="inquiryAt" value={inquiryAtCombined} />
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker
                  value={inquiryDateVal}
                  onChange={(date) => {
                    setInquiryDateVal(date)
                    // 날짜 선택 시 시간이 비어있으면 현재 시각을 디폴트로 자동 입력
                    // (브라우저 native time input의 placeholder는 실제 값이 아니라 사용자 혼동 방지용)
                    // uncontrolled 이므로 DOM 값도 함께 세팅해야 화면에 반영된다.
                    if (date && !inquiryTimeRef.current?.value) {
                      // 지금 시각도 KST 정본으로 — 이 값은 KST 로 해석돼 저장된다(기기 타임존과 무관해야 한다).
                      const t = splitKstDateTime(new Date()).hm
                      if (inquiryTimeRef.current) inquiryTimeRef.current.value = t
                      setInquiryTimeVal(t)
                    }
                  }}
                  placeholder="문의 날짜 선택"
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
                />
              </div>
              <input
                ref={inquiryTimeRef}
                type="time"
                defaultValue={initialInquiry.time}
                onChange={e => setInquiryTimeVal(e.target.value)}
                disabled={!inquiryDateVal}
                aria-label="입실 문의 시각"
                className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors disabled:opacity-50"
              />
            </div>
            <KeepAlertCheckbox defaultValue={lease?.keepAlertAfterInquiry ?? true} />
          </div>
        )}
        {/* 투어 날짜 — 예약자도 투어 일정을 가질 수 있고, 취소자도 이력을 보존한다(운영자 요청 2026-07-11) */}
        {['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'].includes(statusVal) && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">
              {statusVal === 'WAITING_TOUR' ? '투어 예정일' : '투어 날짜'}
              {statusVal !== 'WAITING_TOUR' && <span className="font-normal opacity-60"> (예정 또는 다녀간 날, 선택)</span>}
            </label>
            <div className="flex gap-2">
              <DatePicker
                name="tourDate"
                value={tourDateVal}
                onChange={date => {
                  // 자동 전환은 문의·투어 예정(WAITING_TOUR)에서 사용자가 날짜를 편집한 직후에만.
                  // 예약·취소·완료 상태의 투어일은 이력 기록이라 상태를 건드리지 않는다(전문가 패널 합의).
                  setTourDateVal(date)
                  if (statusVal !== 'WAITING_TOUR') return
                  if (!date) { setUiWaitingKind('INQUIRY'); return }
                  if (date < kstYmdStr()) {
                    // a안(운영자 확정): 지난 날짜는 확인창으로 제안 — 무단 자동 전환 금지
                    void confirmDialog({
                      title: '투어일이 지난 날짜입니다',
                      message: '이미 다녀간 투어라면 상태를 투어 완료로 바꾸는 것을 권합니다.',
                      confirmLabel: '투어 완료로 변경', cancelLabel: '투어 예정 유지',
                    }).then(toDone => {
                      setUiWaitingKind('TOUR')
                      if (toDone) setStatusVal('TOUR_DONE')
                    })
                    return
                  }
                  setUiWaitingKind('TOUR')   // 오늘·미래 날짜 = 아직 안 다녀온 투어
                }}
                placeholder={statusVal === 'WAITING_TOUR' ? '투어 예정일 선택' : '투어 날짜 선택 (선택)'}
                className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
              />
              {/* 시간(선택) — 입력하면 구독 캘린더에 시각 지정 이벤트로 나가고 1시간 전 알림이 붙는다 */}
              {/* uncontrolled(defaultValue) — time 입력은 값이 미완성이면 빈 문자열을 돌려준다. controlled 로 두면
                  시(7)를 치는 순간 value 가 '' 로 덮여 오전/오후 자리까지 가지 못하고 계속 리셋된다(신고 2026-07-24).
                  onChange 는 검증용 state 갱신에만 쓰고 value 로는 묶지 않는다.
                  min — 같은 날이면 문의 시각 이후만 허용(투어는 문의 뒤에 온다, 운영자 요청 2026-07-24). */}
              <input type="time" name="tourTime" defaultValue={lease?.tourTime ?? ''}
                onChange={e => setTourTimeVal(e.target.value)}
                min={tourMinTime}
                disabled={!tourDateVal} aria-label="투어 예정 시간"
                className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors disabled:opacity-40" />
            </div>
            {tourTimeTooEarly ? (
              <p className="text-[0.65625rem] text-[var(--danger-fg)]">투어 시간은 입실 문의 시각({fmtHM12(tourMinTime!)}) 이후로 넣어 주세요.</p>
            ) : (
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">시간까지 넣으면 캘린더 연동에 그 시각으로 등록되고 1시간 전에 알림이 갑니다. 비우면 종일 일정으로 나갑니다.</p>
            )}
          </div>
        )}
        {/* 예약 확정 토글 (RESERVED 전용) — 호실/이용료/입주희망일 필수 + 매칭 알림 제외 */}
        {statusVal === 'RESERVED' && (
          <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)]/50 px-3 py-2.5 space-y-1.5">
            <input type="hidden" name="reservationConfirmed" value={reservationConfirmed ? 'true' : 'false'} />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reservationConfirmed}
                onChange={e => setReservationConfirmed(e.target.checked)}
                className="w-4 h-4 accent-[var(--coral)]"
              />
              <span className="text-xs font-medium text-[var(--warm-dark)]">예약 확정</span>
              {reservationConfirmed && lease?.reservationConfirmedAt && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">· {fmtDate(lease.reservationConfirmedAt)}</span>
              )}
            </label>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed pl-6">
              체크 시 호실/월 이용료/입주 희망일이 필수가 되고, 공실·퇴실 예정 방만 선택할 수 있습니다. 입주 희망일이 도래하면 대시보드 알림에서 거주중 전환을 진행하세요.
            </p>
          </div>
        )}
        {/* 입주 희망일 — 예약/투어 단계는 상태 클러스터 안(상태 바로 아래)에 표시 */}
        {roomIsOptional && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">입주 희망일</label>
            {renderMoveInInput('입주 희망일 선택')}
            {moveInInheritUi}
            {/* 일정 조절 — 매칭 날짜 게이트의 유일한 입력(lib/wishMatch). 미선택은 '아직 안 물어봤다'로 남고
                후보에서 빠지지 않는다. 이 hidden 은 예약·투어 단계에서 항상 렌더된다 — 조건부로 그리면
                서버의 '부재=보존' 관행 탓에 희망일을 지워도 옛 값이 남는다(신고 c4b74c7d 와 같은 클래스).
                거주 단계 저장은 이 블록 자체가 없어 필드가 안 가고, 그래서 값이 보존된다. */}
            <input type="hidden" name="moveInFlexible" value={moveInFlexVal} />
            {moveInVal && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs font-medium text-[var(--warm-mid)]">일정 조절</span>
                <SegmentedControl<MoveInFlexValue>
                  size="sm"
                  ariaLabel="입주 희망일 조절 가능 여부"
                  options={[{ value: 'yes', label: '가능' }, { value: 'no', label: '불가' }]}
                  value={moveInFlexVal}
                  onChange={setMoveInFlexVal}
                />
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">
                  {moveInFlexVal === 'yes' ? '방이 조금 늦게 비어도 매칭 후보로 남습니다'
                    : moveInFlexVal === 'no' ? '이 날짜에 못 맞추는 방은 매칭에서 빠집니다'
                    : '미선택 · 확인 전까지 후보로 남습니다'}
                </span>
                {moveInFlexVal && (
                  <button type="button" onClick={() => setMoveInFlexVal('')}
                    className="min-h-[28px] inline-flex items-center text-[0.65625rem] px-1.5 text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">기본값으로</button>
                )}
              </div>
            )}
            {/* 연락 알림일 — 이 날부터 '연락할 때' 알림. 비우면 영업장 기본(입주 희망일 N일 전). 운영자 요청 2026-07-10 */}
            {moveInVal && (() => {
              const def = (() => {
                const d = new Date(moveInVal + 'T00:00:00')
                if (isNaN(d.getTime())) return ''
                d.setDate(d.getDate() - contactLeadDays)
                const today = new Date(kstYmdStr() + 'T00:00:00')
                const eff = d < today ? today : d
                return `${eff.getFullYear()}-${String(eff.getMonth() + 1).padStart(2, '0')}-${String(eff.getDate()).padStart(2, '0')}`
              })()
              const effective = contactAlertVal || def
              return (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs font-medium text-[var(--warm-mid)]">연락 알림일</span>
                  {/* 날짜를 탭하면 달력이 열려 바로 변경(운영자 요청 2026-07-10). 저장값은 직접 지정했을 때만 */}
                  <DatePicker value={effective} onChange={setContactAlertVal}
                    className="!w-auto inline-flex items-center px-1 text-sm font-semibold text-[var(--coral)] underline decoration-dotted underline-offset-4" />
                  <input type="hidden" name="contactAlertDate" value={contactAlertVal} />
                  <span className="text-[0.65625rem] text-[var(--warm-muted)]">
                    {contactAlertVal ? '직접 지정' : `기본 · 희망일 ${contactLeadDays}일 전`} · 이 날부터 홈 화면과 알림(종 아이콘)에 표시
                  </span>
                  {contactAlertVal && (
                    <button type="button" onClick={() => setContactAlertVal('')}
                      className="min-h-[28px] inline-flex items-center text-[0.65625rem] px-1.5 text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">기본값으로</button>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* 단기 희망 토글 — 체크 시 월 이용료/보증금/청소비 자동 입력 건너뛰고 수동 입력 강제 */}
        <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)]/50 px-3 py-2.5 space-y-1">
          <input type="hidden" name="isShortTerm" value={isShortTerm ? 'true' : 'false'} />
          {/* 퇴실 예정일의 유일한 전송 지점(거주 전·거주중). 서버는 필드 부재를 '보존'으로 읽으므로
              (신고 aae0ab38 관행) 이 입력을 조건부로 그리면 화면에서 사라진 값이 DB에 그대로 남는다.
              신고 c4b74c7d 가 그 경로다 — 단기 희망을 끄면 퇴실일 칸이 사라져 필드째 전송에서 빠졌고,
              단기를 켠 채 날짜만 지워도 값이 있을 때만 그리던 탓에 역시 빠져 12/20 이 계속 남았다.
              단기 해제 = 퇴실 예정일이 필요 없다는 뜻이므로 빈 값을 명시 전송해 함께 비운다.
              퇴실 예정·퇴실 확정(showExitDate)은 아래 '퇴실일' 필드가 정본이라 여기서 손대지 않는다 —
              퇴실 예정 처리 경로와 무접점. */}
          {!showExitDate && <input type="hidden" name="expectedMoveOut" value={isShortTerm ? shortOut : ''} />}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isShortTerm} onChange={e => setIsShortTerm(e.target.checked)}
              className="w-4 h-4 accent-[var(--coral)]" />
            <span className="text-xs font-medium text-[var(--warm-dark)]">단기 희망</span>
          </label>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed pl-6">
            체크 시 호실 선택 후에도 월 이용료/보증금/청소비가 자동 채워지지 않고 모두 수동 입력합니다. 호실의 표준 가격에는 영향이 없으며 퇴실 후 다음 입주자는 다시 자동 채워집니다.
          </p>
          {isShortTerm && (() => {
            const baseRent = shortQuoteData?.rooms.find(r => r.id === selectedRoomId)?.baseRent
              ?? rooms.find(r => r.id === selectedRoomId)?.baseRent ?? 0
            const days = moveInVal && shortOut ? stayDaysOf(moveInVal, shortOut) : null
            const short = shortQuoteData && baseRent > 0 && days != null
              ? calcShortStay(shortQuoteData.shortStay, baseRent, days, { moveInYmd: moveInVal, moveOutYmd: shortOut }) : null
            return (
              <div className="pl-6 pt-1 space-y-2">
                <p className="text-[0.6875rem] font-medium text-[var(--warm-mid)]">단기 요금 자동 계산 <span className="font-normal text-[var(--warm-muted)]">(홈의 단기 요금 계산과 같은 규칙)</span></p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">{moveInLabel} (아래 칸과 같은 날짜)</span>
                    {/* 메인 계약과 같음이면 여기서도 못 고친다. 이 칸은 아래 입주일과 같은 값이라
                        한쪽만 열어 두면 잠긴 날짜를 옆문으로 바꾸는 길이 된다(제출은 안 되고 계산만 흔들린다). */}
                    <DatePicker value={moveInVal} onChange={setMoveIn} placeholder={moveInLabel}
                      disabled={moveInSameAsParent}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none w-full" />
                  </div>
                  <div>
                    <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">퇴실일 (예정 퇴실일로 저장)</span>
                    <DatePicker value={shortOut} onChange={setShortOut} placeholder="퇴실일"
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none w-full" />
                  </div>
                </div>
                {/* 여기 값(shortOut)은 이 박스 바깥 위쪽의 hidden expectedMoveOut 하나로만 전송된다.
                    거주 단계(showExitDate)는 아래 '퇴실일' 필드가 같은 shortOut 을 쓰므로
                    name="expectedMoveOut" 은 어느 상태에서도 정확히 하나만 전송된다. */}
                {!selectedRoomId ? (
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">호실을 고르면 그 방의 표준가로 자동 계산합니다</p>
                ) : short && days != null ? (
                  <div className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-2.5 py-2 space-y-1">
                    <p className="text-[0.6875rem] text-[var(--warm-dark)]">
                      {days}일 → {short.units}주 계약{short.cappedAtMonth ? ' (1개월 상한 적용)' : ''} ·
                      사용료 {fmtWon(short.baseAmount)} + 청소비 {fmtWon(short.cleaningFee)} = <span className="font-bold">{fmtWon(short.total)}</span>
                      {/* 정책 예약금(shortStay.deposit)의 성격이 예약금 처리 모드에 따라 다르다.
                          applyToRent 에서는 퇴실 때 돌려줄 예치금이 아니라, 청소비를 떼고 나머지를
                          이용료로 충당하는 '예약금'이다 — '퇴실 시 환불'이라고 쓰면 반대로 안내하게 된다. */}
                      {short.deposit > 0 && (shortQuoteData?.shortStay.reservationMode === 'applyToRent'
                        ? <span className="text-[var(--warm-muted)]"> · 예약금 {fmtWon(short.deposit)}(청소비 차감 후 이용료 충당)</span>
                        : <span className="text-[var(--warm-muted)]"> · 보증금 {fmtWon(short.deposit)} 별도(퇴실 시 환불)</span>)}
                    </p>
                    <button type="button"
                      // applyToRent 는 보증금 record 를 만들지 않는 규칙이라 계약 보증금 칸도 채우지 않는다.
                      // 채우면 받지도 않은 예치금 책임이 계약에 박히고 퇴실 정산이 그 금액을 환불하려 든다.
                      onClick={() => { setRentAmount(short.baseAmount); setCleaningFeeVal(short.cleaningFee); if (short.deposit > 0 && shortQuoteData?.shortStay.reservationMode !== 'applyToRent') setDepositAmountVal(short.deposit) }}
                      className="min-h-[32px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-[var(--on-solid)] hover:opacity-90 transition-opacity">
                      이 금액 채우기
                    </button>
                    <span className="ml-2 text-[0.65625rem] text-[var(--warm-muted)]">채운 뒤 아래에서 자유롭게 수정할 수 있어요</span>
                  </div>
                ) : days != null && shortQuoteData && days > shortQuoteData.shortStay.thresholdDays
                    && !(moveInVal && shortOut && isWithinOneCalendarMonth(moveInVal, shortOut)) ? (
                  <p className="text-[0.65625rem] text-[var(--warning-fg)]">단기 범위(입실일부터 한 달)를 넘는 기간입니다. 월 단위로 입력해 주세요.</p>
                ) : (
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">입실일과 퇴실일을 고르면 요금이 자동 계산됩니다</p>
                )}
              </div>
            )
          })()}
        </div>

        {/* 호실 — 상태에 따라 선택 규칙 다름 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">
            호실{roomCanBeEmpty ? '' : ' *'}
            {!roomIsOptional && statusVal === 'RESERVED' && <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)] font-normal">(맞바꿈 시 잠시 비워둘 수 있음)</span>}
          </label>
          <select name="roomId" value={selectedRoomId} onChange={handleRoomChange} required={!roomCanBeEmpty}
            onWheel={e => e.stopPropagation()}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
            <option value="">{roomCanBeEmpty ? '호실 선택 (선택사항)' : '호실 선택'}</option>
            {rooms.map(r => {
              const isCurrentRoom = r.id === lease?.room?.id
              const pick = roomPickability(r, isCurrentRoom)
              // 문의·예약 확정: 공실·본인 방에 더해 '언제 비는지 아는 방'까지 고를 수 있다.
              // 입실·퇴실 예정: 지금 빈 방만(서버가 점유 방을 거부한다).
              const disableRoom = isWaitingTourStatus ? !pick.reservable : (activeOnlyStatus && !pick.residable)
              const showOpenDate = isWaitingTourStatus && !!pick.openDate
              return (
                <option key={r.id} value={r.id} disabled={disableRoom}
                  style={showOpenDate ? { fontWeight: 'bold' } : undefined}>
                  {fmtRoomNo(r.roomNo)}{showOpenDate ? ` (${fmtMD(pick.openDate)} 퇴실)` : ''}
                </option>
              )
            })}
          </select>
          {/* 겹침 경고 — 막지 않고 알린다. 입주일을 아직 안 넣었으면 표시하지 않는다.
              누구와 겹치는지까지 말한다 — 계약이 이어 붙은 방에서 '방의 마지막 퇴실일'은 앞을 막고 선 사람이 아니다.
              당일 회전만은 경고가 아니라 중립 캡션이다 — 앞사람이 나가는 그날 들어오는 것은 정상이라
              노랑으로 부르면 진짜 겹침과 구분이 안 된다(2026-08-19 겹침 판정 개정). */}
          {(() => {
            const sel = rooms.find(r => r.id === selectedRoomId)
            const hit = isWaitingTourStatus ? overlapOccupancy(sel, moveInVal, lease?.id) : null
            if (!hit) return null
            if (isSameDayTurnover({ moveIn: moveInVal, moveOut: (isShortTerm ? shortOut : '') || null }, hit)) {
              return (
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                  당일 회전입니다. {fmtMD(hit.moveOut)} 오후 퇴실 후 입실 가능합니다.
                </p>
              )
            }
            return (
              <p className="text-[0.65625rem] text-[var(--warning-fg)]">
                희망 입주일({fmtMD(moveInVal)})이 {hit.tenantName}님 퇴실 예정일({fmtMD(hit.moveOut)})과 겹칩니다.
              </p>
            )
          })()}

          {/* 이사일 — 살던 사람이 방을 옮길 때만. '실제 퇴실일'(아래) 과 같은 조건부 날짜 칸 문법이다.
              이 칸이 없던 동안 거주 구간의 경계가 '저장을 누른 날'로 박혔다(lib/roomStay recordRoomChange
              의 at 인자를 넘기는 호출부가 저장소에 0곳이었다). 그 날짜가 곧 캘린더의 두 막대가 갈리는
              자리라, 틀리면 옛 방과 새 방이 며칠씩 어긋난 채 그려진다.
              신규 배정(방이 처음 정해지는 것)은 이사가 아니라 입주이므로 뜨지 않는다. */}
          {isRoomMove && (
            <>
              <Field label="이사일" name="moveDate" type="date" value={moveDateVal} onChange={setMoveDateVal} />
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                실제로 방을 옮긴 날입니다. 기본은 오늘이고, 뒤늦게 입력하는 이사는 그날로 고쳐 주세요.
              </p>
            </>
          )}
        </div>

        {/* 메인 계약 (2026-08-13, 다호실 2단계) — 이 계약이 어느 계약에 묶이는가.
            고를 것이 있을 때만 그린다. 단독 계약이 불가한 방을 고르면 필수가 되고,
            그 방을 고르지 않았으면 '없음'이 그대로 기본이다(종전 저장과 같은 값).
            판정은 서버(lib/roomAssignment)가 다시 본다 — 화면에만 있는 규칙은 규칙이 아니다. */}
        {parentLeases.length > 0 && (() => {
          const selectedRoom = rooms.find(r => r.id === selectedRoomId)
          const required = selectedRoom ? !selectedRoom.standaloneLeaseAllowed : false
          return (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">메인 계약{required ? ' *' : ''}</label>
              <select name="parentLeaseTermId" value={parentVal} onChange={e => setParentVal(e.target.value)} required={required}
                onWheel={e => e.stopPropagation()}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                <option value="">없음 (단독 계약)</option>
                {parentLeases.map(l => (
                  <option key={l.id} value={l.id}>
                    {[fmtRoomNo(l.room?.roomNo, '호실 미지정'), STATUS_LABEL[l.status] ?? l.status].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                {required
                  ? '이 호실은 단독 계약이 불가한 방입니다. 메인 계약을 골라 주세요.'
                  : '계약서는 메인 계약의 계약서 한 장에 합쳐서 인쇄됩니다. 청구와 수납은 계약별로 따로입니다.'}
              </p>
              {/* 창고류 방이 딸릴 때 비거주자 권고 — 자동 전환 금지(멀쩡한 방 둘을 혼자 계약할 수 있다,
                  운영자 오더 2026-08-13). 버튼은 화면 상태만 바꾸고 저장은 여전히 저장 버튼이다(투어일 힌트 전례).
                  실사고: 601호가 '투어 대기'인 채 묶여 합본 계약서에 안 실렸다 — 발급은 발급 대상 상태만 싣는다. */}
              {parentVal !== '' && selectedRoom?.vacancyExcluded && statusVal !== 'NON_RESIDENT'
                && !['CHECKED_OUT', 'CANCELLED'].includes(statusVal) && (
                <p className="text-[0.65625rem] text-[var(--warning-fg)] leading-relaxed">
                  이 호실은 거주용이 아닌 방(창고·사무실)으로 설정돼 있습니다. 상태를 비거주자로 바꾸면 합본 계약서에 이 호실이 함께 실립니다.{' '}
                  <button type="button" onClick={() => setStatusVal('NON_RESIDENT')}
                    className="underline text-[var(--coral)] font-medium">비거주자로 변경</button>
                </p>
              )}
            </div>
          )
        })()}

        {(() => {
          const selectedRoom = rooms.find(r => r.id === selectedRoomId)
          const isNR = statusVal === 'NON_RESIDENT'
          const hasNRRate = isNR && selectedRoom?.nonResidentRent != null
          return (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">
                  {hasNRRate ? '비거주 이용료' : isShortTerm ? '이용료' : '월 이용료'}
                </label>
                {hasNRRate && (
                  <Badge tone="pale-blue">비거주 전용</Badge>
                )}
              </div>
              <MoneyInput name="rentAmount" value={rentAmount} onChange={setRentAmount} placeholder="0원" />
              {isNR && selectedRoom && selectedRoom.nonResidentRent == null && (
                <p className="text-[0.65625rem] text-[var(--warning-fg)]">
                  이 호실에 비거주 이용료가 설정되어 있지 않습니다. 호실 관리에서 먼저 설정해 주세요.
                </p>
              )}
            </div>
          )
        })()}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">보증금</label>
          <MoneyInput
            name="depositAmount"
            value={depositAmountVal}
            onChange={setDepositAmountVal}
            placeholder="0원"
          />
          {/* 프리필 안내 — 청소비를 이미 받은 계약이면 그 사실까지 말한다. 기본값 안내 한 줄만 있던 것이
              단기 해제 순간 50,000 이 자동으로 채워진 사고의 발화점이었다(2026-08-10). */}
          {isAutoFilled(depositAmountVal, lease?.depositAmount, defaultDeposit) ? (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">
              {depoCleaningPaidForm > 0
                ? `환경설정 기본값을 불러왔습니다. 이 계약은 입실 때 청소비 ${depoCleaningPaidForm.toLocaleString()}원을 이미 받았으니, 보증금에 포함되는 방식이면 ${depoCashPortionForm.toLocaleString()}원으로 고쳐 주세요.`
                : '환경설정 기본값을 불러왔습니다. 무보증이면 0으로 지우세요.'}
            </p>
          ) : depoCleaningPaidForm > 0 && (depositAmountVal ?? 0) > 0 ? (
            <p className="text-[0.65625rem] text-[var(--warm-mid)] break-keep">
              이 계약은 입실 때 청소비 {depoCleaningPaidForm.toLocaleString()}원을 받았습니다. 보증금에 포함되는 방식이면 현금으로 받을 몫은 {depoCashPortionForm.toLocaleString()}원입니다.
            </p>
          ) : null}
          {(depositAmountVal ?? 0) > 0 && (
            <label className="flex items-center gap-1.5 text-[0.6875rem] text-[var(--warm-mid)] cursor-pointer pt-0.5">
              <input type="checkbox" name="depositReceived" value="1" checked={depositReceivedOn}
                onChange={e => { void toggleDepositReceived(e.target.checked) }}
                className="w-3.5 h-3.5 accent-[var(--coral)]" />
              보증금 실제로 받음 — 실수납으로 기록 (이미 기록됐으면 자동 무시)
            </label>
          )}
          {/* 선택한 기록 금액·직전 저장값·확인 이력 — 저장 경로가 같은 판단을 다시 하지 않게 폼이 실어 보낸다 */}
          {depositReceivedAmt != null && <input type="hidden" name="depositReceivedAmount" value={String(depositReceivedAmt)} />}
          {lease && <input type="hidden" name="prevDepositAmount" value={String(lease.depositAmount ?? 0)} />}
          {depositChoiceAsked && <input type="hidden" name="depositRaiseAcked" value="1" />}
        </div>
        {/* 청소비 | 입주일 — 입주일은 거주 단계(roomIsOptional=false)만. 예약/투어는 위 상태 클러스터의 입주 희망일 사용 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">청소비</label>
            <MoneyInput
              name="cleaningFee"
              value={cleaningFeeVal}
              onChange={setCleaningFeeVal}
              placeholder="0원"
            />
            {isAutoFilled(cleaningFeeVal, lease?.cleaningFee, defaultCleaningFee) && (
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">환경설정 기본값을 불러왔습니다. 없으면 0으로 지우세요.</p>
            )}
          </div>
          {!roomIsOptional && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">{moveInLabel}</label>
              {renderMoveInInput(`${moveInLabel} 선택`)}
              {moveInInheritUi}
            </div>
          )}
        </div>
        {/* 납부일 | 퇴실일(조건부) (아이템 5, 7, 8) */}
        <div className="grid grid-cols-2 gap-3">
          {/* 거주 전 상태는 납부일 숨김(단기 문법과 동일) — 서버도 같은 기준으로 비운다 */}
          {!duePending && <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">납부일</label>
            {/* 메인 계약과 같은 날이 기본일 때는 메인 계약의 값을 그대로 제출한다. 상속 플래그를 새로 만들지 않는
                이유는 저장된 것이 곧 청구가 읽는 값이어야 하기 때문이다 — 화면에 보이는 날이 곧 청구일이다. */}
            <input type="hidden" name="dueDay" value={dueSameAsParent ? parentDue.raw : dueDayRaw} />
            <input
              type="text"
              value={dueSameAsParent ? parentDue.disp : dueDayDisp}
              readOnly={dueSameAsParent}
              onChange={e => {
                if (dueSameAsParent) return
                const v = e.target.value
                const stripped = v.replace(/일$/, '').trim()
                const n = Number(stripped)
                if (/[ㅁ마말]/.test(v) || (stripped !== '' && !isNaN(n) && n >= 30)) {
                  setDueDayRaw('말일'); setDueDayDisp('말일')
                } else {
                  setDueDayDisp(v)
                }
              }}
              onFocus={() => { if (!dueSameAsParent) setDueDayDisp(prev => prev.replace(/일$/, '')) }}
              onBlur={() => { if (!dueSameAsParent) applyDueDay(dueDayDisp) }}
              placeholder={dueSameAsParent ? '없음' : '15일, 말일 등'}
              className={`w-full border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm placeholder-[var(--warm-muted)] outline-none transition-colors ${
                dueSameAsParent
                  ? 'bg-[var(--cream)] text-[var(--warm-mid)] cursor-default'
                  : 'bg-[var(--canvas)] text-[var(--warm-dark)] focus:border-[var(--coral)]'}`}
            />
            {parentLease && (
              <>
                {dueSameAsParent && (() => {
                  // 어느 계약을 따라가는지 호실로 말한다. 호실이 없는 단계면 '메인 계약'으로 부른다.
                  const who = parentLease.room?.roomNo ? `${fmtRoomNo(parentLease.room.roomNo)} 계약` : '메인 계약'
                  return (
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed break-keep">
                      {parentDue.raw ? `${who}과 같은 납부일입니다.` : `${who}에 납부일이 없습니다.`}
                      {parentDueUnsaved && ' 메인 계약에서 아직 저장하지 않은 값입니다.'}
                    </p>
                  )
                })()}
                <label className="flex items-start gap-1.5 text-[0.6875rem] text-[var(--warm-mid)] cursor-pointer pt-0.5 leading-snug">
                  <input type="checkbox" checked={dueSeparate}
                    onChange={e => {
                      const next = e.target.checked
                      // 따로 풀 때 내 값이 비어 있으면 부모 값에서 이어 쓴다 — 빈 칸이 되면 방금까지
                      // 보이던 날이 사라져 다시 적어야 한다. 내가 적어 둔 값이 있으면 그것을 지키고.
                      if (next && !dueDayRaw && parentDue.raw) { setDueDayRaw(parentDue.raw); setDueDayDisp(parentDue.disp) }
                      setDueSeparate(next)
                    }}
                    className="w-3.5 h-3.5 accent-[var(--coral)] mt-px shrink-0" />
                  납부일 따로 정하기
                </label>
              </>
            )}
            {!tenant && !dueSameAsParent && <p className="text-[0.65625rem] text-[var(--warm-muted)]">입주일과 같은 날로 자동 설정됩니다. 필요 시 변경하세요.</p>}
          </div>}
          {showExitDate && (
            // 퇴실일의 진실 원천은 shortOut 하나. 단기 계산기(위)와 이 입력이 같은 state 를 공유해야
            // 어느 쪽을 고쳐도 같은 값이 저장되고 미리보기 금액도 따라온다(운영자 신고 2026-07-26).
            // 퇴실 확정 상태에선 '실제 퇴실일'과 쌍이라 계약상 예정일임을 라벨로 구분한다(2026-07-28 오더).
            <Field label={statusVal === 'CHECKED_OUT' ? '퇴실 예정일 (계약상)' : '퇴실일'} name="expectedMoveOut" type="date" value={shortOut} onChange={setShortOut} />
          )}
          {statusVal === 'CHECKED_OUT' && (
            // 실제 퇴실일 — 계약상 21일이어도 19일에 일찍 나가면 그날. 퇴실 상태에서만 노출(사후 정정용).
            <Field label="실제 퇴실일" name="actualMoveOut" type="date" value={actualOut || shortOut || kstYmdStr()} onChange={setActualOut} />
          )}
        </div>
      </FormSection>

      <FormSection title="추가 정보">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="전입신고" name="registrationStatus" defaultValue={lease?.registrationStatus ?? 'NOT_REPORTED'}>
            <option value="NOT_REPORTED">미신고</option>
            <option value="REGISTERED">완료</option>
            <option value="EXEMPTED">해당없음</option>
          </SelectField>
          <SelectField label="결제 수단" name="payMethod" defaultValue={lease?.payMethod ?? ''}>
            <option value="">미선택</option>
            <option value="계좌이체">계좌이체</option>
            <option value="신용카드">신용카드</option>
            <option value="결제선생">결제선생</option>
            <option value="현금">현금</option>
          </SelectField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="현금영수증" name="cashReceipt" defaultValue={lease?.cashReceipt ?? ''}>
            <option value="">미선택</option>
            <option value="불필요">불필요</option>
            <option value="소득공제">소득공제</option>
            <option value="지출증빙">지출증빙</option>
          </SelectField>
          <Field label="방문 경로" name="visitRoute" defaultValue={lease?.visitRoute ?? ''} placeholder="소개, 네이버 등" />
        </div>
        <WishSelector
          rooms={rooms}
          lease={lease}
          allowConditions={true}
          isMove={statusVal === 'ACTIVE' || statusVal === 'NON_RESIDENT'}
        />
        {/* 계약서 파일 — 기존 입주자 수정 시에만 표시. 이제 진짜로 뷰어와 같은 정본 컴포넌트를 쓴다
            (사용자 피드백 2026-06-01: 뷰어에는 첨부 UI 있지만 수정 폼에는 없어 헷갈림).
            수정 중에는 서명 요청만 감춘다 — 저장 전 옛 값으로 스냅샷이 굳는 것을 막기 위해. */}
        {tenant && (
          <div className="space-y-1.5">
            <label className="text-[0.6875rem] font-medium" style={{ color: 'var(--warm-mid)' }}>계약서 파일</label>
            <ContractFilesPanel tenantId={tenant.id} tenantName={tenant.name} hideSignRequest />
          </div>
        )}
        {/* 외부 계약서 링크(contractUrl) 입력 제거 — 2026-08-01. DB 실측 0건이라 아무도 쓰지 않았고,
            계약서 접점이 흩어져 보이는 원인이었다. 컬럼과 저장 액션은 유지(기존 값 보존). */}
      </FormSection>

      {!leaseOnly && (
      <FormSection title="메모">
        <textarea name="memo" rows={2} defaultValue={tenant?.memo ?? ''} placeholder="입주자 특이사항"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] resize-none" />
      </FormSection>
      )}

      {/* 저장하면 실제로 걸릴 추가 청구·청구 감액 한 줄 요약 — 서버가 쓰는 calcShortStay 와 같은 규칙을 폼 값으로 돌린 것.
          단기는 rentAmount 가 체류 전체 사용료라 '이미 청구'는 저장돼 있는 이용료와 같다(서버 왕복 없음). */}
      {lease && isShortTerm && typeof lease.rentAmount === 'number' && (() => {
        const baseRent = shortQuoteData?.rooms.find(r => r.id === selectedRoomId)?.baseRent
          ?? rooms.find(r => r.id === selectedRoomId)?.baseRent ?? 0
        const days = moveInVal && shortOut ? stayDaysOf(moveInVal, shortOut) : null
        const short = shortQuoteData && baseRent > 0 && days != null
          ? calcShortStay(shortQuoteData.shortStay, baseRent, days, { moveInYmd: moveInVal, moveOutYmd: shortOut }) : null
        if (!short || days == null) return null
        // 폼 금액을 건드렸으면 그 값이 목표, 아니면 정책 재계산가 — 서버 판정과 같은 규칙
        const target = (rentAmount ?? 0) !== lease.rentAmount ? (rentAmount ?? 0) : short.baseAmount
        const extra = target - lease.rentAmount
        // 양방향 동기화라 감액도 예고한다(변화 없을 때만 숨김).
        if (extra === 0) return null
        const prevOut = toDateInput(lease.expectedMoveOut)
        const md = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}` }
        return (
          <p className="rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--warm-dark)]">
            {prevOut && prevOut !== shortOut && <>퇴실일 {md(prevOut)} → {md(shortOut)} · </>}
            {days}일({short.units}주) {fmtWon(target)} · 이미 청구 {fmtWon(lease.rentAmount)} · <span className="font-bold">{extra > 0 ? `추가 청구 ${fmtWon(extra)}` : `청구 감액 ${fmtWon(-extra)}`}</span>
          </p>
        )
      })()}

      {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
    </>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────

// 외국인등록번호 칸 — 국적이 대한민국이 아닐 때만 그린다(본국 연락처 칸과 같은 조건).
//
// 저장된 값은 마스킹만 보여준다. 뒤 7자리를 화면에 되돌려 주면 그 화면을 띄워 둔 것만으로
// 어깨너머로 새는데, 운영자가 그 번호를 다시 읽어야 할 일은 거의 없다. 평문이 필요하면 [보기]를
// 눌러야 하고 그때만 열람 기록이 남는다. 문법은 AI 키 칸(설정)의 마스킹 + [변경] + [삭제] 그대로다.
function ForeignRegNoField({ tenantId, masked }: { tenantId?: string; masked: string | null }) {
  const [editing, setEditing] = useState(!masked)
  const [value, setValue] = useState('')
  const [cleared, setCleared] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const digits = value.replace(/\D/g, '')
  const checked = digits.length === 13 ? validateForeignRegNo(digits) : null
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors min-h-[var(--input-h-touch)] sm:min-h-0 tabular-nums'

  // 13자리가 채워지면 생년월일을 대신 채운다. 비어 있을 때만 넣는다 — 사람이 적어 둔 값을
  // 번호가 덮으면 어느 쪽이 맞는지 아무도 모르게 된다. 다르면 말만 하고 그대로 둔다.
  const syncBirthdate = (derived: string) => {
    // setInputByName 과 같은 지문 — 숨은 계약 폼(fieldset[disabled])의 생년월일을 보지 않는다.
    const el = document.querySelector<HTMLInputElement>('[name="birthdate"]:not(:disabled)')
    const current = digitsToIso(el?.value ?? '')
    if (!current) {
      setInputByName('birthdate', derived.replace(/-/g, '.'))
      setNotice('생년월일을 등록번호에서 채웠습니다.')
      return
    }
    setNotice(current === derived ? null : `등록된 생년월일(${current})과 등록번호의 생년월일(${derived})이 다릅니다. 확인해 주세요.`)
  }

  const handleChange = (raw: string) => {
    const next = formatForeignRegNo(raw)
    setValue(next)
    const d = next.replace(/\D/g, '')
    if (d.length < 13) { setNotice(null); return }
    const v = validateForeignRegNo(d)
    if (!v.ok) { setNotice(v.error); return }
    syncBirthdate(v.birthdate)
  }

  const handleReveal = async () => {
    if (!tenantId || busy) return
    setBusy(true)
    try {
      const res = await revealForeignRegNo(tenantId)
      if (!res.ok) { pushToast('error', res.error); return }
      setRevealed(res.value)
      pushToast('info', '열람 기록이 남았습니다.')
    } finally { setBusy(false) }
  }

  const handleClear = async () => {
    if (!(await confirmDialog({
      title: '저장된 외국인등록번호를 지울까요?',
      message: '저장하면 번호가 사라지고 계약서에는 생년월일이 다시 인쇄됩니다. 저장 전까지는 되돌릴 수 있습니다.',
      level: 'caution', confirmLabel: '지우기',
    }))) return
    setCleared(true)
    setEditing(false)
    setValue('')
    setRevealed(null)
    setNotice(null)
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">
        외국인등록번호 <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal">(입력하면 계약서 생년월일 칸이 이 번호로 인쇄됩니다)</span>
      </label>
      {/* 빈 값은 '건드리지 않음' 이다. 지우기는 아래 별도 신호로만 서버에 전달된다. */}
      <input type="hidden" name="foreignRegNo" value={cleared ? '' : digits} />
      <input type="hidden" name="foreignRegNoClear" value={cleared ? '1' : ''} />
      {cleared ? (
        <div className="flex items-center gap-2">
          <span className="flex flex-1 items-center truncate rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] px-3 min-h-[44px] text-xs text-[var(--warm-muted)]">저장하면 삭제됩니다.</span>
          <Btn type="button" variant="ghost" size="sm" onClick={() => { setCleared(false); setEditing(!masked) }}>적용취소</Btn>
        </div>
      ) : masked && !editing ? (
        <div className="flex items-center gap-2">
          <span className="flex flex-1 items-center truncate rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] px-3 min-h-[44px] text-xs text-[var(--warm-dark)] tabular-nums">{revealed ?? masked}</span>
          {!revealed && <Btn type="button" variant="secondary" size="sm" disabled={busy || !tenantId} onClick={() => void handleReveal()}>보기</Btn>}
          <Btn type="button" variant="secondary" size="sm" onClick={() => { setEditing(true); setRevealed(null) }}>변경</Btn>
          <Btn type="button" variant="ghost" size="sm" onClick={() => void handleClear()}>삭제</Btn>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input type="text" inputMode="numeric" autoComplete="off" value={value}
            onChange={e => handleChange(e.target.value)}
            placeholder="예: 900101-5123456" className={inputCls} />
          {masked && <Btn type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setValue(''); setNotice(null) }}>취소</Btn>}
        </div>
      )}
      {notice && (
        <p className={`text-[0.6875rem] leading-relaxed ${checked && !checked.ok ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'}`}>{notice}</p>
      )}
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[var(--warm-muted)] uppercase tracking-wider pb-1 border-b border-[var(--warm-border)]/60">{title}</p>
      {children}
    </div>
  )
}

// 연락수단별 연락처 입력 예시(placeholder). 전화계열은 자동 하이픈, 메신저는 아이디 그대로.
const CONTACT_PLACEHOLDER: Record<string, string> = {
  PHONE: '010-0000-0000',
  LANDLINE: '02-0000-0000',
  KAKAO: '카카오톡 ID',
  WECHAT: '위챗 ID',
  LINE: '라인 ID',
  TELEGRAM: '@텔레그램 아이디',
  FACEBOOK: 'facebook.com/프로필 또는 ID',
}

// 연락처 입력 — 연락수단(contactType)에 따라 전화계열이면 자동 하이픈 포맷, 메신저면 아이디 원문.
// 전환 시 기존 값은 재포맷하지 않고 보존한다(전에는 마운트 이펙트가 하이픈·문자 든 메신저 ID를
// 조용히 훼손했다 — 전문가 패널 지적). 초기값만 현재 타입에 맞춰 표시하고, 이후 입력부터 새 포맷 적용.
function ContactValueInput({ name, defaultValue, contactType }: { name: string; defaultValue?: string; contactType: string }) {
  const isPhone = contactType === 'PHONE' || contactType === 'LANDLINE'
  const [value, setValue] = useState(defaultValue ? (isPhone ? formatPhone(defaultValue) : defaultValue) : '')
  return (
    <input
      type={isPhone ? 'tel' : 'text'}
      name={name}
      value={value}
      onChange={e => setValue(isPhone ? formatPhone(e.target.value) : e.target.value)}
      placeholder={CONTACT_PLACEHOLDER[contactType] ?? ''}
      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--persimmon)] focus:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors min-h-[var(--input-h-touch)] sm:min-h-0"
    />
  )
}

// value/onChange 를 주면 controlled, 아니면 defaultValue 로 자체 state 보유 (배타 사용).
function DateFieldInner({ name, defaultValue, placeholder, value, onChange }: {
  name: string; defaultValue?: string; placeholder?: string; value?: string; onChange?: (v: string) => void
}) {
  const [val, setVal] = useState(defaultValue ?? '')
  return (
    <DatePicker name={name} value={value ?? val} onChange={onChange ?? setVal} placeholder={placeholder ?? '날짜 선택'}
      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] min-h-[var(--input-h-touch)] sm:min-h-0" />
  )
}

function Field({ label, name, type = 'text', placeholder, defaultValue, required, value, onChange, maxLength, hint }: {
  label: string; name: string; type?: string; placeholder?: string; defaultValue?: string; required?: boolean
  // value/onChange 를 주면 controlled, 아니면 defaultValue uncontrolled (SelectField 와 같은 배타 규칙).
  value?: string; onChange?: (v: string) => void
  maxLength?: number
  hint?: string   // 라벨 옆 보조 설명 — '현지 표기 이름' 캡션과 같은 문법
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}
        {hint && <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal"> {hint}</span>}
      </label>
      {type === 'date'
        ? <DateFieldInner name={name} defaultValue={defaultValue} placeholder={placeholder} value={value} onChange={onChange} />
        : type === 'birthdate'
        ? <BirthdateInput name={name} defaultValue={defaultValue} placeholder={placeholder} required={required}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors min-h-[var(--input-h-touch)] sm:min-h-0" />
        : <input type={type} name={name} placeholder={placeholder} required={required} maxLength={maxLength}
            {...(value === undefined ? { defaultValue } : { value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value) })}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors min-h-[var(--input-h-touch)] sm:min-h-0" />
      }
    </div>
  )
}

// value/onChange 를 주면 controlled, 아니면 defaultValue uncontrolled (배타 사용).
// name 을 안 주면 전송하지 않는 순수 UI 셀렉트 — 값은 따로 상시 렌더한 hidden 이 나른다.
function SelectField({ label, name, children, defaultValue, value, onChange, required }: {
  label: string; name?: string; children: React.ReactNode
  defaultValue?: string; value?: string; onChange?: (v: string) => void; required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <select name={name}
        {...(value === undefined ? { defaultValue } : { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) })}
        required={required}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] min-h-[var(--input-h-touch)] sm:min-h-0">
        {children}
      </select>
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--warm-muted)] uppercase tracking-wider pb-1.5 border-b border-[var(--warm-border)]/60">{title}</p>
      {children}
    </div>
  )
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--warm-muted)]">{label}</p>
      <p className="text-sm text-[var(--warm-dark)] mt-0.5">{value}</p>
    </div>
  )
}

// 계약서 파일 패널의 로컬 복제본은 제거했다 — 2026-08-01 접점 정리.
// 주석에는 'Prism 뷰어와 동일한 ContractFilesPanel' 이라 적혀 있었으나 사실이 아니었다.
// 복제본에는 서명 요청 보내기·서명 링크 배지·보내기가 없었고, 삭제도 적용취소 없는 즉시 삭제였다.
// 같은 이름의 화면이 두 벌이라 어디서 열었느냐에 따라 있는 버튼이 달랐던 것이 운영자 혼동의 주축이다.
// 이제 components/entity-modal/widgets/ContractFilesPanel 정본 하나만 쓴다.

// ── 입주자 일괄 편집 모달 ────────────────────────────────────────

function BatchEditTenantsModal({ selectedIds, onClose, onDone }: {
  selectedIds: string[]; onClose: () => void; onDone: () => void
}) {
  // Tenant 필드
  const [nationality, setNationality] = useState('')
  const [gender, setGender]           = useState('')
  // LeaseTerm 필드
  const [depositAmount, setDepositAmount] = useState<number | undefined>(undefined)
  const [dueDay, setDueDay]           = useState('')
  const [status, setStatus]           = useState('')
  const [exitDate, setExitDate]       = useState('')   // 퇴실 예정일 — 퇴실 예정 선택 시에만 노출(신고 204522b7)

  const [pending, setPending] = useState(false)
  const [error, setError]     = useState('')

  const handleApply = async () => {
    const data: Parameters<typeof batchUpdateTenants>[1] = {}
    if (nationality) data.nationality = nationality
    if (gender)      data.gender      = gender
    if (depositAmount != null) data.depositAmount = depositAmount
    if (dueDay.trim()) data.dueDay = dueDay.trim()
    if (status)      data.status   = status
    if (status === 'CHECKOUT_PENDING' && exitDate) data.expectedMoveOut = exitDate

    if (Object.keys(data).length === 0) { setError('변경할 항목을 하나 이상 입력하세요.'); return }

    // 보증금을 한 번에 덮는 저장 — 청소비를 이미 받은 사람은 그 몫이 두 번 잡힐 수 있다.
    // 차단이 아니라 고지다(2026-08-10). 조회 실패는 그냥 통과시킨다.
    if (data.depositAmount != null && data.depositAmount > 0) {
      let n = 0
      try { n = await countTenantsWithCleaningFeeReceived(selectedIds) } catch { n = 0 }
      if (n > 0 && !(await confirmDialog({
        title: '청소비를 이미 받은 계약이 있습니다',
        message: `선택한 ${selectedIds.length}명 중 ${n}명은 입실 때 청소비를 이미 받았습니다.\n`
          + `보증금을 ${data.depositAmount.toLocaleString()}원으로 한 번에 덮으면, 보증금에 청소비가 포함되는 방식일 때 그 몫이 두 번 잡힙니다.\n`
          + '이대로 적용할까요?',
        level: 'caution', confirmLabel: '이대로 적용',
      }))) return
    }

    setPending(true); setError('')
    const res = await batchUpdateTenants(selectedIds, data)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    {
      const u = res.undo
      // 건너뛴 건은 사유별로 꼬리에 붙인다 — 지출 일괄 편집과 같은 문법(FinanceClient skipMsg).
      const skipMsg = res.skipped.length ? ' · ' + res.skipped.map(s => `${s.reason} ${s.count}건 제외`).join(', ') : ''
      pushToast('success', `입주자 ${res.tenantCount}명${res.leaseCount > 0 ? `, 계약 ${res.leaseCount}건` : ''} 업데이트 완료${skipMsg}`, {
        action: { label: '적용취소', run: () => { void undoBatchUpdateTenants(u).then(r => { if (r.ok) pushToast('info', '일괄 수정을 적용취소했습니다'); else pushToast('error', r.error) }) } },
      })
    }
    onDone()
  }

  const [dirty, setDirty] = useState(false)   // v2.0 §12
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <Modal open onClose={onClose} width="md" dirty={dirty}
      // 풀블리드 — 본문과 폭 전체 구분선 액션 바를 children 이 직접 구성한다.
      bodyClassName=""
      title="입주자 일괄 편집" subtitle={`${selectedIds.length}명 선택됨 · 입력하지 않은 항목은 변경되지 않습니다`}>
      <div className="px-6 py-4 space-y-4" onInput={() => requestAnimationFrame(() => setDirty(true))} onChange={() => setDirty(true)}>
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">국적</label>
            <input type="text" value={nationality} onChange={e => setNationality(e.target.value)}
              placeholder="미변경 (예: 한국, Vietnam, China)"
              className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">성별</label>
            <div>
              <SegmentedControl
                size="sm"
                ariaLabel="성별"
                value={gender}
                onChange={setGender}
                options={[
                  { value: '',       label: '미변경' },
                  { value: 'MALE',   label: '남성' },
                  { value: 'FEMALE', label: '여성' },
                  { value: 'OTHER',  label: '기타' },
                ]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">보증금 (계약 전체 적용)</label>
            <MoneyInput value={depositAmount} onChange={setDepositAmount} placeholder="미변경" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">납부일 (계약 전체 적용)</label>
            <input type="text" inputMode="numeric" value={dueDay} onChange={e => setDueDay(e.target.value.replace(/[^0-9말]/g, ''))}
              placeholder="미변경 (예: 5, 25, 말)"
              className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">상태 (계약 전체 적용)</label>
            {/* 편집 폼과 동일한 생애주기 optgroup·라벨(e1b81629) */}
            <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
              <option value="">미변경</option>
              <optgroup label="문의·예약">
                <option value="WAITING_TOUR">문의·투어 예정</option>
                <option value="TOUR_DONE">투어 완료</option>
                <option value="RESERVED">입실 예약</option>
              </optgroup>
              <optgroup label="거주">
                <option value="ACTIVE">거주중</option>
                <option value="CHECKOUT_PENDING">퇴실 예정</option>
                <option value="NON_RESIDENT">비거주자</option>
              </optgroup>
              <optgroup label="종료">
                <option value="CHECKED_OUT">퇴실</option>
                <option value="CANCELLED">입실 취소</option>
              </optgroup>
            </select>
          </div>

          {/* 퇴실 예정 선택 시에만 — 단건 폼 showExitDate 문법 이식(신고 204522b7). 빈 값 = 날짜 미변경 */}
          {status === 'CHECKOUT_PENDING' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">퇴실 예정일 (계약 전체 적용)</label>
              <DatePicker value={exitDate} onChange={setExitDate} placeholder="미변경" className={inputCls} />
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">입력하면 선택한 {selectedIds.length}명 모두 같은 날짜로 저장됩니다. 기존 개별 날짜도 덮어씁니다. 일할 정산은 각 입주자 카드에서 개별 진행하세요.</p>
            </div>
          )}
        </div>
        <div className="border-t border-[var(--warm-border)] px-6 py-3 flex gap-2 shrink-0">
          <Btn type="button" variant="secondary" size="md" onClick={onClose} className="flex-1">
            취소
          </Btn>
          <Btn type="button" variant="primary" size="md" onClick={handleApply} disabled={pending}
            className="flex-1 font-semibold">
            {pending ? '적용 중…' : '적용'}
          </Btn>
        </div>
    </Modal>
  )
}


