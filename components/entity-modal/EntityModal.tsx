'use client'

// Prism 셸 — 호실·고객·수납 통합 상세 모달 (전역).
// "데이터 조합으로 발현되는 뷰" — kind 에 따라 body 가 위젯 조합으로 바뀜.
// 하단 PrismNavBar 클릭은 onSelect={setKind} 로 **인플레이스 전환** — 새 모달 안 뜸 (2중 스택 X).
//
// Phase 2.2 (2026-05-30): kind='room' body 를 RoomBody 위젯 조합으로. 액션 행([삭제][수정])을 셸이 직접 처리.
// Phase 2.3 = kind='tenant' 위젯화 (TenantView 미니 잔존), Phase 2.4 = kind='payment' 요약 위젯화.

import { createContext, useContext, useEffect, useState, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { Modal } from '@/components/ui/Modal'
import { kstMonthStr } from '@/lib/kstDate'
import { getEntityLinks } from '@/app/(app)/rooms/actions'
import { deleteRoom, applyScheduledRentNow } from '@/app/(app)/room-manage/actions'
import { deleteTenant } from '@/app/(app)/tenants/actions'
import { withSave } from '@/lib/saveStatus'
import { PrismNavBar } from './PrismNavBar'
import { RoomBody } from './bodies/RoomBody'
import { TenantBody } from './bodies/TenantBody'
import { PaymentBody } from './bodies/PaymentBody'

type EntityKind = 'room' | 'tenant' | 'payment'
type Seed = { kind: EntityKind; roomId?: string | null; tenantId?: string | null; leaseTermId?: string | null }
type Links = Awaited<ReturnType<typeof getEntityLinks>>

type Ctx = { open: (seed: Seed) => void; close: () => void }
const EntityModalContext = createContext<Ctx | null>(null)

export function useEntityModal(): Ctx {
  const ctx = useContext(EntityModalContext)
  if (!ctx) return { open: () => {}, close: () => {} }
  return ctx
}

const fmtRoomNo = (no?: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '—')

export function EntityModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ kind: EntityKind; seed: Seed; links: Links } | null>(null)
  const open = useCallback((seed: Seed) => setState({ kind: seed.kind, seed, links: null }), [])
  const close = useCallback(() => setState(null), [])

  // seed 의 id 로 연결된 호실/고객/lease id 해소 (네비 가용성·제목용)
  useEffect(() => {
    if (!state || state.links) return
    let active = true
    getEntityLinks({
      roomId: state.seed.roomId ?? undefined,
      tenantId: state.seed.tenantId ?? undefined,
      leaseTermId: state.seed.leaseTermId ?? undefined,
    }).then(links => { if (active) setState(s => (s ? { ...s, links } : s)) })
    return () => { active = false }
  }, [state])

  return (
    <EntityModalContext.Provider value={{ open, close }}>
      {children}
      {state && (
        <PrismShellView
          kind={state.kind}
          links={state.links}
          setKind={k => setState(s => (s ? { ...s, kind: k } : s))}
          onClose={close}
        />
      )}
    </EntityModalContext.Provider>
  )
}

function PrismShellView({ kind, links, setKind, onClose }: {
  kind: EntityKind; links: Links; setKind: (k: EntityKind) => void; onClose: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const month = searchParams.get('month') || kstMonthStr()
  const [isPending, startTransition] = useTransition()

  const hasRoom = !!links?.roomId
  const hasTenant = !!links?.tenantId
  const hasPay = !!links?.leaseTermId
  const title = links ? `${fmtRoomNo(links.roomNo)}${links.tenantName ? ` · ${links.tenantName}` : ''}` : '불러오는 중…'

  // 호실 액션 — 셸이 직접 처리(데이터 정합).
  const handleApplyScheduledNow = () => {
    if (!links?.roomId) return
    if (!confirm(`${fmtRoomNo(links.roomNo)} 예정 가격을 즉시 적용할까요?`)) return
    startTransition(async () => {
      const res = await withSave(() => applyScheduledRentNow(links.roomId!), { success: '예정 가격 적용됨' })
      if (res.ok) router.refresh()
    })
  }
  const handleDeleteRoom = () => {
    if (!links?.roomId) return
    if (!confirm(`${fmtRoomNo(links.roomNo)} 호실을 삭제할까요? 되돌릴 수 없습니다.`)) return
    startTransition(async () => {
      const res = await withSave(() => deleteRoom(links.roomId!), { success: '삭제됨' })
      if (res.ok) { onClose(); router.refresh() }
    })
  }
  // 수정은 페이지 종속 편집 폼이 있는 /room-manage 로 위임 (Phase 2.5 에서 위젯 편집 모드로 대체 예정).
  const handleEditRoom = () => {
    if (!links?.roomId) return
    router.push(`/room-manage?roomId=${links.roomId}&edit=1`)
    onClose()
  }

  // 고객 액션 — 삭제는 셸이 직접, 편집은 페이지로 위임 (탭·상태전환·요청 CRUD 가 페이지 종속).
  const handleDeleteTenant = () => {
    if (!links?.tenantId) return
    if (!confirm(`${links.tenantName ?? '이 고객'}을 삭제할까요? 되돌릴 수 없습니다.`)) return
    startTransition(async () => {
      const res = await withSave(() => deleteTenant(links.tenantId!), { success: '삭제됨' })
      if (res.ok) { onClose(); router.refresh() }
    })
  }
  const handleEditTenant = () => {
    if (!links?.tenantId) return
    router.push(`/tenants?tenantId=${links.tenantId}&edit=1`)
    onClose()
  }

  // Phase 2.4a (2026-05-30): kind='payment' 의 '수납 관리에서 열기' 딥링크 제거.
  // PaymentBody 내부 summary→full 모드 토글이 in-place 전환 (배경 안 바뀜) — 사용자 비전.

  return (
    <Modal
      open onClose={onClose} width="sm" title={title} z={280}
      footer={
        <div className="space-y-2">
          {/* 액션 행 — kind 마다 다른 액션. PrismNavBar 위. */}
          {kind === 'room' && hasRoom && (
            <div className="flex gap-2 items-center">
              <button type="button" onClick={handleDeleteRoom} disabled={isPending}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-40">
                삭제
              </button>
              <div className="flex-1" />
              <Btn variant="primary" size="md" onClick={handleEditRoom} disabled={isPending}>
                수정
              </Btn>
            </div>
          )}
          {kind === 'tenant' && hasTenant && (
            <div className="flex gap-2 items-center">
              <button type="button" onClick={handleDeleteTenant} disabled={isPending}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-40">
                삭제
              </button>
              {links?.tenantId && (
                <a href={`/contract/${links.tenantId}`} target="_blank" rel="noreferrer"
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                  계약서 출력
                </a>
              )}
              <div className="flex-1" />
              <Btn variant="primary" size="md" onClick={handleEditTenant} disabled={isPending}>
                수정
              </Btn>
            </div>
          )}
          {/* deepLink 행 — Phase 2.4a 에서 수납 딥링크 in-place 전환으로 대체됨. 다른 kind 에 필요시 부활. */}
          {/* 공통 하단 네비 — onSelect 로 같은 셸 안에서 body 만 교체 (in-place). */}
          <PrismNavBar
            current={kind}
            onSelect={setKind}
            links={{
              roomId: links?.roomId ?? null,
              tenantId: links?.tenantId ?? null,
              leaseTermId: links?.leaseTermId ?? null,
            }}
          />
        </div>
      }
    >
      <div className="px-5 sm:px-6 py-4">
        {kind === 'room'    && (hasRoom   ? <RoomBody roomId={links!.roomId!} onApplyScheduledNow={handleApplyScheduledNow} /> : <Empty label="연결된 호실이 없습니다." />)}
        {kind === 'tenant'  && (hasTenant ? <TenantBody tenantId={links!.tenantId!} /> : <Empty label="연결된 고객이 없습니다." />)}
        {kind === 'payment' && (hasPay    ? <PaymentBody leaseTermId={links!.leaseTermId!} month={month} canEdit roomNo={links?.roomNo ?? null} /> : <Empty label="연결된 수납(계약)이 없습니다." />)}
      </div>
    </Modal>
  )
}

const Empty = ({ label }: { label: string }) => <p className="text-sm text-[var(--warm-muted)] text-center py-8">{label}</p>
// TenantView 미니 요약 → TenantBody (Phase 2.3b).
// PaymentView 미니 요약 → PaymentBody (sub-mode: summary/full) (Phase 2.4a).
