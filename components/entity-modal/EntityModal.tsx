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
import {
  getEntityLinks, getTenantQuickInfo, getLeaseSettlementInfo, getPaymentsByLease,
} from '@/app/(app)/rooms/actions'
import { deleteRoom, applyScheduledRentNow } from '@/app/(app)/room-manage/actions'
import { STATUS_LABEL } from '@/lib/statusColors'
import { withSave } from '@/lib/saveStatus'
import { PrismNavBar } from './PrismNavBar'
import { RoomBody } from './bodies/RoomBody'

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
const fmtWon = (n: number) => `${n.toLocaleString()}원`

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

  const deepLink =
    kind === 'tenant'  && links?.tenantId ? { href: `/tenants?tenantId=${links.tenantId}`, label: '고객 관리에서 열기' }
    : kind === 'payment' && links?.roomNo ? { href: `/rooms?month=${month}&roomNo=${links.roomNo}`, label: '수납 관리에서 열기' }
    : null

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
          {deepLink && (
            <Btn variant="secondary" size="sm" fullWidth
              onClick={() => { router.push(deepLink.href); onClose() }}>
              {deepLink.label}
            </Btn>
          )}
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
        {kind === 'tenant'  && (hasTenant ? <TenantView tenantId={links!.tenantId!} /> : <Empty label="연결된 고객이 없습니다." />)}
        {kind === 'payment' && (hasPay    ? <PaymentView leaseTermId={links!.leaseTermId!} month={month} /> : <Empty label="연결된 수납(계약)이 없습니다." />)}
      </div>
    </Modal>
  )
}

const Empty = ({ label }: { label: string }) => <p className="text-sm text-[var(--warm-muted)] text-center py-8">{label}</p>
const Loading = () => <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between py-1.5 border-b border-[var(--warm-border)]/50 last:border-0">
    <span className="text-xs text-[var(--warm-muted)]">{k}</span>
    <span className="text-sm text-[var(--warm-dark)]">{v}</span>
  </div>
)

// TenantView/PaymentView — 미니 요약(Phase 2.3/2.4 에서 위젯 조합으로 대체 예정).

function TenantView({ tenantId }: { tenantId: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getTenantQuickInfo>> | null>(null)
  useEffect(() => { let a = true; getTenantQuickInfo(tenantId).then(d => { if (a) setInfo(d) }); return () => { a = false } }, [tenantId])
  if (!info) return <Loading />
  const lease = info.leaseTerms[0]
  const primary = info.contacts[0]
  return (
    <div>
      {lease && <Row k="상태" v={STATUS_LABEL[lease.status] ?? lease.status} />}
      {lease?.room && <Row k="호실" v={fmtRoomNo(lease.room.roomNo)} />}
      {primary && <Row k="연락처" v={primary.contactValue} />}
      {info.nationality && <Row k="국적" v={info.nationality} />}
      {info.job && <Row k="직업" v={info.job} />}
      {lease && lease.rentAmount > 0 && <Row k="월 이용료" v={fmtWon(lease.rentAmount)} />}
      {lease && lease.depositAmount > 0 && <Row k="보증금" v={fmtWon(lease.depositAmount)} />}
      {info.memo && <Row k="메모" v={info.memo} />}
    </div>
  )
}

function PaymentView({ leaseTermId, month }: { leaseTermId: string; month: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getLeaseSettlementInfo>> | null>(null)
  const [records, setRecords] = useState<Awaited<ReturnType<typeof getPaymentsByLease>>['records'] | null>(null)
  useEffect(() => {
    let a = true
    getLeaseSettlementInfo(leaseTermId, month).then(d => { if (a) setInfo(d) })
    getPaymentsByLease(leaseTermId, month).then(d => { if (a) setRecords(d.records) }).catch(() => { if (a) setRecords([]) })
    return () => { a = false }
  }, [leaseTermId, month])
  if (!info) return <Loading />
  const payDateStr = (d: Date | string) => { const t = new Date(d); return `${t.getMonth() + 1}.${t.getDate()}` }
  return (
    <div className="space-y-3">
      <p className="text-[0.625rem] text-[var(--warm-muted)]">총 수납·잔액·이월액은 입금일 기준입니다. ({month.slice(0, 4)}년 {Number(month.slice(5))}월)</p>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)]">총 수납</p>
          <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]">{fmtWon(info.totalPaid)}</p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)]">잔액</p>
          <p className={`text-sm font-bold mt-0.5 ${info.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {info.balance > 0 ? `+${fmtWon(info.balance)}` : info.balance < 0 ? `-${fmtWon(Math.abs(info.balance))}` : '0원'}
          </p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)]">이월액</p>
          <p className="text-sm font-bold mt-0.5 text-[var(--coral)]">
            {info.carryOver !== 0 ? `${info.carryOver > 0 ? '+' : '-'}${fmtWon(Math.abs(info.carryOver))}` : '0원'}
          </p>
        </div>
      </div>
      <div>
        <Row k="월 이용료" v={fmtWon(info.expected)} />
        {info.dueDay && <Row k="납부일" v={info.dueDay.includes('말') ? '매월 말일' : `매월 ${info.dueDay}일`} />}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-[var(--warm-mid)]">이번 달 납부 내역</p>
        {records === null ? (
          <p className="text-xs text-[var(--warm-muted)] py-2">불러오는 중…</p>
        ) : records.length === 0 ? (
          <p className="text-xs text-[var(--warm-muted)] py-2">이 달 납부 기록이 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {records.map(r => (
              <li key={r.id} className="flex items-center justify-between bg-[var(--canvas)] rounded-lg px-3 py-2 text-xs">
                <span className="text-[var(--warm-mid)]">
                  {payDateStr(r.payDate)}
                  {r.isDeposit && <span className="ml-1.5 text-[0.5625rem] text-[var(--coral)]">보증금</span>}
                  {r.payMethod && <span className="ml-1.5 text-[var(--warm-muted)]">· {r.payMethod}</span>}
                </span>
                <span className="font-semibold text-[var(--warm-dark)]">{fmtWon(r.actualAmount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
