'use client'

// kind='tenant' 의 body 조합 — 위젯들을 한 화면 스크롤로 배치.
// Phase 2.3b: 표시 위주 (기본·연락처·계약·추가·메모·계약서 파일 + 수납 요약 + AI 분석).
// 상태 전환 / 납입일 변경 / 편집 / 요청·컴플레인 CRUD 는 /tenants?tenantId=X 로 딥링크.

import { useEffect, useState, useTransition } from 'react'
import { unpaidForLease, billedForLease } from '@/lib/billing'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getTenantDetail } from '@/app/(app)/rooms/actions'
import { analyzeTenantWithGemini, undoRentRefund, undoDepositReturn, getDepositRefundForLease,
  getRoomScheduleState, undoRoomSchedule, clearRoomSchedulePlan, getRoomBusyNotice } from '@/app/(app)/tenants/actions'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { askRoomBusy } from '@/components/tenant/roomBusyPrompt'
import { RoomScheduleSheet } from '@/components/tenant/RoomScheduleSheet'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Btn } from '@/components/ui/Btn'
import { STATUS_LABEL, statusException } from '@/lib/statusColors'
import { TenantBasicInfo } from '../widgets/TenantBasicInfo'
import { ShortStayInfoWidget } from '../widgets/ShortStayInfoWidget'
import { TenantContactInfo } from '../widgets/TenantContactInfo'
import { TenantContractInfo } from '../widgets/TenantContractInfo'
import { TenantWishRooms } from '../widgets/TenantWishRooms'
import { TenantAdditionalInfo } from '../widgets/TenantAdditionalInfo'
import { ContractFilesPanel } from '../widgets/ContractFilesPanel'
import { TenantStatusTransitions } from '../widgets/TenantStatusTransitions'
import { TenantRequestsTab } from '../widgets/TenantRequestsTab'
import { TenantMoveHistory } from '../widgets/TenantMoveHistory'
import { TenantStatusHistory } from '../widgets/TenantStatusHistory'
import { Section } from '../widgets/Section'
import { resolveReservationDepositMode } from '@/lib/reservationDeposit'
import { parseShortStayPolicy } from '@/lib/shortStay'
import { primaryTenantLease, CONTRACT_ISSUE_STATUSES, TENANT_LIST_STATUSES } from '@/lib/leaseStatus'
import { withheldPartsLabel } from '@/lib/depositComposition'
import { fmtRoomNo } from '@/lib/roomNo'

// 보증금 환불 스냅샷 타입 — 서버 정본에서 파생한다(손으로 나열하면 분해 필드가 늘 때 갈린다).
type DepositRefundInfo = NonNullable<Awaited<ReturnType<typeof getDepositRefundForLease>>>
type RoomScheduleInfo = NonNullable<Awaited<ReturnType<typeof getRoomScheduleState>>>
type RoomBusyInfo = NonNullable<Awaited<ReturnType<typeof getRoomBusyNotice>>>

type TenantDetail = NonNullable<Awaited<ReturnType<typeof getTenantDetail>>>

export function TenantBody({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  // 보증금 환불 스냅샷 — 형제(이용료 환불)처럼 첫 페인트에 함께 그려야 본문이 뒤늦게 밀리지 않고,
  // refresh() 로도 재조회돼 '방금 기록한 환불을 바로 되돌리는' 주 시나리오가 막히지 않는다(디자이너 패스).
  const [depoRefund, setDepoRefund] = useState<DepositRefundInfo | null>(null)
  // 호실 일정 현황 — 일정을 쓰는 계약일 때만 값이 온다(§16 상시 진입점).
  const [schedule, setSchedule] = useState<RoomScheduleInfo | null>(null)
  // 입주일에 계약 호실이 아직 차 있다 — 저장 직후 팝업은 놓칠 수 있어 여기 상시로 세운다.
  const [roomBusy, setRoomBusy] = useState<RoomBusyInfo | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let active = true
    getTenantDetail(tenantId).then(d => { if (active && d) setTenant(d as TenantDetail) })
    return () => { active = false }
  }, [tenantId, reloadKey])
  const leaseIdForRefund = (tenant ? primaryTenantLease(tenant.leaseTerms) : undefined)?.id ?? null
  useEffect(() => {
    if (!leaseIdForRefund) { setDepoRefund(null); return }
    let active = true
    getDepositRefundForLease(leaseIdForRefund).then(r => { if (active) setDepoRefund(r) })
    getRoomScheduleState(leaseIdForRefund).then(r => { if (active) setSchedule(r) })
    getRoomBusyNotice(leaseIdForRefund).then(r => { if (active) setRoomBusy(r) })
    return () => { active = false }
  }, [leaseIdForRefund, reloadKey])
  const refresh = () => setReloadKey(k => k + 1)

  if (!tenant) return <SkeletonRows rows={5} className="py-4" />

  // 메인 계약 — 상세 본문 전체가 이 하나를 그린다(부계약은 4단계의 '추가 계약' 줄이 받는다).
  const lease = primaryTenantLease(tenant.leaseTerms)
  const status = lease?.status ?? ''

  return (
    <div className="space-y-5">
      {/* 상태 칩 — 헤더 제목 옆에 두지 않고 본문 최상단에 (셸 제목은 호실·이름) */}
      {status && <StatusInline status={status} confirmed={!!lease?.reservationConfirmedAt} hasTourDate={!!lease?.tourDate} />}

      {/* 상태 전환 (다음 단계 버튼) — 가능한 전환이 없으면 자동 숨김 */}
      {lease && (
        <TenantStatusTransitions
          lease={{
            id: lease.id, status: lease.status, depositAmount: lease.depositAmount, cleaningFee: lease.cleaningFee,
            moveInDate: lease.moveInDate, expectedMoveOut: lease.expectedMoveOut, rentAmount: lease.rentAmount,
            dueDay: lease.dueDay, isShortTerm: lease.isShortTerm,
            reservationConfirmedAt: lease.reservationConfirmedAt, roomId: lease.room?.id ?? null,
            reservationDepositMode: resolveReservationDepositMode(
              lease.reservationDepositMode, lease.property?.reservationDepositMode, lease.isShortTerm,
              parseShortStayPolicy(lease.property?.shortStayPolicy).reservationMode,
            ),
          }}
          tenantId={tenant.id}
          tenantName={tenant.name}
          // 이 계약에 딸린 진행 중 계약 — 퇴실·취소 확인창이 '함께 정리되지 않는다'고 말할 근거다.
          // 술어는 아래 '추가 계약' 줄(TenantBasicInfo)과 같은 한 벌이되, 거기는 '메인이 아닌 계약'을
          // 세고 여기는 '이 계약에 묶인 계약'을 센다. 조회가 CHECKED_OUT 을 안 실어 오므로
          // 죽은 계약은 애초에 후보에 없다(취소만 걸러 낸다).
          subLeases={tenant.leaseTerms
            .filter(l => l.parentLeaseTermId === lease.id && (TENANT_LIST_STATUSES as string[]).includes(l.status))
            .map(l => ({ id: l.id, roomNo: l.room?.roomNo ?? null }))}
          onChange={refresh}
        />
      )}

      <TenantBasicInfo tenant={tenant} />
      <TenantContactInfo tenantId={tenant.id} contacts={tenant.contacts} email={tenant.email} />
      {lease && <TenantContractInfo lease={lease} />}
      {/* 입주 가능한 방 — 아직 방이 없는 리드에게만. 조건(계약 정보) 바로 아래에 두는 것은
          "이 조건이면 어느 방이 되는가"가 그 조건을 읽은 다음의 질문이기 때문이다. */}
      {lease && <TenantWishRooms lease={lease} />}
      {/* 계약서 파일 — 계약 정보(조건) 바로 아래. 조건과 그 조건을 담은 서류가 한 쌍이고,
          서명 완료·발급 전 상태에서 홈 알림을 끄러 들어왔을 때 발급 버튼에 스크롤 없이 닿아야 한다.
          운영자 확정(2026-08-01). 종전에는 메모 아래였고, 그 때문에 모달 하단에 '계약서 출력'
          버튼이 따로 있었다(중복 접점 — 함께 제거). */}
      <Section title="계약서 파일">
        {/* leaseTermId — 이 본문이 그리고 있는 계약(메인). 서명 요청이 이 값을 실어 화면과 스냅샷이
            같은 계약을 가리킨다. 계약이 하나뿐인 사람에게는 추론과 같은 답이라 종전과 동일하다. */}
        <ContractFilesPanel tenantId={tenant.id} tenantName={tenant.name} leaseTermId={lease?.id ?? null}
          extraLeases={tenant.leaseTerms
            // 딸린 계약은 제 계약서 버튼을 갖지 않는다 — 그 계약의 종이는 부모 한 장이고,
            // 여기 버튼을 남기면 같은 방이 두 장으로 나가는 길이 열린다(발급 자체도 서버가 막는다).
            .filter(l => l.id !== lease?.id && !l.parentLeaseTermId && (CONTRACT_ISSUE_STATUSES as string[]).includes(l.status))
            .map(l => ({ id: l.id, roomNo: l.room?.roomNo ?? null }))} />
      </Section>
      {/* 이사 이력 — 방을 옮긴 적이 있을 때만(구간 2개 이상) 나타난다 */}
      <TenantMoveHistory tenantId={tenant.id} />
      {/* 상태 이력 — 언제 어디서 어디로 바뀌었나, 입실 취소·퇴실 사유(신고 ad517231).
          이사 이력 바로 아래에 둔다. 둘 다 이력이고, 아래 적용취소 행보다 먼저 "무슨 일이 있었나"를 읽는다. */}
      <TenantStatusHistory tenantId={tenant.id} />
      {/* 환불 확정 적용취소 — 상시 진입점(§16, 토스트가 사라져도 여기서 항상 가능).
          성격이 같은 두 행이라 한 래퍼로 묶는다(디자이너 패스). */}
      {lease && (() => {
        const undoObj = lease.checkoutProrationUndo as { refund?: { refunded: number; month: string } } | null
        const snap = undoObj?.refund
        if (!snap && !depoRefund && !schedule && !roomBusy) return null
        return (
          <div className="space-y-1.5">
            {snap && <RentRefundUndoRow leaseTermId={lease.id} refunded={snap.refunded} month={snap.month} onDone={refresh} />}
            {depoRefund && <DepositRefundUndoRow info={depoRefund} onDone={refresh} />}
            {schedule && <RoomScheduleRow leaseTermId={lease.id} tenantName={tenant.name} info={schedule} onDone={refresh} />}
            {roomBusy && <RoomBusyRow leaseTermId={lease.id} tenantName={tenant.name} info={roomBusy} onDone={refresh} />}
          </div>
        )
      })()}
      {/* 단기 희망 입주자 — 기간·방 컨디션별 요금 박스(운영자 확정 2026-07-10 a안) */}
      {lease && lease.isShortTerm && <ShortStayInfoWidget lease={lease} tenantId={tenant.id} tenantName={tenant.name} onChange={refresh} />}
      {lease && <TenantAdditionalInfo lease={lease} />}

      {tenant.memo && (
        <Section title="메모">
          <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap">{tenant.memo}</p>
        </Section>
      )}

      <TenantRequestsTab tenantId={tenant.id} />

      {lease && lease.paymentRecords.length > 0 && (
        <PaymentSummaryWithAI tenantId={tenant.id} lease={lease} />
      )}
    </div>
  )
}

// 보증금 환불 확정 표시 + 상시 적용취소 — 기록이 있을 때만 나타난다(B페이즈).
// 용어는 화면 표면 기준 '환불'로 통일한다(서버 함수명은 recordDepositReturn 이지만 사용자 문구는 환불).
function DepositRefundUndoRow({ info, onDone }: {
  info: DepositRefundInfo
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const allWithheld = info.returned === 0 && info.withheld > 0
  const partsLabel = withheldPartsLabel(info.parts, fmtWon)
  const handleUndo = async () => {
    const ok = await confirmDialog({
      title: '보증금 환불 기록을 적용취소할까요?',
      // 미반환분은 성격대로 최대 2행이라 무엇이 사라지는지 카테고리까지 말한다(가이드 §14).
      message: info.withheld > 0
        ? `환불 ${fmtWon(info.returned)} · 미환불 ${fmtWon(info.withheld)} 기록을 지웁니다. 미환불분으로 잡힌 부가수익(${partsLabel ?? '보증금 몰취'})도 함께 사라집니다.`
        : `환불 ${fmtWon(info.returned)} 기록을 지웁니다.`,
      level: 'caution', confirmLabel: '적용취소',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await undoDepositReturn(info.refundId, info.extraIncomeIds)
      if (r.ok) { pushToast('info', '보증금 환불을 적용취소했습니다.'); onDone() }
      else pushToast('error', r.error)
    })
  }
  return (
    <div className="flex items-center justify-between gap-2 bg-[var(--canvas)] rounded-lg px-3 py-2 text-xs">
      <p className="text-[var(--warm-mid)]">
        {allWithheld
          ? <>보증금 전액 미환불 · <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(info.withheld)}</span>{info.reason ? ` (${info.reason})` : ''}</>
          : <>보증금 환불 확정 · <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(info.returned)}</span> 환불
              {info.withheld > 0 && <> · 미환불 <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(info.withheld)}</span></>}</>}
      </p>
      <button type="button" onClick={handleUndo} disabled={pending}
        className="shrink-0 text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40 transition-colors disabled:opacity-50">
        {pending ? '취소 중…' : '적용취소'}
      </button>
    </div>
  )
}

// 중도퇴실 환불 확정 표시 + 상시 적용취소 — 스냅샷은 서버(checkoutProrationUndo.refund)에 영속
function RentRefundUndoRow({ leaseTermId, refunded, month, onDone }: {
  leaseTermId: string; refunded: number; month: string; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const handleUndo = async () => {
    const ok = await confirmDialog({
      title: '이용료 환불을 적용취소할까요?',
      message: '원래 수납 기록을 복원하고 청구를 환불 전 상태로 되돌립니다.',
      confirmLabel: '적용취소',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await undoRentRefund(leaseTermId)
      if (r.ok) { pushToast('info', '이용료 환불을 적용취소했습니다.'); onDone() }
      else pushToast('error', r.error)
    })
  }
  return (
    <div className="flex items-center justify-between gap-2 bg-[var(--canvas)] rounded-lg px-3 py-2 text-xs">
      <p className="text-[var(--warm-mid)]">
        중도퇴실 환불 확정 · {Number(month.slice(5, 7))}월 이용료 <span className="tabular-nums text-[var(--warm-dark)]">{fmtWon(refunded)}</span> 환불
      </p>
      <button type="button" onClick={handleUndo} disabled={pending}
        className="shrink-0 text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40 transition-colors disabled:opacity-50">
        {pending ? '취소 중…' : '적용취소'}
      </button>
    </div>
  )
}

// 입주일에 계약 호실이 아직 차 있다 — 상황이 살아 있는 동안 상시로 선다.
//
// 저장 직후 팝업만 두면 놓친다. 실측(2026-08-26)에서 운영자가 한 번 보고 그 뒤로 못 봤고,
// 왜 안 떴는지 재현되지 않았다. 화면에 계속 서 있으면 그 타이밍에 안 걸린다.
// 일정을 잡거나 날짜를 물리면 조건이 풀려 이 행이 저절로 사라진다.
function RoomBusyRow({ leaseTermId, tenantName, info, onDone }: {
  leaseTermId: string; tenantName: string; info: RoomBusyInfo; onDone: () => void
}) {
  const entityModal = useEntityModal()
  const [planOpen, setPlanOpen] = useState(false)
  const ask = async () => {
    const pick = await askRoomBusy(info)
    if (pick === 'plan') setPlanOpen(true)
    else if (pick === 'occupant' && info.occupantTenantId) {
      entityModal.open({ kind: 'tenant', tenantId: info.occupantTenantId })
    }
  }
  return (
    <>
      <div className="flex items-center justify-between gap-2 bg-[var(--warning-bg)] rounded-lg px-3 py-2 text-xs">
        <p className="min-w-0 text-[var(--warning-fg)]">
          {info.sameDayHandover
            ? <>{fmtRoomNo(info.roomNo, '')} 퇴실일과 입주일이 같습니다 (<span className="font-semibold">{fmtDate(info.moveInYmd)}</span>{info.occupantName ? ` · ${info.occupantName}님 퇴실` : ''})</>
            : info.freeFrom
              ? <>{fmtRoomNo(info.roomNo, '')}는 <span className="font-semibold">{fmtDate(info.freeFrom)}</span>부터 입주 가능합니다. 입주일 {fmtDate(info.moveInYmd)}에는 들어갈 수 없습니다</>
              : <>{fmtRoomNo(info.roomNo, '')}의 입주 가능일이 정해지지 않았습니다{info.occupantName ? ` (${info.occupantName}님 퇴실 예정일 없음)` : ''}</>}
        </p>
        <button type="button" onClick={() => void ask()}
          className="shrink-0 text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warning-fg)]/40 text-[var(--warning-fg)] hover:bg-[var(--warning-fg)]/10 transition-colors">
          {info.freeFrom ? '임시 호실 정하기' : '퇴실일 정하기'}
        </button>
      </div>
      {planOpen && (
        <RoomScheduleSheet leaseTermId={leaseTermId} tenantName={tenantName} mode="plan"
          onClose={() => setPlanOpen(false)}
          onDone={() => { setPlanOpen(false); onDone() }} />
      )}
    </>
  )
}

// 호실 일정 + 상시 적용취소 — 기간마다 다른 방에 머무는 계약에만 선다.
//
// 이동 자체에는 되돌릴 것이 없다. 일정이 진실이고 구간은 그 파생이라, 방이 옮겨진 것은
// 사람이 한 일이 아니라 일정이 시킨 일이다. 그래서 되돌린다는 것은 곧 **입실 처리를 무르는
// 것**이고, 예약 상태로 돌아가 일정과 구간을 함께 걷는다.
//
// 형제 두 행(이용료·보증금 환불)과 같은 문법을 쓴다 — 성격이 같은 자리라 모양이 갈리면 안 된다.
function RoomScheduleRow({ leaseTermId, tenantName, info, onDone }: {
  leaseTermId: string; tenantName: string; info: RoomScheduleInfo; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  // 다시 정하기 — 임시 호실을 402호에서 409호로 바꿀 길이 없었다(운영자 지적 2026-08-26).
  // 지우고 주황 줄에서 다시 짜는 우회로는 아무도 기억하지 못한다. 저장이 덮어쓰기라
  // (saveRoomSchedulePlan) 시트를 그대로 다시 열면 되고, 편집기는 여전히 한 벌이다.
  const [redoOpen, setRedoOpen] = useState(false)
  // 아직 안 들어온 계획이면 지우는 것이고, 이미 살고 있으면 입실 처리를 무르는 것이다.
  // 이름과 무르는 대상이 갈리면 안 된다(§16).
  const isPlan = info.stage === 'plan'
  const handleUndo = async () => {
    const ok = await confirmDialog({
      title: isPlan ? '거주 호실 일정을 지울까요?' : '입실 처리를 적용취소할까요?',
      message: isPlan
        ? '호실 일정만 지웁니다. 예약과 입주 희망일은 그대로 남습니다.'
        : '예약 상태로 되돌리고 호실 일정과 거주 구간을 지웁니다. 입주일은 그대로 남습니다.',
      level: 'caution', confirmLabel: isPlan ? '지우기' : '적용취소',
    })
    if (!ok) return
    startTransition(async () => {
      const r = isPlan ? await clearRoomSchedulePlan(leaseTermId) : await undoRoomSchedule(leaseTermId)
      if (r.ok) { pushToast('info', isPlan ? '거주 호실 일정을 지웠습니다.' : '입실 처리를 적용취소했습니다.'); onDone() }
      else pushToast('error', r.error)
    })
  }
  return (
    <div className="flex items-start justify-between gap-2 bg-[var(--canvas)] rounded-lg px-3 py-2 text-xs">
      {/* 이름이 무르는 대상과 같아야 한다 — 계획은 지우는 것이고 실제는 입실 처리를 무르는 것이다(§16).
          용어는 계약서 5절과 같은 '거주 호실 일정' 하나다. 화면과 종이가 다른 말을 쓰면 안 된다. */}
      <div className="min-w-0">
        <p className="text-[var(--warm-mid)]">{isPlan ? '거주 호실 일정' : '입실 처리 · 거주 호실 일정'}</p>
        <ul className="mt-1 space-y-0.5 text-[var(--warm-dark)] tabular-nums">
          {info.lines.map(l => <li key={l}>{l}</li>)}
        </ul>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {isPlan && (
          <button type="button" onClick={() => setRedoOpen(true)} disabled={pending}
            className="text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40 transition-colors disabled:opacity-50">
            다시 정하기
          </button>
        )}
        <button type="button" onClick={handleUndo} disabled={pending}
          className="text-[0.65625rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40 transition-colors disabled:opacity-50">
          {pending ? (isPlan ? '지우는 중…' : '취소 중…') : (isPlan ? '지우기' : '적용취소')}
        </button>
      </div>
      {redoOpen && (
        <RoomScheduleSheet leaseTermId={leaseTermId} tenantName={tenantName} mode="plan"
          onClose={() => setRedoOpen(false)}
          onDone={() => { setRedoOpen(false); onDone() }} />
      )}
    </div>
  )
}

// 파생 라벨(문의/입실 예약/예약 확정)은 목록 StatusChip과 동일 규칙 — e1b81629 용어 재정의
function StatusInline({ status, confirmed, hasTourDate }: { status: string; confirmed?: boolean; hasTourDate?: boolean }) {
  const ex = statusException(status, { hasTourDate })
  return ex
    ? <div><StatusBadge tone={ex.tone}>{status === 'RESERVED' && confirmed ? '예약 확정' : ex.label}</StatusBadge></div>
    : <div className="text-xs font-medium text-[var(--warm-mid)]">{STATUS_LABEL[status] ?? status}</div>
}

function PaymentSummaryWithAI({ tenantId, lease }: {
  tenantId: string
  // 세 플래그는 옵셔널이 아니다. 옵셔널이면 서버가 안 실어 보내도 컴파일이 통과하고,
  // 그러면 보증금이 월세로 취급돼 완납이 -5만원으로 뜬다(2026-08-04 신고, 실측 8명).
  lease: { paymentRecords: {
    targetMonth: string; expectedAmount: number; actualAmount: number; isPaid: boolean
    isDeposit: boolean | null; isPrevOwner: boolean | null; isBillingAdjust: boolean | null
  }[] }
}) {
  const payments = lease.paymentRecords
  // 청구액은 그 달 record 의 **최댓값**이다. 합으로 잡으면 나눠 낸 달이 곱해져
  // 완납인 사람이 미납으로 뜬다(신고 2026-08-02, 실측 11건 5,987,000원 부풀림).
  // 규칙은 lib/billing 정본 하나로 — 이 화면이 자기 식을 갖고 있던 것이 뿌리였다.
  const totalExpected = billedForLease(payments)
  const totalPaid     = payments.filter(p => !p.isBillingAdjust && !p.isPrevOwner).reduce((s, p) => s + p.actualAmount, 0)
  const unpaid        = unpaidForLease(payments)
  const paidMonths    = payments.filter(p => p.isPaid).length

  const [aiText, setAiText] = useState('')
  const [pending, startTransition] = useTransition()

  const handleAnalyze = () => {
    startTransition(async () => {
      setAiText('')
      try {
        const result = await analyzeTenantWithGemini(tenantId)
        setAiText(result)
      } catch {
        setAiText('분석 중 오류가 발생했습니다.')
      }
    })
  }

  return (
    <Section title="수납 분석">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center min-w-0">
          <p className="text-xs text-[var(--warm-muted)] mb-1">납부월</p>
          <p className="text-base font-bold text-[var(--success-fg)] whitespace-nowrap">{paidMonths}개월</p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center min-w-0">
          <p className="text-xs text-[var(--warm-muted)] mb-1">총 납부액</p>
          <p className="text-base font-bold text-[var(--warm-dark)] whitespace-nowrap"><MoneyDisplay amount={totalPaid} /></p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center min-w-0">
          <p className="text-xs text-[var(--warm-muted)] mb-1">미납액</p>
          <p className={`text-base font-bold whitespace-nowrap ${unpaid > 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-dark)]'}`}>
            <MoneyDisplay amount={unpaid} />
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Btn variant="primary" size="sm" onClick={handleAnalyze} disabled={pending} fullWidth className="font-semibold">
          {pending ? 'AI 분석 중…' : aiText ? '다시 분석' : 'AI로 수납 패턴 분석'}
        </Btn>
        {pending && (
          <div className="flex items-center gap-2 text-xs text-[var(--coral)] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--coral)] animate-bounce" />
            AI가 수납 패턴을 분석하고 있습니다…
          </div>
        )}
        {aiText && !pending && (
          <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap bg-[var(--canvas)] rounded-xl p-3">{aiText}</p>
        )}
      </div>
    </Section>
  )
}
