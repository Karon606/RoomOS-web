'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  updatePropertySettings,
  getRoomTypeOptions, addRoomTypeOption, deleteRoomTypeOption,
  getWindowTypeOptions, addWindowTypeOption, deleteWindowTypeOption,
  getIncomeCategories, addIncomeCategory, deleteIncomeCategory,
  inviteMember, updateMemberRole, removeMember,
  type MemberWithUser,
} from './actions'
import { ROLE_LABEL, type Role } from '@/lib/role-types'
import { MoneyInput } from '@/components/ui/MoneyInput'

type Property = {
  id: string
  name: string
  address: string | null
  phone: string | null
  acquisitionDate: Date | null
  defaultDeposit: number | null
  defaultCleaningFee: number | null
}

const WINDOW_TYPE_LABEL: Record<string, string> = {
  WINDOW: '내창', NO_WINDOW: '외창', SKYLIGHT: '천창',
}

function windowLabel(val: string) {
  return WINDOW_TYPE_LABEL[val] ?? val
}

type Tab = 'basic' | 'room' | 'finance' | 'members'

const TABS: { key: Tab; label: string }[] = [
  { key: 'basic',   label: '기본정보' },
  { key: 'room',    label: '호실 설정' },
  { key: 'finance', label: '수익·지출' },
  { key: 'members', label: '멤버 관리' },
]

export default function SettingsForm({
  property,
  members: initialMembers,
  myRole,
}: {
  property: Property | null
  members: MemberWithUser[]
  myRole: Role
}) {
  const router = useRouter()
  const [tab, setTab]             = useState<Tab>('basic')
  const [toast, setToast]         = useState('')
  const [isPending, startTransition] = useTransition()

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const handleSubmit = async (e: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await updatePropertySettings(formData)
        showToast('✅ 저장되었습니다.')
      } catch (err: unknown) {
        showToast('❌ 저장 실패: ' + (err as Error).message)
      }
    })
  }

  const acqDate = property?.acquisitionDate
    ? new Date(property.acquisitionDate).toISOString().slice(0, 10)
    : ''

  // ── 방타입 ─────────────────────────────────────────────────────
  const [roomTypes, setRoomTypes] = useState<string[]>([])
  const [newRoomType, setNewRoomType] = useState('')

  useEffect(() => { getRoomTypeOptions().then(setRoomTypes) }, [])

  const handleAddRoomType = async () => {
    const v = newRoomType.trim(); if (!v) return
    await addRoomTypeOption(v)
    setRoomTypes(prev => [...prev, v]); setNewRoomType('')
  }
  const handleDeleteRoomType = async (name: string) => {
    if (!confirm(`'${name}' 방타입을 삭제할까요?`)) return
    await deleteRoomTypeOption(name)
    setRoomTypes(prev => prev.filter(t => t !== name))
  }

  // ── 창문 유형 ───────────────────────────────────────────────────
  const [windowTypes, setWindowTypes] = useState<string[]>([])
  const [newWindowType, setNewWindowType] = useState('')

  useEffect(() => { getWindowTypeOptions().then(setWindowTypes) }, [])

  const handleAddWindowType = async () => {
    const v = newWindowType.trim(); if (!v) return
    await addWindowTypeOption(v)
    setWindowTypes(prev => [...prev, v]); setNewWindowType('')
  }
  const handleDeleteWindowType = async (name: string) => {
    if (!confirm(`'${windowLabel(name)}' 창문 유형을 삭제할까요?`)) return
    await deleteWindowTypeOption(name)
    setWindowTypes(prev => prev.filter(t => t !== name))
  }

  // ── 멤버 관리 ──────────────────────────────────────────────────
  const [members, setMembers] = useState<MemberWithUser[]>(initialMembers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('STAFF')
  const isOwner = myRole === 'OWNER'

  const handleInvite = async () => {
    const email = inviteEmail.trim(); if (!email) return
    try {
      await inviteMember(email, inviteRole)
      setInviteEmail('')
      showToast('✅ 멤버가 추가되었습니다.')
      router.refresh()
    } catch (err: unknown) {
      showToast('❌ ' + (err as Error).message)
    }
  }

  const handleRoleChange = async (userId: string, role: Role) => {
    try {
      await updateMemberRole(userId, role)
      setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role, roleLabel: ROLE_LABEL[role] } : m))
    } catch (err: unknown) {
      showToast('❌ ' + (err as Error).message)
    }
  }

  const handleRemove = async (userId: string, name: string) => {
    if (!confirm(`'${name}' 멤버를 제거할까요?`)) return
    try {
      await removeMember(userId)
      setMembers(prev => prev.filter(m => m.userId !== userId))
      showToast('✅ 멤버가 제거되었습니다.')
    } catch (err: unknown) {
      showToast('❌ ' + (err as Error).message)
    }
  }

  // ── 부가수익 카테고리 ────────────────────────────────────────────
  const [incomeCategs, setIncomeCategs] = useState<string[]>([])
  const [newIncomeCateg, setNewIncomeCateg] = useState('')

  useEffect(() => { getIncomeCategories().then(setIncomeCategs) }, [])

  const handleAddIncomeCateg = async () => {
    const v = newIncomeCateg.trim(); if (!v) return
    await addIncomeCategory(v)
    setIncomeCategs(prev => [...prev, v]); setNewIncomeCateg('')
  }
  const handleDeleteIncomeCateg = async (name: string) => {
    if (!confirm(`'${name}' 카테고리를 삭제할까요?`)) return
    await deleteIncomeCategory(name)
    setIncomeCategs(prev => prev.filter(t => t !== name))
  }

  return (
    <div className="max-w-lg">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-5 py-3 text-sm text-[var(--warm-dark)] shadow-xl">
          {toast}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">설정</h1>
        <p className="text-sm text-[var(--warm-muted)] mt-0.5">영업장 기본 정보 및 옵션 관리</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-1 mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-sm font-medium rounded-xl transition-colors ${
              tab === t.key
                ? 'bg-[var(--coral)] text-[var(--warm-dark)]'
                : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 기본정보 탭 */}
      {tab === 'basic' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">영업장 기본 정보</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="영업장명 *" name="name" defaultValue={property?.name ?? ''} />
            <Field label="주소" name="address" defaultValue={property?.address ?? ''} />
            <Field label="대표 연락처" name="phone" defaultValue={property?.phone ?? ''} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">인수 날짜</label>
              <p className="text-xs text-[var(--warm-muted)]">이 날짜 이전의 미납금은 이월 계산에서 제외됩니다.</p>
              <input type="date" name="acquisitionDate" defaultValue={acqDate}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">기본 보증금</label>
                <MoneyInput name="defaultDeposit" defaultValue={property?.defaultDeposit ?? undefined} placeholder="0원" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">기본 청소비</label>
                <MoneyInput name="defaultCleaningFee" defaultValue={property?.defaultCleaningFee ?? undefined} placeholder="0원" />
              </div>
            </div>
            <button type="submit" disabled={isPending}
              className="w-full py-2.5 bg-[var(--coral)] hover:bg-[var(--coral)] text-[var(--warm-dark)] text-sm font-medium rounded-xl transition-colors disabled:opacity-60 mt-2">
              {isPending ? '저장 중...' : '저장'}
            </button>
          </form>
        </div>
      )}

      {/* 호실 설정 탭 */}
      {tab === 'room' && (
        <div className="space-y-4">
          <OptionSection
            title="방타입 관리"
            description="호실 등록 시 선택할 수 있는 방 유형 목록입니다."
            items={roomTypes}
            getLabel={v => v}
            newValue={newRoomType}
            onNewValueChange={setNewRoomType}
            onAdd={handleAddRoomType}
            onDelete={handleDeleteRoomType}
            placeholder="예: 원룸, 투룸, 복층..."
          />
          <OptionSection
            title="창문 유형 관리"
            description="기본 유형: 내창, 외창. 직접 추가하면 그대로 호실 옵션에 표시됩니다."
            items={windowTypes}
            getLabel={windowLabel}
            newValue={newWindowType}
            onNewValueChange={setNewWindowType}
            onAdd={handleAddWindowType}
            onDelete={handleDeleteWindowType}
            placeholder="예: 복층창, 루프탑창..."
          />
        </div>
      )}

      {/* 수익·지출 탭 */}
      {tab === 'finance' && (
        <div className="space-y-4">
          <OptionSection
            title="부가수익 카테고리 관리"
            description="지출/기타수익 페이지에서 부가수익 등록 시 선택할 카테고리입니다."
            items={incomeCategs}
            getLabel={v => v}
            newValue={newIncomeCateg}
            onNewValueChange={setNewIncomeCateg}
            onAdd={handleAddIncomeCateg}
            onDelete={handleDeleteIncomeCateg}
            placeholder="예: 건조기, 세탁기, 자판기..."
          />
        </div>
      )}

      {/* 멤버 관리 탭 */}
      {tab === 'members' && (
        <div className="space-y-4">
          {/* 현재 멤버 목록 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">멤버 목록</h2>
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.userId} className="flex items-center gap-3 bg-[var(--canvas)] rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--coral)] flex items-center justify-center text-sm font-medium text-[var(--warm-dark)] shrink-0">
                    {m.avatarUrl
                      ? <img src={m.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                      : (m.name ?? m.email)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--warm-dark)] truncate">{m.name ?? m.email}</p>
                    <p className="text-xs text-[var(--warm-muted)] truncate">{m.email}</p>
                  </div>
                  {isOwner ? (
                    <select
                      value={m.role}
                      onChange={e => handleRoleChange(m.userId, e.target.value as Role)}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1 text-xs text-[var(--warm-dark)] outline-none"
                    >
                      <option value="OWNER">소유자</option>
                      <option value="MANAGER">관리자</option>
                      <option value="STAFF">스태프</option>
                    </select>
                  ) : (
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium
                      ${m.role === 'OWNER' ? 'bg-[var(--coral)]/30 text-[var(--coral)]' :
                        m.role === 'MANAGER' ? 'bg-emerald-600/30 text-emerald-300' :
                        'bg-[var(--canvas)] text-[var(--warm-mid)]'}`}>
                      {m.roleLabel}
                    </span>
                  )}
                  {isOwner && m.role !== 'OWNER' && (
                    <button
                      onClick={() => handleRemove(m.userId, m.name ?? m.email)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1">
                      제거
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 멤버 초대 (소유자만) */}
          {isOwner && (
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">멤버 초대</h2>
              <p className="text-xs text-[var(--warm-muted)] mb-4">RoomOS에 가입된 이메일로만 초대할 수 있습니다.</p>
              <div className="space-y-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="이메일 입력..."
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]"
                />
                <div className="flex gap-2">
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as Role)}
                    className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
                  >
                    <option value="MANAGER">관리자 — 등록·수정·삭제 가능</option>
                    <option value="STAFF">스태프 — 조회만 가능</option>
                  </select>
                  <button
                    onClick={handleInvite}
                    className="px-4 py-2.5 bg-[var(--coral)] hover:bg-[var(--coral)] text-[var(--warm-dark)] text-sm font-medium rounded-xl transition-colors">
                    초대
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 권한 안내 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-3">권한 안내</h2>
            <div className="space-y-2">
              {([['소유자', '모든 기능 + 멤버 관리'],
                 ['관리자', '등록·수정·삭제 가능, 멤버 관리 불가'],
                 ['스태프', '조회만 가능']] as const).map(([label, desc]) => (
                <div key={label} className="flex gap-3 text-xs">
                  <span className="text-[var(--warm-dark)] w-14 shrink-0">{label}</span>
                  <span className="text-[var(--warm-muted)]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OptionSection({
  title, description, items, getLabel, newValue, onNewValueChange, onAdd, onDelete, placeholder,
}: {
  title: string
  description?: string
  items: string[]
  getLabel: (v: string) => string
  newValue: string
  onNewValueChange: (v: string) => void
  onAdd: () => void
  onDelete: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">{title}</h2>
      {description && <p className="text-xs text-[var(--warm-muted)] mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      <div className="space-y-2 mb-4">
        {items.length === 0 && (
          <p className="text-xs text-[var(--warm-muted)] py-2">항목이 없습니다.</p>
        )}
        {items.map(item => (
          <div key={item} className="flex items-center justify-between bg-[var(--canvas)] rounded-xl px-4 py-2.5">
            <span className="text-sm text-[var(--warm-dark)]">{getLabel(item)}</span>
            <button onClick={() => onDelete(item)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors">
              삭제
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={newValue}
          onChange={e => onNewValueChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()}
          placeholder={placeholder ?? '입력...'}
          className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
        <button onClick={onAdd}
          className="px-4 py-2.5 bg-[var(--coral)] hover:bg-[var(--coral)] text-[var(--warm-dark)] text-sm font-medium rounded-xl transition-colors">
          등록
        </button>
      </div>
    </div>
  )
}

function Field({ label, name, defaultValue }: {
  label: string; name: string; defaultValue: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" name={name} defaultValue={defaultValue}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
    </div>
  )
}
