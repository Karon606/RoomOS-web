'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  updatePropertySettings,
  getRoomTypeOptions, addRoomTypeOption, deleteRoomTypeOption,
  getWindowTypeOptions, addWindowTypeOption, deleteWindowTypeOption,
  getRoomDirectionOptions, addRoomDirectionOption, deleteRoomDirectionOption,
  getIncomeCategories, addIncomeCategory, deleteIncomeCategory,
  getExpenseCategories, addExpenseCategory, deleteExpenseCategory,
  getPaymentMethods, addPaymentMethod, deletePaymentMethod,
  reorderOptions, renameOption, resetOptionsToDefault,
  inviteMember, updateMemberRole, removeMember,
  getRecurringExpenses, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense,
  exportAllData,
  type MemberWithUser, type RecurringExpenseRow,
} from './actions'
import { ROLE_LABEL, type Role } from '@/lib/role-types'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { DatePicker } from '@/components/ui/DatePicker'

type Property = {
  id: string
  name: string
  address: string | null
  phone: string | null
  acquisitionDate: Date | null
  prevOwnerCutoffDate: Date | null
  defaultDeposit: number | null
  defaultCleaningFee: number | null
}

const WINDOW_TYPE_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
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
  const cutoffDate = property?.prevOwnerCutoffDate
    ? new Date(property.prevOwnerCutoffDate).toISOString().slice(0, 10)
    : ''
  const [acqDateVal, setAcqDateVal]         = useState(acqDate)
  const [cutoffDateVal, setCutoffDateVal]   = useState(cutoffDate)

  // ── 방타입 ─────────────────────────────────────────────────────
  const [roomTypes, setRoomTypes] = useState<string[]>([])
  const [newRoomType, setNewRoomType] = useState('')

  useEffect(() => { getRoomTypeOptions().then(setRoomTypes).catch(console.error) }, [])

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
  const handleReorderRoomTypes = async (items: string[]) => {
    setRoomTypes(items)
    await reorderOptions('roomTypeOptions', items)
  }
  const handleRenameRoomType = async (oldVal: string, newVal: string) => {
    if (!newVal.trim() || newVal === oldVal) return
    await renameOption('roomTypeOptions', oldVal, newVal.trim())
    setRoomTypes(prev => prev.map(v => v === oldVal ? newVal.trim() : v))
  }
  const handleResetRoomTypes = async () => {
    if (!confirm('방타입을 기본값(원룸, 미니룸)으로 초기화할까요?')) return
    setRoomTypes(await resetOptionsToDefault('roomTypeOptions'))
  }

  // ── 창문 유형 ───────────────────────────────────────────────────
  const [windowTypes, setWindowTypes] = useState<string[]>([])
  const [newWindowType, setNewWindowType] = useState('')

  useEffect(() => { getWindowTypeOptions().then(setWindowTypes).catch(console.error) }, [])

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
  const handleReorderWindowTypes = async (items: string[]) => {
    setWindowTypes(items)
    await reorderOptions('windowTypeOptions', items)
  }
  const handleRenameWindowType = async (oldVal: string, newVal: string) => {
    if (!newVal.trim() || newVal === oldVal) return
    await renameOption('windowTypeOptions', oldVal, newVal.trim())
    setWindowTypes(prev => prev.map(v => v === oldVal ? newVal.trim() : v))
  }
  const handleResetWindowTypes = async () => {
    if (!confirm('창문 유형을 기본값(외창, 내창)으로 초기화할까요?')) return
    setWindowTypes(await resetOptionsToDefault('windowTypeOptions'))
  }

  // ── 방향 ────────────────────────────────────────────────────────
  const [directions, setDirections] = useState<string[]>([])
  const [newDirection, setNewDirection] = useState('')

  useEffect(() => { getRoomDirectionOptions().then(setDirections).catch(console.error) }, [])

  const handleAddDirection = async () => {
    const v = newDirection.trim(); if (!v) return
    await addRoomDirectionOption(v)
    setDirections(prev => [...prev, v]); setNewDirection('')
  }
  const handleDeleteDirection = async (name: string) => {
    if (!confirm(`'${name}' 방향을 삭제할까요?`)) return
    await deleteRoomDirectionOption(name)
    setDirections(prev => prev.filter(t => t !== name))
  }
  const handleReorderDirections = async (items: string[]) => {
    setDirections(items)
    await reorderOptions('directionOptions', items)
  }
  const handleRenameDirection = async (oldVal: string, newVal: string) => {
    if (!newVal.trim() || newVal === oldVal) return
    await renameOption('directionOptions', oldVal, newVal.trim())
    setDirections(prev => prev.map(v => v === oldVal ? newVal.trim() : v))
  }
  const handleResetDirections = async () => {
    if (!confirm('방향을 기본값(북향~북서향 8방위)으로 초기화할까요?')) return
    setDirections(await resetOptionsToDefault('directionOptions'))
  }

  // ── 멤버 관리 ──────────────────────────────────────────────────
  const [members, setMembers] = useState<MemberWithUser[]>(initialMembers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('STAFF')
  const isOwner = myRole === 'OWNER'

  const handleInvite = async () => {
    const email = inviteEmail.trim(); if (!email) return
    const result = await inviteMember(email, inviteRole)
    if (!result.ok) { showToast('❌ ' + result.error); return }
    setInviteEmail('')
    showToast('✅ 멤버가 추가되었습니다.')
    router.refresh()
  }

  const handleRoleChange = async (userId: string, role: Role) => {
    const result = await updateMemberRole(userId, role)
    if (!result.ok) { showToast('❌ ' + result.error); return }
    setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role, roleLabel: ROLE_LABEL[role] } : m))
  }

  const handleRemove = async (userId: string, name: string) => {
    if (!confirm(`'${name}' 멤버를 제거할까요?`)) return
    const result = await removeMember(userId)
    if (!result.ok) { showToast('❌ ' + result.error); return }
    setMembers(prev => prev.filter(m => m.userId !== userId))
    showToast('✅ 멤버가 제거되었습니다.')
  }

  // ── 부가수익 카테고리 ────────────────────────────────────────────
  const [incomeCategs, setIncomeCategs] = useState<string[]>([])
  const [newIncomeCateg, setNewIncomeCateg] = useState('')

  useEffect(() => { getIncomeCategories().then(setIncomeCategs).catch(console.error) }, [])

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
  const handleReorderIncomeCategs = async (items: string[]) => {
    setIncomeCategs(items)
    await reorderOptions('incomeCategories', items)
  }
  const handleRenameIncomeCateg = async (oldVal: string, newVal: string) => {
    if (!newVal.trim() || newVal === oldVal) return
    await renameOption('incomeCategories', oldVal, newVal.trim())
    setIncomeCategs(prev => prev.map(v => v === oldVal ? newVal.trim() : v))
  }
  const handleResetIncomeCategs = async () => {
    if (!confirm('부가수익 카테고리를 기본값으로 초기화할까요?')) return
    setIncomeCategs(await resetOptionsToDefault('incomeCategories'))
  }

  // ── 지출 카테고리 ────────────────────────────────────────────────
  const [expenseCategs, setExpenseCategs] = useState<string[]>([])
  const [newExpenseCateg, setNewExpenseCateg] = useState('')
  useEffect(() => { getExpenseCategories().then(setExpenseCategs).catch(console.error) }, [])
  const handleAddExpenseCateg = async () => {
    const v = newExpenseCateg.trim(); if (!v) return
    await addExpenseCategory(v)
    setExpenseCategs(prev => [...prev, v]); setNewExpenseCateg('')
  }
  const handleDeleteExpenseCateg = async (name: string) => {
    if (!confirm(`'${name}' 카테고리를 삭제할까요?`)) return
    await deleteExpenseCategory(name)
    setExpenseCategs(prev => prev.filter(t => t !== name))
  }
  const handleReorderExpenseCategs = async (items: string[]) => {
    setExpenseCategs(items)
    await reorderOptions('expenseCategories', items)
  }
  const handleRenameExpenseCateg = async (oldVal: string, newVal: string) => {
    if (!newVal.trim() || newVal === oldVal) return
    await renameOption('expenseCategories', oldVal, newVal.trim())
    setExpenseCategs(prev => prev.map(v => v === oldVal ? newVal.trim() : v))
  }
  const handleResetExpenseCategs = async () => {
    if (!confirm('지출 카테고리를 기본값으로 초기화할까요?')) return
    setExpenseCategs(await resetOptionsToDefault('expenseCategories'))
  }

  // ── 결제 수단 ────────────────────────────────────────────────────
  const [payMethods, setPayMethods] = useState<string[]>([])
  const [newPayMethod, setNewPayMethod] = useState('')
  useEffect(() => { getPaymentMethods().then(setPayMethods).catch(console.error) }, [])
  const handleAddPayMethod = async () => {
    const v = newPayMethod.trim(); if (!v) return
    await addPaymentMethod(v)
    setPayMethods(prev => [...prev, v]); setNewPayMethod('')
  }
  const handleDeletePayMethod = async (name: string) => {
    if (!confirm(`'${name}' 결제 수단을 삭제할까요?`)) return
    await deletePaymentMethod(name)
    setPayMethods(prev => prev.filter(t => t !== name))
  }
  const handleReorderPayMethods = async (items: string[]) => {
    setPayMethods(items)
    await reorderOptions('paymentMethods', items)
  }
  const handleRenamePayMethod = async (oldVal: string, newVal: string) => {
    if (!newVal.trim() || newVal === oldVal) return
    await renameOption('paymentMethods', oldVal, newVal.trim())
    setPayMethods(prev => prev.map(v => v === oldVal ? newVal.trim() : v))
  }
  const handleResetPayMethods = async () => {
    if (!confirm('결제 수단을 기본값(계좌이체, 신용카드, 체크카드, 현금)으로 초기화할까요?')) return
    setPayMethods(await resetOptionsToDefault('paymentMethods'))
  }

  // ── 고정 지출 ────────────────────────────────────────────────────
  const [recurringList, setRecurringList] = useState<RecurringExpenseRow[]>([])
  const [showRecForm, setShowRecForm] = useState(false)
  const [editingRec, setEditingRec] = useState<RecurringExpenseRow | null>(null)
  const [recForm, setRecForm] = useState({ title: '', amount: '', category: '관리비', dueDay: '25', payMethod: '', isAutoDebit: false, isVariable: false, alertDaysBefore: '7', activeSince: '', memo: '' })
  const [recDueDayDisp, setRecDueDayDisp] = useState('25일')
  const [recPending, startRecTransition] = useTransition()

  const fmtRecDueDay = (d: string) => {
    const n = parseInt(d, 10)
    if (isNaN(n) || n <= 0) return d
    return n >= 30 ? '말일' : `${n}일`
  }
  const applyRecDueDay = (input: string) => {
    const t = input.trim()
    if (!t) { setRecForm(p => ({ ...p, dueDay: '25' })); setRecDueDayDisp('25일'); return }
    if (/^[ㅁ마말]/.test(t) || t === '말일') {
      setRecForm(p => ({ ...p, dueDay: '31' })); setRecDueDayDisp('말일'); return
    }
    const n = parseInt(t.replace(/\D/g, ''), 10)
    if (!isNaN(n) && n > 0) {
      if (n >= 30) { setRecForm(p => ({ ...p, dueDay: '31' })); setRecDueDayDisp('말일') }
      else { setRecForm(p => ({ ...p, dueDay: String(n) })); setRecDueDayDisp(`${n}일`) }
    }
  }

  useEffect(() => { getRecurringExpenses().then(setRecurringList).catch(console.error) }, [])

  const openNewRec = () => {
    setEditingRec(null)
    setRecForm({ title: '', amount: '', category: '관리비', dueDay: '25', payMethod: '', isAutoDebit: false, isVariable: false, alertDaysBefore: '7', activeSince: acqDate ?? '', memo: '' })
    setRecDueDayDisp('25일')
    setShowRecForm(true)
  }
  const openEditRec = (r: RecurringExpenseRow) => {
    setEditingRec(r)
    setRecForm({ title: r.title, amount: r.amount.toString(), category: r.category, dueDay: r.dueDay.toString(), payMethod: r.payMethod ?? '', isAutoDebit: r.isAutoDebit, isVariable: r.isVariable, alertDaysBefore: r.alertDaysBefore.toString(), activeSince: r.activeSince ?? '', memo: r.memo ?? '' })
    setRecDueDayDisp(fmtRecDueDay(r.dueDay.toString()))
    setShowRecForm(true)
  }
  const handleSaveRec = () => {
    const data = {
      title: recForm.title.trim(),
      amount: Number(recForm.amount.replace(/[^0-9]/g, '')),
      category: recForm.category,
      dueDay: parseInt(recForm.dueDay) || 25,
      payMethod: recForm.payMethod || undefined,
      isAutoDebit: recForm.isAutoDebit,
      isVariable: recForm.isVariable,
      alertDaysBefore: parseInt(recForm.alertDaysBefore) || 7,
      activeSince: recForm.activeSince || undefined,
      memo: recForm.memo || undefined,
    }
    if (!data.title || !data.amount) return
    startRecTransition(async () => {
      if (editingRec) {
        await updateRecurringExpense(editingRec.id, data)
        setRecurringList(prev => prev.map(r => r.id === editingRec.id ? { ...r, ...data, payMethod: data.payMethod ?? null, memo: data.memo ?? null, activeSince: data.activeSince ?? null } : r))
      } else {
        const res = await addRecurringExpense(data)
        if (res.ok) {
          const updated = await getRecurringExpenses()
          setRecurringList(updated)
        }
      }
      setShowRecForm(false)
    })
  }
  const handleDeleteRec = async (id: string, title: string) => {
    if (!confirm(`'${title}' 고정 지출을 삭제할까요?`)) return
    await deleteRecurringExpense(id)
    setRecurringList(prev => prev.filter(r => r.id !== id))
  }
  const handleToggleRec = async (r: RecurringExpenseRow) => {
    await updateRecurringExpense(r.id, { isActive: !r.isActive })
    setRecurringList(prev => prev.map(x => x.id === r.id ? { ...x, isActive: !x.isActive } : x))
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
                ? 'bg-[var(--coral)] text-white'
                : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 기본정보 탭 */}
      {tab === 'basic' && (
        <>
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">영업장 기본 정보</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="영업장명 *" name="name" defaultValue={property?.name ?? ''} />
            <Field label="주소" name="address" defaultValue={property?.address ?? ''} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">대표 연락처</label>
              <PhoneInput name="phone" defaultValue={property?.phone ?? ''} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">인수 날짜</label>
              <p className="text-xs text-[var(--warm-muted)]">실제 영업장을 인수한 날짜입니다.</p>
              <DatePicker name="acquisitionDate" value={acqDateVal} onChange={setAcqDateVal}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">양도인 귀속 기준일</label>
              <p className="text-xs text-[var(--warm-muted)]">이 날짜 이전 수납금은 양도인 귀속으로 처리됩니다. 비워두면 인수 날짜와 동일.</p>
              <DatePicker name="prevOwnerCutoffDate" value={cutoffDateVal} onChange={setCutoffDateVal}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
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
              className="w-full py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60 mt-2">
              {isPending ? '저장 중...' : '저장'}
            </button>
          </form>
        </div>

        {/* 데이터 점검 — 발생주의 진단 페이지 링크 */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6 mt-4">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">데이터 점검</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
            수납 기록의 입금일(payDate)과 귀속 월(targetMonth)이 회계 기준에 맞게 분류되어 있는지 확인합니다.
            지연 입금·월 불일치 등 재검토 후보를 보고 직접 귀속 월을 조정할 수 있습니다.
          </p>
          <a href="/accrual-check"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
            발생주의 데이터 진단 →
          </a>
        </div>

        {/* 데이터 백업 */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6 mt-4">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">데이터 백업</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
            영업장의 모든 데이터(호실·입주자·계약·수납·지출·기타수익 등)를 JSON 파일로 내려받습니다.
            정기적으로 백업해두면 사고 시 복구에 활용할 수 있습니다.
          </p>
          <BackupButton />
        </div>
        </>
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
            onReorder={handleReorderRoomTypes}
            onRename={handleRenameRoomType}
            onReset={handleResetRoomTypes}
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
            onReorder={handleReorderWindowTypes}
            onRename={handleRenameWindowType}
            onReset={handleResetWindowTypes}
            placeholder="예: 복층창, 루프탑창..."
          />
          <OptionSection
            title="방향 관리"
            description="호실 등록 시 선택할 수 있는 방향 목록입니다."
            items={directions}
            getLabel={v => v}
            newValue={newDirection}
            onNewValueChange={setNewDirection}
            onAdd={handleAddDirection}
            onDelete={handleDeleteDirection}
            onReorder={handleReorderDirections}
            onRename={handleRenameDirection}
            onReset={handleResetDirections}
            placeholder="예: 남동향, 남남동향..."
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
            onReorder={handleReorderIncomeCategs}
            onRename={handleRenameIncomeCateg}
            onReset={handleResetIncomeCategs}
            placeholder="예: 건조기, 세탁기, 자판기..."
          />
          <OptionSection
            title="지출 카테고리 관리"
            description="지출 등록 시 선택할 카테고리입니다. 고정 지출에도 사용됩니다."
            items={expenseCategs}
            getLabel={v => v}
            newValue={newExpenseCateg}
            onNewValueChange={setNewExpenseCateg}
            onAdd={handleAddExpenseCateg}
            onDelete={handleDeleteExpenseCateg}
            onReorder={handleReorderExpenseCategs}
            onRename={handleRenameExpenseCateg}
            onReset={handleResetExpenseCategs}
            placeholder="예: 임대료, 보험료, 통신비..."
          />
          <OptionSection
            title="결제 수단 관리"
            description="지출·고정 지출 등록 시 선택할 결제 수단입니다."
            items={payMethods}
            getLabel={v => v}
            newValue={newPayMethod}
            onNewValueChange={setNewPayMethod}
            onAdd={handleAddPayMethod}
            onDelete={handleDeletePayMethod}
            onReorder={handleReorderPayMethods}
            onRename={handleRenamePayMethod}
            onReset={handleResetPayMethods}
            placeholder="예: 자동이체, 법인카드..."
          />

          {/* 고정 지출 관리 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--warm-dark)]">고정 지출 관리</h2>
                <p className="text-xs text-[var(--warm-muted)] mt-0.5">매월 반복되는 지출 항목. 납부일 전 대시보드에 알림이 표시됩니다.</p>
              </div>
              <button onClick={openNewRec}
                className="px-3 py-1.5 text-xs font-medium rounded-xl transition-colors"
                style={{ background: 'var(--coral)', color: '#fff' }}>+ 추가</button>
            </div>

            {/* 등록/편집 폼 */}
            {showRecForm && (
              <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-[var(--warm-dark)]">{editingRec ? '고정 지출 수정' : '고정 지출 추가'}</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">항목명 *</label>
                  <input type="text" value={recForm.title} onChange={e => setRecForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="예: 건물 임대료, 관리비"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                    <MoneyInput
                      value={Number(recForm.amount) || 0}
                      onChange={v => setRecForm(p => ({ ...p, amount: String(v) }))}
                      placeholder="0원" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">납부일 (매월)</label>
                    <input
                      type="text"
                      value={recDueDayDisp}
                      onChange={e => {
                        const v = e.target.value
                        const stripped = v.replace(/일$/, '').trim()
                        const n = Number(stripped)
                        if (/[ㅁ마말]/.test(v) || (stripped !== '' && !isNaN(n) && n >= 30)) {
                          setRecForm(p => ({ ...p, dueDay: '31' })); setRecDueDayDisp('말일')
                        } else {
                          setRecDueDayDisp(v)
                        }
                      }}
                      onFocus={() => setRecDueDayDisp(prev => prev.replace(/일$/, ''))}
                      onBlur={() => applyRecDueDay(recDueDayDisp)}
                      placeholder="25일, 말일 등"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리</label>
                  <select value={recForm.category} onChange={e => setRecForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    {expenseCategs.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <p className="text-[10px] text-[var(--warm-muted)]">카테고리 추가·수정은 위 '지출 카테고리 관리'에서 할 수 있습니다.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">알림 (납부일 N일 전)</label>
                  <input type="number" min={0} max={30} value={recForm.alertDaysBefore}
                    onChange={e => setRecForm(p => ({ ...p, alertDaysBefore: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  <p className="text-[10px] text-[var(--warm-muted)]">자동이체 항목은 주말·공휴일이면 다음 영업일 기준으로 알림이 계산됩니다.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">활성화 시작일 (선택)</label>
                  <DatePicker value={recForm.activeSince} onChange={v => setRecForm(p => ({ ...p, activeSince: v }))}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
                  <p className="text-[10px] text-[var(--warm-muted)] leading-relaxed">
                    이 항목이 실제로 <strong>내 부담</strong>이 되는 첫 날짜입니다.<br />
                    예) 인터넷 요금 결제일이 25일이고 4월25일분이 3월 사용분이면, 양도인이 부담하는 마지막 청구가 4월 → 내 부담 시작은 <strong>5월 청구분(5월25일)</strong>부터이므로 2026-05-25 입력.<br />
                    입력하지 않으면 즉시 활성화됩니다.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">결제 수단 (선택)</label>
                  <select value={recForm.payMethod} onChange={e => setRecForm(p => ({ ...p, payMethod: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    <option value="">선택 안 함</option>
                    {payMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recForm.isAutoDebit} onChange={e => setRecForm(p => ({ ...p, isAutoDebit: e.target.checked }))} className="accent-[var(--coral)]" />
                    <span className="text-xs text-[var(--warm-dark)]">자동이체 항목</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recForm.isVariable} onChange={e => setRecForm(p => ({ ...p, isVariable: e.target.checked }))} className="accent-[var(--coral)]" />
                    <div>
                      <span className="text-xs text-[var(--warm-dark)]">변동 금액</span>
                      <p className="text-[10px] text-[var(--warm-muted)] leading-tight mt-0.5">전기·수도 등 매달 금액이 달라지는 항목</p>
                    </div>
                  </label>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모 (선택)</label>
                  <input type="text" value={recForm.memo} onChange={e => setRecForm(p => ({ ...p, memo: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowRecForm(false)}
                    className="flex-1 py-2 text-sm rounded-xl border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">취소</button>
                  <button onClick={handleSaveRec} disabled={recPending || !recForm.title.trim() || !recForm.amount}
                    className="flex-1 py-2 text-sm font-medium rounded-xl text-white transition-colors disabled:opacity-50"
                    style={{ background: 'var(--coral)' }}>{recPending ? '저장 중…' : '저장'}</button>
                </div>
              </div>
            )}

            {/* 목록 */}
            {recurringList.length === 0 && !showRecForm && (
              <p className="text-sm text-[var(--warm-muted)] text-center py-3">등록된 고정 지출이 없습니다.</p>
            )}
            <div className="space-y-2">
              {recurringList.map(r => (
                <div key={r.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${r.isActive ? 'bg-[var(--canvas)]' : 'bg-[var(--canvas)] opacity-50'}`}
                  style={{ border: '1px solid var(--warm-border)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{r.title}</p>
                      {r.isAutoDebit && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">자동이체</span>}
                      {!r.isActive && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">비활성</span>}
                    </div>
                    <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                      매월 {r.dueDay >= 30 ? '말일' : `${r.dueDay}일`} · {r.amount.toLocaleString()}원 · {r.category} · {r.alertDaysBefore}일 전 알림
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleToggleRec(r)}
                      className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
                      {r.isActive ? '비활성' : '활성화'}
                    </button>
                    <button onClick={() => openEditRec(r)}
                      className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">수정</button>
                    <button onClick={() => handleDeleteRec(r.id, r.title)}
                      className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-red-200 text-red-400 hover:text-red-600 transition-colors">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
                  <div className="w-8 h-8 rounded-full bg-[var(--coral)] flex items-center justify-center text-sm font-medium text-white shrink-0">
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
              <p className="text-xs text-[var(--warm-muted)] mb-4">초대할 멤버가 먼저 <a href="/login" className="underline">RoomOS에 Google로 로그인</a>한 후 이메일을 입력해주세요.</p>
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
                    className="px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
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
  title, description, items, getLabel, newValue, onNewValueChange, onAdd, onDelete, onReorder, onRename, onReset, placeholder,
}: {
  title: string
  description?: string
  items: string[]
  getLabel: (v: string) => string
  newValue: string
  onNewValueChange: (v: string) => void
  onAdd: () => void | Promise<void>
  onDelete: (v: string) => void
  onReorder?: (items: string[]) => void
  onRename?: (oldValue: string, newValue: string) => void
  onReset?: () => void | Promise<void>
  placeholder?: string
}) {
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const trimmed = newValue.trim()
  const isDuplicate = trimmed !== '' && items.includes(trimmed)

  const handleAdd = async () => {
    if (isAdding || !trimmed || isDuplicate) return
    setIsAdding(true)
    try { await onAdd() } finally { setIsAdding(false) }
  }

  const move = (idx: number, dir: -1 | 1) => {
    if (!onReorder) return
    const next = [...items]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onReorder(next)
  }

  const startEdit = (item: string) => {
    setEditingItem(item)
    setEditingValue(item)
  }

  const saveEdit = () => {
    if (editingItem !== null) {
      onRename?.(editingItem, editingValue)
      setEditingItem(null)
    }
  }

  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-6">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">{title}</h2>
        {onReset && (
          <button onClick={onReset}
            className="shrink-0 text-[11px] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] border border-[var(--warm-border)] rounded-lg px-2 py-0.5 transition-colors">
            기본값으로 초기화
          </button>
        )}
      </div>
      {description && <p className="text-xs text-[var(--warm-muted)] mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      <div className="space-y-2 mb-4">
        {items.length === 0 && (
          <p className="text-xs text-[var(--warm-muted)] py-2">항목이 없습니다.</p>
        )}
        {items.map((item, idx) => (
          <div key={`${item}-${idx}`} className="flex items-center gap-2 bg-[var(--canvas)] rounded-xl px-3 py-2">
            {onReorder && editingItem !== item && (
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  className="w-6 h-5 flex items-center justify-center rounded text-[var(--warm-mid)] hover:text-[var(--warm-dark)] disabled:opacity-20 transition-colors text-[10px] leading-none">
                  ▲
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === items.length - 1}
                  className="w-6 h-5 flex items-center justify-center rounded text-[var(--warm-mid)] hover:text-[var(--warm-dark)] disabled:opacity-20 transition-colors text-[10px] leading-none">
                  ▼
                </button>
              </div>
            )}
            {editingItem === item ? (
              <>
                <input
                  value={editingValue}
                  onChange={e => setEditingValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingItem(null) }}
                  autoFocus
                  className="flex-1 bg-[var(--canvas)] border border-[var(--coral)] rounded-lg px-2 py-1 text-sm text-[var(--warm-dark)] outline-none"
                />
                <button onClick={saveEdit}
                  className="shrink-0 text-[10px] px-2 py-1 rounded-lg text-white transition-colors"
                  style={{ background: 'var(--coral)' }}>저장</button>
                <button onClick={() => setEditingItem(null)}
                  className="shrink-0 text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">취소</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-[var(--warm-dark)]">{getLabel(item)}</span>
                {onRename && (
                  <button onClick={() => startEdit(item)}
                    className="shrink-0 text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">수정</button>
                )}
                <button onClick={() => onDelete(item)}
                  className="shrink-0 text-[10px] text-red-400 hover:text-red-300 transition-colors px-1">삭제</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <input type="text" value={newValue}
            onChange={e => onNewValueChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder={placeholder ?? '입력...'}
            className={`flex-1 bg-[var(--canvas)] border rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none transition-colors ${
              isDuplicate ? 'border-red-400 focus:border-red-400' : 'border-[var(--warm-border)] focus:border-[var(--coral)]'
            }`} />
          <button onClick={handleAdd} disabled={isAdding || !trimmed || isDuplicate}
            className="px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 min-w-[56px]">
            {isAdding ? '…' : '등록'}
          </button>
        </div>
        {isDuplicate && (
          <p className="text-[11px] text-red-400">이미 존재하는 항목입니다.</p>
        )}
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

function BackupButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const handleBackup = async () => {
    setError('')
    setBusy(true)
    try {
      const json = await exportAllData()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const ts = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `roomos-backup-${ts}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError((err as Error).message ?? '백업 실패')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <button type="button" onClick={handleBackup} disabled={busy}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl bg-[var(--coral)] hover:opacity-90 text-white transition-opacity disabled:opacity-60">
        {busy ? '백업 생성 중...' : 'JSON 백업 다운로드'}
      </button>
      {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
    </div>
  )
}
