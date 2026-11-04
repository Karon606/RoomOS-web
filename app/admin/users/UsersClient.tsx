'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { pushToast } from '@/lib/saveStatus'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Btn } from '@/components/ui/Btn'
import { ManageMenu } from '@/components/ui/RecordEditShell'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { withParticle } from '@/lib/koParticle'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { setUserStatus, setSuperAdmin, approveUser, undoAdminUserChange, archiveStaleSignups, unarchiveSignups } from '../actions'
import {
  ACTION_LABEL, PLATFORM_ADMIN_LABEL, STAFF_ROLE_LABEL, STALE_DAYS, cardActions, grantImpact,
  type AdminUserUndo, type CardActionKey,
} from '@/lib/adminAccess'

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
  providerLabel: string | null
  lastSignInLabel: string
  archived: boolean
  stale: boolean
}

// 상태 배지(§11 정본 Badge). 승인됨은 정상 상태라 배지가 없다(립·배지는 예외 상태 전용, §18). 대기는 info, 거절은 neutral.
const STATUS_BADGE: Record<Row['status'], { label: string; tone: 'pale-blue' | 'pale-neutral' } | null> = {
  PENDING: { label: '승인 대기', tone: 'pale-blue' },
  APPROVED: null,
  REJECTED: { label: '거절', tone: 'pale-neutral' },
}

// 1차 필터(§23 SegmentedControl, '전체'가 먼저). 코랄 채움 알약은 §23·§25 위반이라 걷었다.
// '정리됨'은 정리한 계정이 있을 때만 끝에 선다(나머지 칸에서는 정리한 계정이 빠진다).
const FILTERS = [
  { value: 'ALL', label: '전체' },
  { value: 'PENDING', label: '승인 대기' },
  { value: 'APPROVED', label: '승인됨' },
  { value: 'REJECTED', label: '거절' },
  { value: 'ARCHIVED', label: '정리됨' },
] as const
type FilterKey = (typeof FILTERS)[number]['value']

// §11 메타 칩 정본(가입 경로): bg --canvas · --warm-muted · ring 1px --warm-border · r-sm · 10.5px
const META_CHIP = 'shrink-0 rounded-sm bg-[var(--canvas)] px-1.5 py-0.5 text-[0.65625rem] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]'

/** 빈 상태 제목(§29). 검색창이 없으니 '검색어를 조정해 보세요' 같은 안내를 하지 않는다. */
function emptyTitle(f: FilterKey) {
  return f === 'ALL' ? '가입자가 없습니다' : `'${FILTERS.find(x => x.value === f)!.label}' 가입자가 없습니다`
}

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

type MyProperty = { id: string; name: string }
type StaffRole = keyof typeof STAFF_ROLE_LABEL

export default function UsersClient({ rows, pendingCount, propertyCount, myProperties }: {
  rows: Row[]; pendingCount: number; propertyCount: number; myProperties: MyProperty[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [filter, setFilter] = useState<FilterKey>(pendingCount > 0 ? 'PENDING' : 'ALL')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [approving, setApproving] = useState<Row | null>(null)

  const archivedCount = rows.filter(r => r.archived).length
  const filters = FILTERS.filter(f => f.value !== 'ARCHIVED' || archivedCount > 0)
  const visible = filter === 'ARCHIVED' ? rows.filter(r => r.archived)
    : rows.filter(r => !r.archived && (filter === 'ALL' || r.status === filter))
  const staleRows = rows.filter(r => r.stale)

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

  /** 오래된 계정 정리(§14 파괴 확인창 + 토스트 적용취소). 지우지 않고 목록에서만 걷는다. */
  async function archiveStale() {
    const names = staleRows.map(r => r.name || r.email)
    const ok = await confirmDialog({
      title: `오래된 대기·거절 계정 ${staleRows.length}개를 정리할까요?`,
      message: `${STALE_DAYS}일 넘게 접속이 없고 영업장이 없는 대기·거절 계정입니다. 계정을 지우지 않고 목록에서만 걷습니다. '정리됨' 칸에서 다시 볼 수 있습니다.`,
      level: 'danger',
      confirmLabel: '정리',
      impactTitle: '정리할 계정',
      impact: [...names.slice(0, 5).map(label => ({ label })), ...(names.length > 5 ? [{ label: `외 ${names.length - 5}명` }] : [])],
      irreversibleNote: UNDO_REVERSIBLE,
    })
    if (!ok) return
    startTransition(async () => {
      try {
        const res = await archiveStaleSignups(staleRows.map(r => r.id))
        if (!res.ok) { pushToast('error', res.error); return }
        const undo = res.undo
        pushToast('success', `계정 ${res.count}개를 정리했습니다`, { action: { label: '적용취소', run: () => { void unarchiveSignups(undo.ids, undo.at).then(r => {
          if (r.ok) { pushToast('info', `적용취소했습니다 · 계정 ${r.count}개 정리`); router.refresh() } else pushToast('error', r.error)
        }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } } })
        router.refresh()
      } catch {
        pushToast('error', '처리 중 통신 오류가 발생했습니다')
      }
    })
  }

  function unarchive(u: Row) {
    setBusyId(u.id)
    startTransition(async () => {
      try {
        const res = await unarchiveSignups([u.id])
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', `${displayName(u)} 되살렸습니다`)
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
    const who = displayName(u)
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
    if (key === 'approve' || key === 'reapprove') { setApproving(u); return }
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
    const status = key === 'toPending' ? 'PENDING' : 'REJECTED'
    run(u.id, () => setUserStatus(u.id, status), done, undone)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold text-[var(--ink)]">
          가입자 <span className="num text-[var(--ink-m)] font-semibold">({rows.length - archivedCount})</span>
        </h1>
        {staleRows.length > 0 && (
          <Btn variant="secondary" size="sm" disabled={pending} onClick={() => { void archiveStale() }}>
            오래된 계정 정리 ({staleRows.length})
          </Btn>
        )}
      </div>

      <SegmentedControl options={filters} value={filter} onChange={setFilter} size="sm" ariaLabel="가입 상태" scroll />

      {visible.length === 0 ? (
        <EmptyState
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" /></svg>}
          title={emptyTitle(filter)}
        />
      ) : (
        <ul className="space-y-2.5">
          {visible.map((u) => {
            const badge = STATUS_BADGE[u.status]
            const isAdmin = u.isSuperAdmin || u.envAdmin
            const rowBusy = pending && busyId === u.id
            const contact = [u.phone, u.address].filter(Boolean).join(' · ')
            const meta = [
              `가입 ${u.createdAtLabel}`,
              u.lastSignInLabel ? `최근 접속 ${u.lastSignInLabel}` : '',
              u.ownedCount > 0 ? `소유 영업장 ${u.ownedCount}` : '',
              u.roleCount > 0 ? `참여 영업장 ${u.roleCount}` : '',
              u.inviteCode ? `코드 ${u.inviteCode}` : '',
            ].filter(Boolean).join(' · ')
            // 정리한 계정은 되살리기 하나만 선다(상태 동작은 되살린 뒤)
            const acts = u.archived ? { primary: [], manage: [], danger: [] } : cardActions({ status: u.status, dbAdmin: u.isSuperAdmin, envAdmin: u.envAdmin, isSelf: u.isSelf })
            const menu = [...acts.manage, ...acts.danger].map(k => ({
              key: k, label: ACTION_LABEL[k], danger: acts.danger.includes(k), onSelect: () => { void act(u, k) },
            }))
            return (
              <li
                key={u.id}
                className="rounded-xl p-4 bg-[var(--cream)] border border-[var(--warm-border)]"
                style={{ opacity: rowBusy ? 0.6 : 1 }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    {/* 이름이 없으면(이메일 가입·실명 칸 없던 때) 이메일이 식별자다. '—' 를 찍지 않는다. */}
                    <span className="font-semibold text-[var(--ink)] truncate mr-1 [overflow-wrap:anywhere]">{u.name || u.email}</span>
                    {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                    {isAdmin && <Badge tone="pale-neutral">{PLATFORM_ADMIN_LABEL}</Badge>}
                    {u.isSelf && <Badge tone="pale-neutral">나</Badge>}
                    {u.archived && <Badge tone="pale-neutral">정리됨</Badge>}
                    {u.providerLabel && <span className={META_CHIP}>{u.providerLabel}</span>}
                  </div>
                  {u.name && <p className="text-sm text-[var(--ink-s)] truncate mt-0.5">{u.email}</p>}
                  {contact && <p className="text-xs text-[var(--ink-m)] mt-1 break-keep [overflow-wrap:anywhere]">{contact}</p>}
                  <p className="text-xs text-[var(--ink-m)] mt-1 num">{meta}</p>
                </div>

                {u.archived && (
                  <div className="flex items-center justify-end gap-2 mt-3">
                    <Btn size="sm" variant="secondary" disabled={rowBusy} onClick={() => unarchive(u)}>되살리기</Btn>
                  </div>
                )}
                {(acts.primary.length > 0 || menu.length > 0) && (
                  <div className="flex items-center justify-end gap-2 mt-3">
                    {acts.primary.map(k => (
                      <Btn key={k} size="sm" variant={k === 'reject' || k === 'reapprove' ? 'secondary' : 'primary'}
                        disabled={rowBusy} onClick={() => { void act(u, k) }}>
                        {ACTION_LABEL[k]}
                      </Btn>
                    ))}
                    {menu.length > 0 && <ManageMenu items={menu} disabled={rowBusy} placement="auto" size="sm" />}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {approving && (
        <ApproveModal
          key={approving.id}
          row={approving}
          myProperties={myProperties}
          onClose={() => setApproving(null)}
          onApprove={(addMember) => {
            const u = approving
            const who = displayName(u)
            setApproving(null)
            const staff = addMember ? ` · ${myProperties.find(p => p.id === addMember.propertyId)?.name ?? ''} ${withParticle(STAFF_ROLE_LABEL[addMember.role], '으로/로')} 추가` : ''
            run(u.id, () => approveUser(u.id, addMember), `${who} 승인했습니다${staff}`, `적용취소했습니다 · ${who} 승인${addMember ? '·직원 추가' : ''}`)
          }}
        />
      )}
    </div>
  )
}

function displayName(u: Row) {
  return `${u.name || u.email} 님`
}

/**
 * 승인 확인창(Modal sm). '내 영업장 직원으로도 추가'는 기본 꺼짐이다(갈림길 E). 자기 영업장을 따로 만들어 운영할 사람은 그대로 승인하고,
 * 내 고시원 직원으로 들일 사람만 켠다. 켜면 영업장(내가 소유한 곳)과 역할(관리자·스태프·제한 스태프)을 고른다. 소유한 영업장이 없으면 칸이 없다.
 */
function ApproveModal({ row, myProperties, onClose, onApprove }: {
  row: Row
  myProperties: MyProperty[]
  onClose: () => void
  onApprove: (addMember: { propertyId: string; role: StaffRole } | null) => void
}) {
  const [addStaff, setAddStaff] = useState(false)
  const [propertyId, setPropertyId] = useState(myProperties[0]?.id ?? '')
  const [role, setRole] = useState<StaffRole>('STAFF')
  const roleOptions = (Object.keys(STAFF_ROLE_LABEL) as StaffRole[]).map(k => ({ value: k, label: STAFF_ROLE_LABEL[k] }))
  return (
    <Modal
      open
      onClose={onClose}
      title={`${displayName(row)} 승인`}
      subtitle={row.email}
      width="sm"
      dirty={addStaff}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn variant="secondary" size="md" onClick={onClose}>취소</Btn>
          <Btn variant="primary" size="md" onClick={() => onApprove(addStaff && propertyId ? { propertyId, role } : null)}>승인</Btn>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-[var(--ink-s)] break-keep">
          승인하면 이 계정이 스테이음을 쓸 수 있습니다. 자기 영업장을 따로 만들어 운영할 사람이면 그대로 승인합니다.
        </p>
        {myProperties.length > 0 && (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm text-[var(--warm-dark)] cursor-pointer min-h-[44px] py-2">
              <input type="checkbox" checked={addStaff} onChange={e => setAddStaff(e.target.checked)}
                className="w-4 h-4 accent-[var(--coral)] mt-0.5 shrink-0" />
              <span className="break-keep">내 영업장 직원으로도 추가</span>
            </label>
            {addStaff && (
              <div className="space-y-3 pl-6">
                {myProperties.length > 1 ? (
                  <div className="space-y-1.5">
                    <label htmlFor="approve-property" className="block text-xs font-medium text-[var(--ink-s)]">영업장</label>
                    <select id="approve-property" value={propertyId} onChange={e => setPropertyId(e.target.value)}
                      className="w-full h-[var(--input-h-touch)] bg-[var(--cream-2)] border-[1.5px] border-[var(--border-s)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--tc)]">
                      {myProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--ink-s)]">영업장 · {myProperties[0].name}</p>
                )}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[var(--ink-s)]">역할</p>
                  <SegmentedControl options={roleOptions} value={role} onChange={setRole} ariaLabel="직원 역할" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
