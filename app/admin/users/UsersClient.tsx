'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { pushToast } from '@/lib/saveStatus'
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn } from '@/components/ui/Btn'
import { ManageMenu } from '@/components/ui/RecordEditShell'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { setUserStatus, setSuperAdmin, undoAdminUserChange } from '../actions'
import { ACTION_LABEL, PLATFORM_ADMIN_LABEL, cardActions, grantImpact, type AdminUserUndo, type CardActionKey } from '@/lib/adminAccess'

type Row = {
  id: string
  email: string
  name: string
  phone: string
  address: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  isSuperAdmin: boolean
  envAdmin: boolean
  isSelf: boolean
  inviteCode: string
  createdAtLabel: string
  ownedCount: number
  roleCount: number
}

const STATUS_META: Record<Row['status'], { label: string; bg: string; fg: string }> = {
  PENDING: { label: '승인 대기', bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
  APPROVED: { label: '승인됨', bg: 'var(--sand)', fg: 'var(--ink)' },
  REJECTED: { label: '거절', bg: 'var(--cream-3)', fg: 'var(--ink-3)' },
}

const FILTERS = [
  { key: 'PENDING', label: '승인 대기' },
  { key: 'APPROVED', label: '승인됨' },
  { key: 'REJECTED', label: '거절' },
  { key: 'ALL', label: '전체' },
] as const

type ActionResult = { ok: true; undo: AdminUserUndo | null } | { ok: false; error: string }

/** 권한·상태를 바꾼 뒤의 토스트 문장. 적용취소도 같은 대상 이름으로 말한다. */
const DONE_MSG: Record<CardActionKey, string> = {
  approve: '승인했습니다',
  reapprove: '다시 승인했습니다',
  reject: '거절했습니다',
  toPending: '대기로 되돌렸습니다',
  revokeApproval: '승인을 취소했습니다',
  grantAdmin: `${PLATFORM_ADMIN_LABEL} 권한을 줬습니다`,
  revokeAdmin: `${PLATFORM_ADMIN_LABEL} 권한을 회수했습니다`,
}

const UNDO_REVERSIBLE = '실행 뒤 토스트의 적용취소로 되돌릴 수 있습니다.'

export default function UsersClient({ rows, pendingCount, propertyCount }: { rows: Row[]; pendingCount: number; propertyCount: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>(pendingCount > 0 ? 'PENDING' : 'ALL')
  const [busyId, setBusyId] = useState<string | null>(null)

  const visible = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)

  function run(id: string, fn: () => Promise<ActionResult>, done: string, undoneMsg: string) {
    setBusyId(id)
    startTransition(async () => {
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error ?? '처리에 실패했습니다.'); return }
        const undo = res.undo
        pushToast('success', done, undo ? { action: { label: '적용취소', run: () => { void undoAdminUserChange(undo).then(r => {
          if (r.ok) { pushToast('info', undoneMsg); router.refresh() }
          else pushToast('error', r.error)
        }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } } } : undefined)
        router.refresh()
      } catch {
        pushToast('error', '처리 중 통신 오류가 발생했습니다')
      } finally {
        setBusyId(null)
      }
    })
  }

  /** 카드 동작 하나. 위험한 것만 확인창을 거친다(권한 주기는 파괴 단계 + 볼 수 있게 되는 것 목록). */
  async function act(u: Row, key: CardActionKey) {
    const who = `${u.name === '—' ? u.email : u.name} 님`
    const done = `${who} ${DONE_MSG[key]}`
    const undone = `적용취소했습니다 · ${who} ${ACTION_LABEL[key]}`
    if (key === 'grantAdmin') {
      const ok = await confirmDialog({
        title: `${who}에게 ${PLATFORM_ADMIN_LABEL} 권한을 줄까요?`,
        level: 'danger',
        confirmLabel: '권한 주기',
        impactTitle: '이 사람이 볼 수 있게 되는 것',
        impact: grantImpact({ propertyCount, signupCount: rows.length }),
        irreversibleNote: UNDO_REVERSIBLE,
      })
      if (ok) run(u.id, () => setSuperAdmin(u.id, true), done, undone)
      return
    }
    if (key === 'revokeAdmin') {
      const ok = await confirmDialog({
        title: `${who}의 ${PLATFORM_ADMIN_LABEL} 권한을 회수할까요?`,
        message: '스테이음 관리자 화면과 모든 영업장 소유자 접근이 끊깁니다. 참여한 영업장의 역할은 그대로입니다.',
        level: 'caution',
        confirmLabel: '권한 회수',
      })
      if (ok) run(u.id, () => setSuperAdmin(u.id, false), done, undone)
      return
    }
    if (key === 'revokeApproval' || (key === 'toPending' && u.status === 'APPROVED')) {
      const ok = await confirmDialog({
        title: key === 'revokeApproval' ? `${who}의 승인을 취소할까요?` : `${who}의 상태를 대기로 되돌릴까요?`,
        level: 'danger',
        confirmLabel: key === 'revokeApproval' ? '승인 취소' : '대기로 되돌리기',
        impactTitle: '바로 일어나는 일',
        impact: [{ label: `참여한 영업장 ${u.ownedCount + u.roleCount}곳에 들어갈 수 없게 됩니다.` }],
        irreversibleNote: UNDO_REVERSIBLE,
      })
      if (!ok) return
    }
    const status = key === 'approve' || key === 'reapprove' ? 'APPROVED' : key === 'toPending' ? 'PENDING' : 'REJECTED'
    run(u.id, () => setUserStatus(u.id, status), done, undone)
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
            style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}
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
                color: active ? 'var(--on-solid)' : 'var(--ink-3)',
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
                          {PLATFORM_ADMIN_LABEL}
                        </span>
                      )}
                      {(u.envAdmin && !u.isSuperAdmin) && (
                        <span
                          className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--persimmon-l)', color: 'var(--persimmon-d)' }}
                        >
                          {PLATFORM_ADMIN_LABEL}
                        </span>
                      )}
                      {u.isSelf && (
                        <span
                          className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--cream-3)', color: 'var(--ink-3)' }}
                        >
                          나
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

                {(() => {
                  const acts = cardActions({ status: u.status, dbAdmin: u.isSuperAdmin, envAdmin: u.envAdmin, isSelf: u.isSelf })
                  const menu = [...acts.manage, ...acts.danger].map(k => ({
                    key: k, label: ACTION_LABEL[k], danger: acts.danger.includes(k), onSelect: () => { void act(u, k) },
                  }))
                  if (acts.primary.length === 0 && menu.length === 0) return null
                  return (
                    <div className="flex items-center justify-end gap-2 mt-3">
                      {acts.primary.map(k => (
                        <Btn key={k} size="sm" variant={k === 'reject' || k === 'reapprove' ? 'secondary' : 'primary'}
                          disabled={rowBusy} onClick={() => { void act(u, k) }}>
                          {ACTION_LABEL[k]}
                        </Btn>
                      ))}
                      {menu.length > 0 && <ManageMenu items={menu} disabled={rowBusy} placement="auto" size="sm" />}
                    </div>
                  )
                })()}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
