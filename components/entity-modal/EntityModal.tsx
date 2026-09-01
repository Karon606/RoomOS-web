'use client'

// Prism 셸 — 호실·입주자·수납 통합 상세 모달 (전역).
// "데이터 조합으로 발현되는 뷰" — kind 에 따라 body 가 위젯 조합으로 바뀜.
// 하단 PrismNavBar 클릭은 onSelect={setKind} 로 **인플레이스 전환** — 새 모달 안 뜸 (2중 스택 X).
//
// Phase 2.2 (2026-05-30): kind='room' body 를 RoomBody 위젯 조합으로. 액션 행([삭제][수정])을 셸이 직접 처리.
// Phase 2.3 = kind='tenant' 위젯화 (TenantView 미니 잔존), Phase 2.4 = kind='payment' 요약 위젯화.

import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { Modal } from '@/components/ui/Modal'
import { kstMonthStr } from '@/lib/kstDate'
import { resolveMonthParam } from '@/lib/monthParam'
import { getEntityLinks } from '@/app/(app)/rooms/actions'
import { deleteRoom, applyScheduledRentNow, undoApplyScheduledRent } from '@/app/(app)/room-manage/actions'
import { deleteTenant } from '@/app/(app)/tenants/actions'
import { withSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { PrismNavBar } from './PrismNavBar'
import { SkeletonRows } from '@/components/ui/Skeleton'
import MonthSelector from '@/components/layout/MonthSelector'
import { RoomBody } from './bodies/RoomBody'
import { TenantBody } from './bodies/TenantBody'
import { PaymentBody } from './bodies/PaymentBody'
import { useNavRouter } from '@/lib/useNavRouter'
import { fmtRoomNo } from '@/lib/roomNo'
import { CONTRACT_ISSUE_STATUSES } from '@/lib/leaseStatus'
import { TenantDocBundleSheet } from '@/components/doc/TenantDocBundleSheet'

type EntityKind = 'room' | 'tenant' | 'payment'
type Seed = { kind: EntityKind; roomId?: string | null; tenantId?: string | null; leaseTermId?: string | null; openCheckoutProration?: boolean }
type Links = Awaited<ReturnType<typeof getEntityLinks>>

/**
 * markDirty — 이 셸 안의 위젯이 "지금 쓰다 만 글이 있다"를 알리는 자리.
 *
 * 왜 필요한가. Modal 은 §12 의 dirty 정책을 이미 완비하고 있다(배경 클릭 무시, Esc·X 는
 * "작성 중인 내용이 있습니다" 1회 확인). 그런데 이 셸만 그 문을 안 썼다. 그래서 요청 내용을
 * 쓰다 **배경을 탭하면 모달이 그냥 닫히고 글이 사라졌다.** 경고도 없다. 아이폰에서 키보드를
 * 내리는 관습적 동작이 "칸 밖 탭하기"라 실수로 닿기 쉬운 자리다(실측 2026-08-29).
 *
 * key 로 가르는 이유는 이 셸 안에 글을 받는 위젯이 여럿이어서다. 한 위젯이 비웠다고 다른
 * 위젯의 글까지 없는 것으로 치면 안 된다.
 */
type Ctx = {
  open: (seed: Seed) => void
  close: () => void
  markDirty: (key: string, dirty: boolean) => void
}
const EntityModalContext = createContext<Ctx | null>(null)

export function useEntityModal(): Ctx {
  const ctx = useContext(EntityModalContext)
  if (!ctx) return { open: () => {}, close: () => {}, markDirty: () => {} }
  return ctx
}

// Provider 밖에서 셸을 여는 열기 신호 — lib/globalSearch 의 bindGlobalSearch 와 같은 모듈 pub/sub.
// 헤더(종·검색)는 AppShell 안, Provider 밖이라 useEntityModal 을 쓸 수 없다.
let opener: ((seed: Seed) => void) | null = null

/** Provider 밖에서 Prism 셸을 연다. 신호가 닿지 않으면 false — 호출부가 URL 딥링크로 폴백한다. */
export function openEntityModal(seed: Seed): boolean {
  if (!opener) return false
  opener(seed)
  return true
}

// 셸에 쌓인 한 면. open() 은 이 면을 **쌓고**, 뒤로는 한 장 걷는다.
//
// 왜 스택인가 (2026-08-13, 1인 다호실 1단계). 601호 면에서 다른 방·다른 사람으로 건너뛰면
// 종전에는 시드가 통째로 교체돼 직전 면이 사라졌다. 되돌아갈 길이 '닫고 다시 찾기'뿐이라,
// 방을 둘 쓰는 사람을 오가며 확인하는 동선이 매번 처음부터였다. 프레임에 links 를 함께 들고
// 있으므로 뒤로 갈 때 재조회가 없다 — 걷어낸 면이 그대로 다시 선다.
type Frame = { kind: EntityKind; seed: Seed; links: Links | undefined; seq: number }

export function EntityModalProvider({ children }: { children: React.ReactNode }) {
  // links: undefined = 아직 해소 중(뼈대), null = 해소했는데 연결 없음(빈 안내). 둘을 한 값으로 두면
  // 여는 순간부터 링크가 올 때까지 "연결된 입주자가 없습니다"가 떠 있다 — 있는 사람인데도.
  const [stack, setStack] = useState<Frame[]>([])
  const top = stack.length > 0 ? stack[stack.length - 1] : null
  // 프레임 식별자 — 배열 인덱스로는 안 된다. 비동기 링크 해소가 돌아왔을 때 그 사이 스택이
  // 밀렸으면 엉뚱한 면에 남의 links 를 심는다.
  const seqRef = useRef(0)
  // 모달 열기 직전의 페이지 스크롤 위치 — 닫을 때 그 위치로 복원 (router.refresh() 가
  // 페이지 상단으로 리셋시키는 문제 해결, 사용자 피드백 2026-06-01).
  const scrollYRef = useRef<number>(0)

  // 페이지 이동(브라우저 뒤로가기 포함) 시 전역 모달 정리 — 새 페이지 위에 이전 모달이
  // 떠 있고, 닫으면 이전 페이지의 스크롤 위치로 점프하던 문제. 스크롤 복원 없이 닫기만.
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname
      setStack([])
    }
  }, [pathname])
  const open = useCallback((seed: Seed) => {
    setStack(s => {
      // 스크롤 위치는 **셸이 처음 열릴 때만** 찍는다. 쌓는 중에 다시 찍으면 배경이 잠긴 동안의
      // 값이라 같긴 하지만, 의미가 '셸을 열기 직전'이라는 것을 코드가 말하게 둔다.
      if (s.length === 0 && typeof window !== 'undefined') scrollYRef.current = window.scrollY
      return [...s, { kind: seed.kind, seed, links: undefined, seq: ++seqRef.current }]
    })
  }, [])
  // 헤더 종이 쓰는 열기 신호 배선 — Provider 는 (app) 레이아웃에 하나뿐이다.
  useEffect(() => {
    opener = open
    return () => { if (opener === open) opener = null }
  }, [open])
  const back = useCallback(() => { setStack(s => s.slice(0, -1)) }, [])
  const close = useCallback(() => {
    setStack([])
    if (typeof window !== 'undefined') {
      const y = scrollYRef.current
      // router.refresh 가 redraw 후 0,0 로 리셋할 수 있어 두 번 시도 (RAF + 150ms 후)
      requestAnimationFrame(() => window.scrollTo(0, y))
      setTimeout(() => window.scrollTo(0, y), 150)
    }
  }, [])

  // seed 의 id 로 연결된 호실/입주자/lease id 해소 (네비 가용성·제목용)
  useEffect(() => {
    if (!top || top.links !== undefined) return
    let active = true
    const seq = top.seq
    const put = (links: Links) => setStack(s => s.map(f => (f.seq === seq ? { ...f, links } : f)))
    getEntityLinks({
      roomId: top.seed.roomId ?? undefined,
      tenantId: top.seed.tenantId ?? undefined,
      leaseTermId: top.seed.leaseTermId ?? undefined,
    })
      .then(links => { if (active) put(links) })
      // 조회 실패도 해소로 친다 — undefined 로 남으면 뼈대가 영영 돌아간다.
      .catch(() => { if (active) put(null) })
    return () => { active = false }
  }, [top])

  // 쓰다 만 글이 있는 위젯들. **바뀌지 않으면 같은 Set 을 그대로 돌려준다** — 글자마다
  // 새 Set 을 만들면 그때마다 셸이 통째로 다시 그려진다.
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set())
  const markDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys(prev => {
      if (prev.has(key) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])
  // 면이 바뀌거나 창이 닫히면 표식을 비운다 — 사라진 위젯의 글이 남아 있는 것으로 세면
  // 그다음 창이 영영 "작성 중"이 된다. 렌더 중 조정이다(이 저장소의 effect-setState 회피 문법).
  const dirtyScope = `${top?.seq ?? ''}-${top?.kind ?? ''}`
  const [syncedScope, setSyncedScope] = useState(dirtyScope)
  if (syncedScope !== dirtyScope) {
    setSyncedScope(dirtyScope)
    setDirtyKeys(prev => (prev.size > 0 ? new Set() : prev))
  }
  const anyDirty = dirtyKeys.size > 0

  return (
    <EntityModalContext.Provider value={{ open, close, markDirty }}>
      {children}
      {top && (
        <PrismShellView
          dirty={anyDirty}
          // 면이 바뀌면 셸 내부 상태(퇴실 정산 시드 소진 등)를 새로 시작한다. 면 전환(setKind)은
          // seq 가 그대로라 리마운트되지 않는다 — 그 상태는 한 면 안에서 이어져야 한다.
          key={top.seq}
          kind={top.kind}
          links={top.links}
          openCheckoutProration={top.seed.openCheckoutProration}
          setKind={k => setStack(s => (s.length > 0 ? [...s.slice(0, -1), { ...s[s.length - 1], kind: k }] : s))}
          onBack={stack.length > 1 ? back : undefined}
          onClose={close}
        />
      )}
    </EntityModalContext.Provider>
  )
}

function PrismShellView({ kind, links, openCheckoutProration, setKind, onBack, onClose, dirty }: {
  kind: EntityKind; links: Links | undefined; openCheckoutProration?: boolean; setKind: (k: EntityKind) => void
  /** 이 셸 안에 쓰다 만 글이 있는가 — Modal 의 dirty 정책(§12)에 그대로 넘긴다. */
  dirty?: boolean
  /** 셸에 쌓인 직전 면으로 — 스택이 한 장뿐이면 undefined 라 Modal 이 뒤로 버튼을 안 그린다. */
  onBack?: () => void
  onClose: () => void
}) {
  const router = useRouter()
  // 페이지 이동 전용 — refresh(7곳)까지 진행바를 태우면 모달 안 저장마다 막대가 떠 소음이 된다
  const navRouter = useNavRouter()
  const searchParams = useSearchParams()
  // 수납 면은 돈이라 미래 월이 잠긴 축이다 — URL 이 미래를 들고 있어도 이번 달로 읽는다(lib/monthParam).
  const month = resolveMonthParam(searchParams.get('month'))
  const isPastMonth = month < kstMonthStr()   // 프리즘이 과거 월을 보고 있으면 강조
  // 호실 면의 기준월은 조회 월(수납 축)과 분리한다. 호실 상태는 '지금 그 방이 어떤가'라는 현재의
  // 사실이고, 호실 카드(RoomManageClient targetMonth)도 언제나 KST 이번 달로 묻는다. 조회 월을
  // 따라가면 모달 안에서 지난달로 옮긴 뒤 호실 면으로 돌아왔을 때 뒤에 깔린 카드와 또 갈린다 —
  // 이번에 봉합한 바로 그 클래스다. 게다가 호실 면엔 월 선택기가 없어 설명할 자리도 없다.
  const roomStatusMonth = kstMonthStr()
  const [isPending, startTransition] = useTransition()

  const hasRoom = !!links?.roomId
  const hasTenant = !!links?.tenantId
  const hasPay = !!links?.leaseTermId

  // ── 호실 면이 보고 있는 방 ────────────────────────────────────────────
  // 한 사람이 방을 둘 쓰면(509호 거주 + 601호 창고) 호실 면은 그중 하나를 그린다. 초기값은 진입한
  // 방이고, 세그먼트로 바꾼다. **앵커는 안 따라온다** — 제목·입주자 면·수납 면은 메인 계약 그대로다.
  //
  // 상태를 셸이 들고 있는 이유는 아래 액션 행이다. RoomBody 안에 두면 화면은 601호를 그리는데
  // [삭제]·[수정]은 links.roomId(진입 방)를 지워 버린다. 보는 방과 조작 대상은 하나여야 한다.
  const [roomSel, setRoomSel] = useState<string | null>(null)
  // 이 사람이 계약으로 쥔 방들 — 계약 순서(메인이 먼저)이고, 진입 방이 그 목록에 없으면 뒤에 붙인다
  // (공실·퇴실 방으로 들어온 경우). 하나뿐이면 RoomBody 가 세그먼트를 안 그린다.
  const roomOptions = useMemo(() => {
    const out: { id: string; roomNo: string | null }[] = []
    const push = (id: string | null | undefined, roomNo: string | null | undefined) => {
      if (!id || out.some(o => o.id === id)) return
      out.push({ id, roomNo: roomNo ?? null })
    }
    for (const l of links?.leases ?? []) push(l.roomId, l.roomNo)
    push(links?.roomId, links?.roomNo)
    return out
  }, [links])
  const shownRoomId = (roomSel && roomOptions.some(o => o.id === roomSel) ? roomSel : null) ?? links?.roomId ?? null
  const shownRoomNo = roomOptions.find(o => o.id === shownRoomId)?.roomNo ?? links?.roomNo ?? null
  // 앵커 계약이 걸린 방 — 지금 보는 방이 이것과 다르면 그 방은 이 사람의 추가 계약 방이다.
  const anchorRoomId = links?.leases.find(l => l.id === links.leaseTermId)?.roomId ?? null
  const subLeaseNote = anchorRoomId && shownRoomId && shownRoomId !== anchorRoomId && links?.tenantName
    ? `${fmtRoomNo(links.anchorRoomNo)} ${links.tenantName}님의 추가 계약 방입니다.`
    : undefined

  // ── 수납 면이 여는 계약 ───────────────────────────────────────────────
  // 기본은 앵커(메인 계약)다. 601호 창고 면에서 수납 탭으로 넘어와도 메인이 열린다 — 종전에는
  // 진입 계약이 그대로 열려 문의 단계 계약이면 "이 상태의 입주자는 수납 정보를 열 수 없습니다"라는
  // 막다른 길이었다. 다만 계약을 **이름으로 지목**하고 들어온 진입(수납 관리의 계약별 행)은 그
  // 계약이 열린다. 601호 행을 눌렀는데 509호 수납이 열리면 돈이 엉뚱한 계약에 들어간다.
  const [leaseSel, setLeaseSel] = useState<string | null>(null)
  const leaseOptions = useMemo(() => {
    const out: { id: string; roomNo: string | null }[] = []
    const push = (id: string | null | undefined, roomNo: string | null | undefined) => {
      if (!id || out.some(o => o.id === id)) return
      out.push({ id, roomNo: roomNo ?? null })
    }
    // 청구가 도는 계약만 — 투어 단계 계약에는 수납 면이 열 것이 없다(수납 폼 세그먼트와 같은 집합).
    for (const l of links?.leases ?? []) if ((CONTRACT_ISSUE_STATUSES as string[]).includes(l.status)) push(l.id, l.roomNo)
    push(links?.entryLeaseTermId, links?.roomNo)
    return out
  }, [links])
  const shownLeaseId = (leaseSel && leaseOptions.some(o => o.id === leaseSel) ? leaseSel : null)
    ?? links?.entryLeaseTermId ?? links?.leaseTermId ?? null
  const shownLeaseRoomNo = leaseOptions.find(o => o.id === shownLeaseId)?.roomNo ?? links?.roomNo ?? null

  // ── 서류 묶음 보내기 시트 ─────────────────────────────────────────────
  // 열면 그 사람의 보관 서류를 계약 축으로 세워 한 번의 공유 시트로 보낸다(신고 44501308).
  // 값은 '어느 계약 분을 기본 체크할지' — 사람 단위 진입은 null 이라 아무것도 안 고른다.
  const [docSheetLease, setDocSheetLease] = useState<string | null | undefined>(undefined)

  // 퇴실 정산 자동 진입 시드는 1회성 — 수납 면을 떠나면 소진.
  // 소진하지 않으면 하단 나브바로 수납 면에 재진입할 때마다 정산 폼이 다시 펼쳐진다.
  const [prorationSeedSpent, setProrationSeedSpent] = useState(false)
  const effectiveOpenProration = openCheckoutProration && !prorationSeedSpent
  const handleSelectKind = (k: EntityKind) => {
    if (kind === 'payment' && k !== 'payment' && openCheckoutProration) setProrationSeedSpent(true)
    setKind(k)
  }
  // 제목은 **앵커**를 말한다 — 이 사람의 메인 계약이 걸린 방이다. 부계약 방(601호 창고)으로 들어와도
  // 제목은 '509 · 김상혁'이다. 종전처럼 진입 방을 적으면 같은 사람이 어느 문으로 들어왔느냐에 따라
  // 다른 이름으로 불린다. 지금 보고 있는 방은 호실 면의 방 선택기가 말한다(2026-08-13, 1인 다호실).
  //
  // 임시 호실을 거치는 이사 중에는 **지금 사는 방이 먼저다**(운영자 지적 2026-09-01 — 402호에
  // 사는 사람을 404호라 부르면 현장과 화면이 다른 말을 한다). 계약 방은 꼬리로 남긴다 —
  // 청구·계약서가 그 축을 쓰다는 사실이 제목에서 사라지면 안 된다. 이사를 마치면 두 값이
  // 같아져 꼬리가 저절로 사라진다.
  const titleRoomNo = links?.currentRoomNo ?? links?.anchorRoomNo ?? links?.roomNo
  const titleContractTail = links?.currentRoomNo && links.anchorRoomNo && links.currentRoomNo !== links.anchorRoomNo
    ? ` (계약 ${fmtRoomNo(links.anchorRoomNo)})` : ''
  const title = links ? `${fmtRoomNo(titleRoomNo)}${links.tenantName ? ` · ${links.tenantName}` : ''}${titleContractTail}` : '…'

  // 호실 액션 — 셸이 직접 처리(데이터 정합).
  const handleApplyScheduledNow = async () => {
    if (!shownRoomId) return
    const ok = await confirmDialog({
      title: `${fmtRoomNo(shownRoomNo)} 예정 가격을 즉시 적용할까요?`,
      confirmLabel: '적용',
    })
    if (!ok) return
    startTransition(async () => {
      const res = await withSave(() => applyScheduledRentNow(shownRoomId), { success: '예정 가격 적용됨' })
      if (res.ok && res.undo) {
        const u = res.undo
        pushToast('info', '잘못 적용했다면 되돌릴 수 있어요', {
          action: { label: '적용취소', run: () => { void undoApplyScheduledRent(u).then(r => { if (r.ok) pushToast('info', '예정 가격 적용을 취소하고 원래 월 이용료로 복원했습니다'); else pushToast('error', r.error) }) } },
        })
      }
      if (res.ok) router.refresh()
    })
  }
  const handleDeleteRoom = async () => {
    if (!shownRoomId) return
    const ok = await confirmDialog({
      title: `${fmtRoomNo(shownRoomNo)} 호실을 삭제할까요?`,
      level: 'danger', confirmLabel: '삭제',
    })
    if (!ok) return
    startTransition(async () => {
      const res = await withSave(() => deleteRoom(shownRoomId), { success: '삭제됨', silentError: true })
      // 과거 계약·수납 이력 — 건수를 보여주는 영향 고지형 다이얼로그(v2.0 §14) 동의 후에만 영구 삭제
      if (!res.ok && res.needsForce) {
        const force = await confirmDialog({
          title: `${fmtRoomNo(shownRoomNo)} 기록을 영구 삭제할까요?`,
          message: '매출 통계·과거 조회에서도 함께 사라집니다.',
          level: 'danger', confirmLabel: '영구 삭제',
          impact: [
            { label: '과거 계약', count: res.leases ?? 0 },
            { label: '수납 기록', count: res.payments ?? 0 },
          ],
        })
        if (!force) return
        const res2 = await withSave(() => deleteRoom(shownRoomId, { force: true }), { success: '삭제됨' })
        if (res2.ok) { onClose(); router.refresh() }
        return
      }
      if (!res.ok) { pushToast('error', res.error); return }   // needsForce 외 실패(거주중 등)
      onClose(); router.refresh()
    })
  }
  // 다른 페이지의 편집 폼으로 넘기는 문 — **목적지가 설 때까지 이 창을 닫지 않는다**.
  //
  // 종전에는 push 직후 바로 닫아서, 목적지 페이지가 그려지기 전까지 아무것도 없는 화면이
  // 잠깐 보였다. 운영자 지적(2026-08-26) — "상세정보 창이 사라졌다가 조금 후에 수정 창이 떠.
  // 잠깐 사라지는 창 때문에 뭔가 잘못 눌렀나? 싶은 불안감이 생겨."
  //
  // 전환(startTransition) 중에는 React 가 이 창을 그대로 세워 두므로, 전환이 끝난 뒤에 닫으면
  // 화면이 끊기지 않는다. 전환이 끝나지 않아도 창이 갇히지 않게 상한을 둔다.
  const navClosing = useRef(false)
  const [opening, setOpening] = useState(false)
  const navigateThenClose = (href: string) => {
    navClosing.current = true
    setOpening(true)
    startTransition(() => { navRouter.push(href) })
    // 전환이 끝나지 않아도 창이 갇히지 않게 상한을 둔다. 정상 경로에서는 아래 effect 가
    // 먼저 닫으므로 이 타이머가 하는 일이 없다.
    setTimeout(() => { if (navClosing.current) { navClosing.current = false; onClose() } }, 1500)
  }
  useEffect(() => {
    if (!navClosing.current || isPending) return
    navClosing.current = false
    onClose()
  }, [isPending, onClose])

  // 수정은 페이지 종속 편집 폼이 있는 /room-manage 로 위임 (Phase 2.5 에서 위젯 편집 모드로 대체 예정).
  const handleEditRoom = () => {
    if (!shownRoomId) return
    navigateThenClose(`/room-manage?roomId=${shownRoomId}&edit=1`)
  }

  // 입주자 액션 — 삭제는 셸이 직접, 편집은 페이지로 위임 (탭·상태전환·요청 CRUD 가 페이지 종속).
  const handleDeleteTenant = async () => {
    if (!links?.tenantId) return
    const ok = await confirmDialog({
      title: `${links.tenantName ?? '이 입주자'}님을 삭제할까요?`,
      level: 'danger', confirmLabel: '삭제',
    })
    if (!ok) return
    startTransition(async () => {
      const res = await withSave(() => deleteTenant(links.tenantId!), { success: '삭제됨', silentError: true })
      // 계약·수납 이력 — 건수를 보여주는 영향 고지형 다이얼로그(v2.0 §14) 동의 후에만 영구 삭제
      if (!res.ok && res.needsForce) {
        const force = await confirmDialog({
          title: `${links.tenantName ?? '이 입주자'}님 기록을 영구 삭제할까요?`,
          message: '매출 통계·과거 조회에서도 함께 사라집니다.',
          level: 'danger', confirmLabel: '영구 삭제',
          impact: [
            { label: '계약', count: res.leases ?? 0 },
            { label: '수납 기록', count: res.payments ?? 0 },
          ],
        })
        if (!force) return
        const res2 = await withSave(() => deleteTenant(links.tenantId!, { force: true }), { success: '삭제됨' })
        if (res2.ok) { onClose(); router.refresh() }
        return
      }
      if (!res.ok) { pushToast('error', res.error); return }
      onClose(); router.refresh()
    })
  }
  const handleEditTenant = () => {
    if (!links?.tenantId) return
    navigateThenClose(`/tenants?tenantId=${links.tenantId}&edit=1`)
  }

  // Phase 2.4a (2026-05-30): kind='payment' 의 '수납 관리에서 열기' 딥링크 제거.
  // PaymentBody 내부 summary→full 모드 토글이 in-place 전환 (배경 안 바뀜) — 사용자 비전.

  return (
    <Modal
      open onClose={onClose} onBack={onBack} width="sm" title={title} z={280} dirty={dirty}
      // 글을 쓰는 동안에는 이 푸터가 통째로 없는 편이 낫다. 액션 여섯과 탭 셋을 세어 보면
      // **아홉 개 전부가 지금 쓰는 글을 버리는 버튼**이다 — 서류 셋과 수정은 페이지를 갈아
      // 치우고, 탭 셋은 면을 바꿔 위젯을 언마운트한다. 경고도 없다. 도움이 되는 것은 0개다.
      // 게다가 아이폰 폭에서 액션이 세 줄로 접혀 푸터가 226px, 남는 본문이 38px 이라
      // 입력칸(96px)이 물리적으로 안 들어갔다(실측 2026-08-29).
      //
      // 액션만 접고 탭을 남기지 않는 이유. 탭도 같은 함정이고, 남기면 Modal 의 border-t 와
      // 탭의 border-b 가 45px 간격으로 두 줄 서서 잘린 푸터처럼 읽힌다.
      collapseFooterOnKeyboard
      footer={
        <div className="space-y-2">
          {/* 액션 행 — 세 면이 한 골격을 쓴다. **좌: 이 면의 파괴적 액션 · 우: 서류, 수정.**
              우측 둘의 상대 위치는 어느 면에서도 안 바뀐다.

              **flex-wrap 을 걷었다.** 종전에는 버튼이 늘면 조용히 접혔고, 접히면 기기마다 버튼
              자리가 달라져 근육 기억이 안 섰다. 더 나쁜 것은 파괴적 버튼의 자리가 설계가 아니라
              레이아웃 계산 결과가 된다는 점이다. wrap 은 안전망이 아니라 은폐 장치다 — 넘치면
              바로 티가 나야 다음 사람이 네 번째 버튼을 무저항으로 더하지 않는다.

              **서류 넷을 문 하나로 접었다**(운영자 승인 2026-08-29, 신고 2번).
              종전에는 만드는 문 셋을 평평하게 깔았는데 그 행이 셋을 못 했다.
                · 발급 가능 여부를 못 가렸다. 보증금 0원 계약에도 영수증 문이 열렸다.
                · 어느 계약의 종이인지 몰랐다. 입주자 면은 지목 없이 추론에 맡겼는데, 그 추론은
                  제목이 쓰는 규칙과 **반대 끝**을 집는다(제목은 입주일 오름차순 첫 건, 서류는
                  내림차순 첫 건). 거주 계약이 둘이면 제목과 다른 계약의 종이가 나갔다.
                · 아이폰 폭에서 세 줄로 접혀 푸터가 226px 이었다. 보증금 영수증까지 더하면
                  320px 기기에서 다섯 줄 337px 이 된다.
              시트(TenantDocBundleSheet)는 셋을 다 한다. 계약 축으로 세우고, 딸린 계약의 계약서·
              보증금 0원·비거주 실거주 확인서를 걸러 내고, 미발급 행의 '작성'이 계약을 지목해
              간다. 목적지 URL 은 이 행이 쓰던 것과 같아 잃는 경로가 없다.

              라벨이 '서류 보내기'가 아니라 '서류'인 이유. 이제 그 문 뒤에서 만들기도 하므로
              '보내기'는 절반만 말한다. '서류함'은 보관만 뜻해 작성을 감춘다. */}
          {kind === 'room' && hasRoom && !opening && (
            <div className="flex gap-2 items-center">
              {/* 형제 면과 같은 문법으로 — 종전에는 raw button 에 py-2 text-xs 라 실높이가 34px 이었다
                  (§09 터치 타겟 44px, §10 raw button 금지 양쪽에 걸렸다). */}
              <Btn variant="ghost" size="md" onClick={handleDeleteRoom} disabled={isPending}
                className="text-[var(--danger-fg)]">
                삭제
              </Btn>
              <div className="flex-1" />
              <Btn variant="primary" size="md" onClick={handleEditRoom} disabled={isPending}>
                수정
              </Btn>
            </div>
          )}
          {kind === 'tenant' && hasTenant && !opening && (
            <div className="flex gap-2 items-center">
              <Btn variant="ghost" size="md" onClick={handleDeleteTenant} disabled={isPending}
                className="text-[var(--danger-fg)]">
                삭제
              </Btn>
              <div className="flex-1" />
              {/* null = 계약 지목 없는 사람 단위 진입. 시트가 그 사람의 계약을 전부 세운다. */}
              {links?.tenantId && (
                <Btn variant="secondary" size="md" onClick={() => setDocSheetLease(null)}>
                  서류
                </Btn>
              )}
              <Btn variant="primary" size="md" onClick={handleEditTenant} disabled={isPending}>
                수정
              </Btn>
            </div>
          )}
          {/* 수납 면 — 이 면이 열어 둔 계약(shownLeaseId)을 서류와 수정 양쪽에 실어 보낸다.
              보고 있는 계약과 나가는 종이·열리는 폼이 하나여야 한다(2026-08-13, 다호실 마무리).

              **hasPay 가드.** 본문이 "이 상태의 입주자는 수납 정보를 열 수 없습니다"를 띄우는데
              그 아래 버튼이 살아 있으면, 지목이 빈 채로 문이 열려 엉뚱한 계약에 닿는다.
              **!opening 가드.** 형제 두 면과 같다. 지금 이 면의 문은 시트를 열 뿐이라 opening 을
              안 켜지만, 셋만 가드가 없는 채로 두면 다음에 이동 버튼이 서는 날 조용히 뚫린다. */}
          {kind === 'payment' && hasPay && links?.tenantId && !opening && (
            <div className="flex gap-2 items-center">
              <div className="flex-1" />
              {/* 게이트를 걷었다. 종전에는 (canShare || mailOn) 이 걸려 공유·메일이 없는 기기에서
                  이 문이 사라졌는데, 이제 그 문 뒤에 **발급**이 있어 서류를 아예 못 만들게 된다.
                  입주자 면은 저장 갈래가 생기면서 이미 걷혔다. */}
              <Btn variant="secondary" size="md" onClick={() => setDocSheetLease(shownLeaseId)}>
                서류
              </Btn>
            </div>
          )}
          {/* deepLink 행 — Phase 2.4a 에서 수납 딥링크 in-place 전환으로 대체됨. 다른 kind 에 필요시 부활. */}
          {/* 공통 하단 네비 — onSelect 로 같은 셸 안에서 body 만 교체 (in-place). */}
          <PrismNavBar
            current={kind}
            onSelect={handleSelectKind}
            links={{
              roomId: links?.roomId ?? null,
              tenantId: links?.tenantId ?? null,
              leaseTermId: links?.leaseTermId ?? null,
            }}
          />
        </div>
      }
    >
      <div>
        {/* 링크 해소 전에는 뼈대 — body 들이 자기 조회 중에 쓰는 것과 같은 SkeletonRows 정본이라
            셸이 열린 뒤 뼈대가 한 번도 끊기지 않고 내용으로 이어진다. */}
        {links === undefined || opening ? <SkeletonRows rows={5} className="py-4" /> : (<>
          {/* 수납 정보는 월별 데이터 — 프리즘 안에서도 월 변경 가능(URL ?month= 공유, 모달 유지).
              강조는 MonthSelector 알약 자체(과거면 amber)로 충분 — 별도 박스로 감싸면 '네모 안 네모'라 과함. */}
          {kind === 'payment' && hasPay && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium" style={{ color: isPastMonth ? 'var(--warning-fg)' : 'var(--warm-muted)' }}>
                {isPastMonth ? '지난 달 조회 중' : '조회 월'}
              </span>
              <MonthSelector />
            </div>
          )}
          {kind === 'room'    && (hasRoom   ? <RoomBody roomId={shownRoomId!} month={roomStatusMonth} onApplyScheduledNow={handleApplyScheduledNow}
                                                rooms={roomOptions} onSelectRoom={setRoomSel} subLeaseNote={subLeaseNote} /> : <Empty label="연결된 호실이 없습니다." />)}
          {kind === 'tenant'  && (hasTenant ? <TenantBody tenantId={links!.tenantId!} /> : <Empty label="연결된 입주자가 없습니다." />)}
          {kind === 'payment' && (hasPay    ? <PaymentBody leaseTermId={shownLeaseId!} month={month} canEdit roomNo={shownLeaseRoomNo}
                                                leases={leaseOptions} onSelectLease={setLeaseSel} openCheckoutProration={effectiveOpenProration} /> : <Empty label="연결된 수납(계약)이 없습니다." />)}
        </>)}
        {/* 서류 묶음 보내기 — 셸 안에서 겹쳐 세운다(발급 상세 시트와 같은 층 문법: 셸 패널 안에
            그리면 셸의 층 안에서 그 위에 올라간다). undefined = 닫힘, null = 지목 없는 사람 단위 진입. */}
        {docSheetLease !== undefined && links?.tenantId && (
          <TenantDocBundleSheet
            tenantId={links.tenantId}
            preselectLeaseTermId={docSheetLease}
            onClose={() => setDocSheetLease(undefined)}
          />
        )}
      </div>
    </Modal>
  )
}

const Empty = ({ label }: { label: string }) => <p className="text-sm text-[var(--warm-muted)] text-center py-8">{label}</p>
// TenantView 미니 요약 → TenantBody (Phase 2.3b).
// PaymentView 미니 요약 → PaymentBody (sub-mode: summary/full) (Phase 2.4a).
