'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { pushToast } from '@/lib/saveStatus'
import { EmptyState } from '@/components/ui/EmptyState'
import { setUserStatus, setSuperAdmin } from '../actions'

type Row = {
  id: string
  email: string
  name: string
  phone: string
  address: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  isSuperAdmin: boolean
  inviteCode: string
  createdAtLabel: string
  ownedCount: number
  roleCount: number
}

const STATUS_META: Record<Row['status'], { label: string; bg: string; fg: string }> = {
  PENDING: { label: '승인 대기', bg: 'var(--honey)', fg: '#3d2418' },
  APPROVED: { label: '승인됨', bg: 'var(--sand)', fg: 'var(--ink)' },
  REJECTED: { label: '거절', bg: 'var(--cream-3)', fg: 'var(--ink-3)' },
}

const FILTERS = [
  { key: 'PENDING', label: '승인 대기' },
  { key: 'APPROVED', label: '승인됨' },
  { key: 'REJECTED', label: '거절' },
  { key: 'ALL', label: '전체' },
] as const

export default function UsersClient({ rows, pendingCount }: { rows: Row[]; pendingCount: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>(pendingCount > 0 ? 'PENDING' : 'ALL')
  const [busyId, setBusyId] = useState<string | null>(null)

  const visible = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) pushToast('error', res.error ?? '처리에 실패했습니다.')
      else router.refresh()
      setBusyId(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
          가입자 <span style={{ color: 'var(--ink-mute)' }}>({rows.length})</span>
        </h1>
        {pendingCount > 0 && (
          <span
            className="text-xs font-semibold px-2 py-1 rounded-md"
            style={{ background: 'var(--honey)', color: '#3d2418' }}
          >
            승인 대기 {pendingCount}건
          </span>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{
                background: active ? 'var(--persimmon)' : 'var(--cream)',
                color: active ? '#fff' : 'var(--ink-3)',
                border: '1px solid var(--cream-3)',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" /></svg>}
          title="해당하는 가입자가 없습니다"
          description="검색어나 필터를 조정해 보세요."
        />
      ) : (
        <ul className="space-y-2.5">
          {visible.map((u) => {
            const meta = STATUS_META[u.status]
            const rowBusy = pending && busyId === u.id
            return (
              <li
                key={u.id}
                className="rounded-xl p-4"
                style={{ background: 'var(--cream)', border: '1px solid var(--cream-3)', opacity: rowBusy ? 0.6 : 1 }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate" style={{ color: 'var(--ink)' }}>
                        {u.name}
                      </span>
                      <span
                        className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: meta.bg, color: meta.fg }}
                      >
                        {meta.label}
                      </span>
                      {u.isSuperAdmin && (
                        <span
                          className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--persimmon-l)', color: 'var(--persimmon-d)' }}
                        >
                          운영자
                        </span>
                      )}
                    </div>
                    <p className="text-sm truncate mt-0.5" style={{ color: 'var(--ink-3)' }}>
                      {u.email}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
                      {[u.phone, u.address].filter(Boolean).join(' · ') || '연락처·주소 미입력'}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
                      가입 {u.createdAtLabel} · 소유 영업장 {u.ownedCount} · 참여 {u.roleCount}
                      {u.inviteCode ? ` · 코드 ${u.inviteCode}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 mt-3 flex-wrap">
                  {u.status !== 'APPROVED' && (
                    <button
                      disabled={rowBusy}
                      onClick={() => run(u.id, () => setUserStatus(u.id, 'APPROVED'))}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg text-white disabled:opacity-50"
                      style={{ background: 'var(--persimmon)' }}
                    >
                      승인
                    </button>
                  )}
                  {u.status !== 'REJECTED' && (
                    <button
                      disabled={rowBusy}
                      onClick={() => run(u.id, () => setUserStatus(u.id, 'REJECTED'))}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-50"
                      style={{ background: 'var(--cream-soft)', color: 'var(--ink-3)', border: '1px solid var(--cream-3)' }}
                    >
                      거절
                    </button>
                  )}
                  {u.status !== 'PENDING' && (
                    <button
                      disabled={rowBusy}
                      onClick={() => run(u.id, () => setUserStatus(u.id, 'PENDING'))}
                      className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-50"
                      style={{ background: 'transparent', color: 'var(--ink-mute)', border: '1px solid var(--cream-3)' }}
                    >
                      대기로
                    </button>
                  )}
                  <button
                    disabled={rowBusy}
                    onClick={() => run(u.id, () => setSuperAdmin(u.id, !u.isSuperAdmin))}
                    className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ml-auto"
                    style={{ background: 'transparent', color: 'var(--persimmon-d)', border: '1px solid var(--persimmon-l)' }}
                  >
                    {u.isSuperAdmin ? '운영자 해제' : '운영자 지정'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
