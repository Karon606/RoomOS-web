'use client'

// Prism 셸 — 호실·고객·수납 통합 상세 모달 (전역).
// "데이터 조합으로 발현되는 뷰" — kind 에 따라 body 가 위젯 조합으로 바뀜.
// 하단 PrismNavBar 클릭은 onSelect={setKind} 로 **인플레이스 전환** — 새 모달 안 뜸 (2중 스택 X).
//
// Phase 2.2 (2026-05-30): kind='room' body 를 RoomBody 위젯 조합으로. 액션 행([삭제][수정])을 셸이 직접 처리.
// Phase 2.3 = kind='tenant' 위젯화 (TenantView 미니 잔존), Phase 2.4 = kind='payment' 요약 위젯화.

import { createContext, useContext, useEffect, useState, useCallback, useRef, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { Modal } from '@/components/ui/Modal'
import { kstMonthStr } from '@/lib/kstDate'
import { getEntityLinks } from '@/app/(app)/rooms/actions'
import { deleteRoom, applyScheduledRentNow } from '@/app/(app)/room-manage/actions'
import { deleteTenant, getContractFiles } from '@/app/(app)/tenants/actions'
import { withSave } from '@/lib/saveStatus'
import { PrismNavBar } from './PrismNavBar'
import { RoomBody } from './bodies/RoomBody'
import { TenantBody } from './bodies/TenantBody'
import { PaymentBody } from './bodies/PaymentBody'

type EntityKind = 'room' | 'tenant' | 'payment'
type Seed = { kind: EntityKind; roomId?: string | null; tenantId?: string | null; leaseTermId?: string | null; openCheckoutProration?: boolean }
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
  // 모달 열기 직전의 페이지 스크롤 위치 — 닫을 때 그 위치로 복원 (router.refresh() 가
  // 페이지 상단으로 리셋시키는 문제 해결, 사용자 피드백 2026-06-01).
  const scrollYRef = useRef<number>(0)
  const open = useCallback((seed: Seed) => {
    if (typeof window !== 'undefined') scrollYRef.current = window.scrollY
    setState({ kind: seed.kind, seed, links: null })
  }, [])
  const close = useCallback(() => {
    setState(null)
    if (typeof window !== 'undefined') {
      const y = scrollYRef.current
      // router.refresh 가 redraw 후 0,0 로 리셋할 수 있어 두 번 시도 (RAF + 150ms 후)
      requestAnimationFrame(() => window.scrollTo(0, y))
      setTimeout(() => window.scrollTo(0, y), 150)
    }
  }, [])

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
          openCheckoutProration={state.seed.openCheckoutProration}
          setKind={k => setState(s => (s ? { ...s, kind: k } : s))}
          onClose={close}
        />
      )}
    </EntityModalContext.Provider>
  )
}

function PrismShellView({ kind, links, openCheckoutProration, setKind, onClose }: {
  kind: EntityKind; links: Links; openCheckoutProration?: boolean; setKind: (k: EntityKind) => void; onClose: () => void
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
  // 계약서 출력 — 스캔본이 있으면 어떤 걸 출력할지 묻는다 (3-옵션 커스텀 모달).
  // confirm 다이얼로그를 쓰면 '취소' = 시스템 계약서로 오인되므로 명시적 3-버튼 UI 필요.
  // 없으면 바로 시스템 계약서로 (기존 동작 유지).
  const [printChoice, setPrintChoice] = useState<{ scanUrl: string; fileName: string } | null>(null)
  const handlePrintContract = async () => {
    if (!links?.tenantId) return
    const systemUrl = `/contract/${links.tenantId}`
    let files: Awaited<ReturnType<typeof getContractFiles>> = []
    try { files = await getContractFiles(links.tenantId) } catch { /* 실패 시 시스템 계약서로 폴백 */ }
    if (files.length === 0) {
      window.open(systemUrl, '_blank')
      return
    }
    // 가장 최근 스캔본 (목록의 첫 번째 — 액션이 signedAt desc 로 정렬)
    const latest = files[0]
    setPrintChoice({ scanUrl: latest.viewUrl, fileName: latest.fileName ?? '스캔본' })
  }

  // Phase 2.4a (2026-05-30): kind='payment' 의 '수납 관리에서 열기' 딥링크 제거.
  // PaymentBody 내부 summary→full 모드 토글이 in-place 전환 (배경 안 바뀜) — 사용자 비전.

  return (
    <>
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
                <button type="button" onClick={handlePrintContract}
                  className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                  계약서 출력
                </button>
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
        {kind === 'payment' && (hasPay    ? <PaymentBody leaseTermId={links!.leaseTermId!} month={month} canEdit roomNo={links?.roomNo ?? null} openCheckoutProration={openCheckoutProration} /> : <Empty label="연결된 수납(계약)이 없습니다." />)}
      </div>
    </Modal>
    {/* 계약서 출력 선택 모달 — 스캔본 vs 시스템 계약서 3-옵션 (confirm 다이얼로그의
        [확인]/[취소] 패턴이 사용자 의도와 안 맞아 분리, 2026-06-01 피드백) */}
    {printChoice && (
      <div className="fixed inset-0 z-[290] flex items-center justify-center bg-black/70 p-4"
        onClick={() => setPrintChoice(null)}>
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-xs"
          onClick={e => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-[var(--warm-border)]">
            <h2 className="text-sm font-bold text-[var(--warm-dark)]">어떤 계약서를 출력할까요?</h2>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div>
              <Btn fullWidth variant="primary"
                onClick={() => { window.open(printChoice.scanUrl, '_blank'); setPrintChoice(null) }}>
                스캔본 출력
              </Btn>
              <p className="text-[0.6875rem] text-center text-[var(--warm-muted)] mt-1 truncate" title={printChoice.fileName}>
                {printChoice.fileName}
              </p>
            </div>
            <div>
              <Btn fullWidth variant="secondary"
                onClick={() => { window.open(`/contract/${links?.tenantId}`, '_blank'); setPrintChoice(null) }}>
                시스템 계약서 새로 출력
              </Btn>
              <p className="text-[0.6875rem] text-center text-[var(--warm-muted)] mt-1">
                표준 양식 — 서명 받기 포함
              </p>
            </div>
            <button type="button" onClick={() => setPrintChoice(null)}
              className="w-full pt-2 pb-1 text-xs font-medium text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors">
              취소
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

const Empty = ({ label }: { label: string }) => <p className="text-sm text-[var(--warm-muted)] text-center py-8">{label}</p>
// TenantView 미니 요약 → TenantBody (Phase 2.3b).
// PaymentView 미니 요약 → PaymentBody (sub-mode: summary/full) (Phase 2.4a).
