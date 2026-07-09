'use client'

// 비품·자재 — 소모품 재고와 별개로, 품목으로 산 내구재(의자·거치대·수선유지 자재 등)를
// 방별 / 공용부(위치)별 / 미배정(여분)으로 보여주고, 미배정 아이템을 방·공용부에 배정한다.
// 수량 2개 이상이면 몇 개 배정할지 물어 분할(나머지 여분 유지). 배정해제 시 같은 묶음 재병합.

import { useState, useTransition, useMemo, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { assignAggregateToTarget, revertAssignmentLog, deleteAssignmentLog, setCommonAsset, setAssetReceived, setAssetAssignedAt, setAssetRowSpec, combineAssets, getAssetAssignmentLog, batchAssignAssets, undoBatchAssignAssets, addFreeAsset, type AssetsData, type AssetItem, type AssetAssignmentLogRow, type AssetAssignUndo } from './actions'
import { undoItemNameMerge } from '@/app/(app)/finance/actions'   // §10 합치기 적용취소(토스트 액션)
import { SectionHeader } from '@/components/ui/inventory/SectionHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { InventoryCard } from '@/components/ui/inventory/InventoryCard'
import { MergeSheet, type MergeTarget } from '@/components/ui/inventory/MergeSheet'
import { Modal } from '@/components/ui/Modal'
import { SearchBar } from '@/components/ui/SearchBar'
import MonthSelector from '@/components/layout/MonthSelector'
import { Badge } from '@/components/ui/Badge'
import { SpecWizard, type SpecWizardResult } from '@/components/ui/SpecWizard'
import { InfoHint } from '@/components/ui/InfoHint'

// 비품 위치 섹션 마커 — §21.2 위치 아이콘(핀) 14px
const PinMarker = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
  </svg>
)
const CoralTag = ({ children }: { children: ReactNode }) => (
  <span className="text-[0.625rem] font-normal text-[var(--coral)]">{children}</span>
)

import { fmtWon as won } from '@/lib/fmtMoney'   // §15 단일 경로
const fmtRoomNo = (no: string) => (/^\d+$/.test(no) ? `${no}호` : no)
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))

type Target = { kind: 'room' | 'location'; id: string }

export default function AssetsClient({ data, rooms, locations, targetMonth }: {
  targetMonth: string
  data: AssetsData
  rooms: { id: string; roomNo: string }[]
  locations: { id: string; name: string }[]
}) {
  const router = useRouter()
  // 위치 옮기기 — 카드·상세 공용 단일 흐름(어디로+얼마나+배정일+미리보기), 운영자 요청 2026-07-08
  const [adjQty, setAdjQty] = useState<{ id: string; v: string } | null>(null)   // 배정 수량 직접 조절 입력(카드별)
  const [move, setMove] = useState<{ it: AssetItem; to: string; qty: string; date: string; src: string } | null>(null)   // src: '' = 오래된 구매부터, 'YYYY-MM-DD' = 그 구매분에서만
  // 부분 수령(분할 배송) — 수량>1 이면 몇 개 왔는지 물어봄(기본 전체). 잔여는 수령 대기 유지.
  const [rcvAsk, setRcvAsk] = useState<string | null>(null)   // 대상 AssetItem id
  const [rcvQty, setRcvQty] = useState('1')
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())   // 합산 펼친 항목 id
  const toggleExpand = (id: string) => setExpanded(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  // 선택 모드 — 여러 비품을 골라 ① 방·공용부 일괄 배정 ② 대표 골라 합치기(MergeSheet). 카드별 '합치기'도 병행.
  const [mergeMode, setMergeMode] = useState(false)
  // 대분류 — 미배정(여분)·공용 자재·방·공용부 세 그룹 중 하나만 표시(운영자 요청 2026-07-08). 마지막 선택 유지.
  const [group, setGroup] = useState<'unassigned' | 'common' | 'placed'>(() => {
    if (typeof window === 'undefined') return 'unassigned'
    try { const g = localStorage.getItem('stayeum-assets-group'); return g === 'common' || g === 'placed' ? g : 'unassigned' } catch { return 'unassigned' }
  })
  const pickGroup = (g: 'unassigned' | 'common' | 'placed') => {
    setGroup(g)
    try { localStorage.setItem('stayeum-assets-group', g) } catch { /* 무시 */ }
  }
  // 섹션 접기 — 기본 닫힘(스크롤 부담 완화, 운영자 요청 2026-07-08). 연 섹션은 닫기 전까지 기기에 유지.
  const [openSecs, setOpenSecs] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem('stayeum-assets-open-sections') ?? '[]') as string[]) } catch { return new Set() }
  })
  const toggleSec = (k: string) => setOpenSecs(prev => {
    const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k)
    try { localStorage.setItem('stayeum-assets-open-sections', JSON.stringify([...n])) } catch { /* 저장 실패 무시 */ }
    return n
  })
  const [search, setSearch] = useState('')   // §22.1 상시 검색 — 품목·구매처·카테고리 클라 필터
  const [mergeSel, setMergeSel]   = useState<Set<string>>(new Set())   // 선택된 AssetItem id
  const [pillMode, setPillMode] = useState<'menu' | 'assign'>('menu')   // 하단 바 단계
  // 일괄 배정 수량 시트 — 대상 고른 뒤 품목별 수량(기본 전량) 입력
  const [batchAssign, setBatchAssign] = useState<{ target: Target; label: string; assignedAt: string; rows: { it: AssetItem; qty: string }[] } | null>(null)
  const exitMerge = () => { setMergeMode(false); setMergeSel(new Set()); setPillMode('menu') }
  // 합치기 바텀시트 — §21.4 MergeSheet 단일 통일(카드별·선택 공용)
  const [sheet, setSheet] = useState<{ sourceLabel: string; targets: MergeTarget[]; onConfirm: (destId: string) => void } | null>(null)
  // 비품 상세 풀화면 — §21.5 본문 탭 진입(구매 내역·배정 변경 이력·현재 상태·합치기)
  const [detailItem, setDetailItem] = useState<AssetItem | null>(null)
  // 행별 규격 편집(상세 모달) — 규격이 달라지면 카드가 자동 분리됨(오류신고 3707bf65)
  const [rowSpec, setRowSpec] = useState<Record<string, { v: string; u: string; t: string }>>({})
  const saveRowSpec = (b: { id: string; specValue: number | null; specUnit: string | null; specText: string | null }) => {
    const s = rowSpec[b.id] ?? { v: b.specValue != null ? String(b.specValue) : '', u: b.specUnit ?? '', t: b.specText ?? '' }
    startTransition(async () => {
      const res = await setAssetRowSpec(b.id, s.v.trim() ? Number(s.v) : null, s.u.trim() || null, s.t.trim() || null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '규격 저장됨. 규격이 다르면 별도 카드로 분리됩니다')
      setDetailItem(null)
      router.refresh()
    })
  }
  const [logRows, setLogRows] = useState<AssetAssignmentLogRow[]>([])
  useEffect(() => {
    if (!detailItem) { setLogRows([]); return }
    let alive = true
    getAssetAssignmentLog(detailItem.itemLabel).then(r => { if (alive) setLogRows(r) }).catch(() => {})
    return () => { alive = false }
    // data 도 의존성에 포함 — 상세를 유지한 채 옮기면(연속 배정) 이력도 따라 갱신돼야 한다(운영자 신고 2026-07-09)
  }, [detailItem, data])
  const toggleMergeSel = (id: string) => setMergeSel(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })
  const allItems = useMemo(() => [
    ...data.pending, ...data.unassigned, ...data.common,
    ...data.rooms.flatMap(r => r.items), ...data.locations.flatMap(l => l.items),
  ], [data])
  const selItems = useMemo(() => allItems.filter(it => mergeSel.has(it.id)), [allItems, mergeSel])
  const assetCats = useMemo(() => [...new Set(allItems.map(it => it.category).filter(Boolean))].sort(), [allItems])
  const assetLabels = useMemo(() => [...new Set(allItems.map(it => it.itemLabel).filter(Boolean))].sort(), [allItems])

  // 무상입수 — 무상으로 생긴 비품을 0원 Expense(재고자산)로 등록
  const [freeForm, setFreeForm] = useState<null | { label: string; cat: string; spec: string; specUnit: string; specText: string; qty: string; qtyUnit: string }>(null)
  const [freeWizOpen, setFreeWizOpen] = useState(false)
  const applyFreeWizard = (r: SpecWizardResult) => setFreeForm(f => f ? {
    ...f, spec: r.specValue, specUnit: r.specUnit, specText: r.specText, qty: r.qtyValue || f.qty, qtyUnit: r.qtyUnit,
  } : f)
  const submitFree = () => {
    if (!freeForm) return
    if (!freeForm.label.trim()) { pushToast('error', '품목명을 입력하세요.'); return }
    startTransition(async () => {
      const res = await addFreeAsset({
        itemLabel: freeForm.label,
        category: freeForm.cat,
        specValue: freeForm.spec.trim() ? Number(freeForm.spec) : null,
        specUnit: freeForm.specUnit.trim() || null,
        specText: freeForm.specText.trim() || null,
        qtyValue: Number(freeForm.qty) > 0 ? Number(freeForm.qty) : 1,
        qtyUnit: freeForm.qtyUnit.trim() || '개',
      })
      if (!res.ok) { pushToast('error', res.error); return }
      setFreeForm(null)
      pushToast('success', '무상 입수로 등록되었습니다')
      router.refresh()
    })
  }

  // §10 적용취소 — 토스트 액션·환경설정 '품명 병합' 둘 다(사용자 결정)
  const undoCombine = (runId: string) => startTransition(async () => {
    const res = await undoItemNameMerge(runId)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('success', '합치기를 적용취소했습니다')
    router.refresh()
  })
  // 합치기 실행 — combineAssets(대상=남는 카드, src=합쳐질 지출들). 적용취소는 토스트 + 환경설정 '품명 병합'.
  const runCombine = (destId: string, srcIds: string[], destLabel: string) => {
    if (srcIds.length === 0) { pushToast('error', '대표 외 합칠 비품을 더 선택하세요.'); return }
    startTransition(async () => {
      const res = await combineAssets(destId, srcIds)
      setSheet(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `'${destLabel}'(으)로 합쳐짐`, { action: { label: '적용취소', run: () => undoCombine(res.runId) } })
      exitMerge(); router.refresh()
    })
  }
  // 카드별 합치기 — 이 카드를 같은 구역·분류 다른 카드(대표)로 통일
  const openCardMerge = (it: AssetItem, siblings: AssetItem[]) => setSheet({
    sourceLabel: it.detail || it.itemLabel,
    targets: siblings.map(s => ({ id: s.id, label: s.detail || s.itemLabel })),
    onConfirm: destId => runCombine(destId, it.ids, siblings.find(s => s.id === destId)?.itemLabel ?? ''),
  })
  // 선택 합치기 — 고른 비품들을 대표로 통일
  const openSelectionMerge = () => setSheet({
    sourceLabel: `선택 ${selItems.length}개`,
    targets: selItems.map(s => ({ id: s.id, label: s.detail || s.itemLabel })),
    onConfirm: destId => runCombine(destId, selItems.filter(s => s.id !== destId).flatMap(s => s.ids), selItems.find(s => s.id === destId)?.itemLabel ?? ''),
  })
  // 같은 구역·분류의 다른 카드(합치기 대상 후보)
  const siblingsOf = (list: AssetItem[], it: AssetItem) => list.filter(s => s.id !== it.id && s.category === it.category)
  // 하단 바 대상 선택 → 수량 시트 오픈(품목별 기본 전량). 'room:id' | 'loc:id'
  const onBatchPick = (v: string) => {
    if (!v || selItems.length === 0) return
    const [k, id] = v.split(':')
    const label = k === 'room'
      ? fmtRoomNo(rooms.find(r => r.id === id)?.roomNo ?? '')
      : (locations.find(l => l.id === id)?.name ?? '')
    setBatchAssign({
      target: { kind: k === 'room' ? 'room' : 'location', id },
      label,
      assignedAt: kstYmdStr(),   // 배정일 — 기본 오늘, 시트에서 변경 가능(운영자 요청 2026-07-08)
      rows: selItems.map(it => ({ it, qty: String(it.qtyValue ?? 1) })),
    })
  }

  // 일괄 배정 적용취소(§10·rollback) — 분할 생성행 삭제 + 원상태 복원
  const undoBatch = (undo: AssetAssignUndo) => startTransition(async () => {
    const res = await undoBatchAssignAssets(undo)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('info', '일괄 배정을 적용취소했습니다')
    router.refresh()
  })

  // 수량 시트 확정 → 일괄 배정 실행
  const runBatchAssign = () => {
    if (!batchAssign) return
    const target = batchAssign.target
    const items = batchAssign.rows.map(r => {
      const max = r.it.qtyValue ?? 1
      let q = Number(r.qty)
      if (!(q > 0)) q = max               // 빈/0 → 전량
      q = Math.min(q, max)
      return { ids: r.it.ids, qty: q >= max ? null : q }   // 전량이면 null
    })
    startTransition(async () => {
      const res = await batchAssignAssets({ items, target, assignedAt: batchAssign.assignedAt || null })
      if (!res.ok) { pushToast('error', res.error); return }
      setBatchAssign(null); exitMerge()
      pushToast('success', `${batchAssign.label}에 ${res.assigned}개 품목 배정됨`, {
        action: { label: '적용취소', run: () => undoBatch(res.undo) },
      })
      router.refresh()
    })
  }

  // 위치 이름 헬퍼
  const placeName = (v: string) => {
    const [k, id] = v.split(':')
    return k === 'room' ? fmtRoomNo(rooms.find(r => r.id === id)?.roomNo ?? '') : (locations.find(l => l.id === id)?.name ?? '')
  }
  const curPlace = (it: AssetItem) =>
    it.roomNo ? fmtRoomNo(it.roomNo) : it.locationName ?? (it.isCommon ? '공용 자재' : '미배정(여분)')
  // 같은 품목(라벨+사양) 판별 — 수량 부분만 다른 카드끼리 묶는다 ("지금 어디에 있나")
  const itemIdentity = (x: AssetItem) => {
    const d = x.detail ?? x.itemLabel
    const i = d.lastIndexOf(' x ')
    return [i > 0 ? d.slice(0, i) : d, x.qtyUnit ?? '', x.category ?? '', x.isService ? 'S' : ''].join('|')
  }
  const samePlaceAs = (a: AssetItem) => (x: AssetItem) =>
    (x.roomId ?? null) === (a.roomId ?? null) && (x.locationId ?? null) === (a.locationId ?? null) && !!x.isCommon === !!a.isCommon

  // 옮기기 출발지 라이브 추적 — refresh 후에도 남은 수량으로 계속(연속 배정, 운영자 요청 2026-07-09)
  const moveSrc = useMemo(() => {
    if (!move) return null
    return allItems.find(x => x.id === move.it.id)
      ?? allItems.find(x => itemIdentity(x) === itemIdentity(move.it) && samePlaceAs(move.it)(x))
      ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move, allItems])
  useEffect(() => {
    if (move && !moveSrc) setMove(null)   // 출발지가 비면(전량 이동 반영) 옮기기 모달만 닫음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move, moveSrc])

  // 구매분(날짜)별 행 그룹 — 옮기기에서 특정 구매분만 차감할 때 사용
  const buysOf = (it: AssetItem) => {
    const m = new Map<string, { qty: number; ids: string[] }>()
    for (const b of it.breakdown) {
      const g = m.get(b.date) ?? { qty: 0, ids: [] }
      g.qty += b.qty ?? 1; g.ids.push(b.id); m.set(b.date, g)
    }
    return m
  }

  // 옮기기 실행 — 미배정 복귀도 부분 수량 지원(서버 통합 경로). 빈 수량 = 전량.
  const runMove = () => {
    if (!move) return
    const it = moveSrc ?? move.it
    const buy = move.src ? buysOf(it).get(move.src) : null
    const ids = buy ? buy.ids : it.ids
    const max = buy ? buy.qty : (it.qtyValue ?? 1)
    let q = Number(move.qty)
    if (move.qty === '' || !(q > 0)) q = max
    q = Math.min(q, max)
    const toNone = move.to === ''
    const target = (toNone ? { kind: 'none' } : { kind: move.to.startsWith('room:') ? 'room' : 'location', id: move.to.split(':')[1] }) as Parameters<typeof assignAggregateToTarget>[1]
    const destLabel = toNone ? '미배정(여분)' : placeName(move.to)
    const fromLabel = curPlace(it)
    startTransition(async () => {
      const res = await assignAggregateToTarget(ids, target, q >= max ? null : q, toNone ? null : (move.date || null))
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `${fromLabel} → ${destLabel} · ${fmtQty(q)}${it.qtyUnit ?? '개'} 옮겼습니다`)
      if (q >= max) setMove(null)                                // 전량 이동 — 출발지 비움
      else setMove(m => m ? { ...m, qty: '' } : m)               // 남은 수량으로 계속
      router.refresh()
    })
  }

  // 배정 수량 직접 조절 — 줄이면 여분으로 반환, 늘리면 여분에서 가져옴(운영자 요청 2026-07-09)
  const runAdjustQty = (it: AssetItem, v: string) => {
    const cur = it.qtyValue ?? 0
    const next = Number(v)
    const unit = it.qtyUnit ?? '개'
    if (!(next > 0)) { pushToast('error', '0보다 큰 수량을 입력하세요. 전부 빼려면 옮기기를 쓰세요.'); return }
    if (Math.abs(next - cur) < 1e-9) return
    if (next < cur) {
      const delta = Math.round((cur - next) * 1000) / 1000
      startTransition(async () => {
        const res = await assignAggregateToTarget(it.ids, { kind: 'none' }, delta)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', `${curPlace(it)} ${fmtQty(next)}${unit}로 조절했습니다 (${fmtQty(delta)}${unit}는 여분으로)`)
        setAdjQty(null); router.refresh()
      })
      return
    }
    const delta = Math.round((next - cur) * 1000) / 1000
    const spare = allItems.find(x =>
      itemIdentity(x) === itemIdentity(it) && !x.roomId && !x.locationId && !x.isCommon && !data.pending.some(pd => pd.id === x.id))
    if (!spare || (spare.qtyValue ?? 0) + 1e-9 < delta) {
      pushToast('error', `여분이 부족합니다 (여분 ${fmtQty(spare?.qtyValue ?? 0)}${unit} · ${fmtQty(delta)}${unit} 필요)`)
      return
    }
    const target = (it.roomId ? { kind: 'room', id: it.roomId } : { kind: 'location', id: it.locationId! }) as Parameters<typeof assignAggregateToTarget>[1]
    startTransition(async () => {
      const res = await assignAggregateToTarget(spare.ids, target, delta, it.assignedAt ?? null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `여분에서 ${fmtQty(delta)}${unit} 가져와 ${fmtQty(next)}${unit}로 조절했습니다`)
      setAdjQty(null); router.refresh()
    })
  }

  // 배정 이력 되돌리기(원상복구 + 이력 자동 삭제) / 이력 삭제
  const runRevertLog = (r: AssetAssignmentLogRow) => startTransition(async () => {
    const res = await revertAssignmentLog(r.id)
    if (!res.ok) { pushToast('error', res.error); return }
    pushToast('success', '되돌렸습니다 (이 이력은 지워짐)')
    setDetailItem(null)
    router.refresh()
  })
  const runDeleteLog = (r: AssetAssignmentLogRow) => {
    if (!window.confirm('이 이력 기록만 지웁니다 (배정 상태는 그대로). 지울까요?')) return
    startTransition(async () => {
      const res = await deleteAssignmentLog(r.id)
      if (!res.ok) { pushToast('error', res.error); return }
      setLogRows(rows => rows.filter(x => x.id !== r.id))
      pushToast('info', '이력을 지웠습니다')
    })
  }

  // 공용 자재 표시/해제
  const markCommon = (it: AssetItem, value: boolean) => {
    startTransition(async () => {
      const res = await setCommonAsset(it.ids, value)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', value ? '공용 자재로 표시됨' : '공용 자재 해제됨')
      router.refresh()
    })
  }

  // 수령 상태 토글 (수령 완료 / 수령 대기로). qty 지정 시 부분 수령(행 분할).
  const markReceived = (it: AssetItem, value: boolean, qty?: number) => {
    startTransition(async () => {
      const res = await setAssetReceived(it.ids, value, qty ?? null)
      if (!res.ok) { pushToast('error', res.error); return }
      setRcvAsk(null)
      pushToast('success', !value ? '수령 대기로 변경됨'
        : qty != null && it.qtyValue != null && qty < it.qtyValue
          ? `${fmtQty(qty)}${it.qtyUnit ?? '개'} 수령 완료 · 잔여 ${fmtQty(it.qtyValue - qty)}${it.qtyUnit ?? '개'}는 수령 대기 유지`
          : '수령 완료')
      router.refresh()
    })
  }

  // 배정일 입력·수정 — 방/공용부에 배정된 비품 묶음의 배정일을 저장(빈 값=미상). 상세에서만 노출.
  const saveAssignedAt = (it: AssetItem, v: string) => {
    const next = v || null
    if (next === (it.assignedAt ?? null)) return
    startTransition(async () => {
      const res = await setAssetAssignedAt(it.ids, next)
      if (!res.ok) { pushToast('error', res.error); return }
      setDetailItem(d => d && d.id === it.id ? { ...d, assignedAt: next } : d)
      pushToast('success', next ? '배정일을 저장했습니다' : '배정일을 비웠습니다')
      router.refresh()
    })
  }

  const ItemRow = ({ it, placed, awaitingReceipt, siblings = [] }: { it: AssetItem; placed: boolean; awaitingReceipt?: boolean; siblings?: AssetItem[] }) => (
    <li className="list-none">
      <InventoryCard
        selectable={mergeMode}
        selected={mergeSel.has(it.id)}
        onToggleSelect={() => toggleMergeSel(it.id)}
        onClick={() => setDetailItem(it)}
        onLongPress={!mergeMode ? () => { setMergeMode(true); toggleMergeSel(it.id) } : undefined}
        title={it.itemLabel}
        badges={<>
          {it.isService && <span className="inline-flex items-center rounded-full bg-[var(--canvas)] text-[var(--warm-mid)] text-[0.625rem] font-semibold px-1.5 py-0.5 border border-[var(--warm-border)]">서비스</span>}
          {it.amount === 0 && <span className="inline-flex items-center rounded-full bg-[var(--info-bg)] text-[var(--info-fg)] text-[0.625rem] font-semibold px-1.5 py-0.5">무상</span>}
        </>}
        meta={[boughtThisMonth(it) ? `${monthLabel} 구매분` : null, `${it.date.slice(2)} 구매`, it.vendor, it.assignedAt ? `${it.assignedAt.slice(2)} 배정` : null, it.category, won(it.amount)].filter(Boolean).join(' · ')}
        value={it.qtyValue != null ? `${fmtQty(it.qtyValue)}${it.qtyUnit ?? '개'}` : `${it.count}건`}
        expanded={!mergeMode && it.count > 1 && expanded.has(it.id)}
        expand={
          <ul className="space-y-0.5 border-l-2 border-[var(--warm-border)] pl-2.5">
            {it.breakdown.map((b, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 text-[0.6875rem] text-[var(--warm-muted)]">
                <span className="tabular-nums">{b.date.slice(2)}{b.qty != null ? ` · ${fmtQty(b.qty)}${it.qtyUnit ?? '개'}` : ''}</span>
                <span className="tabular-nums">{won(b.amount)}</span>
              </li>
            ))}
          </ul>
        }
        actions={mergeMode ? undefined : (
          <>
            {it.count > 1 && (
              <button type="button" onClick={() => toggleExpand(it.id)}
                className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
                구매 {it.count}건 합산 {expanded.has(it.id) ? '▾ 접기' : '▸ 펼치기'}
              </button>
            )}
            {awaitingReceipt && rcvAsk === it.id ? (
              <>
                <span className="text-[0.6875rem] text-[var(--warm-muted)]">몇 {it.qtyUnit ?? '개'} 도착? (전체 {fmtQty(it.qtyValue ?? 0)}{it.qtyUnit ?? '개'})</span>
                <input autoFocus type="number" min={1} max={it.qtyValue ?? undefined} step="any"
                  value={rcvQty} disabled={pending}
                  onChange={e => setRcvQty(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') markReceived(it, true, Math.min(Number(rcvQty) || 1, it.qtyValue ?? 1)) }}
                  className="w-16 text-xs bg-[var(--canvas)] border border-[var(--coral)] rounded-sm px-2 py-1 text-[var(--warm-dark)] outline-none tabular-nums" />
                <button type="button" disabled={pending}
                  onClick={() => markReceived(it, true, Math.min(Number(rcvQty) || 1, it.qtyValue ?? 1))}
                  className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">수령</button>
                <button type="button" onClick={() => setRcvAsk(null)} disabled={pending} className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)]">취소</button>
              </>
            ) : awaitingReceipt ? (
              <button type="button" disabled={pending}
                onClick={() => {
                  // 수량 여러 개면 부분 수령 지원 — 몇 개 도착했는지 확인(기본 전체)
                  if (it.qtyValue != null && it.qtyValue > 1) { setRcvAsk(it.id); setRcvQty(fmtQty(it.qtyValue)) }
                  else markReceived(it, true)
                }}
                className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">
                수령 완료
              </button>
            ) : (
              <>
                <button type="button" onClick={() => markReceived(it, false)} disabled={pending}
                  className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">
                  수령대기로
                </button>
                {!placed && (
                  <button type="button" onClick={() => markCommon(it, !it.isCommon)} disabled={pending}
                    className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">
                    {it.isCommon ? '공용 해제' : '공용 자재로'}
                  </button>
                )}
                <button type="button" disabled={pending}
                  onClick={() => setMove({ it, to: '', qty: '', date: kstYmdStr(), src: '' })}
                  className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors disabled:opacity-40">
                  {placed ? '옮기기' : '배정하기'}
                </button>
                {siblings.length > 0 && (
                  <button type="button" onClick={() => openCardMerge(it, siblings)} disabled={pending}
                    className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">
                    합치기
                  </button>
                )}
              </>
            )}
          </>
        )}
      />
    </li>
  )

  const isEmpty = data.rooms.length === 0 && data.locations.length === 0 && data.unassigned.length === 0 && data.common.length === 0 && data.pending.length === 0

  // 검색 필터 — 표시만 거른다. 합치기 후보(siblings)는 원본 목록에서 찾아 검색 중에도 온전.
  const q = search.trim().toLowerCase()
  const hit = (it: AssetsData['pending'][number]) => !q || `${it.itemLabel} ${it.vendor ?? ''} ${it.category} ${it.specText ?? ''}`.toLowerCase().includes(q)
  const sumAmt = (l: AssetsData['pending']) => l.reduce((s, it) => s + it.amount, 0)
  const secOpen = (k: string) => !!q || openSecs.has(k)
  // 대분류 표시 — 검색 중엔 전 그룹 통합 검색
  const showUn = !!q || group === 'unassigned'
  const showCo = !!q || group === 'common'
  const showPl = !!q || group === 'placed'
  const secProps = (k: string) => ({ collapsible: true, collapsed: !secOpen(k), onToggle: () => toggleSec(k),
    trailing: <span className="text-[0.6875rem] text-[var(--warm-muted)]">{secOpen(k) ? '접기' : '펼치기'}</span> })
  const vPending    = data.pending.filter(hit)
  const vUnassigned = data.unassigned.filter(hit)
  const vCommon     = data.common.filter(hit)
  const vRooms      = data.rooms.map(g => ({ ...g, fItems: g.items.filter(hit) })).filter(g => g.fItems.length > 0)
  const vLocations  = data.locations.map(g => ({ ...g, fItems: g.items.filter(hit) })).filter(g => g.fItems.length > 0)
  const searchEmpty = !!q && vPending.length === 0 && vUnassigned.length === 0 && vCommon.length === 0 && vRooms.length === 0 && vLocations.length === 0

  // 선택 월 구매 요약 — 개별 구매 내역(breakdown) 기준. 배치 현황 자체는 월 무관(누적).
  const everyItem = [...data.pending, ...data.unassigned, ...data.common, ...data.rooms.flatMap(g => g.items), ...data.locations.flatMap(g => g.items)]
  const monthBuys = everyItem.flatMap(it => it.breakdown.filter(b => b.date.startsWith(targetMonth)))
  const monthLabel = `${Number(targetMonth.slice(5))}월`
  const boughtThisMonth = (it: AssetItem) => it.breakdown.some(b => b.date.startsWith(targetMonth))

  return (
    <div className="space-y-4">
      {/* 동일 레벨 탭 — 소모품·부식 / 비품·자재(현재) + 월 전환(§24.6 소모품과 동일 2줄 골격) */}
      <div className="flex flex-col items-start gap-2 md:flex-row md:justify-between">
        <ViewTabs ariaLabel="재고 탭" activeId="assets" tabs={[
          { id: 'consumables', label: '소모품·부식', href: '/inventory' },
          { id: 'assets',      label: '비품·자재',   href: '/inventory/assets' },
        ]} />
        <div className="self-end md:self-auto text-right">
          <MonthSelector />
          <p className="mt-0.5 text-[0.625rem] text-[var(--warm-muted)]">월은 &lsquo;이달 구매&rsquo; 요약에만 적용 — 아래 배치 현황은 누적</p>
        </div>
      </div>
      {/* 헤더 — 소모품 탭과 동일 골격: 제목 블록 → 버튼 줄 → 검색(§22.1) */}
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">재고 관리 · 비품·자재
            <InfoHint title="비품·자재란?">품목으로 산 내구재(의자·거치대·수선유지 자재 등)를 방·공용부별로 모아 봅니다. 여분(미배정)은 방이나 공용부(주방·화장실·복도 등)에 배정할 수 있습니다. 공용부는 &lsquo;위치 관리&rsquo;에서 추가합니다.</InfoHint>
          </h1>
          {mergeMode && <p className="text-xs text-[var(--coral)] mt-0.5">비품을 눌러 선택하면 방·공용부 일괄 배정, 합치기(대표로 통일)를 할 수 있어요</p>}
          <p className="text-xs mt-1">
            <span className="font-semibold text-[var(--warm-dark)]">{monthLabel} 구매</span>{' '}
            {monthBuys.length > 0
              ? <span className="text-[var(--warm-mid)] tabular-nums">{monthBuys.length}건 · {won(monthBuys.reduce((s, b) => s + b.amount, 0))}</span>
              : <span className="text-[var(--warm-muted)]">없음</span>}
            <span className="text-[var(--warm-muted)]"> · 배치 현황은 월 무관(누적)</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {!isEmpty && (
            <Btn variant="secondary" size="md" onClick={() => mergeMode ? exitMerge() : setMergeMode(true)}>
              {mergeMode ? '선택 취소' : '선택'}
            </Btn>
          )}
          <Btn variant="primary" size="md"
            onClick={() => setFreeForm({ label: '', cat: assetCats[0] ?? '비품', spec: '', specUnit: '', specText: '', qty: '1', qtyUnit: '개' })}>
            + 무상 입수
          </Btn>
        </div>
        {!isEmpty && <SearchBar value={search} onChange={setSearch} placeholder="품목명, 구매처, 카테고리 검색" />}
      </div>

      {isEmpty ? (
        <EmptyState
          title="비품·자재 내역이 아직 없습니다"
          description="지출 등록에서 품목으로 입력한 내구재(소모품 외 카테고리)가 여기에 모입니다."
        />
      ) : (
        <>
          {/* 대분류 — 미배정(여분) · 공용 자재 · 방·공용부 (검색 중엔 전체 통합 검색이라 숨김) */}
          {!q && (
            <SegmentedControl ariaLabel="비품 대분류" size="md" scroll value={group} onChange={pickGroup} options={[
              { value: 'unassigned', label: <>미배정(여분) <span className="mono text-[0.6875rem] text-[var(--warm-muted)]">{data.pending.length + data.unassigned.length}</span></> },
              { value: 'common', label: <>공용 자재 <span className="mono text-[0.6875rem] text-[var(--warm-muted)]">{data.common.length}</span></> },
              { value: 'placed', label: <>방·공용부 <span className="mono text-[0.6875rem] text-[var(--warm-muted)]">{data.rooms.length + data.locations.length}</span></> },
            ]} />
          )}
          {/* 수령 대기 — 주문했지만 아직 안 받은 비품 (미배정 그룹 맨 위) */}
          {searchEmpty && <EmptyState title="검색 결과가 없습니다" description="다른 검색어로 시도해 보세요." />}
          {showUn && vPending.length > 0 && (
            <section className="space-y-2">
              <SectionHeader name={<>수령 대기 <CoralTag>도착 전</CoralTag></>} count={`${vPending.length}건 · ${won(q ? sumAmt(vPending) : data.pendingTotal)}`} />
              <ul className="space-y-1.5">
                {vPending.map(it => <ItemRow key={it.id} it={it} placed={false} awaitingReceipt siblings={siblingsOf(data.pending, it)} />)}
              </ul>
            </section>
          )}

          {/* 미배정(여분) — 검색 중 무결과면 섹션 자체를 숨김 */}
          {showUn && (!q || vUnassigned.length > 0) && (
          <section className="space-y-2">
            <SectionHeader name="미배정 (여분)" count={`${vUnassigned.length}건 · ${won(q ? sumAmt(vUnassigned) : data.unassignedTotal)}`} />
            {vUnassigned.length === 0 ? (
              <p className="text-xs text-[var(--warm-muted)] bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-3 text-center">미배정 비품이 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {vUnassigned.map(it => <ItemRow key={it.id} it={it} placed={false} siblings={siblingsOf(data.unassigned, it)} />)}
              </ul>
            )}
          </section>
          )}

          {/* 공용 자재 — 페인트·공구 등 방/공용부 배분 안 하는 공용 비품 */}
          {showCo && (
            <section className="space-y-2">
              <SectionHeader name={<>공용 자재 <CoralTag>배분 안 함</CoralTag></>} count={`${vCommon.length}건 · ${won(q ? sumAmt(vCommon) : data.commonTotal)}`} />
              {vCommon.length === 0 ? (
                !q && <p className="text-xs text-[var(--warm-muted)] bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-3 text-center">공용 자재가 없습니다. 카드의 &lsquo;공용 자재로&rsquo;로 표시할 수 있어요.</p>
              ) : (
              <ul className="space-y-1.5">
                {vCommon.map(it => <ItemRow key={it.id} it={it} placed={false} siblings={siblingsOf(data.common, it)} />)}
              </ul>
              )}
            </section>
          )}

          {/* 방별 */}
          {showPl && !q && vRooms.length === 0 && vLocations.length === 0 && (
            <p className="text-xs text-[var(--warm-muted)] bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-3 text-center">방·공용부에 배정된 비품이 아직 없습니다. 미배정(여분)에서 &lsquo;배정하기&rsquo;를 눌러 옮겨보세요.</p>
          )}
          {showPl && vRooms.map(g => (
            <section key={g.roomId} className="space-y-2">
              <SectionHeader marker={<PinMarker />} name={fmtRoomNo(g.roomNo)} count={`${g.fItems.length}건 · ${won(q ? sumAmt(g.fItems) : g.total)}`} {...secProps('room:' + g.roomId)} />
              {secOpen('room:' + g.roomId) && (
              <ul className="space-y-1.5">
                {g.fItems.map(it => <ItemRow key={it.id} it={it} placed siblings={siblingsOf(g.items, it)} />)}
              </ul>
              )}
            </section>
          ))}

          {/* 공용부별 */}
          {showPl && vLocations.map(g => (
            <section key={g.locationId} className="space-y-2">
              <SectionHeader marker={<PinMarker />} name={<>{g.name} <CoralTag>공용부</CoralTag></>} count={`${g.fItems.length}건 · ${won(q ? sumAmt(g.fItems) : g.total)}`} {...secProps('loc:' + g.locationId)} />
              {secOpen('loc:' + g.locationId) && (
              <ul className="space-y-1.5">
                {g.fItems.map(it => <ItemRow key={it.id} it={it} placed siblings={siblingsOf(g.items, it)} />)}
              </ul>
              )}
            </section>
          ))}
        </>
      )}

      {/* 선택 모드 하단 알약 — §21.3 SelectionPillBar(탭 공용). ① 방·공용부 일괄 배정 ② 합치기(대표로 통일). */}
      {mergeMode && mergeSel.size > 0 && (
        <SelectionPillBar count={mergeSel.size} onClose={exitMerge}>
          {pillMode === 'menu' && (
            <>
              <PillButton primary onClick={() => setPillMode('assign')}>방·공용부 일괄 배정</PillButton>
              {mergeSel.size >= 2 && <PillButton onClick={openSelectionMerge}>합치기</PillButton>}
            </>
          )}
          {pillMode === 'assign' && (
            <>
              <select autoFocus defaultValue="" disabled={pending} onChange={e => onBatchPick(e.target.value)}
                className="h-9 max-w-[44vw] rounded-[9px] bg-white/[0.13] px-2 text-sm text-white outline-none">
                <option value="" disabled>방·공용부 선택…</option>
                <optgroup label="방">
                  {rooms.map(r => <option key={r.id} value={'room:' + r.id}>{fmtRoomNo(r.roomNo)}</option>)}
                </optgroup>
                {locations.length > 0 && (
                  <optgroup label="공용부">
                    {locations.map(l => <option key={l.id} value={'loc:' + l.id}>{l.name}</option>)}
                  </optgroup>
                )}
              </select>
              <PillButton onClick={() => setPillMode('menu')}>뒤로</PillButton>
            </>
          )}
        </SelectionPillBar>
      )}

      {/* 합치기 — §21.4 MergeSheet 단일(카드별·선택 공용). 방향 고지 + 적용취소는 환경설정 '품명 병합' */}
      {sheet && (
        <MergeSheet open onClose={() => setSheet(null)}
          sourceLabel={sheet.sourceLabel} targets={sheet.targets}
          description="대표(남을 품목) 기준으로 이름·사양이 통일돼 한 카드가 됩니다. 적용취소는 환경설정 ‘품명 병합’."
          onConfirm={sheet.onConfirm} pending={pending} />
      )}

      {/* 일괄 배정 수량 시트 — 품목별 배정 수량(기본 전량) + 적용취소(§10) */}
      {batchAssign && (
        <Modal
          open
          onClose={() => setBatchAssign(null)}
          title={`일괄 배정 · ${batchAssign.label}`}
          subtitle={`${batchAssign.rows.length}개 품목 · 품목별 배정 수량을 정하세요(기본 전량, 나머지는 여분 유지)`}
          width="sm"
          footer={
            <div className="flex gap-2 justify-end">
              <Btn variant="secondary" size="md" onClick={() => setBatchAssign(null)} disabled={pending}>취소</Btn>
              <Btn variant="primary" size="md" onClick={runBatchAssign} disabled={pending}>{pending ? '배정 중…' : '배정'}</Btn>
            </div>
          }
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--warm-mid)] shrink-0">배정일</span>
            <input type="date" value={batchAssign.assignedAt}
              onChange={e => setBatchAssign(b => b ? { ...b, assignedAt: e.target.value } : b)}
              className="h-9 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
            <span className="text-[0.625rem] text-[var(--warm-muted)]">기본 오늘 · 나중에 카드 상세에서도 수정 가능</span>
          </div>
          <ul className="space-y-2">
            {batchAssign.rows.map((r, idx) => {
              const max = r.it.qtyValue ?? 1
              return (
                <li key={r.it.id} className="flex items-center gap-2 rounded-md bg-[var(--cream)] border border-[var(--warm-border)] px-3 py-2">
                  <span className="flex-1 min-w-0 truncate text-sm text-[var(--warm-dark)]">{r.it.detail || r.it.itemLabel}</span>
                  <input type="number" min={1} max={max} step="any" value={r.qty} disabled={pending}
                    onChange={e => setBatchAssign(b => b ? { ...b, rows: b.rows.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x) } : b)}
                    className="w-16 text-sm bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-[var(--warm-dark)] outline-none tabular-nums focus:border-[var(--coral)]" />
                  <span className="text-xs text-[var(--warm-muted)] shrink-0">/ {fmtQty(max)}{r.it.qtyUnit ?? '개'}</span>
                </li>
              )
            })}
          </ul>
        </Modal>
      )}

      {/* 무상 비품 등록 — 0원 Expense(재고자산) + '무상' 배지 */}
      {freeForm && (
        <Modal
          open
          onClose={() => setFreeForm(null)}
          title="무상 비품 등록"
          subtitle="무상으로 생긴 비품을 0원으로 재고에 등록합니다 (재무 합계 영향 없음)"
          width="xs"
          footer={
            <div className="flex gap-2 justify-end">
              <Btn variant="secondary" size="md" onClick={() => setFreeForm(null)} disabled={pending}>취소</Btn>
              <Btn variant="primary" size="md" onClick={submitFree} disabled={pending}>{pending ? '등록 중…' : '등록'}</Btn>
            </div>
          }
        >
          <div className="space-y-3 px-5 sm:px-6 py-4">
            {/* 품목명 — 일부 입력 시 기존 비품명 추천(datalist) */}
            <label className="block">
              <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">품목명</span>
              <input value={freeForm.label} disabled={pending} autoFocus list="asset-labels"
                onChange={e => setFreeForm(f => f ? { ...f, label: e.target.value } : f)}
                placeholder="예: 의자, 수전 트랩"
                className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <datalist id="asset-labels">{assetLabels.map(l => <option key={l} value={l} />)}</datalist>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">분류</span>
              <input value={freeForm.cat} disabled={pending} list="asset-cats"
                onChange={e => setFreeForm(f => f ? { ...f, cat: e.target.value } : f)}
                className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <datalist id="asset-cats">{assetCats.map(c => <option key={c} value={c} />)}</datalist>
            </label>
            {/* 규격·수량 — 숫자 필드는 폭 고정으로 컴팩트(가로 정리) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">규격 <span className="text-[var(--warm-muted)] font-normal">(선택)</span>
                  <button type="button" onClick={() => setFreeWizOpen(true)}
                    className="ml-2 text-[0.625rem] font-semibold text-[var(--coral)] underline decoration-dotted underline-offset-2">단계별 입력</button>
                </span>
                <div className="flex gap-1.5">
                  <input value={freeForm.spec} disabled={pending} inputMode="decimal" placeholder="값"
                    onChange={e => setFreeForm(f => f ? { ...f, spec: e.target.value } : f)}
                    className="w-full min-w-0 h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 text-sm tabular-nums outline-none focus:border-[var(--coral)]" />
                  <input value={freeForm.specUnit} disabled={pending} placeholder="단위"
                    onChange={e => setFreeForm(f => f ? { ...f, specUnit: e.target.value } : f)}
                    className="w-12 shrink-0 h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 text-sm outline-none focus:border-[var(--coral)]" />
                </div>
              </div>
              <div>
                <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">수량</span>
                <div className="flex gap-1.5">
                  <input value={freeForm.qty} disabled={pending} inputMode="decimal"
                    onChange={e => setFreeForm(f => f ? { ...f, qty: e.target.value } : f)}
                    className="w-full min-w-0 h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 text-sm tabular-nums outline-none focus:border-[var(--coral)]" />
                  <input value={freeForm.qtyUnit} disabled={pending} placeholder="개"
                    onChange={e => setFreeForm(f => f ? { ...f, qtyUnit: e.target.value } : f)}
                    className="w-12 shrink-0 h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 text-sm outline-none focus:border-[var(--coral)]" />
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {freeForm && (
        <SpecWizard open={freeWizOpen} onClose={() => setFreeWizOpen(false)} onComplete={applyFreeWizard}
          itemLabel={freeForm.label || undefined} z={260} />
      )}

      {/* 비품 상세 풀화면 — §21.5 본문 탭 진입. 구매 내역(영수증별)·현재 상태·합치기 */}
      {detailItem && (() => {
        // 라이브 파생 — 옮긴 뒤에도 상세를 유지(연속 배정). 그 위치가 비면 같은 품목의 다른 위치 카드로 따라감.
        const candidates = allItems.filter(x => itemIdentity(x) === itemIdentity(detailItem))
        const it = allItems.find(x => x.id === detailItem.id)
          ?? candidates.find(samePlaceAs(detailItem))
          ?? candidates.sort((a, b) => (b.qtyValue ?? 0) - (a.qtyValue ?? 0))[0]
        if (!it) return null
        const loc = it.roomNo ? fmtRoomNo(it.roomNo) : it.locationName ? it.locationName : it.isCommon ? '공용 자재' : '미배정(여분)'
        const sibs = allItems.filter(s => s.id !== it.id && s.category === it.category)
        return (
          <Modal open onClose={() => setDetailItem(null)} title={it.itemLabel} width="md">
            <div className="space-y-4 p-5">
              <div>
                <p className="text-sm text-[var(--warm-dark)]">{it.detail || it.itemLabel}</p>
                <p className="mt-0.5 text-xs text-[var(--warm-muted)]">{it.category}{it.vendor ? ` · ${it.vendor}` : ''}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={it.roomNo || it.locationName ? 'pale-green' : 'neutral'}>{loc}</Badge>
                {it.isCommon && <Badge tone="inspect">공용 자재</Badge>}
                <span className="text-xs text-[var(--warm-muted)]">총 {fmtQty(it.qtyValue ?? 0)}{it.qtyUnit ?? '개'} · {won(it.amount)} · 구매 {it.count}건</span>
                {/* 잘못 배정 즉시 수정 — 옮기기 모달 직행(운영자 요청 2026-07-08 단순화) */}
                <button type="button"
                  onClick={() => setMove({ it, to: '', qty: '', date: kstYmdStr(), src: '' })}
                  className="min-h-[30px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors">
                  {it.roomNo || it.locationName ? '옮기기' : '배정하기'}
                </button>
              </div>
              {(it.roomNo || it.locationName) && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-[var(--warm-mid)] shrink-0">이 위치 수량</span>
                  <input inputMode="decimal" disabled={pending}
                    value={adjQty?.id === it.id ? adjQty.v : ''}
                    placeholder={fmtQty(it.qtyValue ?? 0)}
                    onChange={e => setAdjQty({ id: it.id, v: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter' && adjQty?.id === it.id) runAdjustQty(it, adjQty.v) }}
                    className="w-20 h-9 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 text-sm tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                  <span className="text-xs text-[var(--warm-mid)]">{it.qtyUnit ?? '개'}</span>
                  <button type="button"
                    disabled={pending || !(adjQty?.id === it.id && adjQty.v.trim() !== '' && Number(adjQty.v) !== (it.qtyValue ?? 0))}
                    onClick={() => adjQty && runAdjustQty(it, adjQty.v)}
                    className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-35">저장</button>
                  <span className="text-[0.625rem] text-[var(--warm-muted)]">줄이면 여분으로, 늘리면 여분에서 가져와요</span>
                </div>
              )}
              {(it.roomNo || it.locationName) && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--warm-mid)] shrink-0">배정일</span>
                  <input key={it.assignedAt ?? 'none'} type="date" defaultValue={it.assignedAt ?? ''} disabled={pending}
                    onChange={e => saveAssignedAt(it, e.target.value)}
                    className="h-9 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                  {it.assignedAt
                    ? <button type="button" onClick={() => saveAssignedAt(it, '')} disabled={pending}
                        className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors">비우기</button>
                    : <span className="text-[0.6875rem] text-[var(--warm-muted)]">미상</span>}
                  <span className="text-[0.625rem] text-[var(--warm-muted)]">날짜를 고르면 바로 저장돼요</span>
                </div>
              )}
              {(() => {
                const places = allItems.filter(s => itemIdentity(s) === itemIdentity(it))
                if (places.length <= 1) return null
                const rank = (x: AssetItem) => x.roomNo ? 1 : x.locationName ? 2 : x.isCommon ? 3 : 0
                const sorted = [...places].sort((a, b) => rank(a) - rank(b) || (a.roomNo ?? a.locationName ?? '').localeCompare(b.roomNo ?? b.locationName ?? ''))
                const totalQ = sorted.reduce((s, x) => s + (x.qtyValue ?? 0), 0)
                return (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-[var(--warm-mid)]">배치 현황
                      <span className="ml-1.5 font-normal text-[var(--warm-muted)]">총 {fmtQty(totalQ)}{it.qtyUnit ?? '개'} · {sorted.length}곳</span>
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {sorted.map(pl => {
                        const isCur = pl.id === it.id
                        const isPending = data.pending.some(x => x.id === pl.id)
                        return (
                          <li key={pl.id}>
                            <button type="button" onClick={() => { if (!isCur) setDetailItem(pl) }}
                              className={[
                                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                                isCur
                                  ? 'border-[var(--coral)] bg-[var(--coral)]/10 text-[var(--warm-dark)] cursor-default'
                                  : 'border-[var(--warm-border)] bg-[var(--cream)] text-[var(--warm-mid)] hover:border-[var(--coral)]/50 hover:text-[var(--warm-dark)]',
                              ].join(' ')}>
                              {curPlace(pl)}{isPending ? ' (수령 대기)' : ''}
                              <span className="mono font-semibold tabular-nums">{fmtQty(pl.qtyValue ?? pl.count)}{it.qtyUnit ?? '개'}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="mt-1 text-[0.625rem] text-[var(--warm-muted)]">눌러서 그 위치 카드로 이동할 수 있어요</p>
                  </div>
                )
              })()}
              <div>
                <p className="mb-1.5 text-xs font-semibold text-[var(--warm-mid)]">구매 내역</p>
                <ul className="space-y-1.5">
                  {it.breakdown.map(b => {
                    const s = rowSpec[b.id] ?? { v: b.specValue != null ? String(b.specValue) : '', u: b.specUnit ?? '', t: b.specText ?? '' }
                    const changed = s.v !== (b.specValue != null ? String(b.specValue) : '') || s.u !== (b.specUnit ?? '') || s.t !== (b.specText ?? '')
                    return (
                      <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="tabular-nums text-[var(--warm-mid)] shrink-0">{b.date}{b.qty != null ? ` · ${fmtQty(b.qty)}${it.qtyUnit ?? '개'}` : ''}</span>
                        <span className="flex items-center gap-1.5 min-w-0">
                          <input value={s.v} disabled={pending} inputMode="decimal" placeholder="규격"
                            onChange={e => setRowSpec(p => ({ ...p, [b.id]: { ...s, v: e.target.value } }))}
                            className="w-14 h-8 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-1.5 text-xs tabular-nums outline-none focus:border-[var(--coral)]" />
                          <input value={s.u} disabled={pending} placeholder="단위"
                            onChange={e => setRowSpec(p => ({ ...p, [b.id]: { ...s, u: e.target.value } }))}
                            className="w-12 h-8 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-1.5 text-xs outline-none focus:border-[var(--coral)]" />
                          <input value={s.t} disabled={pending} placeholder="서술(선택)"
                            onChange={e => setRowSpec(p => ({ ...p, [b.id]: { ...s, t: e.target.value } }))}
                            className="w-20 h-8 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-1.5 text-xs outline-none focus:border-[var(--coral)]" />
                          {changed && (
                            <button type="button" onClick={() => saveRowSpec(b)} disabled={pending}
                              className="min-h-[34px] inline-flex items-center px-2 text-[0.6875rem] font-semibold text-[var(--coral)] hover:underline shrink-0">저장</button>
                          )}
                          <span className="tabular-nums text-[var(--warm-dark)] shrink-0">{won(b.amount)}</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-1 text-[0.625rem] text-[var(--warm-muted)]">규격(사이즈·용량)이 서로 다르면 별도 카드로 분리돼 따로 배정할 수 있습니다.</p>
              </div>
              {logRows.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-[var(--warm-mid)]">배정 변경 이력</p>
                  <p className="mb-1.5 text-[0.625rem] text-[var(--warm-muted)]">되돌리기 = 그 이동을 원상복구하고 이력도 지웁니다 · 지우기 = 기록만 지웁니다</p>
                  <ul className="space-y-1">
                    {logRows.map(r => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-[var(--warm-dark)]">{r.fromLabel ?? '미배정'} <span className="text-[var(--warm-muted)]">→</span> {r.toLabel ?? '미배정'}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="tabular-nums text-[var(--warm-muted)]">{r.qty != null ? `${fmtQty(r.qty)}${it.qtyUnit ?? '개'} · ` : ''}{(r.assignedAt ?? r.createdAt).slice(2)}</span>
                          <button type="button" onClick={() => runRevertLog(r)} disabled={pending}
                            className="min-h-[30px] inline-flex items-center px-1.5 text-[0.6875rem] font-semibold text-[var(--coral)] hover:underline disabled:opacity-40">되돌리기</button>
                          <button type="button" onClick={() => runDeleteLog(r)} disabled={pending}
                            className="min-h-[30px] inline-flex items-center px-1 text-[0.6875rem] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-40">지우기</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {sibs.length > 0 && (
                <button type="button" onClick={() => { setDetailItem(null); openCardMerge(it, sibs) }}
                  className="w-full rounded-xl border border-[var(--warm-border)] py-2.5 text-sm font-semibold text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">
                  다른 품목과 합치기
                </button>
              )}
            </div>
          </Modal>
        )
      })()}

      {/* 위치 옮기기 — 단일 흐름: 어디로 + 얼마나 + 배정일 + 미리보기 (§ 재고 옮기기와 동일 문법) */}
      {move && (() => {
        const it = moveSrc ?? move.it
        const buys = buysOf(it)
        const buyDates = [...buys.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        const buy = move.src ? buys.get(move.src) : undefined
        const max = buy ? buy.qty : (it.qtyValue ?? 1)
        const unit = it.qtyUnit ?? '개'
        const qNum = Number(move.qty)
        const q = move.qty === '' ? max : qNum > 0 ? Math.min(qNum, max) : 0
        const over = qNum > max
        const from = curPlace(it)
        const toNone = move.to === ''
        const dest = toNone ? '미배정(여분)' : placeName(move.to)
        const same = (toNone && !it.roomId && !it.locationId && !it.isCommon)
          || (!!it.roomId && move.to === `room:${it.roomId}`)
          || (!!it.locationId && move.to === `loc:${it.locationId}`)
        return (
          <Modal open onClose={() => setMove(null)} z={260} width="xs"
            title={`옮기기 · ${it.itemLabel}`}
            subtitle={`지금 ${from}에 ${fmtQty(max)}${unit} 있습니다`}
            footer={
              <div className="flex gap-2 justify-end">
                <Btn variant="secondary" size="md" onClick={() => setMove(null)} disabled={pending}>취소</Btn>
                <Btn variant="primary" size="md" onClick={runMove} disabled={pending || over || same || q <= 0}>
                  {pending ? '옮기는 중…' : '옮기기'}
                </Btn>
              </div>
            }>
            <div className="space-y-3 px-5 sm:px-6 py-4">
              <label className="block">
                <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">어디로 옮길까요?</span>
                <select value={move.to} disabled={pending}
                  onChange={e => setMove(m => m ? { ...m, to: e.target.value } : m)}
                  className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="">미배정(여분)으로</option>
                  <optgroup label="방">
                    {rooms.map(r => <option key={r.id} value={'room:' + r.id}>{fmtRoomNo(r.roomNo)}</option>)}
                  </optgroup>
                  {locations.length > 0 && (
                    <optgroup label="공용부">
                      {locations.map(l => <option key={l.id} value={'loc:' + l.id}>{l.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
              {buyDates.length > 1 && (
                <label className="block">
                  <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">어느 구매분에서 뺄까요?</span>
                  <select value={move.src && buys.has(move.src) ? move.src : ''} disabled={pending}
                    onChange={e => setMove(m => m ? { ...m, src: e.target.value, qty: '' } : m)}
                    className="w-full h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    <option value="">오래된 구매분부터 자동</option>
                    {buyDates.map(([d, g]) => (
                      <option key={d} value={d}>{d.slice(2)} 구매분 · {fmtQty(g.qty)}{unit}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">얼마나?</span>
                <div className="flex items-center gap-1.5">
                  <input value={move.qty} disabled={pending} inputMode="decimal" placeholder={`전량(${fmtQty(max)})`}
                    onChange={e => setMove(m => m ? { ...m, qty: e.target.value } : m)}
                    className="w-24 h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 text-sm tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                  <span className="text-sm text-[var(--warm-mid)]">{unit}</span>
                  <button type="button" disabled={pending}
                    onClick={() => setMove(m => m ? { ...m, qty: fmtQty(max) } : m)}
                    className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">전부</button>
                </div>
                {over && <p className="mt-1 text-[0.6875rem] text-[var(--danger-fg)]">지금 있는 수량({fmtQty(max)}{unit})보다 많아요.</p>}
              </label>
              {!toNone && (
                <label className="block">
                  <span className="block text-xs font-medium text-[var(--warm-mid)] mb-1">배정일 <span className="text-[var(--warm-muted)] font-normal">(기본 오늘 · 나중에 수정 가능)</span></span>
                  <input type="date" value={move.date} disabled={pending}
                    onChange={e => setMove(m => m ? { ...m, date: e.target.value } : m)}
                    className="h-10 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                </label>
              )}
              <div className="rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] px-3 py-2.5 text-xs">
                <p className="font-semibold text-[var(--warm-mid)] mb-0.5">이렇게 바뀝니다</p>
                {same
                  ? <p className="text-[var(--warm-muted)]">지금 있는 곳과 같은 곳입니다. 다른 곳을 골라주세요.</p>
                  : <p className="text-[var(--warm-dark)]">{from} → <span className="font-semibold">{dest}</span> · {q > 0 ? `${fmtQty(q)}${unit}` : '수량을 입력하세요'}{q > 0 && q < max ? ` (나머지 ${fmtQty(Math.round((max - q) * 1000) / 1000)}${unit}는 ${from}에 남음)` : ''}</p>}
                {q > 0 && !same && (
                  <p className="mt-0.5 text-[var(--warm-muted)]">{buy ? `${move.src.slice(2)} 구매분에서 차감` : buyDates.length > 1 ? '오래된 구매분부터 차감' : ''}</p>
                )}
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}