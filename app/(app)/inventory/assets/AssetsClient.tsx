'use client'

// 비품·자재 — 소모품 재고와 별개로, 품목으로 산 내구재(의자·거치대·수선유지 자재 등)를
// 방별 / 공용부(위치)별 / 미배정(여분)으로 보여주고, 미배정 아이템을 방·공용부에 배정한다.
// 수량 2개 이상이면 몇 개 배정할지 물어 분할(나머지 여분 유지). 배정해제 시 같은 묶음 재병합.

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/EmptyState'
import { pushToast } from '@/lib/saveStatus'
import { assignAggregateToTarget, setCommonAsset, setAssetReceived, type AssetsData, type AssetItem } from './actions'
import { mergeItemNames } from '@/app/(app)/finance/actions'   // 비품 품명 병합(통일) — 환경설정 AI 병합과 동일 엔진

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

  // 품명 병합 모드 — 실제 같은 품목인데 이름이 달라 따로 잡힌 것들을 선택해 한 이름으로 통일.
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSel, setMergeSel]   = useState<Set<string>>(new Set())   // 선택된 AssetItem id
  const [mergeCanon, setMergeCanon] = useState('')
  const exitMerge = () => { setMergeMode(false); setMergeSel(new Set()); setMergeCanon('') }
  const toggleMergeSel = (id: string) => setMergeSel(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })
  const allItems = useMemo(() => [
    ...data.pending, ...data.unassigned, ...data.common,
    ...data.rooms.flatMap(r => r.items), ...data.locations.flatMap(l => l.items),
  ], [data])
  const mergeLabels = useMemo(
    () => [...new Set(allItems.filter(it => mergeSel.has(it.id)).map(it => it.itemLabel).filter(Boolean))],
    [allItems, mergeSel],
  )
  const doMerge = () => {
    if (mergeLabels.length < 2) { pushToast('error', '서로 다른 이름의 품목을 2개 이상 선택하세요.'); return }
    const canon = mergeCanon.trim() || mergeLabels[0]
    startTransition(async () => {
      const res = await mergeItemNames(canon, mergeLabels)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `'${canon}'(으)로 통일됨 · ${mergeLabels.length}개 이름`)
      exitMerge(); router.refresh()
    })
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

  const ItemRow = ({ it, placed, awaitingReceipt }: { it: AssetItem; placed: boolean; awaitingReceipt?: boolean }) => (
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
            {mergeMode && <span className="text-[var(--coral)]"> · 같은 품목끼리 눌러 선택 → 한 이름으로 통일하세요.</span>}
          </p>
        </div>
        {!isEmpty && (
          <button type="button" onClick={() => mergeMode ? exitMerge() : setMergeMode(true)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors ${mergeMode ? 'bg-[var(--coral)] text-white border-[var(--coral)]' : 'border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>
            {mergeMode ? '병합 취소' : '품명 병합'}
          </button>
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
                {data.pending.map(it => <ItemRow key={it.id} it={it} placed={false} awaitingReceipt />)}
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
                {data.unassigned.map(it => <ItemRow key={it.id} it={it} placed={false} />)}
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
                {data.common.map(it => <ItemRow key={it.id} it={it} placed={false} />)}
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
                {g.items.map(it => <ItemRow key={it.id} it={it} placed />)}
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
                {g.items.map(it => <ItemRow key={it.id} it={it} placed />)}
              </ul>
            </section>
          ))}
        </>
      )}

      {/* 병합 바 — 선택한 품목들을 한 이름으로 통일 (mergeItemNames). 적용취소는 환경설정 '품명 병합'에서 */}
      {mergeMode && (
        <div className="sticky bottom-3 z-10 bg-[var(--cream)] border border-[var(--coral)]/40 rounded-xl p-3 space-y-2"
          style={{ boxShadow: '0 6px 24px -6px rgba(61,36,24,.28)' }}>
          <p className="text-[0.6875rem] text-[var(--warm-mid)]">
            서로 다른 이름의 같은 품목을 골라 한 이름으로 통일합니다. <span className="text-[var(--warm-dark)] font-medium">{mergeLabels.length}개 이름</span> 선택됨.
          </p>
          {mergeLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {mergeLabels.map(l => (
                <button key={l} type="button" onClick={() => setMergeCanon(l)}
                  className={`text-[0.6875rem] px-2 py-1 rounded-md border transition-colors ${(mergeCanon.trim() || mergeLabels[0]) === l ? 'bg-[var(--coral)] text-white border-[var(--coral)]' : 'border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input value={mergeCanon} onChange={e => setMergeCanon(e.target.value)} placeholder={mergeLabels[0] ?? '통일할 이름'}
              className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
            <button type="button" onClick={doMerge} disabled={pending || mergeLabels.length < 2}
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">
              {pending ? '통일 중…' : `${mergeLabels.length}개 통일`}
            </button>
            <button type="button" onClick={exitMerge} className="shrink-0 text-xs px-2 py-1.5 text-[var(--warm-muted)]">취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
