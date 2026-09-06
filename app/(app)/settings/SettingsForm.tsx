'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { type SettingsTab } from './tabs'
import { AiKeyGuide } from '@/components/ui/AiQuotaHint'
import { InfoHint } from '@/components/ui/InfoHint'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { fmtWon } from '@/lib/fmtMoney'
import { useRouter } from 'next/navigation'
import { DEFAULT_DISPOSAL_CONSENT, DEFAULT_SUB_LEASE_ADDENDUM, DEFAULT_SHORT_STAY_ADDENDUM, DEFAULT_EARLY_CHECKOUT_ADDENDUM, DEFAULT_ROOM_SCHEDULE_ADDENDUM,
  resolveSubLeaseAddendum, resolveShortStayAddendum, resolveEarlyCheckoutAddendum, resolveRoomScheduleAddendum, type DisposalConsentTemplate } from '@/lib/contract'
import {
  updatePropertySettings,
  getRoomTypeOptions, addRoomTypeOption, deleteRoomTypeOption,
  getRoomTierOptions, addRoomTierOption, deleteRoomTierOption,
  getWindowTypeOptions, addWindowTypeOption, deleteWindowTypeOption,
  getRoomDirectionOptions, addRoomDirectionOption, deleteRoomDirectionOption,
  getIncomeCategories, addIncomeCategory, deleteIncomeCategory,
  getExpenseCategories, addExpenseCategory, deleteExpenseCategory,
  getPaymentMethods, addPaymentMethod, deletePaymentMethod,
  getRequestCategories, addRequestCategory, deleteRequestCategory,
  getSpecUnitOptions, getQtyUnitOptions, addUnitOption, deleteUnitOption,
  reorderOptions, renameOption, countRenameTargets, resetOptionsToDefault,
  getWorkKindOptions, addWorkKindOption, deleteWorkKindOption,
  inviteMember, updateMemberRole, removeMember,
  getRecurringExpenses, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense, ungroupRecurringExpense,
  exportAllData,
  saveContractTemplate, saveBusinessInfo,
  createStampUploadSession, finalizeStamp, deleteStamp,
  createBizCertUploadSession, finalizeBizCert, deleteBizCert,
  createLogoUploadSession, finalizeLogo, deleteLogo,
  createAppLogoUploadSession, finalizeAppLogo, deleteAppLogo,
  type MemberWithUser, type RecurringExpenseRow, type ContractSettings, type RecurringItemInput,
  getShortStayPolicy, updateShortStayPolicy,
  listItemSpecOptions, renameItemSpecOption, deleteItemSpecOption, type ItemSpecGroup,
  getSmsTemplates, saveSmsTemplate, deleteSmsTemplate, type SmsTemplateRow,
  saveSignDocument, setSignDocumentRetired,
  getDocMailSettings, updateDocMailTemplate, renderDocMailSample,
  getAiSettings, saveAiSettings,
} from './actions'
import { regenerateJoinCode, getOrCreateJoinCode, approveJoinRequest, rejectJoinRequest } from './memberActions'
import type { ContractTemplate, ContractSection, BusinessInfo } from '@/lib/contract'
import type { DocMailTemplate } from '@/lib/docMail'
import { uploadFileToDriveSession } from '@/lib/driveUpload'
import { Btn, BtnLink, btnClass } from '@/components/ui/Btn'
import { parseSignDocuments, type SignDocument } from '@/lib/signDocuments'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { ImageCropModal } from '@/components/ui/ImageCropModal'
import { PushToggle } from './PushToggle'
import { CalendarSubscribeCard } from './CalendarSubscribeCard'
import { ItemNameMergePanel } from './ItemNameMergePanel'
import { WebsiteTab } from './WebsiteTab'
import { ViewTabs } from '@/components/ui/ViewTabs'
import type { SiteRoomCandidates } from '@/lib/siteCandidates'
import DataButtons from '@/components/DataButtons'
import { deactivateProperty, deletePropertyPermanently, getPropertyDeletionImpact } from '@/app/property-select/actions'
import { Modal } from '@/components/ui/Modal'
import { DocVariablesOverviewCard } from './DocVariablesPanel'
import { ROLE_LABEL, type Role } from '@/lib/role-types'
import { useTheme, type ThemeMode } from '@/components/theme/ThemeProvider'
import { useFontSize, type FontSizeLevel } from '@/components/theme/FontSizeProvider'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'
import {
  DEFAULT_RECURRING_DUE_DAY,
  DEFAULT_RECURRING_CATEGORY,
  DEFAULT_RECURRING_ALERT_DAYS_BEFORE,
} from '@/lib/appConfig'
import { trackSave, pushToast, humanError } from '@/lib/saveStatus'
import { calcShortStay, type ShortStayPolicy, type ShortStayReservationMode } from '@/lib/shortStay'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { RECURRING_INTERVAL_CHOICES, recurringCycleLabel, recurringCycleWord } from '@/lib/recurringDueDate'
import { normalizeMailFromLocal, MAIL_FROM_LOCAL_MAX } from '@/lib/mailFrom'

type Property = {
  id: string
  name: string
  address: string | null
  phone: string | null
  replyToEmail?: string | null   // 서류 메일 답장 주소(2026-08-25)
  mailFromLocal?: string | null  // 서류 메일 발신 주소 앞부분(2026-08-26)
  mailCopyToSelf?: boolean       // 보낸 메일 사본 받기(2026-08-26)
  acquisitionDate: Date | null
  prevOwnerCutoffDate: Date | null
  defaultDeposit: number | null
  defaultCleaningFee: number | null
  refundPenaltyPct?: number | null   // 중도퇴실 위약금 기본값(%) — 공정위 10% 캡
  defaultAreaM2: number | null
  reservationDepositMode: string | null
  bankAccount: string | null
  contactLeadDays?: number | null
  checkoutLeadShortDays?: number | null
  checkoutLeadMonths?: number | null
  refundClauseInContract: boolean
  cleaningFeeInDeposit: boolean   // 청소비를 보증금 안의 몫으로 받는 영업장인지(2026-08-10)
  multiContractVersions: boolean  // 한 계약에 여러 판본 계약서를 만들 수 있는 영업장인지(2026-08-20)
  disposalConsentTemplate: unknown
  signDocuments: unknown   // 영업장이 만든 추가 서류(제3 서류)
  subLeaseAddendum: unknown
  shortStayAddendum: unknown
  earlyCheckoutAddendum: unknown
  roomScheduleAddendum: unknown
  publicSlug: string | null
  logoDriveFileId: string | null
  logoThumbnailUrl: string | null
  appLogoDriveFileId: string | null
  appLogoThumbnailUrl: string | null
}

const WINDOW_TYPE_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
}

function windowLabel(val: string) {
  return WINDOW_TYPE_LABEL[val] ?? val
}

type Tab = SettingsTab

// 2026-08-19 IA 2단계(운영자 승인) 순서. 읽는 사람이 안에서 밖으로 걸어 나가는 차례다 —
// 우리가 누구인지(기본정보), 얼마를 받는지(요금·정책), 무엇으로 부르는지(분류 관리),
// 무엇을 써 주는지(계약서·서류), 손님에게 어떻게 보이는지(웹사이트), 누가 함께 쓰는지(멤버 관리),
// 그리고 안쪽 살림 둘(데이터·도구, 화면). 앞의 넷이 영업장 자체를 정하는 칸이고 뒤의 넷은 도구다.
const TABS: { key: Tab; label: string }[] = [
  { key: 'basic',      label: '기본정보' },
  { key: 'pricing',    label: '요금·정책' },
  { key: 'options',    label: '분류 관리' },
  { key: 'contract',   label: '계약서·서류' },
  { key: 'website',    label: '웹사이트' },
  { key: 'members',    label: '멤버 관리' },
  { key: 'data',       label: '데이터·도구' },
  { key: 'appearance', label: '화면' },
]

// ?tab= 딥링크 검증(isSettingsTab)과 탭 키 타입은 ./tabs 정본으로 — 서버가 이 파일('use client')의
// 함수를 부르면 실행에서만 터진다(2026-08-18 /settings 사고).

type JoinRequestRow = {
  id: string
  role: Role
  message: string | null
  createdAt: Date
  user: { id: string; email: string; name: string | null; realName: string | null; phone: string | null }
}

export default function SettingsForm({
  property,
  members: initialMembers,
  myRole,
  contractSettings,
  initialJoinCode,
  initialJoinRequests,
  siteCandidates,
  initialTab,
}: {
  property: Property | null
  members: MemberWithUser[]
  myRole: Role
  contractSettings: ContractSettings
  initialJoinCode?: string | null
  initialJoinRequests?: JoinRequestRow[]
  /** 소개 페이지 반영 대기 — 서버가 실어 내린다(웹사이트 탭이 마운트에서 다시 받지 않는다). */
  siteCandidates: SiteRoomCandidates
  /** ?tab= 딥링크 착지 탭. 홈의 '소개 페이지 반영 대기 N건' 링크가 website 로 들어온다. */
  initialTab?: Tab
}) {
  const router = useRouter()
  const [tab, setTab]             = useState<Tab>(initialTab ?? 'basic')
  const [toast, setToast]         = useState('')
  const [isPending, startTransition] = useTransition()

  // 영업장 로고 — 계약서 이외 위치(사이드바·대시보드 등)에서도 재사용 예정이므로 기본정보에서 관리
  const [logoUrl, setLogoUrl]         = useState<string | null>(property?.logoThumbnailUrl ?? null)
  const [logoUploading, setLogoUploading] = useState(false)

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setLogoUploading(true)
    const release = trackSave()
    try {
      const session = await createLogoUploadSession({
        fileName: file.name, mimeType: file.type, fileSize: file.size,
        origin: window.location.origin,
      })
      if (!session.ok) { pushToast('error', session.error); return }
      const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file)
      const fin = await finalizeLogo(driveFileId)
      if (!fin.ok) { pushToast('error', fin.error); return }
      setLogoUrl(fin.thumbnailUrl)
      pushToast('success', '로고 업로드됨')
    } catch (err) {
      pushToast('error', humanError(err, '로고 업로드 실패'))
    } finally { release(); setLogoUploading(false) }
  }
  const handleLogoDelete = async () => {
    if (!(await confirmDialog({ title: '영업장 로고를 삭제할까요?', level: 'caution', confirmLabel: '삭제' }))) return
    const release = trackSave()
    try {
      const res = await deleteLogo()
      if (!res.ok) { pushToast('error', res.error); return }
      setLogoUrl(null)
      pushToast('success', '로고 삭제됨')
    } finally { release() }
  }

  // 영업장 로고(앱 표시·원형) — 헤더·사이드바·대시보드. 업로드 시 원형 크롭 도구로 위치·확대 조정.
  const [appLogoUrl, setAppLogoUrl]         = useState<string | null>(property?.appLogoThumbnailUrl ?? null)
  const [appLogoUploading, setAppLogoUploading] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)   // 크롭 모달용 원본 object URL
  const closeCrop = () => { setCropSrc(s => { if (s) URL.revokeObjectURL(s); return null }) }
  // 파일 선택 → 바로 업로드하지 않고 크롭 도구를 연다
  const handleAppLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(URL.createObjectURL(file))
  }
  // 크롭 확정 → 정사각 PNG 업로드
  const handleAppLogoCropped = async (blob: Blob) => {
    setAppLogoUploading(true)
    const release = trackSave()
    try {
      const file = new File([blob], 'logo.png', { type: 'image/png' })
      const session = await createAppLogoUploadSession({
        fileName: file.name, mimeType: file.type, fileSize: file.size,
        origin: window.location.origin,
      })
      if (!session.ok) { pushToast('error', session.error); return }
      const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file)
      const fin = await finalizeAppLogo(driveFileId)
      if (!fin.ok) { pushToast('error', fin.error); return }
      setAppLogoUrl(fin.thumbnailUrl)
      pushToast('success', '영업장 로고 저장됨')
    } catch (err) {
      pushToast('error', humanError(err, '로고 업로드 실패'))
    } finally { release(); setAppLogoUploading(false); closeCrop() }
  }
  const handleAppLogoDelete = async () => {
    if (!(await confirmDialog({ title: '영업장 로고를 삭제할까요?', level: 'caution', confirmLabel: '삭제' }))) return
    const release = trackSave()
    try {
      const res = await deleteAppLogo()
      if (!res.ok) { pushToast('error', res.error); return }
      setAppLogoUrl(null)
      pushToast('success', '영업장 로고 삭제됨')
    } finally { release() }
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // 옵션 이름 변경 공통 흐름 — 같은 값을 쓰는 기존 데이터도 함께 바뀌므로, 대상이 있으면 건수를 먼저 고지한다.
  const runRename = async (
    field: Parameters<typeof renameOption>[0],
    oldVal: string,
    rawNew: string,
    setItems: (updater: (prev: string[]) => string[]) => void,
  ) => {
    const newVal = rawNew.trim()
    if (!newVal || newVal === oldVal) return
    const targets = await countRenameTargets(field, oldVal)
    if (targets > 0) {
      const ok = await confirmDialog({
        title: `'${oldVal}'을(를) '${newVal}'(으)로 바꿀까요?`,
        message: `기존 데이터 ${targets}건도 함께 변경됩니다.`,
        level: 'caution',
        confirmLabel: '변경',
      })
      if (!ok) return
    }
    const res = await renameOption(field, oldVal, newVal)
    if (!res.ok) { pushToast('error', res.error); return }
    setItems(prev => prev.map(v => v === oldVal ? newVal : v))
    pushToast('success', '이름이 변경되었습니다', res.updated > 0
      ? { detail: '되돌리려면 이름을 다시 바꾸면 데이터도 함께 돌아옵니다.' }
      : undefined)
  }

  const handleSubmit = async (e: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        await updatePropertySettings(formData)
        showToast('저장되었습니다.')
        pushToast('success', '환경설정 저장됨')
      } catch (err: unknown) {
        const msg = '저장 실패: ' + (err as Error).message
        showToast(msg)
        pushToast('error', msg)
      } finally { release() }
    })
  }

  // 서류 변수 조망에서 원천 카드로 점프 — 탭을 바꾼 뒤 두 프레임 기다려 앵커로 스크롤한다
  // (탭 전환 직후에는 대상 카드가 아직 렌더 전이다).
  const jumpTo = (t: Tab, anchorId: string) => {
    setTab(t)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }))
  }

  const acqDate = property?.acquisitionDate
    ? new Date(property.acquisitionDate).toISOString().slice(0, 10)
    : ''
  const cutoffDate = property?.prevOwnerCutoffDate
    ? new Date(property.prevOwnerCutoffDate).toISOString().slice(0, 10)
    : ''
  // 발신 주소 앞부분 — 입력하는 동안 허용 문자만 남긴다(전용면적 칸과 같은 문법).
  // '@' 는 치도록 두고 저장 때 정본이 잘라낸다 — 전체 주소를 붙여넣는 손을 막지 않는다.
  const [mailFromLocal, setMailFromLocal]   = useState(property?.mailFromLocal ?? '')
  const [acqDateVal, setAcqDateVal]         = useState(acqDate)
  const [cutoffDateVal, setCutoffDateVal]   = useState(cutoffDate)
  // 전용면적·임의처분 동의서는 2026-08-19 IA 2단계에서 계약서·서류 탭으로 옮겼다 — 그 값들의
  // 상태도 함께 갔다(DocumentDefaultsCard). 여기서 들고 있으면 쓰는 자리와 사는 자리가 갈린다.

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
    if (!(await confirmDialog({ title: `'${name}' 방타입을 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteRoomTypeOption(name)
    setRoomTypes(prev => prev.filter(t => t !== name))
  }
  const handleReorderRoomTypes = async (items: string[]) => {
    setRoomTypes(items)
    await reorderOptions('roomTypeOptions', items)
  }
  const handleRenameRoomType = async (oldVal: string, newVal: string) => {
    await runRename('roomTypeOptions', oldVal, newVal, setRoomTypes)
  }
  const handleResetRoomTypes = async () => {
    if (!(await confirmDialog({ title: '방타입을 기본값(원룸, 미니룸)으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setRoomTypes(await resetOptionsToDefault('roomTypeOptions'))
  }

  // ── 호실 등급 (스탠다드/실속형 등 — 방 타입과 별개 차원) ─────────────────
  const [roomTiers, setRoomTiers] = useState<string[]>([])
  const [newRoomTier, setNewRoomTier] = useState('')

  useEffect(() => { getRoomTierOptions().then(setRoomTiers).catch(console.error) }, [])

  const handleAddRoomTier = async () => {
    const v = newRoomTier.trim(); if (!v) return
    await addRoomTierOption(v)
    setRoomTiers(prev => [...prev, v]); setNewRoomTier('')
  }
  const handleDeleteRoomTier = async (name: string) => {
    if (!(await confirmDialog({ title: `'${name}' 등급을 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteRoomTierOption(name)
    setRoomTiers(prev => prev.filter(t => t !== name))
  }
  const handleReorderRoomTiers = async (items: string[]) => {
    setRoomTiers(items)
    await reorderOptions('roomTierOptions', items)
  }
  const handleRenameRoomTier = async (oldVal: string, newVal: string) => {
    await runRename('roomTierOptions', oldVal, newVal, setRoomTiers)
  }
  const handleResetRoomTiers = async () => {
    if (!(await confirmDialog({ title: '등급을 기본값(스탠다드, 실속형)으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setRoomTiers(await resetOptionsToDefault('roomTierOptions'))
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
    if (!(await confirmDialog({ title: `'${windowLabel(name)}' 창문 유형을 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteWindowTypeOption(name)
    setWindowTypes(prev => prev.filter(t => t !== name))
  }
  const handleReorderWindowTypes = async (items: string[]) => {
    setWindowTypes(items)
    await reorderOptions('windowTypeOptions', items)
  }
  const handleRenameWindowType = async (oldVal: string, newVal: string) => {
    await runRename('windowTypeOptions', oldVal, newVal, setWindowTypes)
  }
  const handleResetWindowTypes = async () => {
    if (!(await confirmDialog({ title: '창문 유형을 기본값(외창, 내창)으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
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
    if (!(await confirmDialog({ title: `'${name}' 방향을 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteRoomDirectionOption(name)
    setDirections(prev => prev.filter(t => t !== name))
  }
  const handleReorderDirections = async (items: string[]) => {
    setDirections(items)
    await reorderOptions('directionOptions', items)
  }
  const handleRenameDirection = async (oldVal: string, newVal: string) => {
    await runRename('directionOptions', oldVal, newVal, setDirections)
  }
  const handleResetDirections = async () => {
    if (!(await confirmDialog({ title: '방향을 기본값(북향~북서향 8방위)으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setDirections(await resetOptionsToDefault('directionOptions'))
  }

  // ── 작업 종류 ──────────────────────────────────────────────────
  // 청소가 아닌 방 작업(도배·장판 등). 형제 여덟과 같은 손놀림이다.
  // 청소는 이 목록에 없다 — 제 폼과 제 표를 갖고 있어 한 목록에 넣으면 고르는 순간
  // 일어나는 일이 갈린다(디자인 패널 판정 2026-08-25). 그 사실은 카드 설명이 말한다.
  const [workKinds, setWorkKinds] = useState<string[]>([])
  const [newWorkKind, setNewWorkKind] = useState('')

  useEffect(() => { getWorkKindOptions().then(setWorkKinds).catch(console.error) }, [])

  const handleAddWorkKind = async () => {
    const v = newWorkKind.trim(); if (!v) return
    await addWorkKindOption(v)
    setWorkKinds(prev => [...prev, v]); setNewWorkKind('')
  }
  const handleDeleteWorkKind = async (name: string) => {
    if (!(await confirmDialog({ title: `'${name}' 작업 종류를 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteWorkKindOption(name)
    setWorkKinds(prev => prev.filter(t => t !== name))
  }
  const handleReorderWorkKinds = async (items: string[]) => {
    setWorkKinds(items)
    await reorderOptions('workKindOptions', items)
  }
  const handleRenameWorkKind = async (oldVal: string, newVal: string) => {
    await runRename('workKindOptions', oldVal, newVal, setWorkKinds)
  }
  const handleResetWorkKinds = async () => {
    if (!(await confirmDialog({ title: '작업 종류를 기본값(도배, 장판)으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setWorkKinds(await resetOptionsToDefault('workKindOptions'))
  }

  // ── 멤버 관리 ──────────────────────────────────────────────────
  const [members, setMembers] = useState<MemberWithUser[]>(initialMembers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('STAFF')
  const isOwner = myRole === 'OWNER'

  const handleInvite = async () => {
    const email = inviteEmail.trim(); if (!email) return
    const result = await inviteMember(email, inviteRole)
    if (!result.ok) { showToast(result.error); return }
    setInviteEmail('')
    showToast('멤버가 추가되었습니다.')
    router.refresh()
  }

  const handleRoleChange = async (userId: string, role: Role) => {
    // 금액 가시성을 낮추는 변경(→ 제한 스태프)은 되돌릴 수 없는 인상이 아니므로 확인만 — 오조작 방지
    const prevRole = members.find(m => m.userId === userId)?.role
    if (role === 'LIMITED_STAFF' && prevRole !== 'LIMITED_STAFF') {
      if (!(await confirmDialog({ title: '이 멤버는 앞으로 금액·매출을 볼 수 없게 됩니다. 계속할까요?', level: 'caution', confirmLabel: '계속' }))) return
    }
    const result = await updateMemberRole(userId, role)
    if (!result.ok) { showToast(result.error); return }
    setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role, roleLabel: ROLE_LABEL[role] } : m))
  }

  const handleRemove = async (userId: string, name: string) => {
    if (!(await confirmDialog({ title: `'${name}' 멤버를 제거할까요?`, message: '이 영업장에 더 이상 접근할 수 없게 됩니다. 참여 코드로 다시 참여할 수 있습니다.', level: 'caution', confirmLabel: '제거' }))) return
    const result = await removeMember(userId)
    if (!result.ok) { showToast(result.error); return }
    setMembers(prev => prev.filter(m => m.userId !== userId))
    showToast('멤버가 제거되었습니다.')
  }

  // ── 참여 코드 + 참여 요청 (D) ───────────────────────────────────────
  const [joinCode, setJoinCode] = useState<string | null>(initialJoinCode ?? null)
  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>(initialJoinRequests ?? [])

  // 왕복 중 버튼을 잠근다 — regenerateJoinCode 는 부를 때마다 새 난수 코드를 쓰는 비멱등 액션이고,
  // 최초 발급(joinCode 없음)은 confirmDialog 도 안 거쳐 클릭 후 아무 표시가 없었다.
  // 연타하면 코드가 N번 덮어써지고, 커밋 순서와 응답 도착 순서가 어긋나면 화면 코드와 DB 코드가 달라진다.
  // 그러면 운영자는 화면 코드를 스태프에게 주는데 스태프는 '잘못된 코드'를 받고, 양쪽 다 오류가 안 뜬다.
  const [joinBusy, setJoinBusy] = useState(false)
  const handleRegenJoinCode = async () => {
    if (joinBusy) return
    if (joinCode && !(await confirmDialog({ title: '새 참여 코드를 발급할까요?', message: '기존 코드는 더 이상 사용할 수 없습니다.', level: 'caution', confirmLabel: '재발급' }))) return
    setJoinBusy(true)
    try {
      // 최초 발급은 멱등 경로로 — 뚫려도 코드가 안 바뀐다. 재발급은 새 코드가 나오는 게 정상(위 확인창이 앞을 막음).
      const res = joinCode ? await regenerateJoinCode() : await getOrCreateJoinCode()
      if (!res.ok) { showToast(res.error); return }
      setJoinCode(res.code)
      showToast('참여 코드 발급됨')
    } finally {
      setJoinBusy(false)
    }
  }

  const handleCopyJoinCode = async () => {
    if (!joinCode) return
    try { await navigator.clipboard.writeText(joinCode); showToast('코드 복사됨') } catch { /* ignore */ }
  }

  const handleApproveJoin = async (id: string, role: Role) => {
    const res = await approveJoinRequest(id, role)
    if (!res.ok) { showToast(res.error); return }
    setJoinRequests(prev => prev.filter(r => r.id !== id))
    showToast('승인됨. 멤버로 추가됐습니다.')
    router.refresh()
  }

  const handleRejectJoin = async (id: string) => {
    const res = await rejectJoinRequest(id)
    if (!res.ok) { showToast(res.error); return }
    setJoinRequests(prev => prev.filter(r => r.id !== id))
    showToast('거절됨')
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
    if (!(await confirmDialog({ title: `'${name}' 카테고리를 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteIncomeCategory(name)
    setIncomeCategs(prev => prev.filter(t => t !== name))
  }
  const handleReorderIncomeCategs = async (items: string[]) => {
    setIncomeCategs(items)
    await reorderOptions('incomeCategories', items)
  }
  const handleRenameIncomeCateg = async (oldVal: string, newVal: string) => {
    await runRename('incomeCategories', oldVal, newVal, setIncomeCategs)
  }
  const handleResetIncomeCategs = async () => {
    if (!(await confirmDialog({ title: '부가수익 카테고리를 기본값으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
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
    if (!(await confirmDialog({ title: `'${name}' 카테고리를 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteExpenseCategory(name)
    setExpenseCategs(prev => prev.filter(t => t !== name))
  }
  const handleReorderExpenseCategs = async (items: string[]) => {
    setExpenseCategs(items)
    await reorderOptions('expenseCategories', items)
  }
  const handleRenameExpenseCateg = async (oldVal: string, newVal: string) => {
    await runRename('expenseCategories', oldVal, newVal, setExpenseCategs)
  }
  const handleResetExpenseCategs = async () => {
    if (!(await confirmDialog({ title: '지출 카테고리를 기본값으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
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
    if (!(await confirmDialog({ title: `'${name}' 결제 수단을 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deletePaymentMethod(name)
    setPayMethods(prev => prev.filter(t => t !== name))
  }
  const handleReorderPayMethods = async (items: string[]) => {
    setPayMethods(items)
    await reorderOptions('paymentMethods', items)
  }
  const handleRenamePayMethod = async (oldVal: string, newVal: string) => {
    await runRename('paymentMethods', oldVal, newVal, setPayMethods)
  }
  const handleResetPayMethods = async () => {
    if (!(await confirmDialog({ title: '결제 수단을 기본값(계좌이체, 신용카드, 체크카드, 현금)으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setPayMethods(await resetOptionsToDefault('paymentMethods'))
  }

  // ── 요청·컴플레인 카테고리 ───────────────────────────────────────
  const [requestCategs, setRequestCategs] = useState<string[]>([])
  const [newRequestCateg, setNewRequestCateg] = useState('')
  useEffect(() => { getRequestCategories().then(setRequestCategs).catch(console.error) }, [])
  const handleAddRequestCateg = async () => {
    const v = newRequestCateg.trim(); if (!v) return
    await addRequestCategory(v)
    setRequestCategs(prev => [...prev, v]); setNewRequestCateg('')
  }
  const handleDeleteRequestCateg = async (name: string) => {
    if (!(await confirmDialog({ title: `'${name}' 카테고리를 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    await deleteRequestCategory(name)
    setRequestCategs(prev => prev.filter(t => t !== name))
  }
  const handleReorderRequestCategs = async (items: string[]) => {
    setRequestCategs(items)
    await reorderOptions('requestCategories', items)
  }
  const handleRenameRequestCateg = async (oldVal: string, newVal: string) => {
    await runRename('requestCategories', oldVal, newVal, setRequestCategs)
  }
  const handleResetRequestCategs = async () => {
    if (!(await confirmDialog({ title: '요청 카테고리를 기본값으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setRequestCategs(await resetOptionsToDefault('requestCategories'))
  }

  // ── 단위 어휘 ────────────────────────────────────────────────────
  // 지출·재고 저장 때 처음 보는 단위가 들어오면 이 목록에 저절로 쌓인다. 여기는 그 목록을
  // 정리하는 자리다 — 오타가 한 번 들어오면 지울 곳이 없어야 하는 것이 아니라 있어야 한다.
  const [specUnits, setSpecUnits] = useState<string[]>([])
  const [qtyUnits, setQtyUnits] = useState<string[]>([])
  const [newSpecUnit, setNewSpecUnit] = useState('')
  const [newQtyUnit, setNewQtyUnit] = useState('')
  useEffect(() => {
    getSpecUnitOptions().then(setSpecUnits).catch(console.error)
    getQtyUnitOptions().then(setQtyUnits).catch(console.error)
  }, [])
  const handleAddSpecUnit = async () => {
    const v = newSpecUnit.trim(); if (!v) return
    await addUnitOption('spec', v)
    setSpecUnits(prev => [...prev, v]); setNewSpecUnit('')
  }
  const handleDeleteSpecUnit = async (name: string) => {
    if (!(await confirmDialog({ title: `'${name}' 단위를 목록에서 뺄까요?`, message: '이미 저장된 지출과 재고는 그대로 있습니다. 앞으로 고를 때만 안 보입니다.', level: 'caution', confirmLabel: '빼기' }))) return
    await deleteUnitOption('spec', name)
    setSpecUnits(prev => prev.filter(t => t !== name))
  }
  const handleReorderSpecUnits = async (items: string[]) => {
    setSpecUnits(items)
    await reorderOptions('specUnitOptions', items)
  }
  const handleRenameSpecUnit = async (oldVal: string, newVal: string) => {
    await runRename('specUnitOptions', oldVal, newVal, setSpecUnits)
  }
  const handleResetSpecUnits = async () => {
    if (!(await confirmDialog({ title: '규격 단위를 기본값으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setSpecUnits(await resetOptionsToDefault('specUnitOptions'))
  }
  const handleAddQtyUnit = async () => {
    const v = newQtyUnit.trim(); if (!v) return
    await addUnitOption('qty', v)
    setQtyUnits(prev => [...prev, v]); setNewQtyUnit('')
  }
  const handleDeleteQtyUnit = async (name: string) => {
    if (!(await confirmDialog({ title: `'${name}' 단위를 목록에서 뺄까요?`, message: '이미 저장된 지출과 재고는 그대로 있습니다. 앞으로 고를 때만 안 보입니다.', level: 'caution', confirmLabel: '빼기' }))) return
    await deleteUnitOption('qty', name)
    setQtyUnits(prev => prev.filter(t => t !== name))
  }
  const handleReorderQtyUnits = async (items: string[]) => {
    setQtyUnits(items)
    await reorderOptions('qtyUnitOptions', items)
  }
  const handleRenameQtyUnit = async (oldVal: string, newVal: string) => {
    await runRename('qtyUnitOptions', oldVal, newVal, setQtyUnits)
  }
  const handleResetQtyUnits = async () => {
    if (!(await confirmDialog({ title: '수량 단위를 기본값으로 초기화할까요?', level: 'caution', confirmLabel: '초기화' }))) return
    setQtyUnits(await resetOptionsToDefault('qtyUnitOptions'))
  }

  // ── 고정 지출 ────────────────────────────────────────────────────
  const [recurringList, setRecurringList] = useState<RecurringExpenseRow[]>([])
  const [showRecForm, setShowRecForm] = useState(false)
  const [editingRec, setEditingRec] = useState<RecurringExpenseRow | null>(null)
  const [recForm, setRecForm] = useState({ title: '', amount: '', category: DEFAULT_RECURRING_CATEGORY, dueDay: DEFAULT_RECURRING_DUE_DAY, payMethod: '', vendor: '', isAutoDebit: false, isVariable: false, alertDaysBefore: DEFAULT_RECURRING_ALERT_DAYS_BEFORE, activeSince: '', memo: '', intervalMonths: '1', anchorMonth: '', nextDueOverrideMonth: '' })
  const [recDueDayDisp, setRecDueDayDisp] = useState(`${DEFAULT_RECURRING_DUE_DAY}일`)
  const [recPending, startRecTransition] = useTransition()
  // 행별 처리 중 잠금(전역 잠금 방지). 선례 RequestsClient:86 · admin UsersClient:100.
  // 토글·삭제는 서버 왕복 + router.refresh 라 눈에 보이는 딜레이가 있는데 표시가 없어
  // 운영자가 "작동 안 하는 줄 알았다"고 신고했다(2026-08-19).
  const [recBusyId, setRecBusyId] = useState<string | null>(null)
  // #1 세부항목(관리비 묶음) — 한 번에 납부하는 여러 항목. 있으면 부모 금액·변동은 합산 파생.
  const [recItems, setRecItems] = useState<{ name: string; amount: string; isVariable: boolean }[]>([])
  const recValidItems = recItems.filter(it => it.name.trim())
  const recItemsActive = recValidItems.length > 0
  const recItemsTotal = recValidItems.reduce((s, it) => s + (Number(it.amount.replace(/[^0-9]/g, '')) || 0), 0)
  const recItemsHasVariable = recValidItems.some(it => it.isVariable)
  const addRecItem = () => setRecItems(prev => [...prev, { name: '', amount: '', isVariable: false }])
  const updateRecItem = (i: number, patch: Partial<{ name: string; amount: string; isVariable: boolean }>) =>
    setRecItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  const removeRecItem = (i: number) => setRecItems(prev => prev.filter((_, idx) => idx !== i))

  // 주기 표기 — 라벨 정본이 만든 문자열에서 앞말만 뗀다('격월 (홀수달)' -> '격월').
  // 기준 달을 안 고르면 활성화 시작일(없으면 등록일)의 달이 기준이라 그때는 열거를 못 적는다.
  const recCycleSource = {
    intervalMonths: Number(recForm.intervalMonths) || 1,
    anchorMonth: recForm.anchorMonth ? Number(recForm.anchorMonth) : null,
    // 리듬 표기 전용 — 다음 회차 지정은 여기 안 싣는다(위 재무 관리 폼과 같은 이유).
    nextDueOverrideMonth: null,
    activeSince: recForm.activeSince || null,
    createdAt: new Date().toISOString(),
  }
  const recCycleWord = recurringCycleWord(recCycleSource)
  const recCycleHint = recForm.anchorMonth
    ? `이 설정이면 ${recurringCycleLabel(recCycleSource).replace(/^[^(]*\(|\)$/g, '')}에 도래합니다.`
    : '자동이면 활성화 시작일(없으면 등록일)의 달이 기준이 됩니다.'

  const fmtRecDueDay = (d: string) => {
    const n = parseInt(d, 10)
    if (isNaN(n) || n <= 0) return d
    return n >= 30 ? '말일' : `${n}일`
  }
  const applyRecDueDay = (input: string) => {
    const t = input.trim()
    if (!t) { setRecForm(p => ({ ...p, dueDay: DEFAULT_RECURRING_DUE_DAY })); setRecDueDayDisp(`${DEFAULT_RECURRING_DUE_DAY}일`); return }
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

  // 편집 폼은 목록 **위**에 있다. 목록 아래쪽 행에서 [수정]을 누르면 900px 넘는 폼이 스크롤 위치보다
  // 위에 삽입되는데, 스크롤 앵커링이 보던 행을 못박아 화면 픽셀이 하나도 안 바뀐다 — 운영자에게는
  // 버튼이 죽은 것으로 보인다(실기 신고 2026-08-19, 헤드리스 실측: 폼 top −1022 / 뷰포트 상단 56).
  // 재고 프리셋 패널이 같은 이유로 봉합된 자리와 같은 문법이다(FinanceClient:340, lib/useFocusSection:26).
  const recFormRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showRecForm) return
    requestAnimationFrame(() => recFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [showRecForm, editingRec])

  const openNewRec = () => {
    setEditingRec(null)
    setRecForm({ title: '', amount: '', category: DEFAULT_RECURRING_CATEGORY, dueDay: DEFAULT_RECURRING_DUE_DAY, payMethod: '', vendor: '', isAutoDebit: false, isVariable: false, alertDaysBefore: DEFAULT_RECURRING_ALERT_DAYS_BEFORE, activeSince: acqDate ?? '', memo: '', intervalMonths: '1', anchorMonth: '', nextDueOverrideMonth: '' })
    setRecItems([])
    setRecDueDayDisp(`${DEFAULT_RECURRING_DUE_DAY}일`)
    setShowRecForm(true)
  }
  const openEditRec = (r: RecurringExpenseRow) => {
    setEditingRec(r)
    setRecForm({ title: r.title, amount: r.amount.toString(), category: r.category, dueDay: r.dueDay.toString(), payMethod: r.payMethod ?? '', vendor: r.vendor ?? '', isAutoDebit: r.isAutoDebit, isVariable: r.isVariable, alertDaysBefore: r.alertDaysBefore.toString(), activeSince: r.activeSince ?? '', memo: r.memo ?? '', intervalMonths: String(r.intervalMonths ?? 1), anchorMonth: r.anchorMonth ? String(r.anchorMonth) : '', nextDueOverrideMonth: r.nextDueOverrideMonth ?? '' })
    setRecItems(r.items.map(it => ({ name: it.name, amount: String(it.amount), isVariable: it.isVariable })))
    setRecDueDayDisp(fmtRecDueDay(r.dueDay.toString()))
    setShowRecForm(true)
  }
  const handleSaveRec = () => {
    // 세부항목이 있으면 부모 금액·변동은 합산 파생, 없으면 수동 입력값.
    const manualAmount = Number(recForm.amount.replace(/[^0-9]/g, ''))
    const effectiveAmount = recItemsActive ? recItemsTotal : manualAmount
    // 세부항목 페이로드: 활성이면 배열, (수정 시) 부모였다가 다 지웠으면 빈 배열로 클리어, 그 외 undefined(미변경).
    const itemsPayload: RecurringItemInput[] | undefined =
      recItemsActive
        ? recValidItems.map(it => ({ name: it.name.trim(), amount: Number(it.amount.replace(/[^0-9]/g, '')) || 0, isVariable: it.isVariable }))
        : (editingRec && editingRec.items.length > 0 ? [] : undefined)
    const data = {
      title: recForm.title.trim(),
      amount: effectiveAmount,
      category: recForm.category,
      dueDay: parseInt(recForm.dueDay) || 25,
      payMethod: recForm.payMethod || undefined,
      vendor: recForm.vendor.trim() || undefined,
      isAutoDebit: recForm.isAutoDebit,
      isVariable: recItemsActive ? recItemsHasVariable : recForm.isVariable,
      alertDaysBefore: parseInt(recForm.alertDaysBefore) || 7,
      intervalMonths: Number(recForm.intervalMonths) || 1,
      anchorMonth: recForm.anchorMonth ? Number(recForm.anchorMonth) : null,
      nextDueOverrideMonth: recForm.nextDueOverrideMonth || null,
      activeSince: recForm.activeSince || undefined,
      memo: recForm.memo || undefined,
      ...(itemsPayload !== undefined ? { items: itemsPayload } : {}),
    }
    if (!data.title || !data.amount) return
    startRecTransition(async () => {
      // 결과 체크 + try/catch 없이는 silent fail 가능 — 폼은 닫혔는데 리스트 안 바뀌고
      // 사용자가 다시 저장 → 중복 입력 가능 (사용자 피드백 2026-06-01).
      try {
        const res = editingRec
          ? await updateRecurringExpense(editingRec.id, data)
          : await addRecurringExpense(data)
        if (!res.ok) {
          showToast(`저장 실패: ${res.error}`)
          return  // 폼 유지 — 재시도 가능
        }
        // 세부항목 파생(금액·변동·항목 id·정렬)을 정확히 반영하려면 서버 재조회가 안전.
        setRecurringList(await getRecurringExpenses())
        setShowRecForm(false)
        showToast(editingRec ? '고정 지출 수정됨' : '고정 지출 추가됨')
        router.refresh()  // 대시보드 등 다른 페이지의 캐시된 데이터도 갱신
      } catch (e) {
        showToast(`저장 실패: ${(e as Error).message}`)
      }
    })
  }
  const handleDeleteRec = async (id: string, title: string) => {
    if (!(await confirmDialog({ title: `'${title}' 고정 지출을 삭제할까요?`, message: '다음 달부터 자동 기장이 중단됩니다. 이미 기장된 지출은 남습니다.', level: 'caution', confirmLabel: '삭제' }))) return
    setRecBusyId(id)
    const release = trackSave()   // §17 갱신 표시 = 상단 진행 바. 같은 파일의 형제 핸들러와 같은 문법.
    try {
      const res = await deleteRecurringExpense(id)
      if (!res.ok) { showToast(`삭제 실패: ${res.error}`); return }
      setRecurringList(prev => prev.filter(r => r.id !== id))
      showToast('고정 지출 삭제됨')
      router.refresh()
    } catch (e) {
      showToast(`삭제 실패: ${(e as Error).message}`)
    } finally { release(); setRecBusyId(null) }
  }
  const handleToggleRec = async (r: RecurringExpenseRow) => {
    if (recBusyId) return
    // 보낼 값을 먼저 확정한다. 종전에는 서버에 !r.isActive 를 보내면서 로컬은 !x.isActive 로 다시
    // 뒤집어, 연타하면 서버는 한 번만 바뀌고 화면은 두 번 뒤집혀 둘이 갈렸다.
    const next = !r.isActive
    setRecBusyId(r.id)
    const release = trackSave()
    try {
      const res = await updateRecurringExpense(r.id, { isActive: next })
      if (!res.ok) { showToast(`변경 실패: ${res.error}`); return }
      setRecurringList(prev => prev.map(x => x.id === r.id ? { ...x, isActive: next } : x))
      showToast(next ? '활성화됨' : '비활성 처리됨')
      router.refresh()
    } catch (e) {
      showToast(`변경 실패: ${(e as Error).message}`)
    } finally { release(); setRecBusyId(null) }
  }

  return (
    <div className="max-w-lg">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[var(--z-toast)] bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-5 py-3 text-sm text-[var(--warm-dark)] shadow-lift">
          {toast}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">설정</h1>
        <p className="text-sm text-[var(--warm-muted)] mt-0.5">영업장 기본 정보 및 옵션 관리</p>
      </div>

      {/* 탭 — v2.0 §25 뷰 전환 탭 정본(ViewTabs). 종전에는 flex-1 필 나열('제4 변종')이라
          라벨에 nowrap 이 없어 좁은 폭에서 넘치는 대신 접혔다. 웹사이트 탭이 늘어 8칸이 되자
          320px 에서 칸이 31.25px 로 좁아지며 '데이터·도구'가 네 줄로 접히고 탭 줄 높이가
          66 → 86px 로 부푼다(헤드리스 실측). 자연폭 + 넘치면 가로 스크롤이 §25 의 기본이고
          호실 관리·수납 관리·홈이 이미 쓰는 그 문법이다 — 트랙이 max-w-full overflow-x-auto 라
          어느 폭에서도 문서 가로 넘침이 0이다. */}
      <div className="mb-6">
        <ViewTabs ariaLabel="환경설정 탭" activeId={tab}
          onChange={id => setTab(id as Tab)}
          tabs={TABS.map(t => ({ id: t.key, label: t.label }))} />
      </div>

      {/* 기본정보 탭 */}
      {tab === 'basic' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">영업장 기본 정보</h2>

          {/* 영업장 로고 (앱 표시·원형) — 헤더·사이드바·대시보드. 업로드 시 원형 크롭 도구로 조정 */}
          <div className="space-y-1.5 mb-4">
            <label className="text-xs font-medium text-[var(--warm-mid)]">영업장 로고</label>
            <p className="text-xs text-[var(--warm-muted)]">앱 상단·사이드바·대시보드에 <strong>원형으로</strong> 표시되는 대표 로고입니다. 올리면 <strong>위치·크기를 직접 맞출 수</strong> 있어요. 배경 있는 정사각형 권장.</p>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-full border border-dashed border-[var(--warm-border)] flex items-center justify-center bg-[var(--canvas)] overflow-hidden shrink-0">
                {appLogoUrl ? (
                  <img src={appLogoUrl} alt="영업장 로고" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[0.65625rem] text-[var(--warm-muted)]">미등록</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer text-center font-medium transition-colors ${appLogoUploading ? 'opacity-60' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'}`}>
                  {appLogoUploading ? '저장 중…' : (appLogoUrl ? '교체' : '업로드')}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAppLogoSelect} disabled={appLogoUploading} />
                </label>
                {appLogoUrl && (
                  <button type="button" onClick={handleAppLogoDelete} disabled={appLogoUploading}
                    className="px-3 py-1.5 text-xs rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] hover:bg-[var(--danger-bg)] disabled:opacity-50">
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 계약서용 로고 (투명) — 계약서 헤더에만 사용 */}
          <div className="space-y-1.5 mb-4">
            <label className="text-xs font-medium text-[var(--warm-mid)]">계약서용 로고 <span className="text-[var(--warm-muted)] font-normal">(투명 PNG)</span></label>
            <p className="text-xs text-[var(--warm-muted)]">계약서 헤더에만 표시됩니다. 투명 배경 가로형 PNG 권장.</p>
            <div className="flex items-center gap-3">
              <div className="w-32 h-16 rounded-xl border border-dashed border-[var(--warm-border)] flex items-center justify-center bg-[var(--canvas)] overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt="계약서용 로고" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-xs text-[var(--warm-muted)]">미등록</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer text-center font-medium transition-colors ${logoUploading ? 'opacity-60' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'}`}>
                  {logoUploading ? '업로드 중…' : (logoUrl ? '교체' : '업로드')}
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} disabled={logoUploading} />
                </label>
                {logoUrl && (
                  <button type="button" onClick={handleLogoDelete} disabled={logoUploading}
                    className="px-3 py-1.5 text-xs rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] hover:bg-[var(--danger-bg)] disabled:opacity-50">
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>

          {cropSrc && (
            <ImageCropModal src={cropSrc} title="영업장 로고 조정"
              onCancel={closeCrop} onConfirm={handleAppLogoCropped} />
          )}

          <form onSubmit={handleSubmit} className="space-y-4 scroll-mt-4" id="dv-basic-property">
            <Field label="영업장명 *" name="name" defaultValue={property?.name ?? ''} />
            <Field label="주소" name="address" defaultValue={property?.address ?? ''} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">대표 연락처</label>
              <PhoneInput name="phone" defaultValue={property?.phone ?? ''} />
            </div>
            {/* 서류 메일 주소 두 칸 — 나가는 방향(보내는 주소) 다음 돌아오는 방향(답장 받을 주소)이다.
                도메인은 인증 때문에 고정이고 앞부분만 영업장 몫이다(lib/mailFrom).
                문안은 계약서·서류 탭의 '서류 메일 문안' 카드에서 고친다. */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="mailFromLocal">보내는 주소</label>
              <p className="text-xs text-[var(--warm-muted)]">서류 메일을 보낼 때 표시되는 주소의 앞부분입니다. 비워 두면 답장을 받지 않는 기본 주소(no-reply@stayeum.com)로 나갑니다.</p>
              <div className="relative">
                {/* 칸을 떠날 때 저장 규칙을 화면에도 적용한다 — 안 그러면 the.stay@jegi 를 넣고
                    저장했을 때 DB 는 the.stay 인데 칸은 옛 글자를 띄워, 정본이 없애려던
                    '화면과 실제가 갈린다'를 이 화면이 되살린다. */}
                <input type="text" name="mailFromLocal" id="mailFromLocal"
                  value={mailFromLocal}
                  maxLength={MAIL_FROM_LOCAL_MAX}
                  onChange={e => setMailFromLocal(e.target.value.toLowerCase().replace(/[^a-z0-9._@-]/g, ''))}
                  onBlur={e => setMailFromLocal(normalizeMailFromLocal(e.target.value))}
                  placeholder="예: mygoshiwon (영문 소문자·숫자)"
                  inputMode="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 pr-[7.5rem] text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                {/* 접미는 값이 없어도 늘 띄운다 — 단위 장식(㎡)과 달리 "뒤에 무엇이 붙는가"가 정보 그
                    자체라, 빈 칸일 때야말로 형식을 말해 줘야 한다. */}
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--warm-dark)] pointer-events-none">@stayeum.com</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]" htmlFor="replyToEmail">답장 받을 주소</label>
              <p className="text-xs text-[var(--warm-muted)]">받는 사람이 답장하면 이 주소로 옵니다. 네이버·지메일 등 어떤 주소든 됩니다.</p>
              <input type="email" name="replyToEmail" id="replyToEmail" defaultValue={property?.replyToEmail ?? ''}
                placeholder="예: contact@example.com"
                autoComplete="off"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>
            {/* 사본 받기 — 이 폼과 함께 저장되는 체크박스다(§27.1: 같은 카드 안에서 즉시 저장과
                폼 저장을 섞지 않는다). 앞의 hidden '0' 은 해제를 저장하기 위한 짝이다(감지망 축 ⓔ). */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-[var(--warm-dark)]">보낸 메일 사본</h4>
              <p className="text-xs text-[var(--warm-muted)]">켜면 신원번호·계약서 첨부까지 그대로 내 메일함에 쌓입니다. 기본은 꺼짐입니다.</p>
              <input type="hidden" name="mailCopyToSelf" value="0" />
              <label className="flex items-start gap-2 text-xs text-[var(--warm-dark)] cursor-pointer pt-0.5">
                <input type="checkbox" name="mailCopyToSelf" value="1" defaultChecked={property?.mailCopyToSelf === true}
                  className="w-4 h-4 accent-[var(--coral)] mt-0.5 shrink-0" />
                <span className="break-keep">보낸 메일 사본을 답장 받을 주소로 함께 받는다</span>
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">인수 날짜</label>
              <p className="text-xs text-[var(--warm-muted)]">실제 영업장을 인수한 날짜입니다.</p>
              <DatePicker name="acquisitionDate" value={acqDateVal} onChange={setAcqDateVal}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">양도인 귀속 기준일</label>
              <p className="text-xs text-[var(--warm-muted)]">이 날짜 이전 수납금은 양도인 귀속으로 처리됩니다. 비워두면 인수 날짜와 동일.</p>
              <DatePicker name="prevOwnerCutoffDate" value={cutoffDateVal} onChange={setCutoffDateVal}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">연락할 때 알림 (며칠 전부터)</label>
              <p className="text-xs text-[var(--warm-muted)]">문의·투어·미확정 예약 입주자의 입주 희망일이 이 일수 안으로 들어오면 &lsquo;연락할 때&rsquo; 알림이 홈과 종에 뜹니다. 기본 14일.</p>
              <div className="flex items-center gap-2">
                <input type="text" name="contactLeadDays" inputMode="numeric"
                  defaultValue={String(property?.contactLeadDays ?? 14)}
                  className="w-24 px-3 py-2.5 rounded-sm text-sm tabular-nums outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors" />
                <span className="text-sm text-[var(--warm-mid)]">일 전부터</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">퇴실 예정으로 바뀌는 시점</label>
              <p className="text-xs text-[var(--warm-muted)]">거주중인 입주자를 퇴실일 며칠(몇 달) 전에 &lsquo;퇴실 예정&rsquo;으로 바꿀지 정합니다. 그때부터 새 입실자를 찾고 청소를 잡습니다. 한 달 이하로 지내는 분과 그보다 오래 지내는 분에게 다른 기준이 붙습니다. 0을 넣으면 퇴실 당일에 바뀝니다.</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--warm-mid)]">한 달 이하</span>
                <input type="text" name="checkoutLeadShortDays" inputMode="numeric"
                  defaultValue={String(property?.checkoutLeadShortDays ?? 7)}
                  className="w-20 px-3 py-2.5 rounded-sm text-sm tabular-nums outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors" />
                <span className="text-sm text-[var(--warm-mid)]">일 전</span>
                <span className="text-sm text-[var(--warm-mid)] pl-2">그 밖</span>
                <input type="text" name="checkoutLeadMonths" inputMode="numeric"
                  defaultValue={String(property?.checkoutLeadMonths ?? 1)}
                  className="w-20 px-3 py-2.5 rounded-sm text-sm tabular-nums outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors" />
                <span className="text-sm text-[var(--warm-mid)]">달 전</span>
              </div>
              {/* 달은 날수로 세지 않는다 — 30일로 못 박으면 윤달과 30/31 월에서 갈린다(운영자 확정 2026-08-28). */}
              <p className="text-[0.6875rem] text-[var(--warm-muted)]">달은 달력으로 셉니다. 10월 19일 퇴실이면 한 달 전은 9월 19일입니다.</p>
            </div>
            {/* 이사 안내 — 기본정보 한 탭이 영업장 정보·요금·서류·분류를 모두 이고 있어 스크롤 끝까지
                가야 찾던 칸이 나왔다. 네 갈래로 나눠 보냈으니 여기서 찾던 사람이 빈손으로 돌아가지
                않게 간 곳을 적는다. 1단계(슬러그)와 2단계(나머지 셋)를 상자 하나에 모은 것은,
                상자 둘이 나란히 서면 안내가 카드의 주인이 되기 때문이다.
                바탕은 --cream-soft — 이 줄은 카드(--cream) 안이라 다크에서 --canvas(#000)를 쓰면
                카드에 검은 구멍이 뚫린다(§28, 중첩 패널은 --cream-soft).
                TODO(제거): 첫 줄은 2026-09 중순, 나머지 셋은 2026-09 하순. 한 번에 걷어도 된다. */}
            <div className="rounded-xl px-3 py-2 text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed space-y-0.5" style={{ background: 'var(--cream-soft)', border: '1px solid var(--warm-border)' }}>
              <p>소개 페이지 주소는 <span className="font-semibold text-[var(--warm-dark)]">웹사이트 탭</span>으로 옮겼습니다.</p>
              <p>기본 보증금·청소비·예약금·위약금·환불 규정은 <span className="font-semibold text-[var(--warm-dark)]">요금·정책 탭</span>으로 옮겼습니다.</p>
              <p>영업장 전용면적·입금 계좌번호·잔여 소지품 임의처분 동의서는 <span className="font-semibold text-[var(--warm-dark)]">계약서·서류 탭</span>으로 옮겼습니다.</p>
              <p>요청 카테고리는 <span className="font-semibold text-[var(--warm-dark)]">분류 관리 탭</span>으로 옮겼습니다.</p>
            </div>
            <Btn type="submit" variant="primary" size="md" fullWidth className="mt-2" disabled={isPending}>
              {isPending ? '저장 중…' : '저장'}
            </Btn>
          </form>
        </div>
      )}

      {/* 데이터·도구 탭 — 알림·캘린더·점검·엑셀·백업·문자 템플릿·AI·도움말·위험 구역.
          영업장을 무엇으로 정하느냐가 아니라 무엇으로 다루느냐의 칸이다. 2026-08-19 IA 2단계에서
          여기 섞여 있던 설정 둘(단기 입실 정책은 요금, 품목 세부스펙은 분류)을 제 축으로 보냈다. */}
      {tab === 'data' && (
        <>
        {/* 알림 — PWA 푸시 (홈 화면 설치 시 폰으로 알림 + 아이콘 뱃지) */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-3">알림 (푸시)</h2>
          <PushToggle />
        </div>

        {/* 캘린더 연동 — .ics 구독 (납부예정·퇴실예정 자동 동기화) */}
        <CalendarSubscribeCard />

        {/* 데이터 점검 — 발생주의 진단 페이지 링크 */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">데이터 점검</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
            수납 기록의 입금일(payDate)과 귀속 월(targetMonth)이 회계 기준에 맞게 분류되어 있는지 확인합니다.
            지연 입금·월 불일치 등 재검토 후보를 보고 직접 귀속 월을 조정할 수 있습니다.
          </p>
          <a href="/accrual-check"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
            발생주의 데이터 진단 ›
          </a>
        </div>

        {/* 엑셀 가져오기·내보내기 */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">엑셀 가져오기·내보내기</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
            호실·입주자·지출·부가수익·설정을 엑셀(.xlsx)로 내보내거나, 작성한 엑셀을 가져와 일괄 등록합니다.
            가져오기 시 중복 항목은 처리 방법을 직접 선택할 수 있습니다.
          </p>
          <DataButtons />
        </div>

        {/* 데이터 백업 */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">데이터 백업</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
            영업장의 모든 데이터(호실·입주자·계약·수납·지출·부가수익 등)를 JSON 파일로 내려받습니다.
            정기적으로 백업해두면 사고 시 복구에 활용할 수 있습니다.
          </p>
          <BackupButton />
        </div>

        {/* 품명 병합 (AI) — 비품·자재·소모품·부식 유사 품명 통일 */}
        <ItemNameMergePanel />

        {/* 이사 안내 — 여기 있던 둘이 어디로 갔는지(2026-08-19 IA 2단계). 옛 자리에 그대로 세운다.
            TODO(2026-09 하순 제거). */}
        <div className="rounded-xl px-3 py-2 mt-4 text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed space-y-0.5" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
          <p>단기 입실 정책은 <span className="font-semibold text-[var(--warm-dark)]">요금·정책 탭</span>으로 옮겼습니다.</p>
          <p>품목 세부스펙은 <span className="font-semibold text-[var(--warm-dark)]">분류 관리 탭</span>으로 옮겼습니다.</p>
        </div>

        <span id="dv-sms-unpaid" className="scroll-mt-4" />
        <SmsTemplateCard
          kind="unpaid"
          title="미납 안내 문자 템플릿"
          description={<>홈 &lsquo;누적 미납&rsquo;의 [안내문자]에서 골라 쓰는 문구입니다. 변수는 보낼 때 자동으로 채워집니다:
            {' '}<span className="mono text-[0.6875rem]">{'{이름} {호수} {미납금액} {납기일} {경과일수} {계좌번호}'}</span></>}
          emptyExample={<>아직 템플릿이 없습니다. 예: &ldquo;[우리 원룸텔] {'{이름}'}님, {'{호수}'}호 월 이용료 {'{미납금액}'}원의 납기일({'{납기일}'})이 지났습니다. 아래 계좌로 입금 부탁드립니다. {'{계좌번호}'}&rdquo;</>}
          namePlaceholder="예: 1차 안내"
          bodyLabel="문자 내용 (변수 그대로 적으면 보낼 때 치환)"
        />
        {/* 단체 공지는 배치 전체가 한 본문을 공유해 개인별 치환이 구조적으로 없다 —
            가이드 §29(개인화 불가 맥락에서 변수 표기 노출 금지)에 따라 안내에 {'{이름}'} 같은 표기를 쓰지 않는다. */}
        <span id="dv-sms-notice" className="scroll-mt-4" />
        <SmsTemplateCard
          kind="notice"
          title="단체 공지 문자 템플릿"
          description="입주자 관리의 [단체 공지]에서 골라 쓰는 문구입니다. 모두에게 같은 내용이 나가므로 이름·호수 같은 개인별 값은 채워지지 않습니다."
          emptyExample={<>아직 템플릿이 없습니다. 예: &ldquo;[우리 원룸텔] 7월 15일(수) 오전 10시부터 12시까지 전 층 수도 점검이 있습니다. 이용에 참고 부탁드립니다.&rdquo;</>}
          namePlaceholder="예: 수도 점검 공지"
          bodyLabel="문자 내용"
        />
        <span id="dv-sms-personal" className="scroll-mt-4" />
        <SmsTemplateCard
          kind="personal"
          title="입주자 문자 템플릿"
          description={<>입주자 상세의 [문자]에서 골라 쓰는 문구입니다. 변수는 보낼 때 자동으로 채워집니다:
            {' '}<span className="mono text-[0.6875rem]">{'{이름} {호수} {계좌번호}'}</span></>}
          emptyExample={<>아직 템플릿이 없습니다. 예: &ldquo;[우리 원룸텔] {'{이름}'}님, 아래 계좌로 입금 부탁드립니다. {'{계좌번호}'}&rdquo;</>}
          namePlaceholder="예: 계좌 안내"
          bodyLabel="문자 내용 (변수 그대로 적으면 보낼 때 치환)"
        />
        <AiSettingsCard />

        {/* 도움말 — 앱의 사고방식(사용성 감사 F2). 처음 쓰는 사람이 막히는 개념만 짧게. */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">도움말 · 앱이 계산하는 방식</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">처음 쓸 때 헷갈리기 쉬운 개념을 모았습니다. 항목을 누르면 펼쳐집니다.</p>
          <div className="space-y-1.5">
            {[
              { q: '매출이 왜 입금한 달이 아니라 다른 달에 잡히나요?', a: '이 앱은 귀속월 기준(발생주의)입니다. 4월분 이용료를 5월 1일에 받아도 4월 매출로 집계됩니다. 홈·수납·리포트가 모두 같은 기준을 쓰므로 어디서 봐도 숫자가 일치합니다.' },
              { q: '재고 숫자가 왜 안 변하나요?', a: '재고는 점검(실사) 기록을 기준으로 계산됩니다. 구매는 수령 확인 시 더해지고, 소모량은 두 점검 사이의 차이로 계산됩니다. 재고 관리에서 주기적으로 점검을 기록해 주세요.' },
              { q: '재고가 실제와 다르면 어떻게 하나요?', a: '재고 관리 > 더보기 > 전체 재고 보정으로 실측값을 입력하면 그 시점으로 리셋됩니다. 보정 구간의 차이는 소모량으로 잡지 않아 통계가 왜곡되지 않습니다.' },
              { q: '같은 품목이 여러 이름으로 갈라졌어요.', a: '재고 카드의 합치기(또는 이 페이지의 품명 병합)로 통일하세요. 한 번 고치면 별칭으로 학습되어 다음 영수증부터 자동으로 통일된 이름이 붙습니다.' },
              { q: '영수증은 어디로 올리는 게 좋나요?', a: '바쁠 때는 홈의 찍어 올리기. 던져두면 AI가 분류하고 나중에 검토·승인하면 됩니다. 지금 바로 정확히 입력하려면 지출 등록의 영수증 스캔을 쓰세요. 두 경로 모두 같은 학습을 공유합니다.' },
              { q: '실수로 저장했어요.', a: '저장 직후 뜨는 알림의 적용취소를 누르면 되돌아갑니다. 삭제·병합·일괄 수납 등 대부분의 동작에 적용취소가 있습니다.' },
              { q: '여러 항목을 한 번에 처리하고 싶어요.', a: '목록의 카드를 꾹 누르거나 상단의 선택 버튼을 누르면 다중 선택 모드가 됩니다. 하단 바에서 일괄 수납·일괄 배정·묶기 등을 실행할 수 있습니다.' },
            ].map(h => (
              <details key={h.q} className="rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--warm-dark)]">{h.q}</summary>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--warm-mid)]">{h.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* 법적 고지 — 로그인 화면에만 링크가 있으면 로그인한 뒤에는 찾을 길이 없다.
            처리방침은 아무 때나 다시 볼 수 있어야 하는 문서라 앱 안에도 자리를 둔다(법 제30조). */}
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">약관과 개인정보</h2>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
            스테이음이 어떤 정보를 받아 어떻게 다루는지, 영업장과 스테이음의 역할이 어떻게 나뉘는지 적어 두었습니다.
            입주자 정보의 개인정보처리자는 영업장이고 스테이음은 위탁받아 보관합니다.
          </p>
          {/* 앱 안 라우트라 새 탭으로 열지 않는다 — 홈화면 앱에는 주소창도 뒤로가기도 없어
              돌아올 길이 사라진다(§27.7). 문서 페이지 상단의 '돌아가기'가 복귀 경로다. */}
          <div className="flex flex-wrap gap-2">
            <BtnLink href="/privacy" variant="secondary" size="sm">개인정보 처리방침</BtnLink>
            <BtnLink href="/terms" variant="secondary" size="sm">서비스 이용약관</BtnLink>
          </div>
        </div>

        {/* 위험 구역 — 오너 전용. 운영 종료(되돌림 가능)·영구 삭제(불가). */}
        {isOwner && property && <DangerZone propertyId={property.id} propertyName={property.name} />}
        </>
      )}

      {/* 분류 관리 탭 — 앱이 쓰는 이름표를 한자리에 모았다(2026-08-19 IA 2단계).
          종전에는 같은 일(목록에 이름 하나 추가하기)이 호실 설정·수익·지출·기본정보·데이터·도구
          네 탭에 흩어져 있었다. 차례는 방(호실 축) · 돈(수납·지출 축) · 요청 · 품목 순이다.
          앞의 아홉은 OptionSection 정본 하나로 같은 손놀림이고, 마지막 품목 세부스펙만
          지출 저장에서 저절로 쌓이는 사전이라 추가 칸 없이 고치기·지우기만 있다. */}
      {tab === 'options' && (
        <div className="space-y-4">
          {/* 이사 안내 — 사라진 두 탭을 찾던 사람에게. TODO(2026-09 하순 제거). */}
          <div className="rounded-xl px-3 py-2 text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
            &lsquo;호실 설정&rsquo; 탭과 &lsquo;수익·지출&rsquo; 탭에 있던 분류 항목이 이 탭으로 모였습니다.
          </div>
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
            placeholder="예: 원룸, 투룸, 복층…"
          />
          <OptionSection
            title="등급 관리"
            description="스탠다드/실속형/프리미엄처럼 호실의 등급(패키지)을 구분하는 옵션입니다. 방 타입과는 별개 차원으로, 같은 원룸이라도 등급이 다를 수 있어요."
            items={roomTiers}
            getLabel={v => v}
            newValue={newRoomTier}
            onNewValueChange={setNewRoomTier}
            onAdd={handleAddRoomTier}
            onDelete={handleDeleteRoomTier}
            onReorder={handleReorderRoomTiers}
            onRename={handleRenameRoomTier}
            onReset={handleResetRoomTiers}
            placeholder="예: 스탠다드, 실속형, 프리미엄…"
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
            placeholder="예: 복층창, 루프탑창…"
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
            placeholder="예: 남동향, 남남동향…"
          />
          <OptionSection
            title="작업 종류 관리"
            description="호실 관리 > 작업 탭에서 작업 기록 등록 시 선택할 종류입니다. 청소는 등록 칸이 따로 있어 이 목록에 없습니다."
            items={workKinds}
            getLabel={v => v}
            newValue={newWorkKind}
            onNewValueChange={setNewWorkKind}
            onAdd={handleAddWorkKind}
            onDelete={handleDeleteWorkKind}
            onReorder={handleReorderWorkKinds}
            onRename={handleRenameWorkKind}
            onReset={handleResetWorkKinds}
            placeholder="예: 도배, 장판, 방충망 교체…"
          />
          <OptionSection
            title="부가수익 카테고리 관리"
            description="수납 관리 > 부가수익 탭에서 수익 등록 시 선택할 카테고리입니다."
            items={incomeCategs}
            getLabel={v => v}
            newValue={newIncomeCateg}
            onNewValueChange={setNewIncomeCateg}
            onAdd={handleAddIncomeCateg}
            onDelete={handleDeleteIncomeCateg}
            onReorder={handleReorderIncomeCategs}
            onRename={handleRenameIncomeCateg}
            onReset={handleResetIncomeCategs}
            placeholder="예: 건조기, 세탁기, 자판기…"
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
            placeholder="예: 임대료, 보험료, 통신비…"
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
            placeholder="예: 자동이체, 법인카드…"
          />
          {/* 요청 카테고리 — 기본정보 탭에서 옮겨 왔다. */}
          <OptionSection
            title="요청 카테고리 관리"
            description="요청·컴플레인 등록과 목록 필터에서 선택할 분류입니다. 비우면 기본 5종(시설·소음·청결·편의·기타)을 사용합니다."
            items={requestCategs}
            getLabel={v => v}
            newValue={newRequestCateg}
            onNewValueChange={setNewRequestCateg}
            onAdd={handleAddRequestCateg}
            onDelete={handleDeleteRequestCateg}
            onReorder={handleReorderRequestCategs}
            onRename={handleRenameRequestCateg}
            onReset={handleResetRequestCategs}
            placeholder="예: 인터넷, 주차, 택배…"
          />
          {/* 단위 어휘 — 저장할 때 새 단위가 저절로 쌓이므로, 여기는 쌓인 것을 정리하는 자리다.
              규격과 수량을 가른 이유는 저장 칸이 둘이고 어휘도 다르기 때문이다('박스'가 규격에,
              'kg'이 수량에 뜨면 안 된다). */}
          <OptionSection
            title="수량 단위 관리"
            description="'몇 개 샀나'를 세는 단위입니다. 지출이나 재고를 저장할 때 목록에 없는 단위를 치면 저절로 여기 쌓입니다. 목록에서 빼도 이미 저장된 기록은 그대로 있고, 앞으로 고를 때만 안 보입니다."
            items={qtyUnits}
            getLabel={v => v}
            newValue={newQtyUnit}
            onNewValueChange={setNewQtyUnit}
            onAdd={handleAddQtyUnit}
            onDelete={handleDeleteQtyUnit}
            onReorder={handleReorderQtyUnits}
            onRename={handleRenameQtyUnit}
            onReset={handleResetQtyUnits}
            placeholder="예: 봉, 컵, 회…"
          />
          <OptionSection
            title="규격 단위 관리"
            description="'한 덩어리가 얼마짜리인가'를 재는 단위입니다. 120g 짜리, 30매 들이처럼 씁니다. 크기가 다른 단위끼리는 이름만 바꿀 수 없습니다(저장된 수량이 틀어지기 때문에, 값까지 바꾸려면 재고 관리의 단위 변환을 씁니다)."
            items={specUnits}
            getLabel={v => v}
            newValue={newSpecUnit}
            onNewValueChange={setNewSpecUnit}
            onAdd={handleAddSpecUnit}
            onDelete={handleDeleteSpecUnit}
            onReorder={handleReorderSpecUnits}
            onRename={handleRenameSpecUnit}
            onReset={handleResetSpecUnits}
            placeholder="예: 봉, 컵, 인분…"
          />
          {/* 품목 세부스펙 사전 — 데이터·도구 탭에서 옮겨 왔다(신고 ba9feb6b).
              적립된 게 없으면 카드 자체가 서지 않는다. */}
          <ItemSpecOptionsPanel />
        </div>
      )}

      {/* 요금·정책 탭 — 돈의 기준을 한자리에서 정한다(2026-08-19 IA 2단계).
          장기 기본값(이 카드) 다음에 단기 예외(단기 입실 정책), 그다음이 매달 나가는 돈(고정 지출)이다.
          받는 돈에서 나가는 돈으로 읽히는 차례라 세 카드가 한 이야기가 된다. */}
      {tab === 'pricing' && (
        <div className="space-y-4">
          {/* 이사 안내 — '수익·지출' 탭을 찾던 사람에게 어디로 갈렸는지 알린다.
              카드가 아니라 페이지 바탕 위라 --canvas 가 맞다(계약서 탭 로고 안내와 같은 자리).
              TODO(2026-09 하순 제거). */}
          <div className="rounded-xl px-3 py-2 text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
            &lsquo;수익·지출&rsquo; 탭은 <span className="font-semibold text-[var(--warm-dark)]">요금·정책</span>과 <span className="font-semibold text-[var(--warm-dark)]">분류 관리</span>로 나뉘었습니다. 고정 지출 관리는 이 탭 아래에 있습니다.
          </div>

          {/* 앵커는 카드 최상단이다. 카드 중간(환불 규정 칸)에 두면 착지했을 때 카드 제목이 화면
              위로 밀려 어디에 왔는지가 안 보인다. */}
          <div id="dv-refund-policy" className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 scroll-mt-4">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">기본 요금·환불 규정</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">예약금 기본 처리</label>
                <p className="text-xs text-[var(--warm-muted)]">예약 시 받는 예약금의 기본 처리 방식입니다. 예약마다 개별로 바꿀 수 있습니다. 단기 계약은 단기 입실 정책에서 예약금 처리를 따로 정하면 그 방식을 따릅니다.</p>
                <select name="reservationDepositMode" defaultValue={property?.reservationDepositMode ?? 'deposit'}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="deposit">보증금 대체 · 받은 예약금을 보증금으로</option>
                  <option value="prepaid">이용료 선납 · 입주월 이용료로 충당</option>
                  <option value="none">안 받음 · 예약금 없이 예약</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">중도퇴실 위약금 기본값</label>
                <p className="text-xs text-[var(--warm-muted)]">중도퇴실 환불 시 잔여 이용금액에서 공제하는 위약금율입니다. 공정위 기준(10%)을 넘길 수 없고, 퇴실 처리 때 사람별로 이 값 이하로 조정할 수 있습니다.</p>
                <div className="relative w-32">
                  <input type="text" inputMode="numeric" name="refundPenaltyPct"
                    defaultValue={property?.refundPenaltyPct ?? 10}
                    autoComplete="off"
                    className="w-full px-3 py-2.5 pr-8 rounded-sm text-sm outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] num focus:border-[var(--coral)] transition-colors" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--warm-dark)] pointer-events-none">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">퇴실 환불 규정</label>
                <p className="text-xs text-[var(--warm-muted)]">공정거래위원회 기준 고정: 환불액 = 총 결제금액 − (1일 이용요금 × 실제 이용일수) − 위약금(잔여 이용금액의 10%). 1일 이용요금 = 월 이용료 ÷ 30, 잔여 이용금액 = 총 결제금액 − 이용일수분. <span className="text-[var(--warm-muted)]">위약금율·기간은 법적으로 임의 설정이 불가해 고정됩니다.</span> 퇴실 정산에서 위약금을 면제하거나, 1개월 미만 중도 퇴실이면 단기 요금표를 쓸 수 있습니다.</p>
                {/* 체크박스 앞의 hidden '0' — 꺼진 체크박스는 FormData 에 안 실린다. 저장이 필드 단위로
                    쪼개진 뒤로는(2026-08-19) 그 부재가 "이 탭은 이 필드를 담당하지 않는다"로 읽혀
                    체크를 풀 길이 사라진다. 짝을 세워 두면 has 는 항상 참이고 값은 '1' 유무로 갈린다.
                    같은 이름의 hidden 은 환경설정의 세 체크박스 전부에 있다(감지망 축 ⓔ). */}
                <input type="hidden" name="refundClauseInContract" value="0" />
                <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer pt-0.5">
                  <input type="checkbox" name="refundClauseInContract" value="1" defaultChecked={property?.refundClauseInContract ?? true}
                    className="w-4 h-4 accent-[var(--coral)]" />
                  계약서에 환불 규정 자동 표시 <span className="text-[0.65625rem] text-[var(--warm-muted)]">(계약서 본문에 {'{{환불규정}}'} 자리표시자가 있을 때만 나옵니다. 조항을 직접 쓴 경우 이 설정은 영향이 없습니다)</span>
                </label>
                {/* 청소비 수령 방식 — 돈의 구성을 바꾸는 설정이라 소유자만 고친다(형제 토글과 같은 문법). */}
                {isOwner && (
                  <>
                  <input type="hidden" name="cleaningFeeInDeposit" value="0" />
                  <label className="flex items-start gap-2 text-xs text-[var(--warm-dark)] cursor-pointer pt-0.5">
                    <input type="checkbox" name="cleaningFeeInDeposit" value="1" defaultChecked={property?.cleaningFeeInDeposit ?? false}
                      className="w-4 h-4 accent-[var(--coral)] mt-0.5 shrink-0" />
                    <span className="break-keep">청소비를 보증금에 포함해서 받는다 <span className="text-[0.65625rem] text-[var(--warm-muted)]">(보증금 50,000원에 청소비 20,000원이 들어 있고 현금으로는 30,000원만 받는 방식입니다. 켜면 입실 때 받은 청소비가 보증금의 그만큼을 채운 것으로 계산합니다)</span></span>
                  </label>
                  </>
                )}
              </div>
              <Btn type="submit" variant="primary" size="md" fullWidth className="mt-2" disabled={isPending}>
                {isPending ? '저장 중…' : '저장'}
              </Btn>
            </form>
          </div>

          {/* 단기 입실 정책 — 데이터·도구에서 옮겨 왔다. 오너 전용(§4 요금 기준). */}
          {isOwner && <div id="dv-short-stay" className="scroll-mt-4"><ShortStayPolicyCard /></div>}

          {/* 고정 지출 관리 — 수익·지출 탭에서 옮겨 왔다(카드 내부는 무수정). */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--warm-dark)]">고정 지출 관리</h2>
                <p className="text-xs text-[var(--warm-muted)] mt-0.5">반복 주기에 맞춰 도래하는 지출 항목. 납부일 전 대시보드에 알림이 표시됩니다.</p>
              </div>
              <Btn onClick={openNewRec} variant="primary" size="sm">+ 추가</Btn>
            </div>

            {/* 등록/편집 폼 */}
            {showRecForm && (
              <div ref={recFormRef} className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
                {/* 어느 항목을 여는지 제목이 말한다 (§14 "제목에 대상 이름 명시") — 폼이 목록에서 떨어져
                    있어 이름이 없으면 무엇을 고치는 중인지 화면에 남는 단서가 없다. */}
                <p className="text-xs font-semibold text-[var(--warm-dark)]">{editingRec ? `'${editingRec.title}' 고정 지출 수정` : '고정 지출 추가'}</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">항목명 *</label>
                  <input type="text" value={recForm.title} onChange={e => setRecForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="예: 건물 임대료, 관리비"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                    {recItemsActive ? (
                      <div className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm flex items-center justify-between">
                        <span className="font-medium text-[var(--warm-dark)]">{fmtWon(recItemsTotal)}</span>
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">세부항목 합계</span>
                      </div>
                    ) : (
                      <MoneyInput
                        value={Number(recForm.amount) || 0}
                        onChange={v => setRecForm(p => ({ ...p, amount: String(v) }))}
                        placeholder="0원" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">납부일 ({recCycleWord})</label>
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
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  </div>
                </div>
                {/* 주기 — 격월·분기·반기·연1회(신고 7e7da5c4). 매월이면 기준 달 칸을 안 세운다
                    (스키마가 '매월은 이 값을 안 본다'고 적은 것과 화면이 같은 말을 하게). */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">주기</label>
                  <select value={recForm.intervalMonths}
                    onChange={e => setRecForm(p => ({ ...p, intervalMonths: e.target.value, anchorMonth: e.target.value === '1' ? '' : p.anchorMonth }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    {RECURRING_INTERVAL_CHOICES.map(c => <option key={c.value} value={String(c.value)}>{c.label}</option>)}
                  </select>
                </div>
                {recForm.intervalMonths !== '1' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">기준 달</label>
                    {/* 기록이 있으면 기준 달은 '마지막 기록의 달'에서 파생되는 값이다. 고를 수 있는
                        것처럼 두면 고쳐 놓고도 다음 기록·삭제에 조용히 덮인다. 일정을 옮기는 일은
                        아래 '다음 도래 지정'이 맡는다(패널 다수안, 운영자 확정 2026-08-31). */}
                    {editingRec?.hasRecords ? (
                      <>
                        {/* §12 '자동 합산 읽기전용' 규격 — 보더 없음이 규격이라 투명 보더로 박스
                            모델만 맞춘다(정본 용례 PaymentEntryForm.tsx:623). 형제 입력칸과 같은
                            테두리를 두면 눌러도 안 되는 칸으로 보인다(실기 지적 2026-08-31). */}
                        <p className="text-sm text-[var(--warm-dark)] px-3 py-2 rounded-sm bg-[var(--sand-s)] border border-transparent">
                          {recForm.anchorMonth ? `${recForm.anchorMonth}월` : '자동'}
                        </p>
                        <p className="text-[0.65625rem] text-[var(--warm-muted)]">마지막 기록의 달에서 자동으로 정해집니다. 일정을 옮기려면 아래 다음 도래 지정을 쓰세요.</p>
                      </>
                    ) : (
                      <>
                        <select value={recForm.anchorMonth}
                          onChange={e => setRecForm(p => ({ ...p, anchorMonth: e.target.value }))}
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                          <option value="">자동 (활성화 시작일 기준)</option>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={String(m)}>{m}월</option>)}
                        </select>
                        <p className="text-[0.65625rem] text-[var(--warm-muted)]">{recCycleHint}</p>
                      </>
                    )}
                  </div>
                )}
                {/* 다음 도래 지정 — 미루기·당기기의 자리. 기준 달을 고치면 여섯 달 짝이 통째로
                    옮겨져 엉뚱한 달이 먼저 도래한다(반기 기준을 3월로 밀면 9월이 먼저 온다). */}
                {recForm.intervalMonths !== '1' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">다음 도래 지정 (선택)</label>
                    {/* 바로 위 활성화 시작일과 같은 DatePicker 정본이다. raw month 입력은 빈 상자로
                        보여 무엇을 넣는 칸인지 단서가 없고, 기기마다 다르게 열린다. 값 비우기도
                        정본이 안에서 한다('초기화') — 옆에 버튼을 따로 두면 두 벌이 된다. */}
                    <DatePicker monthOnly placeholder="옮길 달 선택"
                      value={recForm.nextDueOverrideMonth ? recForm.nextDueOverrideMonth + '-01' : ''}
                      onChange={v => setRecForm(p => ({ ...p, nextDueOverrideMonth: v ? v.slice(0, 7) : '' }))}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                      이번 회차만 다른 달로 옮길 때 씁니다. 지정한 달에 한 번 도래하고, 기록하면 그 달부터 다시 셉니다. 비워 두면 {recCycleWord} 리듬 그대로입니다.
                    </p>
                  </div>
                )}
                {/* #1 세부항목(관리비 묶음) — 한 번에 납부하는 여러 항목을 나눠 적기 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">세부항목 (선택)</label>
                    <button type="button" onClick={addRecItem}
                      className="text-[0.6875rem] px-2 py-1 rounded-lg border border-[var(--warm-border)] text-[var(--coral)] hover:bg-[var(--coral)]/5 transition-colors">+ 항목 추가</button>
                  </div>
                  {recItems.length === 0 ? (
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                      한 번에 납부하는 여러 항목(예: 관리비 = 청소관리비 + 수도요금 + 공용전기)으로 나누면, 위 금액·변동 여부가 세부항목에서 자동 합산됩니다.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {recItems.map((it, i) => (
                        <div key={i} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg p-2 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <input type="text" value={it.name} onChange={e => updateRecItem(i, { name: e.target.value })}
                              placeholder="세부항목명 (예: 청소관리비)"
                              className="flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                            <button type="button" onClick={() => removeRecItem(i)}
                              className="shrink-0 w-7 h-7 flex items-center justify-center text-[var(--danger-fg)] hover:text-[var(--danger-fg)] rounded-lg transition-colors" aria-label="세부항목 삭제"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <MoneyInput value={Number(it.amount.replace(/[^0-9]/g, '')) || 0}
                                onChange={v => updateRecItem(i, { amount: String(v) })} placeholder="0원" />
                            </div>
                            <label className="flex items-center gap-1 shrink-0 text-xs text-[var(--warm-mid)] cursor-pointer">
                              <input type="checkbox" checked={it.isVariable}
                                onChange={e => updateRecItem(i, { isVariable: e.target.checked })} className="accent-[var(--coral)]" />변동
                            </label>
                          </div>
                        </div>
                      ))}
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">세부항목이 있으면 위 금액·변동 금액은 자동 합산값입니다. 모두 지우면 단순 고정지출로 돌아갑니다.</p>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리</label>
                  <select value={recForm.category} onChange={e => setRecForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    {expenseCategs.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">카테고리 추가·수정은 위 '지출 카테고리 관리'에서 할 수 있습니다.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">알림 (납부일 N일 전)</label>
                  <input type="number" min={0} max={30} value={recForm.alertDaysBefore}
                    onChange={e => setRecForm(p => ({ ...p, alertDaysBefore: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">자동이체 항목은 주말·공휴일이면 다음 영업일 기준으로 알림이 계산됩니다.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">활성화 시작일 (선택)</label>
                  <DatePicker value={recForm.activeSince} onChange={v => setRecForm(p => ({ ...p, activeSince: v }))}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                    이 항목이 실제로 <strong>내 부담</strong>이 되는 첫 날짜입니다.<br />
                    예) 인터넷 요금 결제일이 25일이고 4월25일분이 3월 사용분이면, 양도인이 부담하는 마지막 청구가 4월이므로 내 부담은 <strong>5월 청구분(5월25일)</strong>부터입니다. 2026-05-25 를 넣으세요.<br />
                    입력하지 않으면 즉시 활성화됩니다.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">결제 수단 (선택)</label>
                  <select value={recForm.payMethod} onChange={e => setRecForm(p => ({ ...p, payMethod: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    <option value="">선택 안 함</option>
                    {payMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {/* 구매처 — 기록되는 지출에 자동 기입(신고 6d1cf1ea) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">구매처 (선택)</label>
                  <input type="text" value={recForm.vendor} onChange={e => setRecForm(p => ({ ...p, vendor: e.target.value }))}
                    placeholder="예: 한국전력, 아리수, KT"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">기록되는 지출의 구매처로 자동 입력됩니다.</p>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recForm.isAutoDebit} onChange={e => setRecForm(p => ({ ...p, isAutoDebit: e.target.checked }))} className="accent-[var(--coral)]" />
                    <span className="text-xs text-[var(--warm-dark)]">자동이체 항목</span>
                  </label>
                  <label className={`flex items-center gap-2 ${recItemsActive ? 'opacity-60' : 'cursor-pointer'}`}>
                    <input type="checkbox" disabled={recItemsActive}
                      checked={recItemsActive ? recItemsHasVariable : recForm.isVariable}
                      onChange={e => setRecForm(p => ({ ...p, isVariable: e.target.checked }))} className="accent-[var(--coral)]" />
                    <div>
                      <span className="text-xs text-[var(--warm-dark)]">변동 금액</span>
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-tight mt-0.5">
                        {recItemsActive ? '세부항목에 변동 항목이 있으면 자동으로 변동 처리됩니다' : '전기·수도 등 매달 금액이 달라지는 항목'}
                      </p>
                    </div>
                  </label>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모 (선택)</label>
                  <input type="text" value={recForm.memo} onChange={e => setRecForm(p => ({ ...p, memo: e.target.value }))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                <div className="flex gap-2">
                  <Btn variant="secondary" size="md" className="flex-1" onClick={() => setShowRecForm(false)}>취소</Btn>
                  <Btn variant="primary" size="md" className="flex-1" onClick={handleSaveRec} disabled={recPending || !recForm.title.trim() || !(recItemsActive ? recItemsTotal : Number(recForm.amount.replace(/[^0-9]/g, '')))}>{recPending ? '저장 중…' : '저장'}</Btn>
                </div>
              </div>
            )}

            {/* 목록 */}
            {recurringList.length === 0 && !showRecForm && (
              <p className="text-sm text-[var(--warm-muted)] text-center py-3">등록된 고정 지출이 없습니다.</p>
            )}
            <div className="space-y-2">
              {recurringList.map(r => {
                // 편집 중인 행 표식 (§22 .sel) — 폼이 목록 위에 있어 이것 없이는 어느 항목이 열렸는지 모른다.
                const editing = showRecForm && editingRec?.id === r.id
                // 좁은 폭에서는 액션 줄을 아래로 내린다 (§20). 종전에는 액션 블록이 shrink-0 이라
                // 폭이 모자라면 품명이 먼저 0 으로 눌렸다 — 320px 실측에서 '전기요금'이 18.2/48px,
                // '임대관리비'는 0px 이었다(실기 신고 2026-08-19 "'전...'으로밖에 안 보여").
                return (
                <div key={r.id} className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 rounded-sm px-3 py-2.5 ${r.isActive ? 'bg-[var(--canvas)]' : 'bg-[var(--canvas)] opacity-50'} ${editing ? 'ring-2 ring-[var(--coral)]/[0.16]' : ''}`}
                  style={{ border: `1px solid ${editing ? 'var(--coral)' : 'var(--warm-border)'}` }}>
                  <div className="min-w-0 sm:flex-1">
                    {/* flex-wrap + break-keep — 품명이 식별의 핵심이라 배지에 밀리지 않고 먼저 자리를
                        가진다. 말줄임은 최후순위라 truncate 를 걷었다. */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium text-[var(--warm-dark)] break-keep">{r.title}</p>
                      {r.items.length > 0 && <Badge tone="pale-neutral">묶음 {r.items.length}</Badge>}
                      {r.isAutoDebit && <Badge tone="pale-blue">자동이체</Badge>}
                      {!r.isActive && <Badge tone="pale-neutral">비활성</Badge>}
                    </div>
                    <p className="num text-xs text-[var(--warm-muted)] mt-0.5 break-keep">
                      {recurringCycleLabel(r)} {r.dueDay >= 30 ? '말일' : `${r.dueDay}일`} · {fmtWon(r.amount)} · {r.category} · {r.alertDaysBefore}일 전 알림
                    </p>
                    {r.items.length > 0 && (
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">
                        {r.items.map(it => `${it.name}${it.isVariable ? '(변동)' : ''}`).join(' · ')}
                      </p>
                    )}
                  </div>
                  {/* 행 액션은 RowActionBtn 정본 — raw 버튼은 히트영역이 32px 이라 §09·§10 의 44px 에
                      못 미쳐 옆 버튼이 눌린다. gap-y-4 는 두 줄로 접힐 때 정본이 먹는 -my-2 히트영역
                      (마진박스 28px · 보더박스 44px)이 위아래로 겹치지 않게 하는 최소값이다. */}
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-4 shrink-0 sm:justify-end">
                    <RowActionBtn disabled={recBusyId === r.id} onClick={() => handleToggleRec(r)}>
                      {r.isActive ? '비활성' : '활성화'}
                    </RowActionBtn>
                    <RowActionBtn disabled={recBusyId === r.id} onClick={() => openEditRec(r)}>수정</RowActionBtn>
                    {r.isGroup && (
                      <RowActionBtn disabled={recBusyId === r.id} onClick={async () => {
                        if (!(await confirmDialog({ title: `'${r.title}' 묶기를 해제할까요?`, message: '묶기 전의 원본 고정지출들이 다시 활성화되고 이 묶음은 삭제됩니다. 묶음으로 이미 기장된 지출은 남습니다.', level: 'caution', confirmLabel: '묶기 해제' }))) return
                        setRecBusyId(r.id)
                        const release = trackSave()
                        try {
                          const res = await ungroupRecurringExpense(r.id)
                          if (!res.ok) { showToast(`해제 실패: ${res.error}`); return }
                          pushToast('success', `묶기를 해제했습니다 · 원본 ${res.restored}건 복구`)
                          setRecurringList(prev => prev.filter(x => x.id !== r.id))
                          router.refresh()
                        } finally { release(); setRecBusyId(null) }
                      }}>묶기 해제</RowActionBtn>
                    )}
                    <RowActionBtn tone="danger" disabled={recBusyId === r.id} onClick={() => handleDeleteRec(r.id, r.title)}>삭제</RowActionBtn>
                  </div>
                </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* 멤버 관리 탭 */}
      {tab === 'members' && (
        <div className="space-y-4">

          {/* 참여 코드 (D) — 소유자만 발급/재발급 */}
          {isOwner && (
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--warm-dark)]">참여 코드</h2>
                {joinCode && (
                  <span className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>
                    공유 가능 (현재 1개)
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-muted)' }}>
                이 코드를 공유하면, 받은 사람이 영업장 선택 화면에서 입력해 <strong>참여 요청</strong>을 보낼 수 있습니다.
                소유자(나)가 아래 <strong>참여 요청</strong> 섹션에서 승인하면 멤버로 추가됩니다.
              </p>
              <div className="flex items-center gap-2">
                {joinCode ? (
                  <>
                    <code className="flex-1 px-3 py-2.5 rounded-xl text-base num font-semibold tracking-[0.25em] text-center"
                      style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--persimmon-d)' }}>
                      {joinCode}
                    </code>
                    <Btn type="button" variant="secondary" size="sm" onClick={handleCopyJoinCode}>복사</Btn>
                    <Btn type="button" variant="secondary" size="sm" onClick={handleRegenJoinCode} disabled={joinBusy}>{joinBusy ? '발급 중…' : '재발급'}</Btn>
                  </>
                ) : (
                  <Btn type="button" variant="primary" size="md" onClick={handleRegenJoinCode} disabled={joinBusy}>{joinBusy ? '발급 중…' : '참여 코드 발급'}</Btn>
                )}
              </div>
            </div>
          )}

          {/* 참여 요청 목록 (D) — pending 요청 */}
          {isOwner && joinRequests.length > 0 && (
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">참여 요청 ({joinRequests.length})</h2>
              <ul className="space-y-2">
                {joinRequests.map(req => {
                  const name = req.user.realName || req.user.name || req.user.email
                  return (
                    <li key={req.id} className="bg-[var(--canvas)] rounded-xl px-4 py-3 space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{name}</p>
                        <p className="text-[0.65625rem] shrink-0" style={{ color: 'var(--warm-muted)' }}>
                          {new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(req.createdAt))}
                        </p>
                      </div>
                      <p className="text-xs truncate" style={{ color: 'var(--warm-muted)' }}>
                        {req.user.email}{req.user.phone ? ` · ${req.user.phone}` : ''}
                      </p>
                      {req.message && (
                        <p className="text-xs leading-relaxed bg-[var(--cream-soft)] rounded-lg px-2.5 py-2"
                          style={{ color: 'var(--warm-dark)' }}>
                          {req.message}
                        </p>
                      )}
                      <div className="flex gap-2 items-center">
                        <select
                          defaultValue="STAFF"
                          onChange={e => { req.role = e.target.value as Role }}
                          className="text-xs bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 outline-none focus:border-[var(--coral)]"
                          style={{ color: 'var(--warm-dark)' }}>
                          <option value="MANAGER">관리자</option>
                          <option value="STAFF">스태프</option>
                          <option value="LIMITED_STAFF">제한 스태프 · 재고 입력 담당, 금액 숨김</option>
                        </select>
                        <Btn type="button" variant="primary" size="sm" onClick={() => handleApproveJoin(req.id, req.role)}>승인</Btn>
                        <Btn type="button" variant="secondary" size="sm" onClick={() => handleRejectJoin(req.id)}>거절</Btn>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* 현재 멤버 목록 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">멤버 목록</h2>
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.userId} className="flex items-center gap-3 bg-[var(--canvas)] rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--coral)] flex items-center justify-center text-sm font-medium text-[var(--on-solid)] shrink-0">
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
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
                    >
                      <option value="OWNER">소유자</option>
                      <option value="MANAGER">관리자</option>
                      <option value="STAFF">스태프</option>
                      <option value="LIMITED_STAFF">제한 스태프 · 재고 입력 담당, 금액 숨김</option>
                    </select>
                  ) : (
                    <span className={`text-xs px-2 py-1 rounded-lg font-medium
                      ${m.role === 'OWNER' ? 'bg-[var(--coral)]/30 text-[var(--coral)]' :
                        m.role === 'MANAGER' ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' :
                        'bg-[var(--canvas)] text-[var(--warm-mid)]'}`}>
                      {m.roleLabel}
                    </span>
                  )}
                  {isOwner && m.role !== 'OWNER' && (
                    <button
                      onClick={() => handleRemove(m.userId, m.name ?? m.email)}
                      className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] transition-colors ml-1">
                      제거
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 멤버 초대 (소유자만) */}
          {isOwner && (
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">멤버 초대</h2>
              <p className="text-xs text-[var(--warm-muted)] mb-4">초대할 멤버가 먼저 <a href="/login" className="underline">스테이음에 Google로 로그인</a>한 후 이메일을 입력해주세요.</p>
              <div className="space-y-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="이메일 입력…"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]"
                />
                <div className="flex gap-2">
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as Role)}
                    className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
                  >
                    <option value="MANAGER">관리자 · 등록·수정·삭제 가능</option>
                    <option value="STAFF">스태프 · 조회만 가능</option>
                  </select>
                  <Btn variant="primary" size="md" onClick={handleInvite}>
                    초대
                  </Btn>
                </div>
              </div>
            </div>
          )}

          {/* 권한 안내 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-3">권한 안내</h2>
            <div className="space-y-2">
              {([['소유자', '모든 기능 + 멤버 관리'],
                 ['관리자', '등록·수정·삭제 가능, 멤버 관리 불가'],
                 ['스태프', '조회만 가능'],
                 ['제한 스태프', '재고 관리를 직접 입력·수정할 수 있고, 입주자·호실 현황은 보되 보증금·이용료·미납 등 금액과 매출·지출·정산·보고서·서류는 보이지 않습니다.']] as const).map(([label, desc]) => (
                <div key={label} className="flex gap-3 text-xs">
                  <span className="text-[var(--warm-dark)] w-14 shrink-0">{label}</span>
                  <span className="text-[var(--warm-muted)]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 계약서·서류 탭 — 계약서 자체(사업자 정보·등록증·도장·본문)에 더해 2026-08-19 IA 2단계로
          서류에 자동으로 박히는 값 셋(전용면적·입금 계좌번호·임의처분 동의서)이 기본정보에서 왔다.
          저장 손잡이는 위쪽 폼들과 같은 것을 쓴다 — 같은 행동이 탭마다 다른 피드백을 주면 안 된다. */}
      {tab === 'contract' && (
        <ContractTab initial={contractSettings} property={property} isOwner={isOwner}
          onSubmitProperty={handleSubmit} saving={isPending} onJump={jumpTo} />
      )}

      {tab === 'website' && <WebsiteTab initialSlug={property?.publicSlug ?? ''} candidates={siteCandidates} />}

      {tab === 'appearance' && <AppearanceTab />}
    </div>
  )
}

// ── 계약서 탭 ─────────────────────────────────────────────────────

function ContractTab({ initial, property, isOwner, onSubmitProperty, saving, onJump }: {
  initial: ContractSettings
  /** 서류 자동채움 값(전용면적·계좌번호·동의서)의 현재 저장값 — 기본정보에서 옮겨 왔다. */
  property: Property | null
  /** 여러 판본 만들기는 법적 위험이 걸린 설정이라 소유자만 고친다(청소비 토글과 같은 이유). */
  isOwner: boolean
  onSubmitProperty: (e: { preventDefault(): void; currentTarget: HTMLFormElement }) => void
  saving: boolean
  /** 서류 변수 조망에서 다른 탭의 원천 카드로 점프한다(허브 정본 DocVariablesPanel). */
  onJump: (tab: Tab, anchorId: string) => void
}) {
  const [template, setTemplate]         = useState<ContractTemplate>(initial.template)
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo>(initial.businessInfo)
  const [stampUrl, setStampUrl]         = useState<string | null>(initial.stampThumbnailUrl)
  const [bizCert, setBizCert]           = useState(initial.bizCert)
  const [savingTpl, setSavingTpl]       = useState(false)
  const [savingBiz, setSavingBiz]       = useState(false)
  const [stampUploading, setStampUploading] = useState(false)
  const [certUploading, setCertUploading]   = useState(false)

  // 서류 자동채움 값 — 기본정보 탭에서 옮겨 온 상태(2026-08-19 IA 2단계). 칸의 문법은 무수정.
  const [areaVal, setAreaVal] = useState(property?.defaultAreaM2 != null ? String(property.defaultAreaM2) : '')
  // 여러 판본 만들기 — 켤 때만 경고를 띄우고, 확인해야 체크가 선다(운영자 결정 2026-08-20).
  // 저장은 이 카드의 저장 버튼이 한다(§27.1 — 같은 카드에서 즉시저장과 폼저장을 섞지 않는다).
  const [multiVersions, setMultiVersions] = useState(property?.multiContractVersions === true)
  const askMultiVersions = async (next: boolean) => {
    if (!next) { setMultiVersions(false); return }
    const ok = await confirmDialog({
      title: '계약서를 여러 판본으로 만들 수 있게 할까요?',
      message: '이 기능을 켜면 한 입주자에게 기재 내용이 다른 계약서를 여러 부 만들 수 있습니다. '
        + '월세 세액공제나 주거급여 신청에 실제와 다른 금액의 계약서가 쓰이면 신청인은 부정수급이 되고, '
        + '그 서류를 만들어 준 운영자도 조력한 것으로 조사받을 수 있습니다. '
        + '보증금이나 월세가 일정액을 넘는 임대차는 주택임대차 신고 대상이 될 수 있고 고시원이 그 대상인지는 '
        + '지역과 건물 유형에 따라 갈리므로, 신고한 내용과 다른 계약서가 남으면 진위를 다투게 됩니다. '
        + '이미 서명을 받은 계약서의 내용을 서명자 동의 없이 바꿔 다른 판본을 만드는 것은 사문서 변조에 해당할 수 있습니다. '
        + '같은 내용을 다른 표기나 서식으로 다시 내야 할 때를 위한 기능이며, 스테이음은 기재 내용이 다른 계약서를 만드는 용도를 권하지 않습니다. '
        + '켜기 전에 변호사 검토를 받아 보시기를 권합니다.',
      level: 'caution', confirmLabel: '켜기',
    })
    if (ok) setMultiVersions(true)
  }
  // 잔여 소지품 임의처분 동의서 — 저장값(JSON) 폴백
  const dcRaw = (property?.disposalConsentTemplate as Partial<DisposalConsentTemplate> | null) ?? null
  const dc = {
    enabled: dcRaw?.enabled ?? DEFAULT_DISPOSAL_CONSENT.enabled,
    days:    dcRaw?.days    ?? DEFAULT_DISPOSAL_CONSENT.days,
    title:   dcRaw?.title   ?? DEFAULT_DISPOSAL_CONSENT.title,
    body:    dcRaw?.body    ?? DEFAULT_DISPOSAL_CONSENT.body,
  }

  // 추가 호실(창고) 특약 — 저장값(JSON) 폴백. resolveSubLeaseAddendum 이 정본이라
  // 화면과 종이가 같은 규칙을 본다. null 이 오면 이 영업장은 특약을 안 쓰는 것이라 칸이 빈다.

  const updateSection = (idx: number, patch: Partial<ContractSection>) => {
    setTemplate(t => ({
      ...t,
      sections: t.sections.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }))
  }
  const moveSection = (idx: number, dir: -1 | 1) => {
    setTemplate(t => {
      const next = [...t.sections]
      const j = idx + dir
      if (j < 0 || j >= next.length) return t
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return { ...t, sections: next }
    })
  }
  const removeSection = async (idx: number) => {
    if (!(await confirmDialog({ title: '이 섹션을 삭제할까요?', level: 'caution', confirmLabel: '삭제' }))) return
    setTemplate(t => ({ ...t, sections: t.sections.filter((_, i) => i !== idx) }))
  }
  const addSection = () => {
    setTemplate(t => ({
      ...t,
      sections: [...t.sections, {
        id: `s${Date.now()}`,
        title: `${t.sections.length + 1}. 새 섹션`,
        items: ['- '],
      }],
    }))
  }

  const handleSaveTemplate = async () => {
    setSavingTpl(true)
    const release = trackSave()
    try {
      const res = await saveContractTemplate(template)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '계약서 본문 저장됨')
    } finally { release(); setSavingTpl(false) }
  }
  const handleSaveBusinessInfo = async () => {
    setSavingBiz(true)
    const release = trackSave()
    try {
      const res = await saveBusinessInfo(businessInfo)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '사업자 정보 저장됨')
    } finally { release(); setSavingBiz(false) }
  }

  // 사업자등록증 — 업로드 축은 도장과 같다(세션 발급 → Drive 직접 PUT → 마무리).
  // 다른 점은 둘뿐이다. 이미지 말고 PDF 도 받는다는 것과, mime 을 서버가 판정해 함께 저장한다는 것.
  const handleBizCertSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCertUploading(true)
    const release = trackSave()
    try {
      const session = await createBizCertUploadSession({
        fileName: file.name, mimeType: file.type, fileSize: file.size,
        origin: window.location.origin,
      })
      if (!session.ok) { pushToast('error', session.error); return }
      const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file)
      const fin = await finalizeBizCert(driveFileId)
      if (!fin.ok) { pushToast('error', fin.error); return }
      setBizCert({ driveFileId, mimeType: fin.mimeType })
      pushToast('success', '사업자등록증 업로드됨')
    } catch (err) {
      pushToast('error', humanError(err, '사업자등록증 업로드 실패'))
    } finally { release(); setCertUploading(false) }
  }
  const handleBizCertDelete = async () => {
    if (!(await confirmDialog({ title: '사업자등록증을 삭제할까요?', level: 'caution', confirmLabel: '삭제' }))) return
    const release = trackSave()
    try {
      const res = await deleteBizCert()
      if (!res.ok) { pushToast('error', res.error); return }
      setBizCert(null)
      pushToast('success', '사업자등록증 삭제됨')
    } finally { release() }
  }

  const handleStampSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setStampUploading(true)
    const release = trackSave()
    try {
      const session = await createStampUploadSession({
        fileName: file.name, mimeType: file.type, fileSize: file.size,
        origin: window.location.origin,
      })
      if (!session.ok) { pushToast('error', session.error); return }
      const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file)
      const fin = await finalizeStamp(driveFileId)
      if (!fin.ok) { pushToast('error', fin.error); return }
      setStampUrl(fin.thumbnailUrl)
      pushToast('success', '도장 업로드됨')
    } catch (err) {
      pushToast('error', humanError(err, '도장 업로드 실패'))
    } finally { release(); setStampUploading(false) }
  }
  const handleStampDelete = async () => {
    if (!(await confirmDialog({ title: '도장 이미지를 삭제할까요?', level: 'caution', confirmLabel: '삭제' }))) return
    const release = trackSave()
    try {
      const res = await deleteStamp()
      if (!res.ok) { pushToast('error', res.error); return }
      setStampUrl(null)
      pushToast('success', '도장 삭제됨')
    } finally { release() }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl px-3 py-2 text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
        영업장 로고는 <span className="font-semibold text-[var(--warm-dark)]">기본정보 탭</span>에서 등록·관리합니다 (사이드바·대시보드 등 다른 위치에서도 함께 사용).
      </div>

      {/* 서류 변수 한눈에 — 조망·허브 진입(운영자 승인 2026-09-01, 패널 설계).
          값의 정본은 각 카드의 DB 필드이고 이 카드는 같은 필드를 보는 창이다. */}
      <DocVariablesOverviewCard onJump={onJump} />

      {/* 사업자 정보 */}
      <div id="dv-biz-info" className="rounded-xl p-4 sm:p-5 space-y-3 scroll-mt-4" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--warm-dark)]">사업자 정보</h3>
          <Btn variant="primary" size="sm" onClick={handleSaveBusinessInfo} disabled={savingBiz}>{savingBiz ? '저장 중…' : '저장'}</Btn>
        </div>
        <p className="text-xs text-[var(--warm-muted)] -mt-1">계약서 하단 사업자 표기 영역에 자동 삽입됩니다.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BizField label="상호" value={businessInfo.name} onChange={v => setBusinessInfo(b => ({ ...b, name: v }))} />
          <BizField label="사업자번호" value={businessInfo.registrationNo} onChange={v => setBusinessInfo(b => ({ ...b, registrationNo: v }))} />
          <BizField label="대표자" value={businessInfo.ceoName} onChange={v => setBusinessInfo(b => ({ ...b, ceoName: v }))} />
          <BizField label="사업장 주소" value={businessInfo.address} onChange={v => setBusinessInfo(b => ({ ...b, address: v }))} />
        </div>
      </div>

      {/* 사업자등록증 — 사업자등록번호 바로 아래에 둔다. 같은 서류에서 옮겨 적는 값들이라
          하나를 채우러 온 김에 다른 하나도 눈에 들어와야 한다(운영자 오더 2026-08-18). */}
      <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">사업자등록증</h3>
        <p className="text-xs text-[var(--warm-muted)] -mt-1">이미지 또는 PDF, 4MB 이하. 상담 도구에서 문자·메일 첨부로 바로 보낼 수 있습니다.</p>
        <div className="flex items-center gap-4">
          {/* 미리보기 바탕은 --cream-soft — 다크에서 --canvas 는 #000 이라 카드에 검은 구멍이 뚫린다(§28) */}
          <div className="w-24 h-24 rounded-xl border border-dashed border-[var(--warm-border)] flex items-center justify-center bg-[var(--cream-soft)] overflow-hidden">
            {bizCert?.mimeType.startsWith('image/') ? (
              // 인증 프록시를 직접 문다 — Drive 공개 URL 을 쓰지 않는다. v= 는 교체 직후 옛 캐시를 끊는 키다.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/biz-cert?v=${bizCert.driveFileId}`} alt="사업자등록증" className="max-w-full max-h-full object-contain" />
            ) : bizCert ? (
              <span className="text-xs font-medium text-[var(--warm-mid)]">PDF</span>
            ) : (
              // --warm-muted 는 이 바탕(--cream-soft) 위에서 다크 4.46:1 로 §28 본문 하한(4.5)에 못 미쳤다
              // (헤드리스 실측). --warm-mid 는 라이트에서 --warm-muted 와 같은 값이라 밝은 화면은 무변동.
              <span className="text-xs text-[var(--warm-mid)]">미등록</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {/* 파일 input 을 감싸는 label 이라 Btn 을 쓸 수 없다 — 토큰은 btnClass 로 공유한다. */}
            <label className={btnClass('primary', 'sm', `cursor-pointer ${certUploading ? 'opacity-60' : ''}`)}>
              {certUploading ? '업로드 중…' : (bizCert ? '교체' : '업로드')}
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleBizCertSelect} disabled={certUploading} />
            </label>
            {bizCert && <Btn variant="danger" size="sm" onClick={handleBizCertDelete} disabled={certUploading}>삭제</Btn>}
          </div>
        </div>
      </div>

      {/* 도장 */}
      <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">도장 이미지</h3>
        <p className="text-xs text-[var(--warm-muted)] -mt-1">투명 배경 PNG 권장. 출력 시 사업자 서명란 옆에 자동 표시됩니다.</p>
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-xl border border-dashed border-[var(--warm-border)] flex items-center justify-center bg-[var(--canvas)] overflow-hidden">
            {stampUrl ? (
              <img src={stampUrl} alt="도장" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-xs text-[var(--warm-muted)]">미등록</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className={`px-3 py-2 text-sm rounded-lg cursor-pointer text-center font-medium transition-colors ${stampUploading ? 'opacity-60' : 'bg-[var(--coral)] text-[var(--on-solid)] hover:opacity-90'}`}>
              {stampUploading ? '업로드 중…' : (stampUrl ? '교체' : '업로드')}
              <input type="file" accept="image/*" className="hidden" onChange={handleStampSelect} disabled={stampUploading} />
            </label>
            {stampUrl && <Btn variant="danger" size="sm" onClick={handleStampDelete} disabled={stampUploading}>삭제</Btn>}
          </div>
        </div>
      </div>

      {/* 본문 템플릿 */}
      <div className="rounded-xl p-4 sm:p-5 space-y-4" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-[var(--warm-dark)]">계약서 본문</h3>
          <Btn variant="primary" size="sm" onClick={handleSaveTemplate} disabled={savingTpl}>{savingTpl ? '저장 중…' : '저장'}</Btn>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--warm-mid)]">계약서 제목</label>
          <input
            type="text"
            value={template.title}
            onChange={e => setTemplate(t => ({ ...t, title: e.target.value }))}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--warm-mid)]">비상연락망 안내 문구</label>
          <input
            type="text"
            value={template.emergencyContactNote ?? ''}
            onChange={e => setTemplate(t => ({ ...t, emergencyContactNote: e.target.value }))}
            placeholder="예) * 비상연락망(이름/전화번호/관계-위급상황시 통보):"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--warm-mid)]">서약 문구 (서명란 위)</label>
          <input
            type="text"
            value={template.oathText}
            onChange={e => setTemplate(t => ({ ...t, oathText: e.target.value }))}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
          />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-[var(--warm-mid)]">섹션 (각 줄은 줄바꿈으로 구분 · &lsquo;- &rsquo;로 시작 권장)</p>
          {template.sections.map((sec, idx) => (
            <div key={sec.id} className="rounded-xl p-3 space-y-2" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sec.title}
                  onChange={e => updateSection(idx, { title: e.target.value })}
                  className="flex-1 min-w-0 bg-transparent border-b border-[var(--warm-border)] px-1 py-1 text-sm font-semibold text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
                />
                <button type="button" onClick={() => moveSection(idx, -1)} disabled={idx === 0} aria-label="위로"
                  className="text-xs px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] disabled:opacity-30 inline-flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
                <button type="button" onClick={() => moveSection(idx, 1)} disabled={idx === template.sections.length - 1} aria-label="아래로"
                  className="text-xs px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] disabled:opacity-30 inline-flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /></svg></button>
                <button type="button" onClick={() => removeSection(idx)}
                  className="text-xs px-2 py-1 rounded-md border border-[var(--danger-ring)] text-[var(--danger-fg)] hover:bg-[var(--danger-bg)]">삭제</button>
              </div>
              <textarea
                value={sec.items.join('\n')}
                onChange={e => updateSection(idx, { items: e.target.value.split('\n') })}
                rows={Math.max(3, sec.items.length)}
                className="w-full bg-transparent border border-[var(--warm-border)] rounded-sm px-2 py-2 text-xs text-[var(--warm-dark)] leading-relaxed outline-none focus:border-[var(--coral)]"
                style={{ fontFamily: 'inherit' }}
              />
            </div>
          ))}
          <button type="button" onClick={addSection}
            className="w-full py-2 text-sm text-[var(--coral)] border border-dashed border-[var(--coral)]/40 rounded-xl hover:bg-[var(--coral-pale)]/30 transition-colors">
            + 섹션 추가
          </button>
        </div>

        <span id="dv-contract-template" className="scroll-mt-4" />
        <div className="rounded-lg px-3 py-2 text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed" style={{ background: 'var(--canvas)' }}>
          본문에서 다음 변수를 사용하면 출력 시 입실자 정보로 자동 치환됩니다:
          <span className="block mt-1 num text-[0.65625rem]">
            {`{{name}} {{phone}} {{birth}} {{job}} {{gender}} {{smoking}} {{deposit}} {{checkInDate}} {{roomNo}} {{checkOutDate}} {{rentFee}} {{emergencyContact}}`}
          </span>
        </div>
      </div>

      {/* 서류 자동채움 값 — 기본정보 탭에서 옮겨 왔다(2026-08-19 IA 2단계). 셋 다 "서류를 뽑을 때
          저절로 들어가는 값"이라는 한 가지 성격이고, 그 성격이 이 탭의 이름(계약서·서류)이다.
          카드 하나에 담고 안에서 border-t 소제목으로 확인서 축과 계약서 동반 축을 가른다 —
          기본정보 폼이 쓰던 그 소제목 문법 그대로다(형제 카드는 h3 + p-4 sm:p-5 를 쓴다).
          폼 자체가 카드다 — 사업자 정보 카드처럼 제목 줄 오른쪽에 저장이 붙는다. */}
      <form id="dv-doc-defaults" onSubmit={onSubmitProperty} className="rounded-xl p-4 sm:p-5 space-y-3 scroll-mt-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--warm-dark)]">서류 자동채움 값</h3>
          <Btn type="submit" variant="primary" size="sm" disabled={saving}>{saving ? '저장 중…' : '저장'}</Btn>
        </div>
        <p className="text-xs text-[var(--warm-muted)] -mt-1">서류를 뽑을 때 저절로 채워지는 값입니다. 기본정보 탭에서 옮겨 왔습니다.</p>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">영업장 전용면적</label>
          <p className="text-xs text-[var(--warm-muted)]">영업장(호실)의 전용면적입니다. 실거주 확인서의 면적 칸에 자동으로 들어갑니다. (호실별 측정 면적이 아닌 영업장 기준 면적)</p>
          <div className="relative">
            <input type="text" inputMode="decimal" name="defaultAreaM2"
              value={areaVal}
              onChange={e => setAreaVal(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="예: 13.2"
              autoComplete="off"
              className="w-full px-3 py-2.5 pr-10 rounded-sm text-sm outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] num focus:border-[var(--coral)] transition-colors" />
            {areaVal.trim() !== '' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--warm-dark)] pointer-events-none">㎡</span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">입금 계좌번호</label>
          <p className="text-xs text-[var(--warm-muted)]">입실료 납부 확인서의 ‘납부방법’에 자동으로 들어갑니다. 은행·계좌번호·예금주까지 적어두면 좋습니다.</p>
          <input type="text" name="bankAccount"
            defaultValue={property?.bankAccount ?? ''}
            placeholder="예: 카카오뱅크 3333-01-2345678 (홍길동)"
            autoComplete="off"
            className="w-full px-3 py-2.5 rounded-sm text-sm outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors" />
        </div>
        {/* 여러 판본 만들기 — 소유자만. 형제 토글(청소비 보증금 포함)과 같은 문법이고, 다른 점은
            켤 때 경고 확인창을 지난다는 것뿐이다. 체크박스 앞의 hidden '0' 은 감지망 축 ⓔ 가 지킨다. */}
        {isOwner && (
          <div className="pt-3 mt-1 border-t border-[var(--warm-border)] space-y-1.5">
            <h4 className="text-xs font-semibold text-[var(--warm-dark)]">여러 판본 만들기</h4>
            <p className="text-xs text-[var(--warm-muted)]">꺼 두면 한 입주자에게 계약서 한 부만 만들어지고, 표기를 바꿔야 하면 그 계약서를 폐기하고 다시 작성합니다. 켜면 실계약 계약서를 먼저 만든 뒤 제출용이나 번역본을 따로 만들 수 있습니다. 다시 끄면 실계약이 아닌 판본은 목록에서 숨겨집니다. 지워지지 않고, 다시 켜면 그대로 돌아옵니다.</p>
            <input type="hidden" name="multiContractVersions" value="0" />
            <label className="flex items-start gap-2 text-xs text-[var(--warm-dark)] cursor-pointer pt-0.5">
              <input type="checkbox" name="multiContractVersions" value="1" checked={multiVersions}
                onChange={e => { void askMultiVersions(e.target.checked) }}
                className="w-4 h-4 accent-[var(--coral)] mt-0.5 shrink-0" />
              <span className="break-keep">한 계약에 여러 판본 계약서를 만든다 <span className="text-[0.65625rem] text-[var(--warm-muted)]">(법적 위험이 있는 기능입니다. 켤 때 안내를 확인해 주세요)</span></span>
            </label>
          </div>
        )}
        {/* 조건부 특약 — 계약서 **본문 뒤에 붙는 절**이라 아래 '동반 서류'와 다르다.
            조건에 맞는 계약에만 붙고(창고 특약은 딸린 비거주 호실이 있을 때), 절 번호는 자리에서 매긴다.

            종전에는 문안이 코드 상수라 아무도 못 고쳤다. 지워지면 그 방을 주거로 쓰지 말라는
            근거가 종이에서 사라진다는 이유였는데, 운영자 판단으로 연다(2026-08-29) —
            영업장 관리 주체에 따라 창고 운영 방식이 다르다. 대신 '기본 문안으로' 를 함께 둔다:
            적용하는 것에는 적용취소가 있어야 하고, 지웠다 되돌릴 길이 없으면 아무도 못 고친다. */}
        <div className="pt-3 mt-1 border-t border-[var(--warm-border)]">
          <h4 className="text-xs font-semibold text-[var(--warm-dark)]">조건부 특약</h4>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">조건에 맞는 계약서에만 본문 뒤에 붙는 절입니다.</p>
        </div>
        <span id="dv-addendum-subLease" className="scroll-mt-4" />
        <AddendumCard label="추가 호실 특약" field="subLease" rows={9}
          fallback={DEFAULT_SUB_LEASE_ADDENDUM} saved={resolveSubLeaseAddendum(property?.subLeaseAddendum)}
          hint="창고·사무실처럼 거주용이 아닌 방이 추가 호실로 딸린 계약서에만 붙습니다." />
        <span id="dv-addendum-shortStay" className="scroll-mt-4" />
        <AddendumCard label="단기 입실 특약" field="shortStay" rows={5}
          fallback={DEFAULT_SHORT_STAY_ADDENDUM} saved={resolveShortStayAddendum(property?.shortStayAddendum)}
          hint="단기 입실로 등록한 계약서에만 붙습니다. 단기 입실 정책이 꺼져 있으면 안 붙습니다." />
        <span id="dv-addendum-earlyCheckout" className="scroll-mt-4" />
        <AddendumCard label="조기 퇴실 시 요금 적용" field="earlyCheckout" rows={4}
          fallback={DEFAULT_EARLY_CHECKOUT_ADDENDUM} saved={resolveEarlyCheckoutAddendum(property?.earlyCheckoutAddendum)}
          hint="일반 계약서에만 붙습니다(단기 특약과 함께 서지 않습니다). 1개월을 못 채우고 중도 퇴실할 때의 요금 기준입니다." />
        <span id="dv-addendum-roomSchedule" className="scroll-mt-4" />
        <AddendumCard label="거주 호실 일정" field="roomSchedule" rows={4}
          fallback={DEFAULT_ROOM_SCHEDULE_ADDENDUM} saved={resolveRoomScheduleAddendum(property?.roomScheduleAddendum)}
          hint={'임시 호실을 거쳐 계약 호실로 옮기는 계약서에만 붙습니다. 문장 안 {{일정}} 자리에 그 계약의 호실 일정이 들어갑니다.'} />
        <div className="pt-3 mt-1 border-t border-[var(--warm-border)]">
          <h4 className="text-xs font-semibold text-[var(--warm-dark)]">계약서 동반 서류</h4>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">계약서를 뽑을 때 함께 나가는 별도 서류입니다.</p>
        </div>
        <div className="space-y-1.5">
          <span id="dv-disposal" className="scroll-mt-4" /><label className="text-xs font-medium text-[var(--warm-mid)]">잔여 소지품 임의처분 동의서</label>
          <p className="text-xs text-[var(--warm-muted)]">계약서와 함께 출력되는 별도 서류. 입실자 정보·날짜·서명란은 자동입니다. 본문에 변수 사용 가능: <span className="num">{'{{성명}} {{호실}} {{연락처}} {{미납일수}} {{영업장명}} {{대표}}'}</span></p>
          {/* 체크박스 앞의 hidden '0' — 요금·정책 탭의 두 토글과 같은 이유다(감지망 축 ⓔ). */}
          <input type="hidden" name="disposalEnabled" value="0" />
          <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer">
            <input type="checkbox" name="disposalEnabled" value="1" defaultChecked={dc.enabled} className="w-4 h-4 accent-[var(--coral)]" />
            계약서와 함께 출력
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1">
              <label className="text-[0.6875rem] text-[var(--warm-muted)]">제목</label>
              <input type="text" name="disposalTitle" defaultValue={dc.title}
                className="w-full px-3 py-2.5 rounded-sm text-sm outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors" />
            </div>
            <div className="space-y-1">
              <label className="text-[0.6875rem] text-[var(--warm-muted)]">미납 기준일</label>
              <input type="text" inputMode="numeric" name="disposalDays" defaultValue={String(dc.days)} placeholder="7"
                className="w-20 px-3 py-2.5 rounded-sm text-sm outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] num focus:border-[var(--coral)] transition-colors" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[0.6875rem] text-[var(--warm-muted)]">동의 내용 (본문)</label>
            <textarea name="disposalBody" defaultValue={dc.body} rows={9}
              className="w-full px-3 py-2.5 rounded-sm text-sm leading-relaxed outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors resize-y" />
          </div>
        </div>
      </form>

      {/* 추가 서류 — 동의서(위 자동채움 폼 안)와 별도 카드다. 그쪽은 한 벌 폼형이고 여기는
          여러 벌 목록형이라 §27.1 이 한 카드 안 혼용을 금한다. */}
      <span id="dv-sign-docs" className="scroll-mt-4" />
      <SignDocumentsCard initial={parseSignDocuments(property?.signDocuments)} />

      {/* 서류 메일 문안 — 자동채움 카드 바로 아래. 이 탭의 축("서류를 내보낼 때 저절로 붙는 값")
          그대로다. 문자 템플릿 카드(여러 벌 목록형)와 달리 한 벌 기본값 폼형이라 여기가 자리다. */}
      <span id="dv-doc-mail" className="scroll-mt-4" />
      <DocMailTemplateCard />
    </div>
  )
}

/**
 * 조건부 특약 한 벌 — 셋이 같은 문법을 쓴다(추가 호실 · 단기 입실 · 조기 퇴실).
 *
 * 카드마다 폼을 손으로 베끼면 필드 이름이나 폴백 규칙이 한 벌만 어긋나고, 그 절만 되살아나거나
 * 사라진다. 저장 이름은 field 로 만든다 — `${field}Title` · `${field}Items` 가 규약이고
 * lib/propertySettingsPatch 가 같은 이름으로 읽는다.
 *
 * **비우는 것이 곧 '이 영업장은 이 절을 안 쓴다'이다.** 그래서 saved 가 null 이면 칸이 빈 채로
 * 열린다 — 기본 문안을 되살려 놓으면 지운 적 없는 조항이 다시 종이에 실린다.
 */
function AddendumCard({ label, field, rows, fallback, saved, hint }: {
  label: string
  field: 'subLease' | 'shortStay' | 'earlyCheckout' | 'roomSchedule'
  rows: number
  fallback: { title: string; items: string[] }
  saved: { title: string; items: string[] } | null
  hint: string
}) {
  const [title, setTitle] = useState(saved?.title ?? fallback.title)
  const [items, setItems] = useState((saved?.items ?? []).join('\n'))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
        <button type="button"
          onClick={() => { setTitle(fallback.title); setItems(fallback.items.join('\n')) }}
          className="min-h-[28px] inline-flex items-center text-[0.65625rem] px-1.5 text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">기본 문안으로</button>
      </div>
      <p className="text-xs text-[var(--warm-muted)]">{hint} 항목은 한 줄에 하나씩 적고, 번호는 인쇄할 때 자동으로 매겨집니다. 전부 비우면 이 영업장은 이 절을 쓰지 않습니다.</p>
      <input type="text" name={`${field}Title`} value={title} onChange={e => setTitle(e.target.value)}
        placeholder={fallback.title}
        className="w-full px-3 py-2.5 rounded-sm text-sm outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors" />
      <textarea name={`${field}Items`} value={items} onChange={e => setItems(e.target.value)} rows={rows}
        className="w-full px-3 py-2.5 rounded-sm text-sm leading-relaxed outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors resize-y" />
    </div>
  )
}

function BizField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
    </div>
  )
}

// ── 화면(테마) 탭 ─────────────────────────────────────────────────
const FONT_SIZE_OPTIONS: { key: FontSizeLevel; label: string; desc: string; basePx: number }[] = [
  { key: 'compact', label: '작게',   desc: '한 화면에 더 많은 정보 · 데이터 집중형',  basePx: 14 },
  { key: 'default', label: '기본',   desc: '권장 크기',                               basePx: 16 },
  { key: 'large',   label: '크게',   desc: '가독성 우선 · 눈이 불편한 경우 권장',     basePx: 18 },
  { key: 'xlarge',  label: '아주 크게', desc: '최대 크기',                            basePx: 20 },
]

function FontSizePreview({ basePx }: { basePx: number }) {
  const scale = basePx / 16
  return (
    <div
      className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-3 space-y-1.5 overflow-hidden"
      style={{ fontSize: `${basePx}px` }}
    >
      <div className="flex items-center justify-between">
        <span style={{ fontSize: `${0.625 * scale}rem`, lineHeight: 1.4 }} className="text-[var(--warm-muted)]">2026년 5월 15일</span>
        <span style={{ fontSize: `${0.875 * scale}rem` }} className="font-bold text-[var(--danger-fg)]">-58만원</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span style={{ fontSize: `${0.625 * scale}rem` }} className="px-2 py-0.5 rounded-sm bg-[var(--coral-pale)] text-[var(--coral)]">통신비</span>
        <span style={{ fontSize: `${0.75 * scale}rem` }} className="text-[var(--warm-dark)]">인터넷 요금</span>
      </div>
      <span style={{ fontSize: `${0.625 * scale}rem` }} className="text-[var(--warm-muted)]">계좌이체 · 하나은행</span>
    </div>
  )
}

function AppearanceTab() {
  const { mode, setMode, isDark } = useTheme()
  const { level, setLevel } = useFontSize()

  const themeOptions: { key: ThemeMode; label: string; desc: string }[] = [
    { key: 'system', label: '시스템 따라', desc: '기기 설정(라이트/다크)에 자동으로 맞춤' },
    { key: 'light',  label: '라이트',     desc: '항상 밝은 화면' },
    { key: 'dark',   label: '다크',       desc: '항상 어두운 화면 · 야간·OLED 권장' },
    { key: 'time',   label: '시간 기반',  desc: '오전 6시~오후 6시 라이트, 그 외 다크' },
  ]

  return (
    <div className="space-y-4">
      {/* 테마 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--warm-dark)]">테마</h2>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">
            현재 적용: <span className="font-medium text-[var(--warm-dark)]">{isDark ? '다크' : '라이트'}</span>
          </p>
        </div>
        <div className="space-y-2">
          {themeOptions.map(o => {
            const selected = mode === o.key
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setMode(o.key)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors flex items-start gap-3
                  ${selected
                    ? 'border-[var(--persimmon)] bg-[var(--persimmon-l)]'
                    : 'border-[var(--warm-border)] bg-[var(--canvas)] hover:border-[var(--camel)]'}`}
              >
                <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                  ${selected ? 'border-[var(--persimmon)]' : 'border-[var(--warm-border)]'}`}>
                  {selected && <span className="w-2 h-2 rounded-full bg-[var(--persimmon)]" />}
                </span>
                <span className="flex-1">
                  <span className={`block text-sm font-medium ${selected ? 'text-[var(--persimmon-d)]' : 'text-[var(--warm-dark)]'}`}>{o.label}</span>
                  <span className="block text-xs text-[var(--warm-muted)] mt-0.5">{o.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 글씨 크기 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--warm-dark)]">글씨 크기</h2>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">앱 전체 텍스트 크기. 이 기기에만 적용됩니다</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FONT_SIZE_OPTIONS.map(o => {
            const selected = level === o.key
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setLevel(o.key)}
                className={`text-left px-3 py-3 rounded-xl border transition-colors flex flex-col gap-2
                  ${selected
                    ? 'border-[var(--persimmon)] bg-[var(--persimmon-l)]'
                    : 'border-[var(--warm-border)] bg-[var(--canvas)] hover:border-[var(--camel)]'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                    ${selected ? 'border-[var(--persimmon)]' : 'border-[var(--warm-border)]'}`}>
                    {selected && <span className="w-2 h-2 rounded-full bg-[var(--persimmon)]" />}
                  </span>
                  <span className={`text-sm font-medium ${selected ? 'text-[var(--persimmon-d)]' : 'text-[var(--warm-dark)]'}`}>{o.label}</span>
                </div>
                <FontSizePreview basePx={o.basePx} />
                <span className="text-[0.65625rem] text-[var(--warm-muted)] leading-snug">{o.desc}</span>
              </button>
            )
          })}
        </div>
      </div>
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

  // 핸들 드래그(운영자 요청 2026-07-18 — 호실설정·수익지출에도 순서 편집 적용).
  // 드래그는 오른쪽 44pt 핸들 버튼에서만 시작 — 행 몸통에 걸면 스크롤 터치가 순서를 바꿔버린다(재고 순서 편집에서 확인된 교훈).
  // 드래그 중엔 로컬 순서(dragOrder)로 표시하고, 놓을 때 한 번만 onReorder(화살표와 같은 저장 경로).
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const optListRef = useRef<HTMLDivElement | null>(null)
  const dragChanged = useRef(false)
  const onHandleDown = (idx: number) => (e: React.PointerEvent) => {
    if (!onReorder) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragChanged.current = false
    setDragOrder([...items])
    setDragIdx(idx)
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (dragIdx == null || !optListRef.current || !dragOrder) return
    const rows = Array.from(optListRef.current.children) as HTMLElement[]
    if (rows.length === 0) return
    let over = -1
    if (e.clientY < rows[0].getBoundingClientRect().top) over = 0
    else if (e.clientY > rows[rows.length - 1].getBoundingClientRect().bottom) over = rows.length - 1
    else for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (e.clientY >= r.top && e.clientY <= r.bottom) { over = i; break } }
    if (over < 0 || over === dragIdx) return
    setDragOrder(prev => {
      if (!prev) return prev
      const next = [...prev]
      const [m] = next.splice(dragIdx, 1)
      next.splice(over, 0, m)
      return next
    })
    setDragIdx(over)
    dragChanged.current = true
  }
  const onHandleUp = () => {
    if (dragIdx == null) return
    const finalOrder = dragOrder
    setDragIdx(null); setDragOrder(null)
    if (dragChanged.current && finalOrder && onReorder) { dragChanged.current = false; onReorder(finalOrder) }
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
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">{title}</h2>
        {onReset && (
          <button onClick={onReset}
            className="shrink-0 text-[0.6875rem] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] border border-[var(--warm-border)] rounded-lg px-2 py-0.5 transition-colors">
            기본값으로 초기화
          </button>
        )}
      </div>
      {description && <p className="text-xs text-[var(--warm-muted)] mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      <div ref={optListRef} className="space-y-2 mb-4">
        {items.length === 0 && (
          <p className="text-xs text-[var(--warm-muted)] py-2">항목이 없습니다.</p>
        )}
        {(dragOrder ?? items).map((item, idx) => (
          // key는 값 자체(고유) — 재정렬 시 요소 identity 보존.
          <div key={item} className={`flex items-center gap-2 bg-[var(--canvas)] rounded-xl px-3 py-2 ${dragIdx === idx ? 'border border-[var(--coral)] shadow-lift select-none' : ''}`}>
            {onReorder && editingItem !== item && (
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  aria-label="위로 이동"
                  className="w-6 h-5 flex items-center justify-center rounded text-[var(--warm-mid)] hover:text-[var(--warm-dark)] disabled:opacity-20 transition-colors leading-none">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={idx === items.length - 1}
                  aria-label="아래로 이동"
                  className="w-6 h-5 flex items-center justify-center rounded text-[var(--warm-mid)] hover:text-[var(--warm-dark)] disabled:opacity-20 transition-colors leading-none">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
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
                  className="flex-1 bg-[var(--canvas)] border border-[var(--coral)] rounded-sm px-2 py-1 text-sm text-[var(--warm-dark)] outline-none"
                />
                <button onClick={saveEdit}
                  className="shrink-0 text-[0.65625rem] px-2 py-1 rounded-lg text-[var(--on-solid)] transition-colors"
                  style={{ background: 'var(--coral)' }}>저장</button>
                <button onClick={() => setEditingItem(null)}
                  className="shrink-0 text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">취소</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-[var(--warm-dark)]">{getLabel(item)}</span>
                {onReorder && (
                  <button type="button" aria-label={`${getLabel(item)} 순서 이동`}
                    onPointerDown={onHandleDown(idx)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
                    style={{ touchAction: 'none' }}
                    className="shrink-0 flex items-center justify-center w-11 h-11 -my-1 rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] cursor-grab active:cursor-grabbing">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
                    </svg>
                  </button>
                )}
                {onRename && (
                  <button onClick={() => startEdit(item)}
                    className="shrink-0 text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">수정</button>
                )}
                <button onClick={() => onDelete(item)}
                  className="shrink-0 text-[0.65625rem] text-[var(--danger-fg)] hover:text-[var(--danger-fg)] transition-colors px-1">삭제</button>
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
            placeholder={placeholder ?? '입력…'}
            className={`flex-1 bg-[var(--canvas)] border rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none transition-colors ${
              isDuplicate ? 'border-[var(--danger-ring)] focus:border-[var(--danger-ring)]' : 'border-[var(--warm-border)] focus:border-[var(--coral)]'
            }`} />
          <Btn variant="primary" size="md" className="min-w-[56px]" onClick={handleAdd} disabled={isAdding || !trimmed || isDuplicate}>
            {isAdding ? '…' : '등록'}
          </Btn>
        </div>
        {isDuplicate && (
          <p className="text-[0.6875rem] text-[var(--danger-fg)]">이미 존재하는 항목입니다.</p>
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
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
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
      const ts = kstYmdStr()
      const a = document.createElement('a')
      a.href = url
      a.download = `stayeum-backup-${ts}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(humanError(err, '백업 실패'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <Btn type="button" variant="primary" size="sm" onClick={handleBackup} disabled={busy}>
        {busy ? '백업 생성 중…' : 'JSON 백업 다운로드'}
      </Btn>
      {error && <p className="text-[var(--danger-fg)] text-xs mt-2">{error}</p>}
    </div>
  )
}

// 위험 구역 — 오너 전용. 운영 종료(되돌림 가능)와 영구 삭제(불가) + 삭제 전 백업 안내.
// 품목 세부스펙 사전 — 단가 무관 구분 정보(색상·사이즈·치수)의 품목별 옵션 관리.
// 지출 저장 시 자동 적립되고, 지출 폼의 세부스펙 칩으로 재사용된다(신고 ba9feb6b).
function ItemSpecOptionsPanel() {
  const [groups, setGroups] = useState<ItemSpecGroup[] | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const reload = () => listItemSpecOptions().then(setGroups).catch(() => setGroups([]))
  useEffect(() => { reload() }, [])

  const saveRename = async (id: string) => {
    const res = await renameItemSpecOption(id, editVal)
    if (res.ok) { setEditId(null); pushToast('success', '세부스펙 수정됨'); reload() }
    else pushToast('error', res.error)
  }
  const remove = async (id: string, label: string) => {
    const ok = await confirmDialog({ title: '세부스펙 삭제', level: 'caution', message: `'${label}' 옵션을 목록에서 삭제할까요? 기존 지출 기록은 바뀌지 않습니다.`, confirmLabel: '삭제' })
    if (!ok) return
    const res = await deleteItemSpecOption(id)
    if (res.ok) { pushToast('success', '삭제됨'); reload() }
    else pushToast('error', res.error)
  }

  if (groups !== null && groups.length === 0) return null   // 아직 적립된 게 없으면 카드 숨김
  // 카드 사이 간격은 담는 쪽(분류 관리 탭의 space-y-4)이 준다 — 제 mt 를 들고 있으면 이중이 된다.
  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">품목 세부스펙</h2>
      <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
        단가와 무관한 구분 정보(색상·사이즈·치수)입니다. 지출 입력 때 저장한 값이 자동으로 쌓이고, 품목 선택 시 칩으로 재사용됩니다.
      </p>
      {!groups ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <div key={g.itemLabel}>
              <p className="text-xs font-semibold text-[var(--warm-dark)] mb-1">{g.itemLabel}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.options.map(o => editId === o.id ? (
                  <span key={o.id} className="inline-flex items-center gap-1">
                    <input value={editVal} onChange={e => setEditVal(e.target.value)} autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') saveRename(o.id); if (e.key === 'Escape') setEditId(null) }}
                      className="w-40 bg-[var(--canvas)] border border-[var(--coral)] rounded-md px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                    <Btn type="button" variant="primary" size="sm" onClick={() => saveRename(o.id)}>저장</Btn>
                    <Btn type="button" variant="secondary" size="sm" onClick={() => setEditId(null)}>취소</Btn>
                  </span>
                ) : (
                  <span key={o.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs rounded-md border border-[var(--warm-border)] bg-[var(--canvas)] text-[var(--warm-dark)]">
                    <button type="button" onClick={() => { setEditId(o.id); setEditVal(o.label) }}
                      className="hover:text-[var(--coral)]" title="수정">{o.label}</button>
                    <button type="button" onClick={() => remove(o.id, o.label)}
                      className="text-[var(--warm-muted)] hover:text-[var(--danger-fg)] px-1 leading-none" aria-label={`${o.label} 삭제`}>×</button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// AI(제미나이) 설정 카드 — 본인 API 키(BYOK). 공지 'AI 다듬기'가 이 키로 동작(미등록 시 비활성 안내).
function AiSettingsCard() {
  const [loaded, setLoaded] = useState(false)
  const [keyMasked, setKeyMasked] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null)
  const [isOwner, setIsOwner] = useState(true)
  const [model, setModel] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getAiSettings().then(r => { setKeyMasked(r.keyMasked); setModel(r.model ?? ''); setUsage({ used: r.usedThisMonth, limit: r.limit }); setIsOwner(r.isOwner); setLoaded(true) }).catch(() => setLoaded(true))
  }, [])

  const saveKey = async (apiKey: string | null) => {
    setBusy(true)
    const res = await saveAiSettings({ apiKey })
    setBusy(false)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('success', apiKey ? 'API 키를 저장했습니다' : 'API 키를 삭제했습니다')
    setEditingKey(false); setKeyInput('')
    const r = await getAiSettings().catch(() => null)
    if (r) { setKeyMasked(r.keyMasked); setModel(r.model ?? '') }
  }
  const saveModel = async (m: string) => {
    setModel(m)
    const res = await saveAiSettings({ model: m || null })
    if (!res.ok) pushToast('error', res.error)
    else pushToast('success', '모델 설정을 저장했습니다')
  }
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">AI 설정 (제미나이 API 키)
        <InfoHint title="API 키 무료 발급"><AiKeyGuide /></InfoHint>
      </h2>
      <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
        영수증·계약서 인식, 문자 다듬기, 재무 분석 등 모든 AI 기능에 사용됩니다. 키가 없어도 월 {usage?.limit ?? 10}회까지 무료 체험이 되고,
        키를 등록하면 제한 없이 사용됩니다. 키는 영업장 소유 관리자 계정에 저장되어 그 관리자의 모든 영업장에 함께 적용됩니다. 발급 방법은 제목 옆 안내를 확인하세요.
      </p>
      {!keyMasked && usage && (
        <p className="text-xs mb-3 rounded-lg px-3 py-2 bg-[var(--canvas)] border border-[var(--warm-border)]">
          <span className="text-[var(--warm-muted)]">이번 달 무료 사용 · </span>
          <span className="font-semibold text-[var(--warm-dark)] tabular-nums">{usage.used} / {usage.limit}회</span>
          {usage.used >= usage.limit && <span className="text-[var(--danger-fg)]"> · 한도 도달</span>}
        </p>
      )}
      {!loaded ? (
        <SkeletonRows rows={2} />
      ) : (
        <div className="space-y-3">
          {!isOwner ? (
            <p className="text-xs text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-3 py-2.5">
              {keyMasked ? `등록된 키: ${keyMasked}` : '등록된 키가 없습니다.'} · AI 설정은 영업장 소유 관리자 계정에서 관리합니다.
            </p>
          ) : keyMasked && !editingKey ? (
            <div className="flex items-center gap-2">
              <span className="mono text-xs text-[var(--warm-dark)] bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-3 py-2 flex-1 truncate">{keyMasked}</span>
              <Btn type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setEditingKey(true)}>변경</Btn>
              <Btn type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void saveKey(null)}>삭제</Btn>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)}
                placeholder="발급받은 API 키 붙여넣기" className={inputCls} autoComplete="off" />
              <Btn type="button" variant="primary" size="sm" disabled={busy || !keyInput.trim()} onClick={() => void saveKey(keyInput)}>저장</Btn>
              {keyMasked && <Btn type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setEditingKey(false); setKeyInput('') }}>취소</Btn>}
            </div>
          )}
          <label className="block max-w-xs">
            <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">모델</span>
            <select value={model} onChange={e => void saveModel(e.target.value)} disabled={!keyMasked || !isOwner}
              className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] disabled:opacity-50">
              <option value="">기본 (gemini-2.5-flash · 빠름)</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (고급 · 느리지만 문장력 우수)</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

// 문자 템플릿 카드 — kind 로 두 종류를 같은 컴포넌트가 관리(OptionSection 재사용 문법과 동일).
//  'unpaid' 미납 안내: 대시보드 '누적 미납'의 [안내문자]가 사용. 변수는 발송 시점에 자동 치환.
//  'notice' 단체 공지: 입주자 관리 [단체 공지]가 사용. 배치 전체가 한 본문을 공유해 치환이 구조적으로 없다.
// 종전엔 'unpaid' 하드코딩이라 공지 템플릿은 목록조차 없어 수정도 삭제도 불가능했다(운영자 신고 2026-07-17).
// 서류 메일 문안 카드 — Property.docMailTemplate(2026-08-25 운영자 승인). 메일 프레임(영업장명
// 헤더·첨부 상자·푸터)은 모든 영업장이 공유하고 본문 영역만 여기서 바꾼다. 기본 모드는 텍스트
// 세 칸, 직접 HTML 모드는 본문 영역 통째 교체(HTML 모르는 운영자가 마크업을 깨뜨릴 일이 없게
// 모드를 가른다). 저장은 카드 우측 버튼 하나(§27.1 폼형), 검증 실패는 인라인(§27.2), 미리보기는
// 발송과 같은 서버 렌더(renderDocMailSample)를 sandbox iframe 으로 띄운다. 복원은 로컬 되채움이라
// 저장을 안 누르면 무해하다(§16 undo — 저장된 커스텀을 지우는 실수단은 복원 후 저장 = 칼럼 null).
/**
 * 추가 서류 카드 — 서명을 받는 제3의 서류를 영업장이 직접 만든다(제목 + 문단 + 서명).
 *
 * 동의서 카드와 합치지 않는다. 그쪽은 enabled·미납 기준일이라는 제 축이 있는 한 벌 폼형이고
 * 여기는 여러 벌 목록형이다 — §27.1 이 한 카드 안 혼용을 금한다(문자 템플릿 카드와 같은 판정).
 * 저장은 전용 출구(saveSignDocument·setSignDocumentRetired)로 나가고, 서버 병합에 삭제 경로가
 * 없어 "발행한 서류는 지워지지 않는다"가 구조다. 삭제 버튼은 그래서 아예 없다 — 중지가 덮는다.
 */
function SignDocumentsCard({ initial }: { initial: SignDocument[] }) {
  const [docs, setDocs] = useState<SignDocument[]>(initial)
  const [editing, setEditing] = useState<{ key?: string; title: string; body: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLDivElement | null>(null)
  const active = docs.filter(d => !d.retiredAt)
  const retired = docs.filter(d => d.retiredAt)
  const [showRetired, setShowRetired] = useState(false)

  const openNew = () => { setEditing({ title: '', body: '' }); setTimeout(() => formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0) }

  const save = async () => {
    if (!editing || saving) return
    setSaving(true)
    const release = trackSave()
    try {
      const res = await saveSignDocument(editing)
      if (!res.ok) { pushToast('error', res.error); return }
      setDocs(prev => {
        const at = prev.findIndex(d => d.key === res.key)
        const next = [...prev]
        if (at >= 0) next[at] = { ...next[at], title: editing.title.trim(), body: editing.body.trim() }
        else next.push({ key: res.key, title: editing.title.trim(), body: editing.body.trim(), createdAt: new Date().toISOString() })
        return next
      })
      setEditing(null)
      pushToast('success', '저장됨', { detail: '새 계약서부터 이 서류가 함께 나갑니다. 이미 보낸 링크와 발급본은 바뀌지 않습니다.' })
    } finally {
      release()
      setSaving(false)
    }
  }

  const setRetired = async (doc: SignDocument, retire: boolean, opts?: { silent?: boolean }) => {
    const res = await setSignDocumentRetired(doc.key, retire)
    if (!res.ok) { pushToast('error', res.error); return }
    setDocs(prev => prev.map(d => d.key === doc.key
      ? (retire
        ? { ...d, retiredAt: new Date().toISOString() }
        : (() => { const rest = { ...d }; delete rest.retiredAt; return rest })())
      : d))
    if (opts?.silent) { pushToast('info', retire ? '중지됨' : `'${doc.title}' 서류를 다시 사용합니다.`); return }
    if (retire) {
      pushToast('success', '중지됨', {
        detail: '새 계약서에 안 붙습니다. 이미 보낸 서명 링크와 서명이 끝난 계약서에는 계속 실립니다.',
        action: { label: '적용취소', run: () => void setRetired(doc, false, { silent: true }) },
      })
    } else {
      pushToast('success', '다시 사용됨', { detail: '새 계약서부터 이 서류가 다시 함께 나갑니다.' })
    }
  }

  const row = (d: SignDocument) => (
    <div key={d.key}
      className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 rounded-xl px-3 py-2.5 ${d.retiredAt ? 'bg-[var(--canvas)] opacity-50' : 'bg-[var(--canvas)]'} ${editing?.key === d.key ? 'ring-2 ring-[var(--coral)]/[0.16]' : ''}`}
      style={{ border: `1px solid ${editing?.key === d.key ? 'var(--coral)' : 'var(--warm-border)'}` }}>
      <div className="min-w-0 sm:flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium text-[var(--warm-dark)] break-keep">{d.title}</p>
          {d.retiredAt && <Badge tone="pale-neutral">사용 안 함</Badge>}
        </div>
        <p className="text-xs text-[var(--warm-muted)] mt-0.5 truncate">{d.body.split('\n')[0]}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-4 shrink-0 sm:justify-end">
        <RowActionBtn onClick={() => void setRetired(d, !d.retiredAt)}>{d.retiredAt ? '다시 사용' : '중지'}</RowActionBtn>
        <RowActionBtn onClick={() => { setEditing({ key: d.key, title: d.title, body: d.body }); setTimeout(() => formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0) }}>수정</RowActionBtn>
      </div>
    </div>
  )

  return (
    <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">추가 서류</h3>
        <Btn variant="primary" size="sm" onClick={openNew}>+ 추가</Btn>
      </div>
      <p className="text-xs text-[var(--warm-muted)] -mt-1">
        계약서와 함께 서명을 받는 서류를 직접 만듭니다. 잔여 소지품 임의처분 동의서와 같은 자리에 붙고,
        입실자 정보·날짜·서명란은 자동입니다.
      </p>
      {editing && (
        <div ref={formRef} className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-[var(--warm-dark)]">{editing.key ? `'${docs.find(d => d.key === editing.key)?.title}' 서류 수정` : '서류 추가'}</p>
          <div className="space-y-1">
            <label className="text-[0.6875rem] text-[var(--warm-muted)]">서류 제목</label>
            <input type="text" value={editing.title} onChange={e => setEditing(p => p && { ...p, title: e.target.value })}
              placeholder="예: 차량 등록 동의서"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)] transition-colors" />
          </div>
          <div className="space-y-1">
            <label className="text-[0.6875rem] text-[var(--warm-muted)]">본문</label>
            <textarea value={editing.body} onChange={e => setEditing(p => p && { ...p, body: e.target.value })} rows={8}
              className="w-full px-3 py-2.5 rounded-sm text-sm leading-relaxed outline-none bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] focus:border-[var(--coral)] transition-colors resize-y" />
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              줄을 바꾸면 문단이 나뉩니다. 본문에 변수를 쓸 수 있습니다.
              <span className="num"> {'{{성명}} {{호실}} {{연락처}} {{영업장명}} {{대표}}'}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Btn variant="secondary" size="md" className="flex-1" onClick={() => setEditing(null)}>취소</Btn>
            <Btn variant="primary" size="md" className="flex-1" onClick={() => void save()} disabled={saving || !editing.title.trim() || !editing.body.trim()}>저장</Btn>
          </div>
        </div>
      )}
      {docs.length === 0 && !editing ? (
        <p className="text-sm text-[var(--warm-muted)] text-center py-3">아직 만든 서류가 없습니다. 오른쪽 위 [+ 추가]로 만듭니다.</p>
      ) : (
        <div className="space-y-2">{active.map(row)}</div>
      )}
      {retired.length > 0 && (
        <div className="space-y-2 pt-1">
          {/* 접힘 정본 문법(폐기본·끈 알림과 같은 결) — 44px 히트영역, aria-expanded, 회전 셰브론.
              underline 은 이 앱에서 탈출구형 보조 액션 문법이라 접힘 토글에 안 쓴다(디자이너 패스). */}
          <button type="button" onClick={() => setShowRetired(v => !v)} aria-expanded={showRetired}
            className="-my-2 min-h-[44px] text-xs font-medium text-[var(--warm-muted)] inline-flex items-center gap-1">
            {showRetired ? '사용 중지된 서류 숨기기' : `사용 중지된 서류 ${retired.length}건 보기`}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showRetired ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showRetired && retired.map(row)}
        </div>
      )}
    </div>
  )
}

function DocMailTemplateCard() {
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<'text' | 'html'>('text')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [closingText, setClosingText] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [defaults, setDefaults] = useState<{ subject: string; body: string }>({ subject: '', body: '' })
  const [saving, setSaving] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  useEffect(() => {
    getDocMailSettings()
      .then(r => {
        setMode(r.template.mode)
        setSubject(r.template.subject ?? '')
        setBodyText(r.template.bodyText ?? '')
        setClosingText(r.template.closingText ?? '')
        setBodyHtml(r.template.bodyHtml ?? '')
        setDefaults(r.defaults)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  // 폼 값 그대로 — 저장·미리보기가 같은 입력을 쓴다. 빈 칸 = null(그 칸만 내장 기본).
  const currentInput = (): DocMailTemplate => ({
    mode,
    subject: subject.trim() ? subject : null,
    bodyText: bodyText.trim() ? bodyText : null,
    closingText: closingText.trim() ? closingText : null,
    bodyHtml: bodyHtml.trim() ? bodyHtml : null,
  })

  const save = async () => {
    setSaving(true)
    setInlineError(null)
    try {
      const r = await updateDocMailTemplate(currentInput())
      if (!r.ok) { setInlineError(r.error); return }
      pushToast('success', '서류 메일 문안 저장됨')
    } catch (e) {
      pushToast('error', humanError(e, '저장에 실패했습니다.'))
    } finally { setSaving(false) }
  }

  const doPreview = async () => {
    if (previewBusy) return
    setPreviewBusy(true)
    try {
      const r = await renderDocMailSample(currentInput())
      if (!r.ok) { pushToast('error', r.error); return }
      setPreview({ subject: r.subject, html: r.html })
    } catch {
      pushToast('error', '미리보기를 만들지 못했습니다.')
    } finally { setPreviewBusy(false) }
  }

  // 복원은 폼 값 되채움(로컬)이다 — 서버 쓰기는 여전히 저장 버튼 하나가 한다. 그래서 복원의
  // 적용취소는 '저장 안 누르기'로 항상 성립한다(카테고리 초기화 정본과 같은 문형).
  const restore = async () => {
    const ok = await confirmDialog({
      title: '메일 문안을 기본으로 되돌릴까요?',
      message: '지금 적은 내용이 지워집니다. 저장을 눌러야 실제로 반영됩니다.',
      level: 'caution', confirmLabel: '되돌리기',
    })
    if (!ok) return
    setMode('text'); setSubject(''); setBodyText(''); setClosingText(''); setBodyHtml('')
    setInlineError(null)
  }

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'

  return (
    <div className="rounded-xl p-4 sm:p-5 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">서류 메일 문안</h3>
        <Btn type="button" variant="primary" size="sm" onClick={() => void save()} disabled={saving || !loaded}>
          {saving ? '저장 중…' : '저장'}
        </Btn>
      </div>
      <p className="text-xs text-[var(--warm-muted)] -mt-1 leading-relaxed">
        서류를 메일로 보낼 때 쓰는 기본 문구입니다. 보내기 직전에 그때만 고칠 수도 있습니다.
        변수 <span className="num text-[0.65625rem]">{'{영업장명} {이름} {서류목록}'}</span> 은 보낼 때 자동으로 채워집니다.
      </p>
      {!loaded ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="space-y-3">
          <SegmentedControl<'text' | 'html'> size="sm" ariaLabel="문안 방식"
            options={[{ value: 'text', label: '기본 문안' }, { value: 'html', label: '직접 HTML' }]}
            value={mode} onChange={setMode} />

          {mode === 'text' ? (
            <>
              <div className="space-y-1">
                <label className="text-[0.6875rem] text-[var(--warm-muted)]">제목</label>
                <input type="text" value={subject} maxLength={150} placeholder={defaults.subject}
                  onChange={e => setSubject(e.target.value)} className={inputCls} />
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">제목과 첫 줄은 받는 사람 잠금화면에 뜹니다. 이름 같은 개인정보는 본문 안쪽에 쓰는 것을 권합니다.</p>
              </div>
              <div className="space-y-1">
                <label className="text-[0.6875rem] text-[var(--warm-muted)]">본문 (첨부 목록 위)</label>
                <textarea value={bodyText} rows={6} maxLength={4000} placeholder={defaults.body}
                  onChange={e => setBodyText(e.target.value)}
                  className={`${inputCls} leading-relaxed resize-y`} />
              </div>
              <div className="space-y-1">
                <label className="text-[0.6875rem] text-[var(--warm-muted)]">맺음말 (첨부 목록 아래)</label>
                <textarea value={closingText} rows={3} maxLength={1000}
                  onChange={e => setClosingText(e.target.value)}
                  className={`${inputCls} leading-relaxed resize-y`} />
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">비워 두면 연락처 안내가 자동으로 들어갑니다.</p>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              {/* 중첩 안내 상자는 --cream-soft — 카드(--cream) 안에서 --canvas 는 다크에서 검은 구멍(§28) */}
              <div className="rounded-lg px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]" style={{ background: 'var(--cream-soft)', border: '1px solid var(--warm-border)' }}>
                메일 본문 영역의 HTML 을 직접 작성합니다. 영업장명 헤더·첨부 목록·하단 표기는 자동으로 붙습니다.
                표와 인라인 스타일만 안정적으로 표시되며, script 와 외부 이미지·웹폰트는 저장할 때 제거됩니다.
              </div>
              <textarea value={bodyHtml} rows={12} maxLength={30000}
                onChange={e => setBodyHtml(e.target.value)}
                className={`${inputCls} num leading-relaxed resize-y`} />
            </div>
          )}

          {/* 검증 실패는 인라인(§27.2) — 오타 변수·상한 초과가 여기 선다. */}
          {inlineError && <p className="text-xs text-[var(--danger-fg)]">{inlineError}</p>}

          <div className="flex gap-2">
            <Btn type="button" variant="secondary" size="sm" onClick={() => void doPreview()} disabled={previewBusy}>
              {previewBusy ? '만드는 중…' : '미리보기'}
            </Btn>
            <Btn type="button" variant="secondary" size="sm" onClick={() => void restore()}>기본 문안으로 복원</Btn>
          </div>
        </div>
      )}

      {preview && (
        <Modal open onClose={() => setPreview(null)} width="md" title="메일 미리보기">
          <div className="space-y-2">
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">예시 값으로 채운 미리보기입니다. 실제 발송 때는 입주자 이름·서류 목록·첨부 파일명이 그대로 들어갑니다.</p>
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.65625rem] text-[var(--warm-mid)]">제목</p>
              <p className="mt-0.5 text-sm text-[var(--warm-dark)]">{preview.subject}</p>
            </div>
            {/* 메일은 어느 테마에서든 같은 종이 — 프레임이 칠하는 바탕색으로 못박는다(확인 화면과 한 벌). */}
            <iframe title="문안 미리보기" sandbox="" srcDoc={preview.html}
              className="h-[420px] w-full rounded-lg border border-[var(--warm-border)]"
              style={{ background: '#FBF6EF' }} />
          </div>
        </Modal>
      )}
    </div>
  )
}

function SmsTemplateCard({ kind, title, description, emptyExample, namePlaceholder, bodyLabel }: {
  kind: 'unpaid' | 'notice' | 'personal'
  title: string
  description: React.ReactNode
  emptyExample: React.ReactNode
  namePlaceholder: string
  bodyLabel: string
}) {
  const [list, setList] = useState<SmsTemplateRow[] | null>(null)
  const [edit, setEdit] = useState<{ id?: string; name: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { getSmsTemplates(kind).then(setList).catch(() => setList([])) }, [kind])

  const reload = () => getSmsTemplates(kind).then(setList).catch(() => {})
  const save = async () => {
    if (!edit) return
    setBusy(true)
    // kind 는 신규 생성에만 반영된다(서버는 id 있으면 name·body 만 update). 넘겨도 수정 경로엔 무해.
    const res = await saveSmsTemplate({ ...edit, kind })
    setBusy(false)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('success', '템플릿 저장됨')
    setEdit(null); void reload()
  }
  const remove = async (row: SmsTemplateRow) => {
    if (!(await confirmDialog({ title: `'${row.name}' 템플릿을 삭제할까요?`, message: '보낸 문자 이력은 그대로 남습니다.', confirmLabel: '삭제', level: 'caution' }))) return
    setBusy(true)
    const res = await deleteSmsTemplate(row.id)
    setBusy(false)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('info', '템플릿을 삭제했습니다')
    void reload()
  }
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 mt-4">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">{title}</h2>
      <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">{description}</p>
      {!list ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="space-y-2.5">
          {list.length === 0 && !edit && (
            <p className="text-xs text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5">
              {emptyExample}
            </p>
          )}
          <ul className="space-y-1.5">
            {list.map(row => (
              <li key={row.id} className="flex items-center gap-2 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)]/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--warm-dark)] truncate">{row.name}</p>
                  <p className="text-[0.6875rem] text-[var(--warm-muted)] truncate">{row.body}</p>
                </div>
                <button type="button" disabled={busy} onClick={() => setEdit({ id: row.id, name: row.name, body: row.body })}
                  className="min-h-[30px] shrink-0 inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">수정</button>
                <button type="button" disabled={busy} onClick={() => void remove(row)}
                  className="min-h-[30px] shrink-0 inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md text-[var(--warm-muted)] hover:text-[var(--danger-fg)] transition-colors disabled:opacity-40">삭제</button>
              </li>
            ))}
          </ul>
          {edit ? (
            <div className="space-y-2 rounded-xl border border-[var(--coral)]/40 bg-[var(--canvas)]/50 p-3">
              <label className="block">
                <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">템플릿 이름</span>
                <input value={edit.name} disabled={busy} placeholder={namePlaceholder}
                  onChange={e => setEdit(v => v ? { ...v, name: e.target.value } : v)} className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">{bodyLabel}</span>
                <textarea value={edit.body} disabled={busy} rows={5}
                  onChange={e => setEdit(v => v ? { ...v, body: e.target.value } : v)}
                  className={`${inputCls} leading-relaxed`} />
              </label>
              <div className="flex gap-2 justify-end">
                <Btn type="button" variant="secondary" size="sm" onClick={() => setEdit(null)} disabled={busy}>취소</Btn>
                <Btn type="button" variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{busy ? '저장 중…' : '저장'}</Btn>
              </div>
            </div>
          ) : (
            <Btn type="button" variant="secondary" size="sm" onClick={() => setEdit({ name: '', body: '' })}>+ 템플릿 추가</Btn>
          )}
        </div>
      )}
    </div>
  )
}

// 단기 입실 정책 카드 — 수치만 바꾸면 시뮬레이션(입주자 관리 > 요금 계산)이 그대로 따라간다.
// 제기역점 기준(시드): 최소 1주 · 주 단위 계약 · 1달 이내 = 계약일수 × 1.5 (1개월 상한) + 청소비 2만.
function ShortStayPolicyCard() {
  const [p, setP] = useState<ShortStayPolicy | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { getShortStayPolicy().then(setP).catch(() => setP(null)) }, [])

  const numCls = 'w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  // 셀렉트는 같은 테두리·여백 문법에 폭만 전폭 — 문장형 선택지가 좁은 칸에서 잘리지 않게.
  const selCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  const setNum = (k: 'unitDays' | 'minUnits' | 'thresholdDays' | 'multiplier' | 'cleaningFee' | 'roundTo' | 'deposit') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/[^0-9.]/g, '')
      setP(prev => prev ? { ...prev, [k]: v === '' ? 0 : Number(v) } : prev)
    }
  // 미리보기 — 월세 60만 기준 최소 계약 요금 (수치 이해 확인용)
  const preview = p?.enabled ? calcShortStay(p, 600000, p.unitDays * p.minUnits) : null

  const save = async () => {
    if (!p) return
    setBusy(true)
    const res = await updateShortStayPolicy(p)
    setBusy(false)
    if (res.ok) pushToast('success', '단기 입실 정책 저장됨')
    else pushToast('error', res.error)
  }

  // 카드 사이 간격은 담는 쪽(요금·정책 탭의 space-y-4)이 준다 — 제 mt 를 들고 있으면 이중이 된다.
  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6">
      <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">단기 입실 정책</h2>
      <p className="text-xs text-[var(--warm-muted)] leading-relaxed mb-3">
        1달 이내 단기 거주의 요금 기준입니다. 여기 수치가 입주자 관리의 요금 계산(시뮬레이션)에 바로 적용됩니다.
      </p>
      {!p ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="space-y-3">
          <SegmentedControl size="sm" ariaLabel="단기 정책 사용"
            options={[{ value: 'on', label: '사용' }, { value: 'off', label: '사용 안 함' }]}
            value={p.enabled ? 'on' : 'off'}
            onChange={v => setP({ ...p, enabled: v === 'on' })} />
          {p.enabled && (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="block">
                  <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">계약 단위(일)</span>
                  <input value={String(p.unitDays)} inputMode="numeric" onChange={setNum('unitDays')} className={numCls} />
                </label>
                <label className="block">
                  <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">최소 계약(단위 수)</span>
                  <input value={String(p.minUnits)} inputMode="numeric" onChange={setNum('minUnits')} className={numCls} />
                </label>
                <label className="block">
                  <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">적용 상한(거주일)</span>
                  <input value={String(p.thresholdDays)} inputMode="numeric" onChange={setNum('thresholdDays')} className={numCls} />
                </label>
                <label className="block">
                  <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">청구 배율</span>
                  <input value={String(p.multiplier)} inputMode="decimal" onChange={setNum('multiplier')} className={numCls} />
                </label>
                <label className="block">
                  <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">청소비(원)</span>
                  <input value={String(p.cleaningFee)} inputMode="numeric" onChange={setNum('cleaningFee')} className={numCls} />
                </label>
                <label className="block">
                  <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">절삭 단위(원)</span>
                  <input value={String(p.roundTo)} inputMode="numeric" onChange={setNum('roundTo')} className={numCls} />
                </label>
                {/* 이 값의 성격은 아래 '예약금 처리'가 정한다 — applyToRent 에서는 퇴실 때 돌려줄
                    예치금이 아니라 예약금 시드다. 라벨을 고정해 두면 정반대로 안내하게 된다. */}
                <label className="block">
                  <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">
                    {p.reservationMode === 'applyToRent' ? '예약금(원) · 수납 폼 기본값' : '보증금(원) · 퇴실 시 반환'}
                  </span>
                  <input value={String(p.deposit)} inputMode="numeric" onChange={setNum('deposit')} className={numCls} />
                </label>
              </div>
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                계산: 거주일을 계약 단위로 올려 계약일수를 내고, 거기에 배율을 곱해 청구 일수를 냅니다(1개월 30일 상한). 그 일수만큼 월 이용료를 일할해 절삭 단위로 반올림하고 청소비를 더합니다.
                {p.reservationMode === 'applyToRent'
                  ? ' 예약금은 예약 수납 폼의 기본값으로만 쓰이며, 받을 때 청소비를 먼저 떼고 남은 금액이 입주월 이용료로 충당됩니다(0이면 프리필 없음).'
                  : ' 보증금은 요금에 포함되지 않는 별도 예치금이며 일반 입주자처럼 퇴실 때 환불합니다(0이면 없음).'}
                {preview && ` 예: 월 이용료 60만 기준 최소 계약(${p.unitDays * p.minUnits}일) = ${preview.total.toLocaleString()}원`}
              </p>
              {/* 예약금 처리 — 요금 계산과는 다른 축이라 계산 설명 아래 제 줄로 둔다.
                  손대지 않으면 미설정으로 남아 영업장 기본 처리(위 '예약금 기본 처리')를 그대로 따른다. */}
              <label className="block">
                <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-1">예약금 처리</span>
                <select value={p.reservationMode ?? 'refundableDeposit'}
                  onChange={e => setP({ ...p, reservationMode: e.target.value as ShortStayReservationMode })}
                  className={selCls}>
                  <option value="refundableDeposit">퇴실 시 환불 보증금(현행)</option>
                  <option value="applyToRent">청소비 차감 후 이용료 충당</option>
                </select>
              </label>
            </>
          )}
          <Btn type="button" variant="primary" size="sm" onClick={save} disabled={busy}>{busy ? '저장 중…' : '정책 저장'}</Btn>
        </div>
      )}
    </div>
  )
}

function DangerZone({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [impact, setImpact] = useState<{ rooms: number; tenants: number; payments: number; expenses: number } | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [delError, setDelError] = useState('')

  const handleDeactivate = async () => {
    const ok = await confirmDialog({
      title: '운영을 종료할까요?',
      message: `'${propertyName}'을(를) 운영 종료합니다. 목록에서 비활성으로 표시되며 데이터는 그대로 보존됩니다. 영업장 선택 화면에서 언제든 '운영 재개'할 수 있습니다.`,
      confirmLabel: '운영 종료',
    })
    if (!ok) return
    setBusy(true)
    const res = await deactivateProperty(propertyId)
    setBusy(false)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('success', '운영을 종료했습니다')
    router.push('/property-select')
  }

  const openDelete = async () => {
    setDelError(''); setConfirmName(''); setImpact(null); setDelOpen(true)
    const res = await getPropertyDeletionImpact(propertyId)
    if (res.ok) setImpact(res.counts)
    else { setDelError(res.error) }
  }

  const handleDelete = async () => {
    setDelError('')
    if (confirmName.trim() !== propertyName.trim()) { setDelError('영업장 이름이 일치하지 않습니다.'); return }
    setBusy(true)
    const res = await deletePropertyPermanently(propertyId, confirmName)
    setBusy(false)
    if (!res.ok) { setDelError(res.error); return }
    pushToast('success', '영업장이 영구 삭제되었습니다')
    router.push('/property-select')
  }

  return (
    <div className="rounded-xl p-6 mt-4" style={{ border: '1px solid var(--danger-ring)', background: 'var(--danger-bg)' }}>
      <h2 className="text-sm font-semibold text-[var(--danger-fg)] mb-1">위험 구역</h2>
      <p className="text-xs text-[var(--warm-mid)] leading-relaxed mb-4">
        아래 작업은 영업장 오너만 할 수 있습니다. 삭제 전에는 위 &lsquo;데이터 백업&rsquo;에서 JSON 백업을 먼저 받아두세요.
      </p>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--cream)] border border-[var(--warm-border)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--warm-dark)]">운영 종료</p>
            <p className="text-xs text-[var(--warm-muted)]">목록에서 비활성 표시. 데이터 보존, 언제든 재개 가능.</p>
          </div>
          <Btn type="button" variant="secondary" size="sm" onClick={handleDeactivate} disabled={busy}>운영 종료</Btn>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--cream)] border border-[var(--danger-ring)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--danger-fg)]">영구 삭제</p>
            <p className="text-xs text-[var(--warm-muted)]">호실·입주자·수납·지출 등 모든 데이터를 영구 삭제합니다. 되돌릴 수 없습니다.</p>
          </div>
          <Btn type="button" variant="danger" size="sm" onClick={openDelete} disabled={busy}>영구 삭제</Btn>
        </div>
      </div>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="영업장 영구 삭제" width="sm" dirty={!!confirmName}>
        <div className="space-y-3">
          <p className="text-sm text-[var(--warm-dark)] leading-relaxed">
            <strong className="text-[var(--danger-fg)]">되돌릴 수 없습니다.</strong> 아래 데이터가 모두 영구 삭제됩니다.
          </p>
          {impact ? (
            <ul className="grid grid-cols-2 gap-1.5 text-xs">
              <li className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2">호실 <span className="font-bold tnum text-[var(--warm-dark)]">{impact.rooms}</span></li>
              <li className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2">입주자 <span className="font-bold tnum text-[var(--warm-dark)]">{impact.tenants}</span></li>
              <li className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2">수납 기록 <span className="font-bold tnum text-[var(--warm-dark)]">{impact.payments}</span></li>
              <li className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2">지출 <span className="font-bold tnum text-[var(--warm-dark)]">{impact.expenses}</span></li>
            </ul>
          ) : !delError ? (
            <p className="text-xs text-[var(--warm-muted)]">삭제 대상 집계 중…</p>
          ) : null}
          <p className="text-xs text-[var(--warm-muted)]">백업을 아직 안 받으셨다면 취소하고 &lsquo;데이터 백업&rsquo;에서 먼저 내려받으세요.</p>
          <label className="block">
            <span className="block text-xs text-[var(--warm-mid)] mb-1">확인을 위해 영업장 이름 <strong className="text-[var(--warm-dark)]">{propertyName}</strong> 을(를) 입력하세요</span>
            <input value={confirmName} onChange={e => setConfirmName(e.target.value)} autoFocus
              placeholder={propertyName}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          </label>
          {delError && <p className="text-xs text-[var(--danger-fg)]">{delError}</p>}
          <div className="flex gap-2 pt-1">
            <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => setDelOpen(false)} disabled={busy}>취소</Btn>
            <Btn type="button" variant="danger" size="md" className="flex-1" onClick={handleDelete}
              disabled={busy || confirmName.trim() !== propertyName.trim()}>
              {busy ? '삭제 중…' : '영구 삭제'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
