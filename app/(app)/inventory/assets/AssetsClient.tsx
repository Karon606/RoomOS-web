'use client'

// 비품·자재 — 소모품 재고와 별개로, 품목으로 산 내구재(의자·거치대·수선유지 자재 등)를
// 방별 / 공용부(위치)별 / 미배정(여분)으로 보여주고, 미배정 아이템을 방·공용부에 배정한다.
// 수량 2개 이상이면 몇 개 배정할지 물어 분할(나머지 여분 유지). 배정해제 시 같은 묶음 재병합.

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { assignAggregateToTarget, setCommonAsset, setAssetReceived, combineAssets, type AssetsData, type AssetItem } from './actions'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

const won = (n: number) => n.toLocaleString('ko-KR') + '원'
const fmtRoomNo = (no: string) => (/^\d+$/.test(no) ? `${no}호` : no)
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))

type Target = { kind: 'room' | 'location'; id: string }

export default function AssetsClient({ data, rooms, locations }: {
  data: AssetsData
  rooms: { id: string; roomNo: string }[]
  locations: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [picking, setPicking] = useState<string | null>(null)   // 배정 picker 가 열린 항목 id
  const [qtyAsk, setQtyAsk] = useState<{ it: AssetItem; target: Target; label: string } | null>(null)
  const [qtyVal, setQtyVal] = useState('1')
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())   // 합산 펼친 항목 id
  const toggleExpand = (id: string) => setExpanded(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  // 선택 모드 — 여러 비품을 골라 방·공용부에 일괄 배정. (소모품 '선택 → 위치 일괄 할당'과 동일 패턴.)
  // 같은 품목 합치기(병합)는 소모품과 동일하게 '카드별 합치기'(아래 ItemRow)로 한다.
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSel, setMergeSel]   = useState<Set<string>>(new Set())   // 선택된 AssetItem id
  const [pillMode, setPillMode] = useState<'menu' | 'assign'>('menu')   // 하단 바 단계
  const exitMerge = () => { setMergeMode(false); setMergeSel(new Set()); setPillMode('menu') }
  const toggleMergeSel = (id: string) => setMergeSel(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })
  const allItems = useMemo(() => [
    ...data.pending, ...data.unassigned, ...data.common,
    ...data.rooms.flatMap(r => r.items), ...data.locations.flatMap(l => l.items),
  ], [data])
  const selItems = useMemo(() => allItems.filter(it => mergeSel.has(it.id)), [allItems, mergeSel])

  // 카드별 합치기 — 같은 구역·분류의 다른 카드(대상=남길 카드)로 이 품목을 통일(병합). 소모품 '다른 카드와 병합'과 동일.
  const [combining, setCombining] = useState<string | null>(null)   // 합치기 picker 열린 항목 id
  const [combineDest, setCombineDest] = useState('')                // 선택된 대상 카드 id
  const doCombine = (src: AssetItem, dest: AssetItem) => {
    startTransition(async () => {
      const res = await combineAssets(dest.id, src.ids)
      setCombining(null); setCombineDest('')
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `'${dest.itemLabel}'(으)로 합쳐짐`)
      router.refresh()
    })
  }
  const askCombine = async (src: AssetItem, dest: AssetItem) => {
    const ok = await confirmDialog({
      title: '이 비품을 합칠까요?',
      message: `'${src.itemLabel}' 카드를 '${dest.detail || dest.itemLabel}'(으)로 합칩니다. 이름·사양이 대상 기준으로 통일돼 한 카드가 됩니다. (환경설정 '품명 병합'에서 적용취소)`,
      confirmLabel: '합치기',
    })
    if (ok) doCombine(src, dest)
  }
  // 같은 구역·분류의 다른 카드(합치기 대상 후보)
  const siblingsOf = (list: AssetItem[], it: AssetItem) => list.filter(s => s.id !== it.id && s.category === it.category)
  // 선택한 비품들을 한 방·공용부에 일괄 배정(각 품목 전체 수량). 부분 수량은 개별 '배정'에서.
  const doBatchAssign = (target: Target, label: string) => {
    if (selItems.length === 0) return
    startTransition(async () => {
      let ok = 0
      for (const it of selItems) {
        const res = await assignAggregateToTarget(it.ids, target, null)
        if (res.ok) ok++
      }
      pushToast(ok === selItems.length ? 'success' : 'error', `${label}에 ${ok}/${selItems.length}개 배정됨`)
      exitMerge(); router.refresh()
    })
  }
  // 하단 바 방 선택 — 'room:id' | 'loc:id'
  const onBatchPick = (v: string) => {
    if (!v) return
    const [k, id] = v.split(':')
    const label = k === 'room'
      ? fmtRoomNo(rooms.find(r => r.id === id)?.roomNo ?? '')
      : (locations.find(l => l.id === id)?.name ?? '')
    doBatchAssign({ kind: k === 'room' ? 'room' : 'location', id }, label)
  }

  // 배정 해제(미배정으로) — 묶음(ids) 전체
  const unassign = (it: AssetItem) => {
    startTransition(async () => {
      const res = await assignAggregateToTarget(it.ids, { kind: 'none' }, null)
      setPicking(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '배정 해제됨')
      router.refresh()
    })
  }

  // 통째 배정 — 묶음 전체
  const assignWhole = (it: AssetItem, target: Target, label: string) => {
    startTransition(async () => {
      const res = await assignAggregateToTarget(it.ids, target, null)
      setPicking(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `${label}에 배정됨`)
      router.refresh()
    })
  }

  // 대상 선택 — 수량 2개 이상이면 몇 개 배정할지 물어봄(기본 1), 아니면 통째
  const onPickTarget = (it: AssetItem, value: string) => {
    setPicking(null)
    if (!value) { unassign(it); return }
    const [kind, id] = value.split(':')
    const target: Target = { kind: kind === 'room' ? 'room' : 'location', id }
    const label = kind === 'room'
      ? fmtRoomNo(rooms.find(r => r.id === id)?.roomNo ?? '')
      : (locations.find(l => l.id === id)?.name ?? '공용부')
    const qty = it.qtyValue ?? 0
    if (qty >= 2) { setQtyVal('1'); setQtyAsk({ it, target, label }) }
    else assignWhole(it, target, label)
  }

  const confirmPartial = () => {
    if (!qtyAsk) return
    const max = qtyAsk.it.qtyValue ?? 1
    let q = Number(qtyVal)
    if (!(q > 0)) q = 1
    if (q > max) q = max
    const { it, target, label } = qtyAsk
    startTransition(async () => {
      const res = await assignAggregateToTarget(it.ids, target, q)
      setQtyAsk(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', q >= (it.qtyValue ?? 0) ? `${label}에 전체 배정됨` : `${label}에 ${fmtQty(q)}${it.qtyUnit ?? '개'} 배정됨`)
      router.refresh()
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

  // 수령 상태 토글 (수령 완료 / 수령 대기로)
  const markReceived = (it: AssetItem, value: boolean) => {
    startTransition(async () => {
      const res = await setAssetReceived(it.ids, value)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', value ? '수령 완료' : '수령 대기로 변경됨')
      router.refresh()
    })
  }

  const currentValue = (it: AssetItem) =>
    it.roomId ? `room:${it.roomId}` : it.locationId ? `loc:${it.locationId}` : ''

  const ItemRow = ({ it, placed, awaitingReceipt, siblings = [] }: { it: AssetItem; placed: boolean; awaitingReceipt?: boolean; siblings?: AssetItem[] }) => (
    <li
      className={`bg-[var(--cream)] border rounded-xl px-3.5 py-2.5 transition-colors ${mergeMode ? (mergeSel.has(it.id) ? 'cursor-pointer border-[var(--coral)] ring-2 ring-[var(--coral)]/30' : 'cursor-pointer border-[var(--warm-border)] hover:border-[var(--coral)]/50') : 'border-[var(--warm-border)]'}`}
      onClick={mergeMode ? () => toggleMergeSel(it.id) : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--warm-dark)] truncate">{it.detail || it.itemLabel}</p>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">
            {it.date.slice(2)} · {it.category}{it.vendor ? ` · ${it.vendor}` : ''}
          </p>
          {!mergeMode && it.count > 1 && (
            <button type="button" onClick={() => toggleExpand(it.id)}
              className="mt-0.5 text-[0.625rem] text-[var(--coral)] hover:underline">
              구매 {it.count}건 합산 {expanded.has(it.id) ? '▾ 접기' : '▸ 펼치기'}
            </button>
          )}
        </div>
        {mergeMode ? (
          <span className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-[0.6875rem] ${mergeSel.has(it.id) ? 'bg-[var(--coral)] border-[var(--coral)] text-white' : 'border-[var(--warm-border)] text-transparent'}`}>✓</span>
        ) : (
          <span className="shrink-0 text-sm font-semibold text-[var(--danger-fg)] tabular-nums">{won(it.amount)}</span>
        )}
      </div>
      {!mergeMode && it.count > 1 && expanded.has(it.id) && (
        <ul className="mt-1.5 pl-2.5 border-l-2 border-[var(--warm-border)] space-y-0.5">
          {it.breakdown.map((b, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-[0.6875rem] text-[var(--warm-muted)]">
              <span className="tabular-nums">{b.date.slice(2)}{b.qty != null ? ` · ${fmtQty(b.qty)}${it.qtyUnit ?? '개'}` : ''}</span>
              <span className="tabular-nums">{won(b.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {!mergeMode && (
      <div className="mt-1.5 flex items-center justify-end gap-1.5 flex-wrap">
        {awaitingReceipt ? (
          <button type="button" onClick={() => markReceived(it, true)} disabled={pending}
            className="text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">
            수령 완료
          </button>
        ) : qtyAsk?.it.id === it.id ? (
          <>
            <span className="text-[0.6875rem] text-[var(--warm-muted)]">
              {qtyAsk.label}에 (전체 {fmtQty(it.qtyValue ?? 0)}{it.qtyUnit ?? '개'} 중)
            </span>
            <input autoFocus type="number" min={1} max={it.qtyValue ?? undefined} step="any"
              value={qtyVal} disabled={pending}
              onChange={e => setQtyVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmPartial() }}
              className="w-16 text-xs bg-[var(--canvas)] border border-[var(--coral)] rounded-lg px-2 py-1 text-[var(--warm-dark)] outline-none tabular-nums" />
            <span className="text-[0.6875rem] text-[var(--warm-muted)]">{it.qtyUnit ?? '개'}</span>
            <button type="button" onClick={confirmPartial} disabled={pending}
              className="text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">배정</button>
            <button type="button" onClick={() => setQtyAsk(null)} disabled={pending} className="text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)]">취소</button>
          </>
        ) : picking === it.id ? (
          <>
            <select autoFocus disabled={pending} defaultValue={currentValue(it)}
              onChange={e => onPickTarget(it, e.target.value)}
              className="text-xs bg-[var(--canvas)] border border-[var(--coral)] rounded-lg px-2 py-1 text-[var(--warm-dark)] outline-none max-w-[60vw]">
              <option value="">미배정(여분)</option>
              <optgroup label="방">
                {rooms.map(r => <option key={r.id} value={`room:${r.id}`}>{fmtRoomNo(r.roomNo)}</option>)}
              </optgroup>
              {locations.length > 0 && (
                <optgroup label="공용부">
                  {locations.map(l => <option key={l.id} value={`loc:${l.id}`}>{l.name}</option>)}
                </optgroup>
              )}
            </select>
            <button type="button" onClick={() => setPicking(null)} className="text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)]">취소</button>
          </>
        ) : combining === it.id ? (
          <>
            <select autoFocus disabled={pending} value={combineDest}
              onChange={e => setCombineDest(e.target.value)}
              className="text-xs bg-[var(--canvas)] border border-[var(--coral)] rounded-lg px-2 py-1 text-[var(--warm-dark)] outline-none max-w-[60vw]">
              <option value="">합칠 대상(남길 품목)…</option>
              {siblings.map(s => <option key={s.id} value={s.id}>{s.detail || s.itemLabel}</option>)}
            </select>
            <button type="button" disabled={pending || !combineDest}
              onClick={() => { const dest = siblings.find(s => s.id === combineDest); if (dest) askCombine(it, dest) }}
              className="text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">합치기</button>
            <button type="button" onClick={() => { setCombining(null); setCombineDest('') }} className="text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)]">취소</button>
          </>
        ) : (
          <>
            {/* 수령대기로 되돌리기 (적용취소) */}
            <button type="button" onClick={() => markReceived(it, false)} disabled={pending}
              className="text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">
              수령대기로
            </button>
            {/* 공용 자재 토글 — 미배정/공용 자재에서만 (방·공용부 배정된 건 제외) */}
            {!placed && (
              <button type="button" onClick={() => markCommon(it, !it.isCommon)} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">
                {it.isCommon ? '공용 해제' : '공용 자재로'}
              </button>
            )}
            <button type="button" onClick={() => setPicking(it.id)} disabled={pending}
              className="text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors disabled:opacity-40">
              {placed ? '배정 변경' : '배정'}
            </button>
            {/* 같은 구역·분류의 다른 카드로 합치기 (소모품 '다른 카드와 병합'과 동일) */}
            {siblings.length > 0 && (
              <button type="button" onClick={() => { setCombining(it.id); setCombineDest('') }} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">
                합치기
              </button>
            )}
          </>
        )}
      </div>
      )}
    </li>
  )

  const isEmpty = data.rooms.length === 0 && data.locations.length === 0 && data.unassigned.length === 0 && data.common.length === 0 && data.pending.length === 0

  return (
    <div className="space-y-5 px-4 sm:px-6 py-5">
      {/* 동일 레벨 탭 — 소모품·부식 / 비품·자재(현재) */}
      <div className="inline-flex rounded-xl border border-[var(--warm-border)] overflow-hidden text-sm font-medium">
        <button type="button" onClick={() => router.push('/inventory')}
          className="px-4 py-2 bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">소모품·부식</button>
        <button type="button" className="px-4 py-2 bg-[var(--coral)] text-white">비품·자재</button>
      </div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-[var(--warm-dark)]">재고 관리 · 비품·자재</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">
            품목으로 산 내구재(의자·거치대·수선유지 자재 등)를 방·공용부별로 모아 봅니다. 여분(미배정)은 방이나 공용부(주방·화장실·복도 등)에 배정할 수 있습니다. <span className="text-[var(--warm-mid)]">공용부는 ‘위치 관리’에서 추가합니다.</span>
            {mergeMode && <span className="text-[var(--coral)]"> · 비품을 눌러 선택 → 방·공용부에 일괄 배정. (같은 품목 합치기는 각 카드의 ‘합치기’)</span>}
          </p>
        </div>
        {!isEmpty && (
          <Btn variant="secondary" size="sm" onClick={() => mergeMode ? exitMerge() : setMergeMode(true)}>
            {mergeMode ? `선택 취소${mergeSel.size > 0 ? ` (${mergeSel.size})` : ''}` : '선택'}
          </Btn>
        )}
      </div>

      {isEmpty ? (
        <EmptyState
          title="비품·자재 내역이 아직 없습니다"
          description="지출 등록에서 품목으로 입력한 내구재(소모품 외 카테고리)가 여기에 모입니다."
        />
      ) : (
        <>
          {/* 수령 대기 — 주문했지만 아직 안 받은 비품 (맨 위) */}
          {data.pending.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                수령 대기 <span className="text-[0.625rem] text-[var(--coral)] font-normal">도착 전</span> <span className="text-[var(--warm-muted)] font-normal">{data.pending.length}건 · {won(data.pendingTotal)}</span>
              </h2>
              <ul className="space-y-1.5">
                {data.pending.map(it => <ItemRow key={it.id} it={it} placed={false} awaitingReceipt siblings={siblingsOf(data.pending, it)} />)}
              </ul>
            </section>
          )}

          {/* 미배정(여분) — 먼저 */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
              미배정 (여분) <span className="text-[var(--warm-muted)] font-normal">{data.unassigned.length}건 · {won(data.unassignedTotal)}</span>
            </h2>
            {data.unassigned.length === 0 ? (
              <p className="text-xs text-[var(--warm-muted)] bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-3 text-center">미배정 비품이 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.unassigned.map(it => <ItemRow key={it.id} it={it} placed={false} siblings={siblingsOf(data.unassigned, it)} />)}
              </ul>
            )}
          </section>

          {/* 공용 자재 — 페인트·공구 등 방/공용부 배분 안 하는 공용 비품 */}
          {data.common.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                공용 자재 <span className="text-[0.625rem] text-[var(--coral)] font-normal">배분 안 함</span> <span className="text-[var(--warm-muted)] font-normal">{data.common.length}건 · {won(data.commonTotal)}</span>
              </h2>
              <ul className="space-y-1.5">
                {data.common.map(it => <ItemRow key={it.id} it={it} placed={false} siblings={siblingsOf(data.common, it)} />)}
              </ul>
            </section>
          )}

          {/* 방별 */}
          {data.rooms.map(g => (
            <section key={g.roomId} className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                {fmtRoomNo(g.roomNo)} <span className="text-[var(--warm-muted)] font-normal">{g.items.length}건 · {won(g.total)}</span>
              </h2>
              <ul className="space-y-1.5">
                {g.items.map(it => <ItemRow key={it.id} it={it} placed siblings={siblingsOf(g.items, it)} />)}
              </ul>
            </section>
          ))}

          {/* 공용부별 */}
          {data.locations.map(g => (
            <section key={g.locationId} className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                {g.name} <span className="text-[0.625rem] text-[var(--coral)] font-normal">공용부</span> <span className="text-[var(--warm-muted)] font-normal">{g.items.length}건 · {won(g.total)}</span>
              </h2>
              <ul className="space-y-1.5">
                {g.items.map(it => <ItemRow key={it.id} it={it} placed siblings={siblingsOf(g.items, it)} />)}
              </ul>
            </section>
          ))}
        </>
      )}

      {/* 선택 바 — 소모품 '선택 → 위치 일괄 할당'과 동일한 다크 플로팅 알약(방·공용부 일괄 배정 단일 액션).
          배정 적용취소는 각 품목에서. 같은 품목 합치기는 각 카드의 '합치기'(적용취소: 환경설정 '품명 병합'). */}
      {mergeMode && mergeSel.size > 0 && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+56px)] md:bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="flex items-center gap-2 bg-[var(--ink)] text-[var(--canvas)] rounded-xl px-4 py-3 shadow-lift pointer-events-auto mx-4 max-w-[calc(100vw-24px)]">
            <span className="text-sm font-medium whitespace-nowrap">{mergeSel.size}개 선택</span>
            <div className="w-px h-4 bg-[var(--canvas)]/20" />
            {pillMode === 'menu' && (
              <button type="button" onClick={() => setPillMode('assign')}
                className="text-sm font-semibold text-[var(--coral)] hover:text-[var(--coral-dark)] transition-colors whitespace-nowrap">방·공용부 일괄 배정</button>
            )}
            {pillMode === 'assign' && (
              <>
                <select autoFocus defaultValue="" disabled={pending}
                  onChange={e => onBatchPick(e.target.value)}
                  className="bg-white/15 text-[var(--canvas)] rounded-lg px-2 py-1.5 text-sm outline-none max-w-[44vw]">
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
                <button type="button" onClick={() => setPillMode('menu')} className="text-sm px-2 py-1.5 text-[var(--canvas)]/70 hover:text-[var(--canvas)]">뒤로</button>
              </>
            )}
            <button type="button" onClick={exitMerge}
              className="text-sm px-3 py-1.5 rounded-xl bg-white/15 text-[var(--canvas)] hover:bg-white/25 transition-colors">취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
