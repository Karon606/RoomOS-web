'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import type { CleaningRow, CleaningStatus } from './cleaningConstants'
import { CleaningRowBody, CLEANING_STATUS_LABEL } from '@/components/cleaning/CleaningRowBody'
import { CleaningPlanForm } from '@/components/cleaning/CleaningPlanForm'
import { ViewTabs } from '@/components/ui/ViewTabs'
import MonthSelector from '@/components/layout/MonthSelector'
import { MoveCalendar } from '@/components/room-manage/MoveCalendar'
import type { MoveCalendarRange } from '@/lib/moveCalendar'
import { kstMonthOf, fmtMD, fmtMDDay } from '@/lib/fmtDate'
import { displayName } from '@/lib/displayName'
import { fmtRentApplyFrom } from '@/lib/fmtMoney'
import { useRouter, useSearchParams } from 'next/navigation'
import { addRoom, updateRoom, createPhotoUploadSession, finalizeRoomPhoto, deleteRoomPhoto, reorderRoomPhotos, setRoomShowOnSite, setRoomPhotoShowOnSite, setRoomPhotoIs360, requestGalleryRedeploy, batchUpdateRooms, undoBatchUpdateRooms } from './actions'
import { AreaInput } from '@/components/ui/AreaInput'
import { InfoHint } from '@/components/ui/InfoHint'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { useCanEdit, useCanReadScope } from '@/components/RoleContext'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { Modal as SharedModal } from '@/components/ui/Modal'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { useUrlState } from '@/lib/useUrlState'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { SortSelect } from '@/components/ui/SortSelect'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { RoomCard, type CardKind } from '@/components/ui/RoomCard'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { StatusBadge, statusTipColor, statusRowTint, type BadgeTone } from '@/components/ui/StatusBadge'
import { DisplayFieldsMenu, useDisplayFields, type FieldDef } from '@/components/ui/DisplayFieldsMenu'
import { PhotoLightbox, uploadFileToDriveSession, type Photo } from '@/components/room-manage/PhotoViewer'
import { looksLike360 } from '@/lib/driveImage'
import { checkoutSubText, moveInSubText, isShortTermCheckoutDue, nextRoomReservation, primaryRoomLease, reservationSubText, roomAvailability, roomStatusView } from '@/lib/leaseStatus'
import { kstMonthStr } from '@/lib/kstDate'
import { TRACK_MONTH_KEY } from '@/lib/monthParam'
import dynamic from 'next/dynamic'
import { fmtRoomNo } from '@/lib/roomNo'

// 공용·외관 사진 관리 모달 — 열기 전까지 내려받지 않게 지연 로드. 환경설정 웹사이트 탭도 같은 모달을 연다.
const PropertyPhotosManager = dynamic(() => import('./PropertyPhotosManager'), { ssr: false })

// 사진 평균 밝기(0~255) — 어두운 사진 재촬영 경고용(막지 않고 안내만). 48x48 축소로 빠르게, 실패 시 255(경고 안 함).
async function avgBrightness(file: File): Promise<number> {
  if (!file.type.startsWith('image/')) return 255
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        const w = (c.width = 48), h = (c.height = 48)
        const ctx = c.getContext('2d')
        if (!ctx) { resolve(255); return }
        ctx.drawImage(img, 0, 0, w, h)
        const d = ctx.getImageData(0, 0, w, h).data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        resolve(sum / (w * h))
      } catch { resolve(255) } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(255) }
    img.src = url
  })
}
const DARK_THRESHOLD = 70   // 평균 밝기 이 미만이면 어둡다고 경고

/** 이 화면의 뷰 전환 탭(§25). 링크로 들어오는 진입점이 있어 서버가 초기값을 정한다. */
export type ViewTabId = 'rooms' | 'cleaning' | 'moves'

type Room = {
  id: string
  roomNo: string
  type: string | null
  tier: string | null
  baseRent: number
  scheduledRent: number | null
  rentUpdateDate: Date | string | null
  nonResidentRent: number | null
  nonResidentScheduled: number | null
  nonResidentRentDate: Date | string | null
  memo: string | null
  isVacant: boolean
  showOnSite: boolean            // 소개 페이지 갤러리 공개 여부(운영자 토글, 사진 있을 때만)
  noMoveInReport: boolean        // 전입신고 불가 방 — 카드 배지 + 등록 경고(2026-07-06)
  nonResidentVacant: boolean     // 비거주 점유 시 공실로 표시할지 (false = 창고·사무실)
  standaloneLeaseAllowed: boolean // 이 방만으로 계약이 되는가 (false = 다른 계약에 묶어야 하는 방, 2026-08-13)
  floor: string | null
  windowType: string | null
  direction: string | null
  areaPyeong: number | null
  areaM2: number | null
  photos: Photo[]
  leaseTerms: {
    id: string
    status: string                 // ACTIVE | RESERVED | CHECKOUT_PENDING | NON_RESIDENT
    tenantId: string
    // 별칭·영어이름·표시 선택 — 카드가 부를 이름을 lib/displayName 이 이 셋에서 고른다.
    tenant: { id: string; name: string; englishName: string | null; nickname: string | null; displayNameStyle: string | null } | null
    isShortTerm: boolean           // 단기 — 퇴실 예정 상태로 바뀌기 전에도 퇴실이 보여야 한다
    moveInDate: string | null      // 'YYYY-MM-DD' — 예약 카드의 입주 예정일
    expectedMoveOut: string | null  // 'YYYY-MM-DD' — 퇴실 예정 카드의 퇴실일
  }[]
}

// 방을 대표하는 계약 — 규칙은 lib/leaseStatus 의 primaryRoomLease 가 정본이다(프리즘 호실 면과 공유).
// 이 화면은 비거주까지 넘긴다 — 비거주만 있는 방은 방 설정(nonResidentVacant)에 따라
// 공실 또는 점유로 표시해야 하기 때문이다(운영자 요청 2026-07-06).
function primaryLease(r: Room) {
  return primaryRoomLease(r.leaseTerms)
}

// 카드에 이름이 아직 안 적힌 다음 예약 — 거주자가 있는 방의 예약, 예약이 둘인 방의 뒷사람.
// 카드에서는 뱃지를 늘리지 않고 입주자 줄 아래 예약자 줄로 적는다. 뱃지 자리는 이미 상태 뱃지 +
// 전입신고 불가 + 청소 필요가 나눠 쓰고 있어 §11 최대 2개를 넘긴다.
// 고르는 규칙은 lib/leaseStatus 의 nextRoomReservation 이 정본이다(호실 면·홈 방 현황과 공유).
function nextReservedLease(r: Room, primary: { id: string } | undefined) {
  return nextRoomReservation(r.leaseTerms, primary)
}

// 호실 상태 — 카드 종류(거주중·퇴실예정=resident / 공실·예약=vacant) + 예외 뱃지.
// 거주중·공실은 카드 베이스만으로 구분(뱃지 X), 예약·퇴실예정만 뱃지.
type RoomStatus = {
  label: string
  kind: CardKind
  badge: { tone: BadgeTone; label: string; sub?: string; secondary?: { tone: BadgeTone; label: string } } | null
}
function getRoomStatus(r: Room, targetMonth: string): RoomStatus {
  const lease = primaryLease(r)
  // 라벨·뱃지·카드 종류는 lib/leaseStatus.roomStatusView 정본 — 프리즘 호실 면(모달)이 같은 함수를 쓴다.
  // 이 화면은 그 결과 위에 보조줄만 얹는다. 판정을 여기서 다시 쓰면 카드와 모달이 또 갈린다.
  const base = roomStatusView(lease, { nonResidentVacant: r.nonResidentVacant, targetMonth })
  if (!lease || !base.badge || lease.status === 'NON_RESIDENT') return base
  if (lease.status === 'RESERVED') {
    // 방 어레인지 — 입주 희망일을 퇴실일과 나란히 보려면 카드에 날짜가 있어야 한다(운영자 요청 2026-08-07).
    // 퇴실 예정일까지 잡힌 예약이면 그 사실도 나란히 — 수납 관리의 '미납 + 퇴실 예정' 두 뱃지 문법과 같다.
    // 문장은 lib/leaseStatus 의 reservationSubText 정본 — 프리즘 호실 면의 예약자 줄이 같은 함수를 쓴다.
    const exitSub = checkoutSubText(lease.expectedMoveOut)
    return { ...base, badge: {
      ...base.badge,
      sub: reservationSubText(lease) || undefined,
      secondary: exitSub ? { tone: 'exit', label: '퇴실 예정' } : undefined,
    } }
  }
  // 거주자 카드의 보조줄 — 이 뱃지가 가리키는 사람(거주자)의 퇴실 D-day 다.
  // 다음 예약의 입주 예정일은 2026-08-07 에 이 줄로 함께 잇던 것을 카드의 예약자 줄로 옮겼다
  // (신고 ba546ecb). 날짜 둘을 한 줄에 이으면 뒤엣것이 누구 날짜인지 말할 자리가 없고,
  // 뱃지가 없는 방(그냥 거주중)은 이 줄 자체가 안 서서 예약이 카드에서 통째로 사라졌다.
  return { ...base, badge: {
    ...base.badge,
    sub: checkoutSubText(lease.expectedMoveOut) || undefined,
  } }
}

// 상태 빠른 필터 키 — 공실/예약/거주중/퇴실예정. getRoomStatus 와 동일한 분기.
type RoomStatusKey = 'vacant' | 'reserved' | 'active' | 'checkout'
function roomStatusKey(r: Room, targetMonth: string): RoomStatusKey {
  const lease = primaryLease(r)
  // 계약 없는 방 — 공실 집계에서 뺀 방(빈 창고)은 라벨과 같은 칸에 선다(roomStatusView 와 같은 분기).
  if (!lease) return r.nonResidentVacant ? 'vacant' : 'active'
  if (lease.status === 'NON_RESIDENT') return r.nonResidentVacant ? 'vacant' : 'active'
  if (lease.status === 'RESERVED') return 'reserved'
  if (lease.status === 'CHECKOUT_PENDING') return 'checkout'
  // 단기는 상태가 아니라 사실(퇴실 예정일)로 센다 — 수납 관리 '퇴실 예정' 칩과 같은 판정.
  if (isShortTermCheckoutDue(lease, targetMonth)) return 'checkout'
  return 'active'
}
const STATUS_FILTERS: { key: RoomStatusKey; label: string }[] = [
  { key: 'vacant', label: '공실' },
  { key: 'reserved', label: '입실 예약' },
  { key: 'active', label: '거주중' },
  { key: 'checkout', label: '퇴실 예정' },
]

// 그 방에 잡혀 있는 예약이 하나라도 있는가 — 주 계약이 누구인지는 묻지 않는다.
function hasReservation(r: Room) {
  return r.leaseTerms.some(l => l.status === 'RESERVED')
}

// 이 방이 그 칸에 서는가 — '입실 예약'만 **사람 축**이라 배타가 아니다(신고 ba546ecb).
//
// 종전에는 네 칸 전부 roomStatusKey 로 방을 한 칸에만 세웠다. 그러면 거주자가 있는 방에 잡힌 예약은
// 주 계약(거주)에 밀려 '입실 예약' 칸에서 통째로 사라진다 — 409호는 서종희가 살고 후지이 미나미가
// 9월 입실 예약인데 칸에는 '거주중'으로만 섰고, 예약을 보러 온 운영자에게는 그 예약이 없는 것과 같았다.
// 방이 아니라 사람이 예약의 단위다(수납 관리가 '방이 아니라 계약이 청구의 단위'라 한 것과 같은 이유).
// 겹침 자체는 새 문법이 아니다 — '입주 가능' 칸이 이미 방 단위 사실로 물어 다른 칸과 겹친다.
//
// 칸 숫자도 이 술어로 센다. 목록과 다른 술어로 세면 '입실 예약 5' 를 눌러 4실이 나온다.
function matchesStatusFilter(r: Room, key: RoomStatusKey, targetMonth: string) {
  return key === 'reserved' ? hasReservation(r) : roomStatusKey(r, targetMonth) === key
}
// '입주 가능' 판정은 lib/leaseStatus 의 roomAvailability 가 정본이다 — 홈 매칭 알림이 같은 방 축을 쓴다.
// 칩(roomStatusKey)이 아니라 방 단위 사실로 묻는 이유는 그쪽 주석에 있다.

// 카드 표시 항목 — 이용자가 켜고 끌 수 있는 필드 (호실번호·상태는 항상 표시)
const RM_CARD_FIELDS: FieldDef[] = [
  { key: 'floor',     label: '층' },
  { key: 'tenant',    label: '입주자' },
  { key: 'spec',      label: '타입·창문·면적' },
  { key: 'scheduled', label: '예정 이용료' },
  { key: 'photo',     label: '사진' },
]

// 구 enum 값 → 한국어 표시 (마이그레이션 전 데이터 호환)
const WINDOW_TYPE_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
}
const DIRECTION_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}

function getWindowLabel(val: string) {
  return WINDOW_TYPE_LABEL[val] ?? val
}

function getDirectionLabel(val: string) {
  return DIRECTION_LABEL[val] ?? val
}


function deriveFloor(roomNo: string): string {
  const digits = roomNo.replace(/\D/g, '')
  if (digits.length >= 3) return digits.slice(0, digits.length - 2)
  return ''
}

// 같은 (타입·등급·창문) 조합의 기존 방 baseRent 최빈값을 제안한다. 빈 필드는 매칭에서 제외하고,
// 최소 한 필드는 선택돼야 하며 매칭되는 방이 없으면 null(제안하지 않음).
function suggestBaseRent(rooms: Room[], type: string, tier: string, windowType: string): number | null {
  if (!type && !tier && !windowType) return null
  const matched = rooms.filter(r => {
    if (type && r.type !== type) return false
    if (tier && r.tier !== tier) return false
    if (windowType && r.windowType !== windowType) return false
    return r.baseRent > 0
  })
  if (matched.length === 0) return null
  // 최빈값 — baseRent 값별 빈도 집계 후 최다 빈도(동률이면 먼저 만난 값)
  const counts = new Map<number, number>()
  let best = 0
  let bestCount = 0
  for (const r of matched) {
    const c = (counts.get(r.baseRent) ?? 0) + 1
    counts.set(r.baseRent, c)
    if (c > bestCount) { bestCount = c; best = r.baseRent }
  }
  return best
}

// ── 청소 뷰 ───────────────────────────────────────────────────────
//
// 영업장 전체 청소를 한 화면에서 본다(2026-08-12 구조 개편). 종전에는 방 상세를 하나씩 열어야만
// 청소 이력이 보여서 "이번 달 청소비를 얼마 썼나"에 답할 자리가 없었다.
//
// **관리 화면이지 뷰어가 아니다**(운영자 지적 2026-08-12 — "그 어디에도 수정하거나 접속할 수 없다").
// 처음 시공은 조작을 빼고 호실번호 클릭만 뒀는데, 목록에서 본 것을 목록에서 못 고치면 방 상세를
// 하나씩 여는 종전 동선으로 되돌아간다. 그렇다고 조작을 복제하면 확인창·토스트·적용취소가 두 벌이
// 되므로, 행 자체를 정본 컴포넌트(components/cleaning/CleaningRowBody)로 만들어 방 상세 패널과
// **같은 코드**를 부른다. 등록 폼도 같은 정본(CleaningPlanForm)이고 여기서는 호실을 먼저 고른다.
//
// 목록 껍데기는 형제 목록 문법이다 — cream 카드 + divide-y(보증금·수납 목록), 합계는 목록 위
// 액션 줄 좌측(지출 관리), 등록은 Modal(지출·수익 등록). 날짜는 목록·표 정본 fmtDateDot 이다.
type CleaningSeg = CleaningStatus | '' | 'DELETED'

function CleaningView({ rows, rooms, targetMonth, recentPerformers, canEdit, onOpenRoom, onChanged }: {
  rows: CleaningRow[]
  rooms: { id: string; roomNo: string }[]
  targetMonth: string
  recentPerformers: string[]
  canEdit: boolean
  onOpenRoom: (roomId: string) => void
  onChanged: () => void
}) {
  const [segRaw, setSeg] = useState<CleaningSeg>('PLANNED')
  const [adding, setAdding] = useState(false)

  // 살아 있는 행과 삭제분을 한 번에 받는다(getPropertyCleanings). 아래 모든 집계는 살아 있는 것만 센다.
  const live = rows.filter(r => !r.deletedAt)
  const deleted = rows.filter(r => r.deletedAt)
  // 마지막 삭제분을 되살리면 그 세그먼트 자체가 사라진다. 선택값을 그대로 두면 아무것도 안 켜진
  // 컨트롤이 남으므로 '전체'로 떨군다.
  const seg: CleaningSeg = segRaw === 'DELETED' && deleted.length === 0 ? '' : segRaw
  const counts = live.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {} as Record<CleaningStatus, number>)

  // 예정은 **임박한 것부터**다. 서버 정렬(최근순)은 완료 이력에는 맞지만 예정에는 거꾸로라
  // 기본 세그먼트에서 가장 먼 날이 맨 위에 섰다(형제: 퇴실 예정 퇴실일 asc, 입실 예정 입주일 asc).
  // 날짜 없는 건은 뒤로 민다 — 'YYYY-MM-DD' 는 사전순이 곧 날짜순이다.
  const byScheduledAsc = (a: CleaningRow, b: CleaningRow) =>
    (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999')
  const shown = seg === 'DELETED' ? deleted
    : seg === 'PLANNED' ? live.filter(r => r.status === 'PLANNED').sort(byScheduledAsc)
    : seg ? live.filter(r => r.status === seg)
    : live

  // 합계는 **세그먼트와 무관하게** 이번 달 전체에서 낸다. 필터에 따라 움직이면 같은 이름의 숫자가
  // 화면 조작마다 달라져 "이번 달 청소비"라는 이름이 거짓이 된다.
  // '받은 청소비로 부담'은 그중 일부다(운영 부담이 아닌 몫).
  const monthDone = live.filter(r => r.status === 'DONE' && (r.doneDate ?? '').slice(0, 7) === targetMonth)
  const monthCost = monthDone.reduce((s, r) => s + (r.cost ?? 0), 0)
  const monthFunded = monthDone.filter(r => r.fromCleaningFund).reduce((s, r) => s + (r.cost ?? 0), 0)

  const segLabel = seg === 'DELETED' ? '삭제됨'
    : seg ? CLEANING_STATUS_LABEL[seg] : ''

  return (
    <div className="space-y-3">
      {/* 액션 줄 — 합계 좌측, CTA 우측 ml-auto(지출 관리와 같은 문법). 합계를 목록 위로 올렸다:
          형제 목록은 전부 위에 있고, 아래에 두면 긴 목록에서 스크롤해야 보인다. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-[var(--warm-muted)] num">
          이번 달 청소비 <span className="font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={monthCost} /></span>
          {' · 받은 청소비로 부담 '}
          <span className="font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={monthFunded} /></span>
        </p>
        {canEdit && (
          <div className="ml-auto">
            <Btn variant="primary" size="md" onClick={() => setAdding(true)}>+ 청소 예정 등록</Btn>
          </div>
        )}
      </div>

      {/* 상태 세그먼트 — v2.0 §23 공용 SegmentedControl(같은 화면 호실 상태 필터와 같은 문법).
          '삭제됨'은 있을 때만 선다. 소프트삭제를 되살릴 문이 토스트 6초뿐이었고(§16 은 그 밖의
          진입점을 요구한다), 그 사이 지운 것들은 화면에서 닿을 길이 없었다. */}
      <SegmentedControl<CleaningSeg>
        size="sm"
        scroll
        ariaLabel="청소 상태 필터"
        value={seg}
        onChange={setSeg}
        options={[
          { value: 'PLANNED', label: `예정 ${counts.PLANNED ?? 0}` },
          { value: 'DONE',    label: `완료 ${counts.DONE ?? 0}` },
          { value: 'SKIPPED', label: `안 함 ${counts.SKIPPED ?? 0}` },
          { value: '',        label: `전체 ${live.length}` },
          ...(deleted.length > 0 ? [{ value: 'DELETED' as const, label: `삭제됨 ${deleted.length}` }] : []),
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          title={segLabel ? `'${segLabel}' 상태인 청소가 없습니다` : '청소 기록이 없습니다'}
          description={segLabel ? '다른 상태를 눌러 보세요.' : '위 청소 예정 등록으로 시작할 수 있습니다.'}
        />
      ) : (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          <ul className="divide-y divide-[var(--warm-border)]/50">
            {shown.map(r => (
              <li key={r.id} className="px-4 py-3">
                <CleaningRowBody row={r} recentPerformers={recentPerformers} canEdit={canEdit}
                  deleted={seg === 'DELETED'} onOpenRoom={onOpenRoom} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 등록 — 형제(지출·수익 등록)와 같은 Modal 문법. 폼 자체는 방 상세 패널과 같은 정본이고
          여기서만 호실 선택이 앞에 붙는다. */}
      <SharedModal open={adding} onClose={() => setAdding(false)} title="청소 예정 등록">
        <CleaningPlanForm rooms={rooms}
          onDone={() => { setAdding(false); onChanged() }} onCancel={() => setAdding(false)} />
      </SharedModal>
    </div>
  )
}

export default function RoomManageClient({
  initialRooms,
  initialCleanings,
  recentPerformers,
  roomTypes,
  roomTiers,
  windowTypes,
  directions,
  moveCalendar,
  initialTab,
}: {
  initialRooms: Room[]
  // 영업장 전체 청소 이력(삭제분 포함) — '청소' 뷰와 카드 배지의 공통 재료.
  // initialRooms 와 같은 이유로 prop 을 직접 쓴다.
  initialCleanings: CleaningRow[]
  // 최근에 맡긴 업체·사람 — 청소 완료 폼 이름 칸 선택지. 서버에서 함께 받아 클라 왕복을 없앤다.
  recentPerformers: string[]
  roomTypes: string[]
  roomTiers: string[]
  windowTypes: string[]
  directions: string[]
  // 입퇴실 뷰 한 벌 — 조립·충돌 판정까지 서버가 끝낸 연속 범위다(lib/moveCalendar 정본).
  moveCalendar: MoveCalendarRange
  // 홈 '이달 입퇴실 N건' 링크가 ?tab=moves 로 들어온다(수납 관리 initialTab 과 같은 문법).
  initialTab?: ViewTabId
}) {
  const canEditUi = useCanEdit()   // 뷰어(STAFF) 편집 버튼 숨김(감사 D3)
  const hideMoney = !useCanReadScope('money')   // 제한 스태프 — 이용료·예정 이용료 표시 제거(서버 A-2에서 null)
  // 카드 표시 항목 — 금액 차단 시 '예정 이용료' 필드 제외
  const cardFieldDefs: FieldDef[] = hideMoney ? RM_CARD_FIELDS.filter(f => f.key !== 'scheduled') : RM_CARD_FIELDS
  // #12: initialRooms를 useState로 캡처하면 router.refresh() 후에도 갱신 안 됨(즉시 적용·편집 미반영).
  //      prop을 직접 사용 → revalidatePath+router.refresh 페어로 즉시 반영. (feedback_auto_refresh)
  const rooms = initialRooms
  // 살아 있는 청소 — 카드 배지·뷰 탭 접미 N 이 함께 딛는 한 벌(서버가 삭제분까지 실어 온다).
  const liveCleanings = initialCleanings.filter(c => !c.deletedAt)
  // 단기 퇴실 도래 판정의 기준월 — 이 화면은 월 선택이 없으므로 '이번 달'(KST) 고정.
  const targetMonth = kstMonthStr()
  const windowTypeOptions  = windowTypes.map(v => ({ value: v, label: getWindowLabel(v) }))
  const directionOptions   = directions.map(v => ({ value: v, label: getDirectionLabel(v) }))

  // 검색 · 정렬
  const [search, setSearch]     = useUrlState('q', '')
  const [sortKey, setSortKey]   = useState<'roomNo' | 'baseRent' | 'vacancy'>('roomNo')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc')
  const [cardFields, toggleCardField] = useDisplayFields('roomManage.cardFields', RM_CARD_FIELDS)

  // 필터
  type AreaPyeongRange  = '' | '<1' | '1-2' | '2-3' | '3+'
  type AreaM2Range      = '' | '<3.3' | '3.3-6.6' | '6.6-9.9' | '9.9+'
  const [filterStatus, setFilterStatus]       = useState<RoomStatusKey | 'available' | ''>('')
  const [showFilters, setShowFilters]         = useState(false)
  const [filterRoomNo, setFilterRoomNo]       = useState('')
  const [filterType, setFilterType]           = useState('')
  const [filterTier, setFilterTier]           = useState('')
  const [filterWindowType, setFilterWindowType] = useState('')
  const [filterDirection, setFilterDirection] = useState('')
  const [filterAreaPyeong, setFilterAreaPyeong] = useState<AreaPyeongRange>('')
  const [filterAreaM2, setFilterAreaM2]       = useState<AreaM2Range>('')
  const [filterRentMin, setFilterRentMin]     = useState<number | undefined>(undefined)
  const [filterRentMax, setFilterRentMax]     = useState<number | undefined>(undefined)

  const resetFilters = () => {
    setFilterRoomNo(''); setFilterType(''); setFilterTier(''); setFilterWindowType(''); setFilterDirection('')
    setFilterAreaPyeong(''); setFilterAreaM2('')
    setFilterRentMin(undefined); setFilterRentMax(undefined)
  }
  const activeFilterCount =
    (filterRoomNo ? 1 : 0) +
    (filterType ? 1 : 0) +
    (filterTier ? 1 : 0) +
    (filterWindowType ? 1 : 0) +
    (filterDirection ? 1 : 0) +
    (filterAreaPyeong ? 1 : 0) +
    (filterAreaM2 ? 1 : 0) +
    (filterRentMin != null || filterRentMax != null ? 1 : 0)

  const matchAreaPyeong = (val: number | null): boolean => {
    if (!filterAreaPyeong) return true
    if (val == null) return false
    if (filterAreaPyeong === '<1')   return val < 1
    if (filterAreaPyeong === '1-2')  return val >= 1 && val < 2
    if (filterAreaPyeong === '2-3')  return val >= 2 && val < 3
    if (filterAreaPyeong === '3+')   return val >= 3
    return true
  }
  const matchAreaM2 = (val: number | null): boolean => {
    if (!filterAreaM2) return true
    if (val == null) return false
    if (filterAreaM2 === '<3.3')     return val < 3.3
    if (filterAreaM2 === '3.3-6.6')  return val >= 3.3 && val < 6.6
    if (filterAreaM2 === '6.6-9.9')  return val >= 6.6 && val < 9.9
    if (filterAreaM2 === '9.9+')     return val >= 9.9
    return true
  }

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false)
  const [editRoom, setEditRoom]         = useState<Room | null>(null)
  const [rentUpdateDateVal, setRentUpdateDateVal] = useState('')
  // 층 상태 — 등록·수정 모달
  const [addRoomNoVal, setAddRoomNoVal]   = useState('')
  const [addFloorVal, setAddFloorVal]     = useState('')
  const [editFloorVal, setEditFloorVal]   = useState('')
  // 비거주 이용료 상태 — 수정 모달
  const [nrEnabled, setNrEnabled]         = useState(false)
  const [nrDateVal, setNrDateVal]         = useState('')
  // 비거주 이용료 상태 — 등록 모달
  const [addNrEnabled, setAddNrEnabled]   = useState(false)
  const [addNrDateVal, setAddNrDateVal]   = useState('')

  // 방 컨디션(타입·등급·창문) + 기본 이용료 controlled 상태 — 조합 선택 시 baseRent 자동제안(신고 089f0f17).
  // 등록 모달
  const [addType, setAddType]             = useState('')
  const [addTier, setAddTier]             = useState('')
  const [addWindowType, setAddWindowType] = useState('')
  const [addBaseRent, setAddBaseRent]     = useState(0)
  const [addRentSuggested, setAddRentSuggested] = useState(false)
  // 수정 모달
  const [editType, setEditType]             = useState('')
  const [editTier, setEditTier]             = useState('')
  const [editWindowType, setEditWindowType] = useState('')
  const [editBaseRent, setEditBaseRent]     = useState(0)
  const [editRentSuggested, setEditRentSuggested] = useState(false)

  // URL ?roomId=xxx 자동 열기 — ?edit=1 면 편집 폼, 아니면 Prism 셸의 호실 면.
  // handledOpenRef: 같은 요청은 1회만 처리 — initialRooms 갱신(저장 후 refresh)마다
  // effect 가 재실행되며 닫은 폼이 옛 데이터로 재오픈되던 레이스 방지(입주자 관리 edit=1 버그와 동일 패턴).
  const searchParams = useSearchParams()
  const handledOpenRef = useRef<string | null>(null)
  useEffect(() => {
    const roomId = searchParams.get('roomId')
    if (!roomId) { handledOpenRef.current = null; return }
    const key = `${roomId}:${searchParams.get('edit') ?? ''}`
    if (handledOpenRef.current === key) return
    const found = initialRooms.find(r => r.id === roomId)
    if (!found) return
    handledOpenRef.current = key
    if (searchParams.get('edit') === '1') openEdit(found)
    else entityModal.open({ kind: 'room', roomId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, initialRooms])

  // 사진
  const [editPhotos, setEditPhotos]           = useState<Photo[]>([])
  const [viewPhoto, setViewPhoto]             = useState<Photo | null>(null)  // 큰 사진/360 뷰어 lightbox
  const [showOnSiteVal, setShowOnSiteVal]     = useState(false)               // 소개 페이지 공개 토글(즉시 반영, 폼 submit 무관)
  const [showOnSitePending, setShowOnSitePending] = useState(false)
  const [photosDirty, setPhotosDirty]         = useState(false)               // 편집 세션 중 사진 변경 여부 — 모달 닫을 때 재배포 1회 트리거용
  const [showPropPhotos, setShowPropPhotos]   = useState(false)               // 공용·외관 사진 관리 모달
  const [addPhotoPreviews, setAddPhotoPreviews] = useState<{ file: File; previewUrl: string }[]>([])
  const [photoUploading, setPhotoUploading]   = useState(false)
  const [photoProgress, setPhotoProgress]     = useState<{ name: string; percent: number; current: number; total: number } | null>(null)

  // 배치 선택
  // 청소 예정이 남은 방 — "어떤 방이 청소 안 됐는지 헷갈린다"(신고 b21e4e98)에 한눈에 답한다.
  // 상태 판정에 섞지 않는다. 청소는 거주 상태와 축이 다르고, 섞으면 getRoomStatus 한 함수가
  // 두 가지 일을 하게 된다. 배지로만 얹고 필터는 별도 칩으로 둔다.
  //
  // **재료는 '청소' 뷰와 같은 한 벌이다**(2026-08-12 수렴). 종전에는 카드 배지만 별도 서버 액션을
  // 클라에서 다시 불러 같은 사실을 두 축으로 읽었고, 목록에서 완료 처리해도 배지가 한 박자 늦거나
  // 다른 날을 말할 수 있었다. 예정이 여럿인 방은 **가장 이른 예정일** 하나만 남긴다 — 보조줄은
  // 한 줄이라 어느 건인지 여기서 정해야 하고, 운영자가 먼저 마주칠 일정이 가장 이른 것이다.
  // 예정일 없는 건(등록 때 비울 수 있다)은 날짜 있는 건에 밀리고, 그런 건만 남으면 날짜 없이
  // 배지만 그린다 — 없는 날짜는 짓지 않는다.
  const openCleanings = (() => {
    const out: Record<string, { scheduledDate: string | null }> = {}
    for (const c of liveCleanings) {
      if (c.status !== 'PLANNED') continue
      const cur = out[c.roomId]
      // 'YYYY-MM-DD' 는 사전순이 곧 날짜순이라 문자열 비교로 이르고 늦음이 갈린다.
      if (cur && (!c.scheduledDate || (cur.scheduledDate && cur.scheduledDate <= c.scheduledDate))) continue
      out[c.roomId] = { scheduledDate: c.scheduledDate }
    }
    return out
  })()
  const [cleaningOnly, setCleaningOnly] = useState(false)
  // 호실 / 청소 뷰 전환(v2.0 §25). 접미 N 은 **예정 건수**다 — 위 '청소 필요 N실'은 방 수라 단위가 다르다.
  const [viewTab, setViewTab] = useState<ViewTabId>(initialTab ?? 'rooms')
  const plannedCleaningCount = liveCleanings.filter(c => c.status === 'PLANNED').length
  // 보고 있는 탭을 URL 에 남긴다 — 캘린더가 트랙 위치(?at=)를 적어 두는데 탭이 URL 에 없으면
  // 그 주소를 북마크·공유했을 때 캘린더가 아니라 호실 목록이 열린다. replaceState 라 히스토리가
  // 안 쌓이고 서버도 다시 안 돈다(첫 인자 null 이 필수 — lib/monthParam 주석 참조).
  // 기본 탭('rooms')은 키를 지운다. 파라미터는 '기본이 아닌 상태'만 담는 것이 이 저장소의 문법이다.
  useEffect(() => {
    const url = new URL(window.location.href)
    const cur = url.searchParams.get('tab')
    const next = viewTab === 'rooms' ? null : viewTab
    if (cur === next) return
    if (next) url.searchParams.set('tab', next)
    else url.searchParams.delete('tab')
    window.history.replaceState(null, '', url)
  }, [viewTab])

  // 트랙이 보고 있는 달 — 캘린더가 착지할 때와 스크롤이 멎을 때마다 알려 준다. null 이면 아직 첫 착지 전.
  // 서버 왕복이 없다: 달별 건수는 이미 moveCalendar.months 에 전부 실려 왔다.
  const [viewMonth, setViewMonth] = useState<string | null>(null)
  // 접미 N 은 **보고 있는 달**의 건수다. 서버 prop(focusMonth 의 건수)만 쓰면 스크롤을 따라오지 못해
  // 라벨은 9월인데 배지는 8월 수로 서 있었다. 못 찾으면 서버 값으로 떨어진다(트랙이 아직 안 앉은 회차).
  const moveEventCount = viewMonth != null
    ? moveCalendar.months.find(m => m.month === viewMonth)?.eventCount ?? moveCalendar.focusEventCount
    : moveCalendar.focusEventCount

  const [selectMode, setSelectMode]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBatchEdit, setShowBatchEdit] = useState(false)
  const toggleSelectRoom = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }

  // 기타
  const [types, setTypes]   = useState<string[]>(roomTypes)
  const [tiers, setTiers]   = useState<string[]>(roomTiers)
  const [error, setError]   = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const entityModal = useEntityModal()
  const photoInputRef    = useRef<HTMLInputElement>(null)
  const addPhotoInputRef = useRef<HTMLInputElement>(null)

  // 카드에 적히는 이름 — 상태 판정과 같은 계약을 봐야 이름과 뱃지가 같은 사람을 가리킨다.
  // 부를 이름은 입주자 정보의 '카드 표시 이름' 선택을 따른다(lib/displayName 정본, 홈 타일과 같은 규칙).
  const currentTenant = (room: Room) => {
    const t = primaryLease(room)?.tenant
    return t ? displayName(t, t.displayNameStyle) : null
  }
  // 검색용 이름 뭉치 — 카드에 별칭이 서 있어도 한글 이름으로 찾을 수 있어야 하고, 그 반대도 같다.
  const tenantNameHay = (t: { name: string; nickname: string | null; englishName: string | null } | null | undefined) =>
    `${t?.name ?? ''} ${t?.nickname ?? ''} ${t?.englishName ?? ''}`.toLowerCase()

  // 검색 · 정렬 적용
  const filteredRooms = (() => {
    const q = search.trim().toLowerCase()
    const roomNoQ = filterRoomNo.trim().toLowerCase()
    const base = rooms.filter(r => {
      if (q) {
        // 예약자 이름도 잡는다 — 카드에 이름이 안 적히는 예약(거주자가 있는 방)은 종전에 검색으로도
        // 닿을 수 없었다. 이름으로 방을 찾는 것이 이 검색창의 주 용도인데 예약자만 예외였다.
        const ok =
          r.roomNo.toLowerCase().includes(q) ||
          tenantNameHay(primaryLease(r)?.tenant).includes(q) ||
          r.leaseTerms.some(l => l.status === 'RESERVED' && tenantNameHay(l.tenant).includes(q)) ||
          (r.type ?? '').toLowerCase().includes(q)
        if (!ok) return false
      }
      if (filterStatus) {
        if (filterStatus === 'available') { if (!roomAvailability(r)) return false }
        else if (!matchesStatusFilter(r, filterStatus, targetMonth)) return false
      }
      if (cleaningOnly && !openCleanings[r.id]) return false
      if (roomNoQ && !r.roomNo.toLowerCase().includes(roomNoQ)) return false
      if (filterType && r.type !== filterType) return false
      if (filterTier && r.tier !== filterTier) return false
      if (filterWindowType && r.windowType !== filterWindowType) return false
      if (filterDirection && r.direction !== filterDirection) return false
      if (!matchAreaPyeong(r.areaPyeong)) return false
      if (!matchAreaM2(r.areaM2)) return false
      if (filterRentMin != null && r.baseRent < filterRentMin) return false
      if (filterRentMax != null && r.baseRent > filterRentMax) return false
      return true
    })
    return [...base].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'vacancy') {
        const av = a.isVacant ? 1 : 0
        const bv = b.isVacant ? 1 : 0
        return dir * (av - bv)
      }
      if (sortKey === 'baseRent') return dir * (a.baseRent - b.baseRent)
      return dir * a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true })
    })
  })()

  // '입주 가능' 2섹션 그룹 — 지금(공실) / 곧(퇴실 예정). 필터가 켜졌을 때만 만든다.
  // 카드 렌더는 아래 renderRoomCard 를 그대로 공유해 목록 문법이 갈라지지 않게 한다.
  const availableGroups = (() => {
    if (filterStatus !== 'available') return null
    // 정렬 키는 입주 가능일(= 마지막 퇴실일 다음 날) — 계약이 둘인 방은 먼저 나가는 사람이 아니라
    // 늦게 나가는 사람 기준이라야 '언제부터 받을 수 있나'가 맞는다.
    // 카드에 날짜 칩을 얹으려면 방과 입주 가능일이 붙어 다녀야 한다 — 렌더에서 다시 판정하면
    // 정렬이 쓴 값과 칩이 쓴 값이 갈릴 수 있다. 'now' 그룹은 날짜가 없으므로 undefined 다.
    const soon = filteredRooms
      .map(r => ({ r, a: roomAvailability(r) }))
      .filter((x): x is { r: Room; a: { kind: 'soon'; availableFrom: string } } => x.a?.kind === 'soon')
      .sort((x, y) => x.a.availableFrom !== y.a.availableFrom
        ? (x.a.availableFrom < y.a.availableFrom ? -1 : 1)
        : x.r.roomNo.localeCompare(y.r.roomNo, 'ko', { numeric: true }))
      .map((x): { r: Room; availableFrom?: string } => ({ r: x.r, availableFrom: x.a.availableFrom }))
    return [
      { key: 'now',  label: '지금 입주 가능', rooms: filteredRooms.filter(r => roomAvailability(r)?.kind === 'now').map((r): { r: Room; availableFrom?: string } => ({ r })) },
      { key: 'soon', label: '곧 입주 가능',   rooms: soon },
    ]
  })()

  // ── 핸들러 ────────────────────────────────────────────────────────

  const openEdit = (room: Room) => {
    entityModal.close()
    setEditRoom(room)
    setEditPhotos(room.photos)
    setShowOnSiteVal(room.showOnSite)
    setPhotoOrderMode(false)
    setEditFloorVal(room.floor ?? '')
    setRentUpdateDateVal(room.rentUpdateDate ? new Date(room.rentUpdateDate).toISOString().slice(0, 10) : '')
    setNrEnabled(room.nonResidentRent != null)
    setNrDateVal(room.nonResidentRentDate ? new Date(room.nonResidentRentDate).toISOString().slice(0, 10) : '')
    // 방 컨디션·이용료 controlled 초기화 — 최초 로드는 기존 값 그대로, 자동제안은 이후 select 변경부터.
    setEditType(room.type ?? '')
    setEditTier(room.tier ?? '')
    setEditWindowType(room.windowType ?? '')
    setEditBaseRent(room.baseRent)
    setEditRentSuggested(false)
    setError('')
  }

  // URL ?roomId·?edit=1 정리 — 안 지우면 저장/닫기 후에도 파라미터가 남는다.
  // 그 상태에서 같은 방을 다시 [수정](EntityModal)하면 router.push 가 '동일 URL' 이라 무시되고
  // handledOpenRef 도 그대로라 useEffect 가 openEdit 을 호출하지 않아 → 셸만 닫히고 편집 폼이
  // 안 열려 목록으로 '튕겨나오는' 문제가 생긴다(입주자 관리 clearTenantUrlParams 와 동일 패턴).
  const clearRoomUrlParams = () => {
    if (searchParams.get('edit') === '1' || searchParams.get('roomId')) {
      // 렌더 시점 스냅샷이 아니라 **지금의 실제 URL** 로 재구성한다 — 캘린더 트랙이
      // history.replaceState 로 적어 둔 위치를 옛 스냅샷이 되돌려 쓰던 레이스 방지
      // (lib/useUrlState 가 같은 이유로 같은 문법을 쓴다).
      const params = new URLSearchParams(window.location.search)
      params.delete('edit'); params.delete('roomId')
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    }
  }

  const closeEdit = () => {
    // 이 세션에 사진(공개·360·순서·삭제·추가·방공개)을 바꿨으면 소개 페이지 대표 썸네일 재배포를 한 번 트리거
    if (photosDirty) { void requestGalleryRedeploy(); setPhotosDirty(false) }
    setEditRoom(null)
    setEditPhotos([])
    setEditFloorVal('')
    setNrEnabled(false)
    setNrDateVal('')
    setError('')
    clearRoomUrlParams()
  }

  const closeAddModal = () => {
    addPhotoPreviews.forEach(p => URL.revokeObjectURL(p.previewUrl))
    setAddPhotoPreviews([])
    setAddNrEnabled(false)
    setAddNrDateVal('')
    setAddRoomNoVal('')
    setAddFloorVal('')
    setAddType('')
    setAddTier('')
    setAddWindowType('')
    setAddBaseRent(0)
    setAddRentSuggested(false)
    setShowAddModal(false)
    setError('')
  }

  // 방 컨디션 select 를 바꿀 때 같은 조합 기존 방들의 baseRent 최빈값을 제안(신고 089f0f17).
  // 매칭 방이 없으면 기존 값 유지. 사용자가 이용료를 직접 고치면 제안 표시는 해제한다.
  const suggestAdd = (type: string, tier: string, windowType: string) => {
    const s = suggestBaseRent(rooms, type, tier, windowType)
    if (s != null) { setAddBaseRent(s); setAddRentSuggested(true) }
  }
  const suggestEdit = (type: string, tier: string, windowType: string) => {
    const s = suggestBaseRent(rooms, type, tier, windowType)
    if (s != null) { setEditBaseRent(s); setEditRentSuggested(true) }
  }

  const MAX_PHOTOS = 10

  const handleAddPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const files = Array.from(e.target.files)
    const remaining = MAX_PHOTOS - addPhotoPreviews.length
    if (remaining <= 0) { setError(`사진은 최대 ${MAX_PHOTOS}장까지 추가할 수 있습니다.`); e.target.value = ''; return }
    const picked = files.slice(0, remaining)
    // 어두운 사진 경고(막지 않고 안내만)
    void Promise.all(picked.map(avgBrightness)).then(bs => {
      const dark = bs.filter(b => b < DARK_THRESHOLD).length
      if (dark > 0) pushToast('info', `사진 ${dark}장이 어두워요. 형광등과 자연광을 섞지 말고 밝은 낮에 다시 찍으면 더 좋습니다`)
    })
    const newPreviews = picked.map(file => ({
      file, previewUrl: URL.createObjectURL(file),
    }))
    setAddPhotoPreviews(prev => [...prev, ...newPreviews])
    e.target.value = ''
  }

  const removeAddPhoto = (index: number) => {
    setAddPhotoPreviews(prev => {
      URL.revokeObjectURL(prev[index].previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleAdd = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await addRoom(formData)
        if (!res.ok) { pushToast('error', res.error); return }
        let failedPhotos = 0
        for (const { file } of addPhotoPreviews) {
          try {
            const session = await createPhotoUploadSession({
              roomId: res.id,
              fileName: file.name,
              mimeType: file.type,
              fileSize: file.size,
              origin: window.location.origin,
            })
            if (!session.ok) { failedPhotos++; continue }
            const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file, () => {})
            await finalizeRoomPhoto({ roomId: res.id, driveFileId, fileName: file.name })
          } catch (err) {
            console.error('[handleAdd photo]', err)
            failedPhotos++   // 일부 사진 실패해도 나머지/호실 자체는 유지, 실패 장수는 아래서 안내
          }
        }
        closeAddModal()
        router.refresh()
        pushToast('success', '호실 추가됨')
        if (failedPhotos > 0) pushToast('info', `사진 ${failedPhotos}장은 업로드하지 못했어요. 호실 수정에서 다시 추가해 주세요.`)
      } finally { release() }
    })
  }

  const handleUpdate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await updateRoom(formData)
        if (res && !res.ok) { pushToast('error', res.error); return }
        closeEdit()
        // 전체 새로고침(window.reload) 대신 soft refresh — 토스트가 살아남고,
        // URL ?roomId&edit=1 이 남아 있어도 handledOpenRef 가 유지돼 폼이 재오픈되지 않음
        // (full reload 시 ref 초기화로 수정 팝업이 되돌아오던 글리치 해소).
        router.refresh()
        pushToast('success', '호실 수정됨')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '오류가 발생했습니다.'
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editRoom || !e.target.files?.length) return
    const files = Array.from(e.target.files)
    if (editPhotos.length >= MAX_PHOTOS) {
      setError(`사진은 최대 ${MAX_PHOTOS}장까지 추가할 수 있습니다.`)
      e.target.value = ''; return
    }
    const toUpload = files.slice(0, MAX_PHOTOS - editPhotos.length)
    // 어두운 사진 경고 — 막지 않고 안내만(사진 전문가: 밝기는 재촬영 유도, 최종 판단은 사람).
    const darkCount = (await Promise.all(toUpload.map(avgBrightness))).filter(b => b < DARK_THRESHOLD).length
    if (darkCount > 0) pushToast('info', `사진 ${darkCount}장이 어두워요. 형광등과 자연광을 섞지 말고 밝은 낮에 다시 찍으면 더 좋습니다`)
    setPhotoUploading(true); setError('')
    try {
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i]
        setPhotoProgress({ name: file.name, percent: 0, current: i + 1, total: toUpload.length })
        try {
          // 1) 서버에 Drive 업로드 세션 요청 (파일은 보내지 않음 — 메타데이터만)
          const session = await createPhotoUploadSession({
            roomId: editRoom.id,
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
            origin: window.location.origin,
          })
          if (!session.ok) { setError(session.error); break }

          // 2) 클라이언트가 Drive로 직접 PUT 업로드 (Vercel 함수 우회)
          const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file, percent =>
            setPhotoProgress({ name: file.name, percent, current: i + 1, total: toUpload.length })
          )

          // 3) 권한 설정 + DB 저장
          const fin = await finalizeRoomPhoto({
            roomId: editRoom.id,
            driveFileId,
            fileName: file.name,
          })
          if (!fin.ok) { setError(fin.error); break }
          setEditPhotos(prev => [...prev, { id: fin.id, driveFileId: fin.driveFileId, storageUrl: fin.storageUrl, fileName: fin.fileName }])
          setPhotosDirty(true)
        } catch (err) {
          console.error('[handlePhotoUpload]', err)
          setError(`업로드 중 오류: ${(err as Error).message ?? '알 수 없는 오류'}`)
          break
        }
      }
    } finally {
      setPhotoUploading(false)
      setPhotoProgress(null)
      e.target.value = ''
    }
  }

  const handlePhotoDelete = async (photoId: string) => {
    if (!(await confirmDialog({ title: '이 사진을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    const res = await deleteRoomPhoto(photoId)
    if (!res.ok) { setError(res.error); return }
    setEditPhotos(prev => prev.filter(p => p.id !== photoId))
    setPhotosDirty(true)
  }

  // 사진 단위 공개 토글 — 낙관적 갱신 후 실패 시 원복. 대표(공개·비360 첫 장)는 자동 재계산돼 카드 썸네일도 바뀐다.
  const handleTogglePhotoShow = async (photoId: string, next: boolean) => {
    setEditPhotos(prev => prev.map(p => p.id === photoId ? { ...p, showOnSite: next } : p))
    const res = await setRoomPhotoShowOnSite(photoId, next)
    if (!res.ok) {
      setEditPhotos(prev => prev.map(p => p.id === photoId ? { ...p, showOnSite: !next } : p))
      pushToast('error', res.error)
      return
    }
    setPhotosDirty(true)
    router.refresh()   // 카드 대표 썸네일(공개 첫 장) 동기화
  }

  // 사진 360 지정 토글(뷰어에서 호출) — 저장하면 공개 웹·그리드 배지·대표 계산에 반영. 실패 시 false 반환 → 뷰어 로컬 원복.
  const handleTogglePhotoIs360 = async (photoId: string, next: boolean): Promise<boolean> => {
    setEditPhotos(prev => prev.map(p => p.id === photoId ? { ...p, is360: next } : p))
    const res = await setRoomPhotoIs360(photoId, next)
    if (!res.ok) {
      setEditPhotos(prev => prev.map(p => p.id === photoId ? { ...p, is360: !next } : p))
      pushToast('error', res.error)
      return false
    }
    setPhotosDirty(true)
    pushToast('success', next ? '360 사진으로 지정했어요' : '360 지정을 해제했어요')
    router.refresh()
    return true
  }

  // 소개 페이지 공개 토글 — 즉시 반영(폼 저장과 무관), 낙관적 갱신 후 실패 시 원복. 되돌리기는 다시 끄면 된다.
  const handleToggleShowOnSite = async () => {
    if (!editRoom || showOnSitePending) return
    const next = !showOnSiteVal
    setShowOnSitePending(true)
    setShowOnSiteVal(next)
    const res = await setRoomShowOnSite(editRoom.id, next)
    setShowOnSitePending(false)
    if (!res.ok) { setShowOnSiteVal(!next); pushToast('error', res.error); return }
    setPhotosDirty(true)
    pushToast('success', next ? '소개 페이지에 공개했어요' : '소개 페이지에서 내렸어요')
    router.refresh()
  }

  // 사진 순서 편집(오류신고 8dba0177) — 비품 '순서 편집' 정본 패턴(1열 행 + 오른쪽 44pt 손잡이 드래그) 이식.
  // 대표 이미지 = 첫 장(photos[0]) 규칙이라 별도 대표 필드 없이 순서 저장 하나로 처리.
  const [photoOrderMode, setPhotoOrderMode] = useState(false)
  const [dragPhotoIdx, setDragPhotoIdx] = useState<number | null>(null)
  const photoOrderChanged = useRef(false)
  const photoDragListRef = useRef<HTMLElement | null>(null)
  const editPhotosRef = useRef(editPhotos)
  useEffect(() => { editPhotosRef.current = editPhotos }, [editPhotos])   // 렌더 중 ref 접근 금지(react-compiler)
  const dragStartPhotosRef = useRef<Photo[]>([])   // 드래그 시작 시점 순서 — 저장 실패 원복용

  const savePhotoOrder = async (next: Photo[], prev: Photo[], successMsg: string) => {
    if (!editRoom) return
    setEditPhotos(next)   // 낙관적 반영, 실패 시 원복
    const res = await reorderRoomPhotos(editRoom.id, next.map(p => p.id))
    if (!res.ok) {
      setEditPhotos(prev)
      pushToast('error', res.error)
      return
    }
    setPhotosDirty(true)
    router.refresh()   // 호실 카드 대표 썸네일(photos[0]) 즉시 동기화
    pushToast('success', successMsg, {
      action: { label: '적용취소', run: () => {
        void reorderRoomPhotos(editRoom.id, prev.map(p => p.id)).then(r => {
          if (r.ok) { setEditPhotos(prev); router.refresh(); pushToast('info', '사진 순서를 되돌렸습니다') }
          else pushToast('error', r.error)
        })
      } },
    })
  }

  // 라이트박스 '대표로 설정' — 해당 사진을 맨 앞으로 이동
  const handleSetMainPhoto = async (photo: Photo) => {
    const prev = editPhotosRef.current
    if (prev[0]?.id === photo.id) return
    setViewPhoto(null)
    await savePhotoOrder([photo, ...prev.filter(p => p.id !== photo.id)], prev, '대표 이미지로 설정됨')
  }

  const onPhotoHandleDown = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    photoDragListRef.current = (e.currentTarget as HTMLElement).closest('[data-photo-drag-list]') as HTMLElement | null
    photoOrderChanged.current = false
    dragStartPhotosRef.current = editPhotosRef.current
    setDragPhotoIdx(idx)
  }
  const onPhotoHandleMove = (e: React.PointerEvent) => {
    if (dragPhotoIdx == null || !photoDragListRef.current) return
    const items = Array.from(photoDragListRef.current.children) as HTMLElement[]
    if (items.length === 0) return
    let over = -1
    if (e.clientY < items[0].getBoundingClientRect().top) over = 0
    else if (e.clientY > items[items.length - 1].getBoundingClientRect().bottom) over = items.length - 1
    else {
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect()
        if (e.clientY >= r.top && e.clientY <= r.bottom) { over = i; break }
      }
    }
    if (over < 0 || over === dragPhotoIdx) return
    setEditPhotos(prevP => {
      const next = [...prevP]
      const [moved] = next.splice(dragPhotoIdx, 1)
      next.splice(over, 0, moved)
      return next
    })
    setDragPhotoIdx(over)
    photoOrderChanged.current = true
  }
  const onPhotoHandleUp = async () => {
    if (dragPhotoIdx == null) return
    setDragPhotoIdx(null)
    if (!photoOrderChanged.current) return
    photoOrderChanged.current = false
    const prev = dragStartPhotosRef.current
    const next = editPhotosRef.current
    if (!editRoom || prev.map(p => p.id).join() === next.map(p => p.id).join()) return
    const res = await reorderRoomPhotos(editRoom.id, next.map(p => p.id))
    if (!res.ok) {
      setEditPhotos(prev)
      pushToast('error', res.error)
      return
    }
    router.refresh()
    pushToast('success', '사진 순서 저장됨')
  }

  const TypeSection = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
      <select name="type" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <p className="text-[0.65625rem] text-[var(--warm-muted)]">방 타입 추가·관리는 환경설정에서 할 수 있습니다.</p>
    </div>
  )

  const TierSection = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">등급</label>
      <select name="tier" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {tiers.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <p className="text-[0.65625rem] text-[var(--warm-muted)]">등급(스탠다드/실속형 등) 추가·관리는 환경설정에서 할 수 있습니다.</p>
    </div>
  )

  // 호실 카드 한 장 — 평소 목록과 '입주 가능' 그룹 목록이 같은 렌더를 쓴다(복제 금지).
  // availableFrom — '입주 가능' 필터의 '곧' 그룹에서만 넘어오는 입주 가능일('YYYY-MM-DD').
  // 평소 목록은 넘기지 않는다. 그 화면에서 46실 카드가 저마다 날짜 칩을 달면 칩 줄이 상태·전입신고
  // 불가·청소 필요와 넷이 되고, 정작 그 목록에서 묻는 것은 '이 방이 지금 어떤가'다.
  // 그룹 화면은 질문 자체가 '언제부터인가'라 날짜가 제목(그룹 머리글)의 답이 된다.
  const renderRoomCard = (room: Room, availableFrom?: string) => {
    const tenant = currentTenant(room)
    const thumb  = room.photos[0]
    const rs     = getRoomStatus(room, targetMonth)
    // 카드에 이름이 안 적히는 예약 — 거주자가 있는 방의 예약, 예약이 둘인 방의 뒷사람(404호 8/15·9/1).
    // '입실 예약' 칸이 사람 축이 된 이상 그 칸에 선 방은 누구의 예약인지 카드에서 말해야 한다.
    // 문장은 카드가 이미 쓰던 조각 그대로다 — 이름(입주자 줄) + moveInSubText('9/2 입주 예정').
    // 날짜 없는 예약은 상태 라벨로 메운다. 이름만 적으면 두 번째 거주자로 읽힌다.
    const reserved = nextReservedLease(room, primaryLease(room))
    const reservedLine = reserved
      ? [reserved.tenant ? displayName(reserved.tenant, reserved.tenant.displayNameStyle) : null, moveInSubText(reserved.moveInDate) ?? '입실 예약'].filter(Boolean).join(' · ')
      : null
    // 그 방에 남은 청소 예정 중 가장 이른 것(서버가 골라 준다).
    const cleaning = openCleanings[room.id]
    // Status Row 팁/틴트 톤 — 예약·퇴실은 배지 톤, 거주중은 olive(paid),
    // 공실은 RoomCard vacant 기본(ink-mute 팁) 유지.
    const tipTone: BadgeTone | null = rs.badge ? rs.badge.tone : rs.kind === 'resident' ? 'paid' : null
    const selected = selectMode && selectedIds.has(room.id)
    return (
      <RoomCard key={room.id}
        kind={rs.kind}
        selected={selected}
        tipColor={tipTone ? statusTipColor(tipTone) : undefined}
        tipBg={tipTone ? statusRowTint(tipTone) : undefined}
        onClick={() => selectMode ? toggleSelectRoom(room.id) : (entityModal.open({ kind: 'room', roomId: room.id }), setError(''))}
        onLongPress={!selectMode ? () => { setSelectMode(true); toggleSelectRoom(room.id) } : undefined}
        className="overflow-hidden flex items-stretch">
        {/* 정보 */}
        <div className="flex-1 p-4 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-base font-bold ${rs.kind === 'vacant' ? 'text-[var(--warm-mid)]' : 'text-[var(--coral)]'}`}>{fmtRoomNo(room.roomNo)}</span>
            {cardFields.floor && room.floor && (
              <span className="text-[0.65625rem] px-2 py-0.5 rounded-full font-medium shrink-0 bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                {room.floor}층
              </span>
            )}
            {/* 입주 가능일 — 층 칩과 같은 메타 칩 문법이다. 상태 뱃지 앞에 두는 이유는 이것이
                방을 가리키는 사실(호실번호·층)에 붙는 정보이지 상태가 아니기 때문이다. */}
            {availableFrom && (
              <span className="text-[0.65625rem] px-2 py-0.5 rounded-full font-medium shrink-0 bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                {fmtMD(availableFrom)}부터
              </span>
            )}
            {rs.badge && <StatusBadge tone={rs.badge.tone} sub={rs.badge.sub} secondary={rs.badge.secondary}>{rs.badge.label}</StatusBadge>}
            {room.noMoveInReport && <StatusBadge tone="exit">전입신고 불가</StatusBadge>}
            {/* 보조줄에 예정일 + 요일(§11). 청소 업체는 화목·월수금처럼 요일로 오니 날짜만으로는
                일정을 못 읽는다(운영자 요청 2026-08-10). D-day 는 붙이지 않는다 — 남은 날수가
                아니라 무슨 요일에 오는가가 이 자리의 정보다. 날짜를 비워 등록한 건은 보조줄 없음.
                뱃지는 늘리지 않는다 — 이 줄은 이미 상태·전입신고 불가와 셋이 나눠 쓰고 있다. */}
            {cleaning && (
              <StatusBadge tone="await" sub={cleaning.scheduledDate ? `${fmtMDDay(cleaning.scheduledDate)} 예정` : undefined}>
                청소 필요
              </StatusBadge>
            )}
          </div>
          {cardFields.tenant && tenant && <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{tenant}</p>}
          {/* 예약자 줄 — 사는 사람 아래 한 단 낮은 톤으로 선다. 같은 크기·굵기로 적으면 두 사람이
              같이 사는 방으로 읽힌다. 색은 아래 예정 이용료 줄과 같은 --warm-mid 다. --warm-muted 로
              적었더니 320px 실측에서 바로 밑 스펙 줄(타입·창문·면적)과 크기·색이 같아 사람이 스펙의
              한 줄로 읽혔다. '입주자' 표시 항목을 끄면 함께 사라진다(같은 사람 축이다). */}
          {cardFields.tenant && reservedLine && <p className="text-xs text-[var(--warm-mid)] truncate">{reservedLine}</p>}
          <div className="space-y-0.5 pt-0.5">
            {cardFields.spec && (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--warm-muted)]">
                {room.type && <span>{room.type}</span>}
                {room.tier && <span>{room.tier}</span>}
                {(room.windowType || room.direction) && (
                  <span>
                    {[
                      room.windowType ? getWindowLabel(room.windowType) : null,
                      room.direction  ? getDirectionLabel(room.direction) : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
                {(room.areaPyeong || room.areaM2) && (
                  <span>
                    {[
                      room.areaPyeong ? `${room.areaPyeong}평` : null,
                      room.areaM2     ? `${room.areaM2}㎡`    : null,
                    ].filter(Boolean).join(' / ')}
                  </span>
                )}
              </div>
            )}
            {!hideMoney && (
              <p className="text-sm font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={room.baseRent} /></p>
            )}
            {!hideMoney && cardFields.scheduled && room.scheduledRent != null && (
              <p className="text-xs text-[var(--warm-mid)]">
                → <MoneyDisplay amount={room.scheduledRent} />
                {/* 날짜가 아니라 달로 적는다 — 인상은 그 달 전체에 걸린다(lib/billing effectiveBaseRent).
                    호실 상세 모달이 같은 문장(fmtRentApplyFrom)을 쓴다. */}
                {room.rentUpdateDate && <span className="text-[var(--warm-muted)] ml-1 whitespace-nowrap">({fmtRentApplyFrom(kstMonthOf(room.rentUpdateDate))})</span>}
              </p>
            )}
          </div>
        </div>
        {/* 썸네일 (오른쪽) */}
        {cardFields.photo && (
          <div className="w-24 sm:w-28 shrink-0 bg-[var(--canvas)]">
            {thumb ? (
              <img src={thumb.storageUrl} alt={fmtRoomNo(room.roomNo)} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.4 }}>
                  <path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" />
                </svg>
              </div>
            )}
          </div>
        )}
      </RoomCard>
    )
  }

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* 헤더 — flex-wrap 이 없으면 자식 여섯이 압축되며 버튼 안에서 글자가 쪼개진다.
          목록 화면 일곱 중 여기만 wrap 이 없었다(운영자 신고 aea83d6b "상단 버튼이 너무 복잡해").
          부제도 걷는다 — 바로 아래 상태 칩이 같은 값을 이미 말하고 있었고, 게다가 부제의 '거주중'은
          퇴실 예정을 합쳐 39, 칩은 나눠서 36 이라 한 화면에 같은 이름의 숫자가 둘이었다. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* min-w-0 — 안 줄어들면 탭 트랙의 max-w-full 이 좌우 여백 밖으로 밀린다(수납 관리와 같은 처방). */}
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">호실 관리</h1>
          {/* 뷰 전환 탭 — 제목 옆(수납 관리와 같은 자리·같은 정본).
              equal 을 뗐다. 라벨이 '입퇴실 캘린더'로 길어지면서 세 칸이 가장 긴 칸에 맞춰
              부풀어(320px 118.7px x 3) 트랙이 콘텐츠 폭을 통째로 먹고, 390px 에서 월 셀렉터가
              한 줄 더 밀려 내려갔다(헤더 높이 102 → 142). 320px 에서는 칸이 288 에 갇혀 글자가
              1px 잘렸다. 자연폭으로 두면 56.9 / 79 / 129 = 트랙 266.9 로 세 폭 전부 안 잘리고
              헤더 높이도 종전 그대로다(142/142/102). 자연폭 + 넘치면 가로 스크롤이 §25 의 기본이고
              형제 수납 관리(3탭 + 접미 N)가 쓰는 바로 그 문법이다 — equal 은 아직 부록 등재 제안 중. */}
          <ViewTabs ariaLabel="호실 관리 뷰" activeId={viewTab}
            onChange={id => setViewTab(id as ViewTabId)}
            tabs={[
              { id: 'rooms',    label: '호실' },
              { id: 'cleaning', label: '청소', suffix: plannedCleaningCount > 0 ? String(plannedCleaningCount) : undefined },
              // '입퇴실'만으로는 무엇이 열리는지 안 보인다는 운영자 제안(2026-08-18) — 이 탭이 여는 것은
              // 달력이라 이름이 그렇게 말한다. 홈 링크 문구('이달 입퇴실 N건')는 그대로 둔다.
              // 접미 N 은 **보고 있는 달**의 건수다(트랙 전체가 아니라). 홈 '이달 입퇴실 N건'을
              // 눌러 들어왔을 때 그 숫자가 여기서 다른 값으로 바뀌면 둘 중 하나가 거짓으로 읽힌다.
              // 그래서 착지 순간에는 홈과 같은 수이고, 그 뒤 숫자가 바뀌는 것은 운영자가 스스로
              // 다른 달로 옮겼기 때문이다. 갱신은 스크롤이 멎은 뒤 한 번뿐이다 — rAF 로 밀면
              // 접미 폭이 바뀔 때마다 ViewTabs 의 코랄 채움이 200ms 애니메이션에 갇힌다.
              { id: 'moves',    label: '입퇴실 캘린더', suffix: moveEventCount > 0 ? String(moveEventCount) : undefined },
            ]} />
        </div>
        {/* 뷰어(STAFF)에겐 편집 진입 숨김(감사 D3) */}
        {/* ml-auto — 좁은 폭에서 두 줄로 접힐 때도 버튼군이 우측 정렬(월 셀렉터 우측 통일 지적과 같은 클래스). */}
        {/* 호실 뷰에서만 — 둘 다 호실에 대한 동작이라 청소 뷰에서는 할 일이 아니고, 청소 뷰의
            '+ 청소 예정 등록'까지 서면 헤더 CTA 가 셋이 된다(§23 은 1~2개). 형제(수납 관리)도
            탭별 CTA 를 섹션 안에 둔다. */}
        {canEditUi && viewTab === 'rooms' && (
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <Btn variant="secondary" size="md" onClick={() => setShowPropPhotos(true)}>
            공용·외관 사진
          </Btn>
          <Btn variant="primary" size="md" onClick={() => { setShowAddModal(true); setError('') }}>
            + 호실 등록
          </Btn>
        </div>
        )}
        {/* 월 셀렉터는 입퇴실 뷰에만 — 자리는 그대로 두되 역할이 바뀌었다(2026-08-17 연속 뷰).
            종전에는 달마다 다시 조회하는 스위치였고, 지금은 넓은 트랙 위의 **점프 컨트롤**이다.
            트랙을 끌면 보고 있는 달이 ?at= 으로 따라 적히므로 이 라벨이 현재 위치를 말한다.
            키가 형제 화면과 다른 이유는 뜻이 달라서다(lib/monthParam TRACK_MONTH_KEY) — 여기 값은
            조회 장부 월이 아니라 트랙 위치라, 내비가 그것을 조회 월로 복사하면 전역이 그 달로 열린다.
            fallbackKey 는 홈 딥링크(?tab=moves&month=) 착지용이다.
            §25 탭 좌·셀렉터 우 — 형제 페이지와 같은 자리를 지킨다. */}
        {viewTab === 'moves' && (
          <div className="shrink-0 ml-auto">
            <MonthSelector allowFuture futureIsNormal paramKey={TRACK_MONTH_KEY} fallbackKey="month" />
          </div>
        )}
      </div>

      {/* 입퇴실 뷰 — 여러 달을 잇는 연속 트랙. 조립·충돌 판정은 서버(lib/moveCalendar)가 끝냈다. */}
      {viewTab === 'moves' && <MoveCalendar data={moveCalendar} onViewMonthChange={setViewMonth} />}

      {/* 청소 뷰 — 영업장 전체 청소 목록. 행 표시·조작은 방 상세 패널과 같은 정본 컴포넌트다. */}
      {viewTab === 'cleaning' && (
        <CleaningView rows={initialCleanings} rooms={rooms} targetMonth={targetMonth}
          recentPerformers={recentPerformers} canEdit={canEditUi}
          onOpenRoom={roomId => { entityModal.open({ kind: 'room', roomId }); setError('') }}
          onChanged={() => router.refresh()} />
      )}

      {viewTab === 'rooms' && <>
      {/* 검색바 + 필터 토글 — v2.0 §23 공용 SearchBar. 스크롤 시 상단 고정 */}
      <div className="flex gap-2 sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={search} onChange={setSearch} placeholder="호실 번호, 입주자 이름, 방 타입 검색" className="flex-1" />
        <button
          type="button"
          onClick={() => setShowFilters(v => !v)}
          className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
            showFilters || activeFilterCount > 0
              ? 'bg-[var(--coral)] text-[var(--on-solid)]'
              : 'bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)]'
          }`}
        >
          필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
      </div>

      {/* 상태 빠른 필터 — v2.0 §23 공용 SegmentedControl(수납·입주자와 동일). '전체'가 곧 해제. */}
      {(() => {
        // 칸마다 목록과 같은 술어로 센다 — '입실 예약'이 사람 축(비배타)이 되면서 한 번의 분류로는
        // 셀 수 없어졌다. 아래 '입주 가능'이 같은 이유로 이미 따로 세고 있다.
        const counts = STATUS_FILTERS.reduce((acc, s) => {
          acc[s.key] = rooms.filter(r => matchesStatusFilter(r, s.key, targetMonth)).length
          return acc
        }, {} as Record<RoomStatusKey, number>)
        // 입주 가능은 칩 합이 아니라 목록과 같은 술어로 센다 — 숫자와 목록이 갈리면 안 된다.
        const availableCount = rooms.filter(r => roomAvailability(r)).length
        return (
          <div className="flex gap-2 flex-wrap items-center">
            <SegmentedControl<RoomStatusKey | 'available' | ''>
              size="sm"
              scroll
              ariaLabel="호실 상태 필터"
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { value: '', label: `전체 ${rooms.length}` },
                { value: 'available', label: `입주 가능 ${availableCount}` },
                ...STATUS_FILTERS.map(s => ({ value: s.key, label: `${s.label} ${counts[s.key] ?? 0}` })),
              ]}
            />
            {/* 단기 파생 포함으로 '퇴실 예정' 숫자가 상태값과 달라진다 — 수납 관리와 같은 문구로 설명한다. */}
            <InfoHint title="호실 상태 필터">
              <span className="block">단기 계약은 퇴실 예정 상태로 바뀌기 전에도 포함됩니다.</span>
              <span className="block mt-1.5">입주 가능은 언제 비는지 날짜가 잡힌 방을 모두 모읍니다. 예약된 방도 퇴실 예정일이 있으면 들어갑니다.</span>
              <span className="block mt-1.5">입실 예약은 예약이 잡힌 방을 모두 모읍니다. 거주자가 있는 방도 함께 들어가므로 칸별 숫자의 합이 전체 방 수보다 클 수 있습니다.</span>
            </InfoHint>
          </div>
        )
      })()}

      {/* 필터 패널 */}
      {showFilters && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">호실 번호</label>
              <input
                value={filterRoomNo}
                onChange={e => setFilterRoomNo(e.target.value)}
                placeholder="예: 401, 5"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">등급</label>
              <select
                value={filterTier}
                onChange={e => setFilterTier(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {tiers.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">창문 타입</label>
              <select
                value={filterWindowType}
                onChange={e => setFilterWindowType(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {windowTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">방향</label>
              <select
                value={filterDirection}
                onChange={e => setFilterDirection(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {directionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">면적 (평)</label>
              <select
                value={filterAreaPyeong}
                onChange={e => setFilterAreaPyeong(e.target.value as AreaPyeongRange)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                <option value="<1">1평 미만</option>
                <option value="1-2">1평~2평 미만</option>
                <option value="2-3">2평~3평 미만</option>
                <option value="3+">3평 이상</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">면적 (㎡)</label>
              <select
                value={filterAreaM2}
                onChange={e => setFilterAreaM2(e.target.value as AreaM2Range)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                <option value="<3.3">3.3㎡ 미만</option>
                <option value="3.3-6.6">3.3㎡~6.6㎡ 미만</option>
                <option value="6.6-9.9">6.6㎡~9.9㎡ 미만</option>
                <option value="9.9+">9.9㎡ 이상</option>
              </select>
            </div>
          </div>
          {!hideMoney && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">월 이용료 범위 (원)</label>
              <div className="flex items-center gap-2">
                <MoneyInput
                  value={filterRentMin}
                  onChange={v => setFilterRentMin(v && v > 0 ? v : undefined)}
                  placeholder="최소"
                />
                <span className="text-[var(--warm-muted)] text-sm">~</span>
                <MoneyInput
                  value={filterRentMax}
                  onChange={v => setFilterRentMax(v && v > 0 ? v : undefined)}
                  placeholder="최대"
                />
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Btn
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={resetFilters}
            >
              초기화
            </Btn>
            <Btn
              type="button"
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => setShowFilters(false)}
            >
              닫기
            </Btn>
          </div>
        </div>
      )}

      {/* 청소 조회 실패 안내는 걷었다 — 배지 재료가 서버 페이지와 같은 한 벌이 되면서
          '조회만 따로 실패하는' 상태가 사라졌다. 실패하면 페이지가 실패한다. */}

      {/* 청소 필요만 — 상태 칩과 축이 달라 별도 토글이다. 상태 칩에 섞으면 '공실이면서 청소 필요'를 못 고른다. */}
      {Object.keys(openCleanings).length > 0 && (
        <button type="button" onClick={() => setCleaningOnly(v => !v)}
          className="text-xs px-3 py-2 rounded-lg transition-colors"
          style={cleaningOnly
            ? { background: 'var(--coral)', color: 'var(--on-solid)', minHeight: 44 }
            : { background: 'var(--warning-bg)', color: 'var(--warning-fg)', border: '1px solid var(--warning-ring)', minHeight: 44 }}>
          청소 필요 <span className="num font-semibold">{Object.keys(openCleanings).length}</span>실{cleaningOnly ? ' · 전체 보기' : '만 보기'}
        </button>
      )}

      {/* 정렬 + 목록 조작 — wrap 필수. '선택'이 '선택 취소'로 늘거나 글씨 크기를 키우면 한 줄을 넘긴다. */}
      <div className="flex items-center gap-2 flex-wrap">
        <SortSelect
          ariaLabel="호실 정렬 기준"
          value={sortKey}
          dir={sortDir}
          onChange={sk => { setSortKey(sk); setSortDir('asc') }}
          onToggleDir={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          options={[
            { value: 'roomNo',   label: '호실순' },
            { value: 'vacancy',  label: '공실' },
            ...(hideMoney ? [] : [{ value: 'baseRent' as const, label: '이용료' }]),
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          {/* 선택은 목적 동사가 아니라 목록 조작이라 툴바 행에 선다. 형제(수납·재고)와 같은 자리다.
              canEditUi 가드를 개별로 단다 — 헤더의 묶음 가드에서 빠져나왔으므로 안 달면 STAFF 에게 노출된다. */}
          {canEditUi && (
            <Btn variant="secondary" size="md" onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
              {selectMode ? '선택 취소' : '선택'}
            </Btn>
          )}
          <DisplayFieldsMenu fields={cardFieldDefs} visible={cardFields} onToggle={toggleCardField} />
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-xl p-3">
          <p className="text-[var(--danger-fg)] text-sm">{error}</p>
        </div>
      )}

      {/* 호실 그리드 — 빈 상태는 v2.0 §17 공용 EmptyState */}
      {filteredRooms.length === 0 ? (
        <EmptyState
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" /></svg>}
          title={search ? '검색 결과가 없습니다' : '등록된 호실이 없습니다'}
          description={search ? '다른 검색어로 시도해 보세요.' : '호실 등록 버튼을 눌러 시작하세요.'}
        />
      ) : availableGroups ? (
        /* 입주 가능 — 지금(공실)과 곧(퇴실 예정)을 나눠 보여준다. 빈 그룹은 머리글째 감춘다. */
        <div className="space-y-5">
          {availableGroups.map(g => g.rooms.length === 0 ? null : (
            <div key={g.key}>
              <h2 className="text-sm font-semibold text-[var(--warm-muted)] mb-3">{g.label} {g.rooms.length}실</h2>
              <div className="space-y-2">
                {g.rooms.map(x => renderRoomCard(x.r, x.availableFrom))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {/* 인자를 안 넘기는 호출이다 — .map(renderRoomCard) 로 두면 배열 인덱스가 availableFrom
              자리에 들어가 두 번째 카드부터 '1부터' 같은 칩이 붙는다. */}
          {filteredRooms.map(room => renderRoomCard(room))}
        </div>
      )}
      </>}

      {/* 상세 모달은 전역 Prism 셸(EntityModal)이 담당. 카드 클릭이 entityModal.open() 호출 */}

      {/* ── 배치 편집 모달 ─────────────────────────────────────────────── */}
      {showBatchEdit && (
        <BatchEditRoomsModal
          selectedIds={Array.from(selectedIds)}
          roomTypes={types}
          roomTiers={tiers}
          windowTypeOptions={windowTypeOptions}
          directionOptions={directionOptions}
          onClose={() => setShowBatchEdit(false)}
          onDone={() => { setShowBatchEdit(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 배치 액션 바 — v2.0 §22 공용 SelectionPillBar */}
      {selectMode && selectedIds.size > 0 && (
        <SelectionPillBar count={selectedIds.size} unit="실" onClose={exitSelectMode}>
          <PillButton primary onClick={() => setShowBatchEdit(true)}>일괄 편집</PillButton>
        </SelectionPillBar>
      )}

      {/* ── 호실 추가 모달 ──────────────────────────────────────────── */}
      {showAddModal && (
        <Modal title="호실 등록" onClose={closeAddModal}>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">호실 번호 *</label>
                <input
                  name="roomNo"
                  placeholder="예: 101, A동-3, 옥탑방"
                  value={addRoomNoVal}
                  onChange={e => {
                    const val = e.target.value
                    setAddRoomNoVal(val)
                    setAddFloorVal(deriveFloor(val))
                  }}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <input
                  name="floor"
                  placeholder="자동"
                  value={addFloorVal}
                  onChange={e => setAddFloorVal(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
            </div>
            <TypeSection value={addType} onChange={v => { setAddType(v); suggestAdd(v, addTier, addWindowType) }} />
            <TierSection value={addTier} onChange={v => { setAddTier(v); suggestAdd(addType, v, addWindowType) }} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">기본 월 이용료</label>
              <MoneyInput name="baseRent" value={addBaseRent} onChange={v => { setAddBaseRent(v); setAddRentSuggested(false) }} placeholder="0원" />
              {addRentSuggested && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">같은 조건 방 기준 기본값입니다. 방마다 다르면 수정하세요.</p>
              )}
            </div>

            {/* 비거주 이용료 설정 */}
            <div className="border border-[var(--warm-border)] rounded-xl p-3.5 space-y-3">
              <input type="hidden" name="nonResidentEnabled" value={addNrEnabled ? '1' : '0'} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--warm-mid)]">비거주 이용료 설정</p>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">일반 이용료와 별도로 비거주자 전용 금액을 설정합니다</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" className="sr-only" checked={addNrEnabled} onChange={e => setAddNrEnabled(e.target.checked)} />
                  <div className={`w-9 h-5 rounded-full transition-colors ${addNrEnabled ? 'bg-[var(--coral)]' : 'bg-[var(--warm-border)]'}`} />
                  <div className={`absolute left-0.5 top-0.5 w-4 h-4 bg-[var(--cream)] rounded-full shadow transition-transform ${addNrEnabled ? 'translate-x-4' : ''}`} />
                </label>
              </div>
              {addNrEnabled && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">비거주 월이용료</label>
                    <MoneyInput name="nonResidentRent" placeholder="0원" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">예약 이용료 <span className="text-[var(--warm-muted)]">(선택)</span></label>
                      <MoneyInput name="nonResidentScheduled" placeholder="미설정" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일</label>
                      <DatePicker name="nonResidentRentDate" value={addNrDateVal} onChange={setAddNrDateVal}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">고른 날짜가 속한 달분부터 적용됩니다.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField label="창문 타입" name="windowType" options={windowTypeOptions}
                value={addWindowType} onChange={v => { setAddWindowType(v); suggestAdd(addType, addTier, v) }}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
              <SelectField label="방향" name="direction" options={directionOptions}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
            </div>
            <AreaInput />
            <Field label="메모" name="memo" placeholder="방 컨디션 메모" />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--warm-mid)]">사진</label>
                <button type="button" onClick={() => addPhotoInputRef.current?.click()}
                  className="text-xs text-[var(--coral)] hover:text-[var(--coral)] transition-colors">
                  + 사진 선택
                </button>
                <input ref={addPhotoInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={handleAddPhotoSelect} />
              </div>
              {addPhotoPreviews.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {addPhotoPreviews.map((p, i) => (
                    <div key={p.previewUrl} className="relative group aspect-square rounded-lg overflow-hidden bg-[var(--canvas)]">
                      <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeAddPhoto(i)} aria-label="사진 삭제"
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div onClick={() => addPhotoInputRef.current?.click()}
                  className="h-20 border border-dashed border-[var(--warm-border)] rounded-xl flex items-center justify-center cursor-pointer hover:border-[var(--warm-border)] transition-colors">
                  <p className="text-xs text-[var(--warm-muted)]">클릭하여 사진 선택 (추가 시 업로드)</p>
                </div>
              )}
            </div>

            {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Btn type="button" variant="secondary" onClick={closeAddModal} fullWidth>취소</Btn>
              <Btn type="submit" variant="primary" disabled={isPending} fullWidth>
                {isPending ? '저장 중…' : `저장${addPhotoPreviews.length > 0 ? ` (사진 ${addPhotoPreviews.length}장)` : ''}`}
              </Btn>
            </div>
          </form>
        </Modal>
      )}

      {/* ── 호실 수정 모달 ──────────────────────────────────────────── */}
      {editRoom && (
        <Modal title={`${fmtRoomNo(editRoom.roomNo)} 수정`} onClose={closeEdit}>
          <form onSubmit={handleUpdate} className="space-y-4">
            <input type="hidden" name="id" value={editRoom.id} />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">호실 번호 *</label>
                <input
                  name="roomNo"
                  defaultValue={editRoom.roomNo}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <input
                  name="floor"
                  placeholder="예: 1"
                  value={editFloorVal}
                  onChange={e => setEditFloorVal(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
            </div>
            <TypeSection value={editType} onChange={v => { setEditType(v); suggestEdit(v, editTier, editWindowType) }} />
            <TierSection value={editTier} onChange={v => { setEditTier(v); suggestEdit(editType, v, editWindowType) }} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">기본 월 이용료</label>
              <MoneyInput name="baseRent" value={editBaseRent} onChange={v => { setEditBaseRent(v); setEditRentSuggested(false) }} />
              {editRentSuggested && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">같은 조건 방 기준 기본값입니다. 방마다 다르면 수정하세요.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">예약 이용료 <span className="text-[var(--warm-muted)]">(가격 예약)</span></label>
                <MoneyInput name="scheduledRent" defaultValue={editRoom.scheduledRent ?? undefined} placeholder="미설정" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일</label>
                <DatePicker name="rentUpdateDate" value={rentUpdateDateVal} onChange={setRentUpdateDateVal}
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
              </div>
            </div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">고른 날짜가 속한 달분부터 적용됩니다.</p>

            {/* 비거주 이용료 설정 */}
            <div className="border border-[var(--warm-border)] rounded-xl p-3.5 space-y-3">
              <input type="hidden" name="nonResidentEnabled" value={nrEnabled ? '1' : '0'} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--warm-mid)]">비거주 이용료 설정</p>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">일반 이용료와 별도로 비거주자 전용 금액을 설정합니다</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" className="sr-only" checked={nrEnabled} onChange={e => setNrEnabled(e.target.checked)} />
                  <div className={`w-9 h-5 rounded-full transition-colors ${nrEnabled ? 'bg-[var(--coral)]' : 'bg-[var(--warm-border)]'}`} />
                  <div className={`absolute left-0.5 top-0.5 w-4 h-4 bg-[var(--cream)] rounded-full shadow transition-transform ${nrEnabled ? 'translate-x-4' : ''}`} />
                </label>
              </div>
              {nrEnabled && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">비거주 월이용료</label>
                    <MoneyInput name="nonResidentRent" defaultValue={editRoom.nonResidentRent ?? undefined} placeholder="0원" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">예약 이용료 <span className="text-[var(--warm-muted)]">(선택)</span></label>
                      <MoneyInput name="nonResidentScheduled" defaultValue={editRoom.nonResidentScheduled ?? undefined} placeholder="미설정" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일</label>
                      <DatePicker name="nonResidentRentDate" value={nrDateVal} onChange={setNrDateVal}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">고른 날짜가 속한 달분부터 적용됩니다.</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField label="창문 타입" name="windowType" options={windowTypeOptions}
                value={editWindowType} onChange={v => { setEditWindowType(v); suggestEdit(editType, editTier, v) }}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
              <SelectField label="방향" name="direction" options={directionOptions} defaultValue={editRoom.direction ?? ''}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
            </div>
            <AreaInput defaultPyeong={editRoom.areaPyeong} defaultM2={editRoom.areaM2} />
            <Field label="메모" name="memo" defaultValue={editRoom.memo ?? ''} />

            {/* 방 특성 (2026-07-06, 운영자 요청 — 415 창고·사무실 사례) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">방 특성</label>
              <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer">
                <input type="checkbox" name="noMoveInReport" value="1" defaultChecked={editRoom.noMoveInReport}
                  className="w-3.5 h-3.5 accent-[var(--coral)]" />
                전입신고 불가 <span className="text-[var(--warm-muted)]">(등록 시 경고 + 카드에 표시)</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer">
                <input type="checkbox" defaultChecked={!editRoom.nonResidentVacant}
                  onChange={e => { const h = e.currentTarget.form?.elements.namedItem('nonResidentVacant') as HTMLInputElement | null; if (h) h.value = e.currentTarget.checked ? '0' : '1' }}
                  className="w-3.5 h-3.5 accent-[var(--coral)]" />
                공실 집계에서 제외 <span className="text-[var(--warm-muted)]">(창고·사무실 등 거주용이 아닌 방, 홈·리포트 공실 수에서 빠짐)</span>
              </label>
              <input type="hidden" name="nonResidentVacant" defaultValue={editRoom.nonResidentVacant ? '1' : '0'} />
              {/* 단독 계약 불가 (2026-08-13, 다호실 2단계). 체크가 곧 standaloneLeaseAllowed=false 라
                  위 '공실 집계에서 제외'와 같은 반전 문법이다 — 체크박스에 name 을 두지 않고 형제
                  hidden 의 값을 갈아끼운다. 되돌리기는 체크 해제 후 저장이다(설정 하나, 즉시 복귀). */}
              <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer">
                <input type="checkbox" defaultChecked={!editRoom.standaloneLeaseAllowed}
                  onChange={e => { const h = e.currentTarget.form?.elements.namedItem('standaloneLeaseAllowed') as HTMLInputElement | null; if (h) h.value = e.currentTarget.checked ? '0' : '1' }}
                  className="w-3.5 h-3.5 accent-[var(--coral)]" />
                이 방은 단독 계약이 불가합니다 <span className="text-[var(--warm-muted)]">(다른 계약에 묶어야 하는 방, 계약 저장 때 메인 계약을 골라야 함)</span>
              </label>
              <input type="hidden" name="standaloneLeaseAllowed" defaultValue={editRoom.standaloneLeaseAllowed ? '1' : '0'} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--warm-mid)]">사진</label>
                <div className="flex items-center gap-3">
                  {/* 순서 편집(오류신고 8dba0177) — 첫 번째 사진이 호실 카드 대표. 헤더 형제('+ 사진 추가')와 같은 텍스트 버튼 문법 */}
                  {editPhotos.length >= 2 && (
                    <button type="button" onClick={() => setPhotoOrderMode(v => !v)}
                      className="text-xs text-[var(--coral)] transition-colors">
                      {photoOrderMode ? '완료' : '순서 편집'}
                    </button>
                  )}
                  {!photoOrderMode && (
                    <button type="button" onClick={() => photoInputRef.current?.click()}
                      disabled={photoUploading}
                      className="text-xs text-[var(--coral)] hover:text-[var(--coral)] transition-colors disabled:opacity-50">
                      {photoUploading ? '업로드 중…' : '+ 사진 추가'}
                    </button>
                  )}
                </div>
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={handlePhotoUpload} />
              </div>
              {photoOrderMode ? (
                <>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">오른쪽 손잡이를 잡아 끌어 순서를 바꿉니다. 첫 번째 사진이 호실 카드의 대표 이미지가 됩니다.</p>
                  <div data-photo-drag-list className="space-y-1.5">
                    {editPhotos.map((photo, idx) => (
                      <div key={photo.id}
                        className={`flex items-center gap-2 min-h-[44px] rounded-xl border bg-[var(--cream)] pl-1.5 pr-1 py-1 ${dragPhotoIdx === idx ? 'border-[var(--coral)] shadow-lift select-none' : 'border-[var(--warm-border)]'}`}>
                        <img src={photo.storageUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                        {idx === 0 && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-[var(--coral)] text-[var(--on-solid)] text-[0.65625rem] font-bold">대표</span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--warm-dark)]">{photo.fileName ?? '사진'}</span>
                        {/* 드래그는 오른쪽 44pt 손잡이에서만 — 행 몸통에 걸면 스크롤 터치가 순서를 바꿔버림(비품 정본과 동일) */}
                        <button type="button" aria-label={`${photo.fileName ?? '사진'} 순서 이동`}
                          onPointerDown={onPhotoHandleDown(idx)}
                          onPointerMove={onPhotoHandleMove}
                          onPointerUp={onPhotoHandleUp}
                          onPointerCancel={onPhotoHandleUp}
                          style={{ touchAction: 'none' }}
                          className="shrink-0 flex items-center justify-center w-11 h-11 rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] cursor-grab active:cursor-grabbing">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : editPhotos.length > 0 ? (() => {
                // 대표 = 공개(showOnSite)·비360 중 첫 장. 비공개로 내리면 자동으로 다음 공개 사진이 대표가 된다.
                const mainId = editPhotos.find(p => (p.showOnSite ?? true) && !(p.is360 ?? looksLike360(p.fileName)))?.id
                return (
                <div className="grid grid-cols-3 gap-2">
                  {editPhotos.map((photo) => {
                    const shown = photo.showOnSite ?? true
                    const photoIs360 = photo.is360 ?? looksLike360(photo.fileName)
                    return (
                    <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--canvas)]">
                      <img src={photo.storageUrl} alt={photo.fileName ?? ''}
                        onClick={() => setViewPhoto(photo)}
                        className={`w-full h-full object-cover cursor-zoom-in transition-opacity ${shown ? '' : 'opacity-40'}`} />
                      {/* 대표 배지 — 공개·비360 첫 장 = 호실 카드 썸네일. 삭제(우상)·360°(좌하)·공개토글(우하)과 자리 안 겹침 */}
                      {photo.id === mainId && editPhotos.length > 1 && (
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-[var(--coral)] text-[var(--on-solid)] text-[0.65625rem] font-bold pointer-events-none">대표</span>
                      )}
                      {photoIs360 && (
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-black/65 text-white text-[0.65625rem] font-bold pointer-events-none">360°</span>
                      )}
                      {/* 공개/비공개 토글 — 눈 아이콘. 비공개면 눈 감김 + 사진 흐리게(dim). 방 공개가 켜졌을 때 노출 대상 */}
                      <button type="button" onClick={() => handleTogglePhotoShow(photo.id, !shown)}
                        aria-label={shown ? '소개 페이지에서 숨기기' : '소개 페이지에 표시'}
                        title={shown ? '공개 중 · 눌러서 숨김' : '숨김 · 눌러서 공개'}
                        className={`absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${shown ? 'bg-[var(--coral)]/85 text-[var(--on-solid)]' : 'bg-black/60 text-white/80'}`}>
                        {shown ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.9 5.1A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.3 3.9M6.1 6.1A15 15 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4-.9M3 3l18 18"/></svg>
                        )}
                      </button>
                      <button type="button" onClick={() => handlePhotoDelete(photo.id)} aria-label="사진 삭제"
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 hover:bg-[var(--danger-solid)]/80 rounded-full text-white transition-colors flex items-center justify-center">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                    )
                  })}
                  {photoUploading && (
                    <div className="aspect-square rounded-lg bg-[var(--canvas)] flex flex-col items-center justify-center gap-1">
                      <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                      {photoProgress && (
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">{photoProgress.percent}%</span>
                      )}
                    </div>
                  )}
                </div>
                )
              })() : (
                <div onClick={() => photoInputRef.current?.click()}
                  className="h-20 border border-dashed border-[var(--warm-border)] rounded-xl flex items-center justify-center cursor-pointer hover:border-[var(--warm-border)] transition-colors">
                  {photoUploading
                    ? <div className="flex flex-col items-center gap-1">
                        <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                        {photoProgress && (
                          <span className="text-[0.65625rem] text-[var(--warm-muted)]">{photoProgress.percent}%</span>
                        )}
                      </div>
                    : <p className="text-xs text-[var(--warm-muted)]">클릭하여 사진 업로드</p>}
                </div>
              )}
              {photoProgress && photoProgress.total > 1 && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)] text-right">
                  업로드 중 ({photoProgress.current}/{photoProgress.total}) · {photoProgress.percent}%
                </p>
              )}
              {/* 소개 페이지 공개 토글 — 사진이 있을 때만. 공실 여부와 무관하게 운영자가 직접 켜고 끈다. */}
              {editPhotos.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1.5">
                  <label className={`flex items-center gap-2 text-xs text-[var(--warm-dark)] ${showOnSitePending ? 'opacity-50' : 'cursor-pointer'}`}>
                    <input type="checkbox" checked={showOnSiteVal} onChange={handleToggleShowOnSite} disabled={showOnSitePending}
                      className="w-3.5 h-3.5 accent-[var(--coral)]" />
                    이 방 사진을 소개 페이지에 공개 <span className="text-[var(--warm-muted)]">(공실과 무관하게 직접 켜고 끕니다)</span>
                  </label>
                  <InfoHint title="공개 전 확인">
                    <span className="whitespace-pre-line">
                      {'공개하기 전에 이 다섯 가지를 확인해 주세요.\n\n'}
                      {'1. 폰 밝기를 절반으로 낮춰도 방 구석이 보이나요.\n'}
                      {'2. 흰 벽이나 침구가 초록·파랑으로 보이지 않나요.\n'}
                      {'3. 사람, 거울에 비친 촬영자, 남의 물건이 없나요.\n'}
                      {'4. 문틀·창틀 세로선이 반듯한가요.\n'}
                      {'5. 방문한 사람이 사진과 다르다고 할 요소가 없나요.'}
                    </span>
                  </InfoHint>
                </div>
              )}
              {editPhotos.length > 1 && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">사진마다 눈 아이콘으로 공개·숨김을 정할 수 있어요. 공개 중 첫 사진이 대표(호실 카드 썸네일)가 됩니다.</p>
              )}
            </div>

            {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Btn type="button" variant="secondary" onClick={closeEdit} fullWidth>취소</Btn>
              <Btn type="submit" variant="primary" disabled={isPending} fullWidth>
                {isPending ? '저장 중…' : '저장'}
              </Btn>
            </div>
          </form>
        </Modal>
      )}

      {/* 큰 사진 / 360 뷰어 lightbox — 대표가 아닌 사진이면 '대표로 설정' 제공(오류신고 8dba0177) */}
      {viewPhoto && (
        <PhotoLightbox photo={viewPhoto} onClose={() => setViewPhoto(null)}
          onSetMain={editPhotos.length > 1 && editPhotos[0]?.id !== viewPhoto.id
            ? () => { void handleSetMainPhoto(viewPhoto) }
            : undefined}
          onToggle360={next => handleTogglePhotoIs360(viewPhoto.id, next)} />
      )}

      {showPropPhotos && <PropertyPhotosManager onClose={() => setShowPropPhotos(false)} />}

    </div>
  )
}

// ── 호실 일괄 편집 모달 ──────────────────────────────────────────

function BatchEditRoomsModal({ selectedIds, roomTypes, roomTiers, windowTypeOptions, directionOptions, onClose, onDone }: {
  selectedIds: string[]
  roomTypes: string[]
  roomTiers: string[]
  windowTypeOptions: { value: string; label: string }[]
  directionOptions: { value: string; label: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const [type, setType]             = useState('')
  const [tier, setTier]             = useState('')
  const [baseRent, setBaseRent]     = useState<number | undefined>(undefined)
  const [scheduledRent, setScheduledRent] = useState<number | undefined>(undefined)
  const [rentUpdateDateVal, setRentUpdateDateVal] = useState('')
  const [clearScheduled, setClearScheduled] = useState(false)
  const [windowType, setWindowType] = useState('')
  const [direction, setDirection]   = useState('')
  const [pending, setPending]       = useState(false)
  const [error, setError]           = useState('')

  const handleApply = async () => {
    const data: Parameters<typeof batchUpdateRooms>[1] = {}
    if (type) data.type = type
    if (tier) data.tier = tier
    if (baseRent != null) data.baseRent = baseRent
    if (clearScheduled) data.scheduledRent = null
    else if (scheduledRent != null) {
      if (!rentUpdateDateVal) { setError('예약이용료를 설정하려면 적용 예정일을 함께 지정하세요. (적용일이 없으면 적용되지 않습니다)'); return }
      data.scheduledRent = scheduledRent
      data.rentUpdateDate = new Date(rentUpdateDateVal)
    }
    if (windowType) data.windowType = windowType
    if (direction)  data.direction  = direction

    if (Object.keys(data).length === 0) { setError('변경할 항목을 하나 이상 입력하세요.'); return }

    setPending(true); setError('')
    const res = await batchUpdateRooms(selectedIds, data)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    {
      const u = res.undo
      pushToast('success', `${res.count}개 호실 업데이트 완료`, {
        action: { label: '적용취소', run: () => { void undoBatchUpdateRooms(u).then(r => { if (r.ok) pushToast('info', '일괄 수정을 적용취소했습니다 (동기화된 계약 임대료 포함 복원)'); else pushToast('error', r.error) }) } },
      })
    }
    if ((res.skippedNegotiated ?? 0) > 0) {
      pushToast('info', `협의 임대료(기준가와 다른 금액) 계약 ${res.skippedNegotiated}건은 덮어쓰지 않았습니다. 필요하면 입주자 관리에서 개별 변경하세요.`)
    }
    onDone()
  }

  return (
    <Modal title={`호실 일괄 편집 (${selectedIds.length}개)`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--warm-muted)]">입력하지 않은 항목은 변경되지 않습니다.</p>
        {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
          <div className="flex gap-1 flex-wrap">
            {['미변경', ...roomTypes].map(t => (
              <button key={t} type="button"
                onClick={() => setType(t === '미변경' ? '' : t)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${(t === '미변경' && !type) || type === t ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-mid)] border-[var(--warm-border)]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">등급</label>
          <div className="flex gap-1 flex-wrap">
            {['미변경', ...roomTiers].map(t => (
              <button key={t} type="button"
                onClick={() => setTier(t === '미변경' ? '' : t)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${(t === '미변경' && !tier) || tier === t ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-mid)] border-[var(--warm-border)]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">기본이용료</label>
            <MoneyInput value={baseRent} onChange={setBaseRent} placeholder="미변경" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">예약이용료</label>
            <div className={clearScheduled ? 'opacity-40 pointer-events-none' : ''}>
              <MoneyInput value={scheduledRent} onChange={setScheduledRent} placeholder="미변경" />
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={clearScheduled} onChange={e => { setClearScheduled(e.target.checked); if (e.target.checked) setScheduledRent(undefined) }} className="rounded" />
              <span className="text-[0.65625rem] text-[var(--warm-muted)]">예약이용료 삭제</span>
            </label>
          </div>
        </div>

        {!clearScheduled && scheduledRent != null && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일 <span className="text-[var(--danger-fg)]">*</span> <span className="text-[var(--warm-muted)]">(없으면 적용 안 됨)</span></label>
            <DatePicker name="batchRentUpdateDate" value={rentUpdateDateVal} onChange={setRentUpdateDateVal}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">고른 날짜가 속한 달분부터 적용됩니다.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">창문 타입</label>
            <select value={windowType} onChange={e => setWindowType(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="">미변경</option>
              {windowTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">방향</label>
            <select value={direction} onChange={e => setDirection(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="">미변경</option>
              {directionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={onClose}>
            취소
          </Btn>
          <Btn type="button" variant="primary" size="md" className="flex-1 font-semibold" onClick={handleApply} disabled={pending}>
            {pending ? '적용 중…' : '적용'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────

// 이 파일 폼 모달 셋(호실 등록·수정·일괄 편집)의 얇은 래퍼. 본문 여백은 얹지 않는다 —
// SharedModal 이 이미 §13 기본값(px-5 sm:px-6 py-4)을 주므로 여기서 한 겹 더 주면 이중 여백이다.
// 320px 에서 좌우 40px 을 폼에서 빼앗아 2열 칸이 98px 까지 좁아지던 자리였다(§13).
function Modal({ title, children, onClose }: {
  title: string; children: React.ReactNode; onClose: () => void
}) {
  return (
    <SharedModal open onClose={onClose} title={title} width="md">
      {children}
    </SharedModal>
  )
}

function Field({ label, name, placeholder, defaultValue }: {
  label: string; name: string; placeholder?: string; defaultValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" name={name} defaultValue={defaultValue} placeholder={placeholder}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)] transition-colors" />
    </div>
  )
}

function SelectField({ label, name, options, defaultValue, hint, value, onChange }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; hint?: string
  value?: string; onChange?: (v: string) => void   // 넘기면 controlled(자동제안 연동), 없으면 기존 uncontrolled
}) {
  const controlled = onChange !== undefined
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <select name={name}
        {...(controlled ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) } : { defaultValue: defaultValue ?? '' })}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-[0.65625rem] text-[var(--warm-muted)]">{hint}</p>}
    </div>
  )
}

