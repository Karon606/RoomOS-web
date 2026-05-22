'use client'

// 호실·고객·수납 통합 상세 모달 (전역).
// 어느 페이지에서 열든 배경 페이지를 바꾸지 않고, 하단 [호실][고객][수납] 버튼으로
// 같은 대상의 다른 영역 상세를 제자리에서 전환한다. (router.push 페이지 이동 제거)
// 1단계: 요약 뷰 + 제자리 전환 + "X 관리에서 열기" 딥링크. 전체 등록/편집은 2단계.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { Modal } from '@/components/ui/Modal'
import { kstMonthStr } from '@/lib/kstDate'
import {
  getEntityLinks, getRoomQuickInfo, getTenantQuickInfo, getLeaseSettlementInfo, getPaymentsByLease,
} from '@/app/(app)/rooms/actions'
import { STATUS_LABEL } from '@/lib/statusColors'

type EntityKind = 'room' | 'tenant' | 'payment'
type Seed = { kind: EntityKind; roomId?: string | null; tenantId?: string | null; leaseTermId?: string | null }
type Links = Awaited<ReturnType<typeof getEntityLinks>>

type Ctx = { open: (seed: Seed) => void; close: () => void }
const EntityModalContext = createContext<Ctx | null>(null)

export function useEntityModal(): Ctx {
  const ctx = useContext(EntityModalContext)
  if (!ctx) return { open: () => {}, close: () => {} }  // provider 밖에서도 안전
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
      {state && <EntityModalView kind={state.kind} links={state.links} setKind={k => setState(s => (s ? { ...s, kind: k } : s))} onClose={close} />}
    </EntityModalContext.Provider>
  )
}

function EntityModalView({ kind, links, setKind, onClose }: {
  kind: EntityKind; links: Links; setKind: (k: EntityKind) => void; onClose: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const month = searchParams.get('month') || kstMonthStr()

  const hasRoom = !!links?.roomId
  const hasTenant = !!links?.tenantId
  const hasPay = !!links?.leaseTermId
  const title = links ? `${fmtRoomNo(links.roomNo)}${links.tenantName ? ` · ${links.tenantName}` : ''}` : '불러오는 중…'

  const navBtn = (k: EntityKind, label: string, enabled: boolean) => (
    <button type="button" disabled={!enabled || kind === k}
      onClick={() => setKind(k)}
      className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-colors disabled:cursor-default ${
        kind === k ? 'bg-[var(--coral)] text-white'
        : enabled ? 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'
        : 'bg-[var(--canvas)] text-[var(--warm-muted)] opacity-40'
      }`}>
      {label}
    </button>
  )

  const deepLink =
    kind === 'room' && links?.roomId ? { href: `/room-manage?roomId=${links.roomId}`, label: '호실 관리에서 열기' }
    : kind === 'tenant' && links?.tenantId ? { href: `/tenants?tenantId=${links.tenantId}`, label: '고객 관리에서 열기' }
    : kind === 'payment' && links?.roomNo ? { href: `/rooms?month=${month}&roomNo=${links.roomNo}`, label: '수납 관리에서 열기' }
    : null

  return (
    <Modal
      open onClose={onClose} width="sm" title={title} z={280}
      footer={
        <div className="space-y-2">
          <div className="flex gap-2">
            {navBtn('room', '호실', hasRoom)}
            {navBtn('tenant', '고객', hasTenant)}
            {navBtn('payment', '수납', hasPay)}
          </div>
          {deepLink && (
            <Btn variant="secondary" size="sm" fullWidth
              onClick={() => { router.push(deepLink.href); onClose() }}>
              {deepLink.label}
            </Btn>
          )}
        </div>
      }
    >
      <div className="px-5 sm:px-6 py-4">
        {kind === 'room'    && (hasRoom   ? <RoomView roomId={links!.roomId!} /> : <Empty label="연결된 호실이 없습니다." />)}
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

function RoomView({ roomId }: { roomId: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getRoomQuickInfo>> | null>(null)
  useEffect(() => { let a = true; getRoomQuickInfo(roomId).then(d => { if (a) setInfo(d) }); return () => { a = false } }, [roomId])
  if (!info) return <Loading />
  return (
    <div className="space-y-3">
      {info.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {info.photos.map(p => <img key={p.id} src={p.storageUrl} alt="" className="h-28 w-28 object-cover rounded-xl shrink-0" />)}
        </div>
      )}
      <div>
        <Row k="상태" v={info.isVacant ? '공실' : '거주중'} />
        <Row k="입주자" v={info.leaseTerms[0]?.tenant?.name ?? '공실'} />
        {info.type && <Row k="방 타입" v={info.type} />}
        <Row k="기본 이용료" v={fmtWon(info.baseRent)} />
        {info.scheduledRent != null && <Row k="예약 이용료" v={fmtWon(info.scheduledRent)} />}
        {info.direction && <Row k="방향" v={info.direction} />}
        {info.memo && <Row k="메모" v={info.memo} />}
      </div>
    </div>
  )
}

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
      {/* 이번 달 납부 내역 (읽기) — 등록·수정은 '수납 관리에서 열기' */}
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
