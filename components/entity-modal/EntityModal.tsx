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
import { docFromQuery } from '@/lib/docNav'
import { getContractShareState } from '@/app/(app)/tenants/contractShare'
import { Modal } from '@/components/ui/Modal'
import { kstMonthStr } from '@/lib/kstDate'
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
import { canShareFiles } from '@/lib/shareFile'
import { TenantDocBundleSheet } from '@/components/doc/TenantDocBundleSheet'

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

  return (
    <EntityModalContext.Provider value={{ open, close }}>
      {children}
      {top && (
        <PrismShellView
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

function PrismShellView({ kind, links, openCheckoutProration, setKind, onBack, onClose }: {
  kind: EntityKind; links: Links | undefined; openCheckoutProration?: boolean; setKind: (k: EntityKind) => void
  /** 셸에 쌓인 직전 면으로 — 스택이 한 장뿐이면 undefined 라 Modal 이 뒤로 버튼을 안 그린다. */
  onBack?: () => void
  onClose: () => void
}) {
  const router = useRouter()
  // 페이지 이동 전용 — refresh(7곳)까지 진행바를 태우면 모달 안 저장마다 막대가 떠 소음이 된다
  const navRouter = useNavRouter()
  const searchParams = useSearchParams()
  const month = searchParams.get('month') || kstMonthStr()
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
  // 다건 보내기는 공유 시트 말고 폴백이 없다 — 미지원 기기(데스크톱·인앱 브라우저)는 진입점을 숨긴다.
  // 형제 3화면과 같은 정책이고, SSR 은 기기를 알 수 없어 마운트 후 1회 판정한다.
  const [canShare, setCanShare] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCanShare(canShareFiles()) }, [])

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
  const title = links ? `${fmtRoomNo(links.anchorRoomNo ?? links.roomNo)}${links.tenantName ? ` · ${links.tenantName}` : ''}` : '…'

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
  // 수정은 페이지 종속 편집 폼이 있는 /room-manage 로 위임 (Phase 2.5 에서 위젯 편집 모드로 대체 예정).
  const handleEditRoom = () => {
    if (!shownRoomId) return
    navRouter.push(`/room-manage?roomId=${shownRoomId}&edit=1`)
    onClose()
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
    navRouter.push(`/tenants?tenantId=${links.tenantId}&edit=1`)
    onClose()
  }
  // 종전 '계약서 출력' 버튼(handlePrintContract)은 제거했다 — 2026-08-01 용어·접점 정리.
  // 독자 기능이 0이었다. 파일이 없으면 /contract/[tenantId] 를 열었는데 그건 계약서 파일 섹션의
  // '계약서 작성·서명'과 같고, 있으면 다이얼로그 뒤에서 같은 URL 또는 파일 행의 링크를 열었을 뿐이다.
  // 게다가 files[0] 은 signedAt desc 첫 건이라 시스템 발급본일 수 있는데 무조건 '스캔본'이라 표기해
  // 스캔본을 한 번도 올리지 않은 입실자에게도 '스캔본 출력'이 떴다(보관 35건 중 11건이 발급본).
  // 하단 행이 스크롤 없이 닿는 이점은 계약서 파일 섹션을 계약 정보 바로 아래로 올려 대체한다.
  // 이제 하단 행에는 부속 서류(실거주 확인서·입실료 납부 확인서)만 남는다.

  // 실거주 확인서 — 입실자 데이터로 자동 채워진 작성 화면으로 이동.
  // 소프트 내비가 아니라 전체 페이지 이동이다. 라우트 viewport 가 새 문서 파싱 시점에 확실히 적용된다.
  // 목적지가 (app) 밖이라 어차피 셸을 다시 세우므로 잃는 것이 없다.
  const handleResidenceCert = () => {
    if (!links?.tenantId) return
    window.location.assign(`/residence-cert/${links.tenantId}${docFromQuery('tenant', links.tenantId)}`)
    onClose()
  }
  // 계약서 — 규칙 1·§30.10. 하단은 서류를 만들고 발급하러 가는 문이고,
  // 위쪽 '계약서 파일' 칸은 이미 있는 파일의 보관함이다. 이름으로 갈린다 —
  // 하단은 목적어 없는 '계약서', 파일 칸의 버튼에는 항상 '스캔본'이 붙는다.
  const handleContract = async () => {
    if (!links?.tenantId) return
    // 서명이 들어온 계약은 **서명 시점 스냅샷**으로 연다. 그냥 열면 화면이 지금 DB 값을 보여주고,
    // 거기서 발급을 누르면 입주자가 서명한 문서와 다른 계약서가 나간다.
    // 계약서 파일 칸의 진입은 이미 이렇게 갈리는데 이 문만 안 갈려 있었다(2026-08-04 지적).
    const tenantId = links.tenantId
    let share = ''
    try {
      const res = await getContractShareState(tenantId)
      // signedAt 만으로는 부족하다 — 서명을 지워도 남는 과거 사실이라, 깨끗한 계약이 옛 스냅샷
      // 화면에 갇혔다(502호 2026-08-10). 지금 서명이 남아 있을 때만 서명본으로 연다.
      if (res.ok && res.link?.signedAt && res.link.signatureLive) share = `&share=${encodeURIComponent(res.link.id)}`
    } catch { /* 조회 실패는 무시 — 일반 진입으로 간다. 문이 막히는 것보다 낫다 */ }
    window.location.assign(`/contract/${tenantId}${docFromQuery('tenant', tenantId)}${share}`)
    onClose()
  }
  // 납부 확인서·보증금 영수증 — 입실자 데이터로 자동 채워진 작성 화면으로 이동.
  //
  // namedLeaseTermId 는 계약 지목이다(2026-08-13, 다호실 마무리 — 계약서 축과 같은 ?leaseTermId= 문법).
  // 수납 면에서 누른 버튼은 **그 면이 열어 둔 계약**의 서류를 뽑아야 한다. 601호 창고 계약을 보고
  // 있는데 509호 거주 계약의 확인서가 나오면, 받지도 않은 돈의 종이가 나가거나 그 반대가 된다.
  // 입주자 면의 버튼은 사람 단위라 지목 없이 종전대로 — 추론이 고르는 계약이 곧 메인이다
  // (계약서 파일 칸의 주 버튼과 같은 규칙).
  const handleRentReceipt = (kindArg: 'rent' | 'deposit' = 'rent', namedLeaseTermId?: string | null) => {
    if (!links?.tenantId) return
    const named = namedLeaseTermId ? `leaseTermId=${encodeURIComponent(namedLeaseTermId)}&` : ''
    window.location.assign(`/rent-receipt/${links.tenantId}?${kindArg === 'deposit' ? 'kind=deposit&' : ''}${named}from=tenant&tenantId=${encodeURIComponent(links.tenantId)}`)
    onClose()
  }

  // Phase 2.4a (2026-05-30): kind='payment' 의 '수납 관리에서 열기' 딥링크 제거.
  // PaymentBody 내부 summary→full 모드 토글이 in-place 전환 (배경 안 바뀜) — 사용자 비전.

  return (
    <Modal
      open onClose={onClose} onBack={onBack} width="sm" title={title} z={280}
      footer={
        <div className="space-y-2">
          {/* 액션 행 — kind 마다 다른 액션. PrismNavBar 위. */}
          {kind === 'room' && hasRoom && (
            <div className="flex gap-2 items-center">
              <button type="button" onClick={handleDeleteRoom} disabled={isPending}
                className="px-3 py-2 bg-[var(--danger-bg)] hover:bg-[var(--danger-bg)] text-[var(--danger-fg)] text-xs font-medium rounded-lg transition-colors disabled:opacity-40">
                삭제
              </button>
              <div className="flex-1" />
              <Btn variant="primary" size="md" onClick={handleEditRoom} disabled={isPending}>
                수정
              </Btn>
            </div>
          )}
          {kind === 'tenant' && hasTenant && (
            <div className="flex flex-wrap gap-2 items-center">
              <Btn variant="ghost" size="md" onClick={handleDeleteTenant} disabled={isPending}
                className="text-[var(--danger-fg)]">
                삭제
              </Btn>
              {links?.tenantId && (
                <Btn variant="secondary" size="md" onClick={handleContract}>
                  계약서
                </Btn>
              )}
              {links?.tenantId && (
                <Btn variant="secondary" size="md" onClick={handleResidenceCert}>
                  실거주 확인서
                </Btn>
              )}
              {links?.tenantId && (
                <Btn variant="secondary" size="md" onClick={() => handleRentReceipt('rent')}>
                  입실료 납부 확인서
                </Btn>
              )}
              {/* 위 셋은 서류를 만들러 가는 문이고, 이것은 이미 만들어진 서류를 보내는 문이다.
                  종전에는 종류마다 목록 화면을 따로 열어 한 사람의 종이를 네 번에 걸쳐 보냈다. */}
              {links?.tenantId && canShare && (
                <Btn variant="secondary" size="md" onClick={() => setDocSheetLease(null)}>
                  서류 보내기
                </Btn>
              )}
              <div className="flex-1" />
              <Btn variant="primary" size="md" onClick={handleEditTenant} disabled={isPending}>
                수정
              </Btn>
            </div>
          )}
          {/* 수납 관리(=payment 모달)에서 서류 발급 진입 — 돈을 기록한 자리에서 바로 뽑는 동선(신고 d68220bd).
              계약 세그먼트가 열어 둔 계약(shownLeaseId)을 그대로 실어 보낸다 — 보고 있는 계약과
              나가는 종이가 하나여야 한다(2026-08-13, 다호실 마무리). */}
          {kind === 'payment' && links?.tenantId && (
            <div className="flex flex-wrap gap-2 items-center">
              <Btn variant="secondary" size="md" onClick={() => handleRentReceipt('rent', shownLeaseId)}>
                입실료 납부 확인서
              </Btn>
              <Btn variant="secondary" size="md" onClick={() => handleRentReceipt('deposit', shownLeaseId)}>
                보증금 영수증
              </Btn>
              {/* 여기서 연 시트는 이 면이 열어 둔 계약 분을 기본 체크한다 — 보고 있는 계약과
                  나가는 종이가 하나여야 한다(위 두 버튼의 지목과 같은 규칙). */}
              {canShare && (
                <Btn variant="secondary" size="md" onClick={() => setDocSheetLease(shownLeaseId)}>
                  서류 보내기
                </Btn>
              )}
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
        {links === undefined ? <SkeletonRows rows={5} className="py-4" /> : (<>
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
