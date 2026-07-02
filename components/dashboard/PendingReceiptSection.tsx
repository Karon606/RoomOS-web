'use client'

// 대시보드 — '찍어 올리기' 입력 + AI 분류된 등록 대기 큐.
// 사용자 흐름:
//   1) 사진 올리기 → 카메라/갤러리 → 업로드
//   2) AI 가 영수증/재고/기타 분류 + 추출값 표시
//   3) 사용자가 검토 후 [지출 등록] 또는 [재고 등록] 또는 [거절]

import { useEffect, useRef, useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  uploadPendingReceipt, getPendingReceipts, approvePendingReceipt, rejectPendingReceipt,
  type PendingReceiptRow,
} from '@/app/(app)/dashboard/pendingReceipt'
import { Btn } from '@/components/ui/Btn'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast } from '@/lib/saveStatus'

// 영수증 카테고리 — 영수증/재고 공통
const EXPENSE_CATEGORIES = [
  '부식비', '소모품비', '폐기물 처리비', '수선유지비', '공과금', '마케팅/광고비',
  '인건비', '청소용역비', '관리비', '임대료', '통신/렌탈/보험료', '세금/수수료',
]
// 재고 추적 대상 카테고리 (이 안에 있으면 재고 모듈이 자동 인식)
const INVENTORY_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비']

const KIND_LABEL: Record<string, { label: string; color: string }> = {
  expense:   { label: '지출(영수증)', color: 'var(--coral)' },
  inventory: { label: '재고/물품',     color: 'var(--success-fg)' },
  unknown:   { label: '미분류',        color: 'var(--warm-mid)' },
}

function fmtAgo(d: Date | string): string {
  const t = new Date(d)
  const min = Math.floor((Date.now() - t.getTime()) / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  return `${Math.floor(hour / 24)}일 전`
}

type EditMode = 'expense' | 'inventory'

export function PendingReceiptSection() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<PendingReceiptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<{ id: string; mode: EditMode } | null>(null)
  const [, startTransition] = useTransition()

  const reload = async () => {
    setLoading(true)
    try { setRows(await getPendingReceipts(20)) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() /* eslint-disable-line */ }, [])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', f)
      const res = await uploadPendingReceipt(fd)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '업로드 + AI 분류 완료')
      await reload()
    } finally { setUploading(false) }
  }

  return (
    <section className="space-y-3 rounded-xl p-4" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold" style={{ color: 'var(--warm-dark)' }}>찍어 올리기 · 등록 대기</h2>
          <p className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>영수증/물품 사진을 올리면 AI 가 분류하고, 검토 후 등록</p>
        </div>
        <Btn variant="primary" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '업로드 중...' : '사진 올리기'}
        </Btn>
        {/* capture 미지정 — 모바일에서 '사진 찍기/앨범/파일'을 모두 선택할 수 있게(촬영 강제 X) */}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </header>

      {loading && rows.length === 0 && (
        <SkeletonRows rows={2} className="py-1" />
      )}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-center py-3" style={{ color: 'var(--warm-muted)' }}>대기 중인 항목이 없습니다.</p>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <PendingCard key={r.id} row={r}
            editingMode={editing?.id === r.id ? editing.mode : null}
            onStartEdit={(mode) => setEditing({ id: r.id, mode })}
            onCancelEdit={() => setEditing(null)}
            onApproved={async () => { setEditing(null); await reload() }}
            onRejected={() => startTransition(async () => {
              const res = await rejectPendingReceipt(r.id)
              if (res.ok) { pushToast('success', '거절됨'); await reload() }
              else pushToast('error', res.error)
            })}
          />
        ))}
      </div>
    </section>
  )
}

function PendingCard({ row, editingMode, onStartEdit, onCancelEdit, onApproved, onRejected }: {
  row: PendingReceiptRow
  editingMode: EditMode | null
  onStartEdit: (mode: EditMode) => void
  onCancelEdit: () => void
  onApproved: () => void
  onRejected: () => void
}) {
  const kindInfo = KIND_LABEL[row.inferredKind ?? 'unknown'] ?? KIND_LABEL.unknown
  const isInventory = editingMode === 'inventory'
  const aiSuggestsInventory = row.inferredKind === 'inventory'

  const [pending, startTransition] = useTransition()
  const [date, setDate] = useState(row.inferredDate ?? new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState<number>(row.inferredAmount ?? 0)
  const [category, setCategory] = useState(() => {
    // 재고 모드면 추적 카테고리 중 첫 매치 또는 기본 '부식비'
    if (aiSuggestsInventory) {
      if (row.inferredCategory && INVENTORY_CATEGORIES.includes(row.inferredCategory)) return row.inferredCategory
      return '부식비'
    }
    return row.inferredCategory ?? ''
  })
  const [vendor, setVendor] = useState(row.inferredVendor ?? '')
  const [memo, setMemo] = useState(row.notes ?? '')
  // 재고 전용
  const [itemLabel, setItemLabel] = useState(row.itemLabel ?? '')
  const [specValue, setSpecValue] = useState(row.specValue ?? '')
  const [specUnit, setSpecUnit] = useState(row.specUnit ?? '')
  const [qtyValue, setQtyValue] = useState(row.qtyValue ?? '')
  const [qtyUnit, setQtyUnit] = useState(row.qtyUnit ?? '개')

  const handleApprove = () => {
    if (!category) { pushToast('error', '카테고리를 선택하세요'); return }
    if (isInventory) {
      if (!itemLabel.trim()) { pushToast('error', '품목명을 입력하세요'); return }
      if (!INVENTORY_CATEGORIES.includes(category)) { pushToast('error', '재고는 부식비/소모품비/폐기물 처리비 중에서 선택해야 추적됩니다.'); return }
    } else {
      if (!(amount > 0)) { pushToast('error', '금액을 입력하세요'); return }
    }
    startTransition(async () => {
      const res = await approvePendingReceipt(row.id, {
        date,
        amount: amount || 0,
        category,
        vendor: vendor || undefined,
        memo: memo || undefined,
        ...(isInventory ? {
          itemLabel: itemLabel.trim(),
          specValue: specValue || undefined,
          specUnit:  specUnit  || undefined,
          qtyValue:  qtyValue  || undefined,
          qtyUnit:   qtyUnit   || undefined,
        } : {}),
      })
      if (res.ok) { pushToast('success', isInventory ? '재고 보충으로 등록됨' : '지출로 등록됨'); onApproved() }
      else pushToast('error', res.error)
    })
  }

  return (
    <div className="rounded-xl p-3 flex gap-3" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
      {/* 썸네일 */}
      <a href={row.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
        <img src={row.imageUrl} alt="" className="w-20 h-20 object-cover rounded-lg" />
      </a>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: 'var(--cream)', color: kindInfo.color, border: `1px solid ${kindInfo.color}40` }}>
            {kindInfo.label}
          </span>
          {editingMode && (
            <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: isInventory ? 'var(--success-bg)' : 'var(--coral)20', color: isInventory ? 'var(--success-fg)' : 'var(--coral)' }}>
              {isInventory ? '재고 등록 중' : '지출 등록 중'}
            </span>
          )}
          <span className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>{fmtAgo(row.createdAt)}</span>
        </div>

        {!editingMode && (
          <>
            <p className="text-sm" style={{ color: 'var(--warm-dark)' }}>
              {row.itemLabel ?? row.notes ?? row.inferredVendor ?? '(AI 분류 정보 없음)'}
            </p>
            <p className="text-xs" style={{ color: 'var(--warm-mid)' }}>
              {row.inferredDate ?? '—'}
              {row.inferredAmount != null && <> · <span className="font-semibold">{fmtWon(row.inferredAmount)}</span></>}
              {row.inferredCategory && <> · {row.inferredCategory}</>}
              {row.qtyValue && <> · {row.qtyValue}{row.qtyUnit ?? '개'}</>}
              {row.specValue && <> · {row.specValue}{row.specUnit ?? ''}</>}
            </p>
            <div className="flex gap-1.5 pt-1 flex-wrap">
              {/* 지출 등록 — expense 추론이면 기본, inventory 면 보조 */}
              <button onClick={() => onStartEdit('expense')} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-lg font-medium"
                style={{
                  background: aiSuggestsInventory ? 'var(--cream)' : 'var(--coral)',
                  color: aiSuggestsInventory ? 'var(--warm-dark)' : '#fff',
                  border: aiSuggestsInventory ? '1px solid var(--warm-border)' : 'none',
                }}>
                지출 등록
              </button>
              {/* 재고 등록 — inventory 추론이면 기본, expense 면 보조 */}
              <button onClick={() => onStartEdit('inventory')} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-lg font-medium"
                style={{
                  background: aiSuggestsInventory ? 'var(--success-solid)' : 'var(--cream)',
                  color: aiSuggestsInventory ? 'var(--cream)' : 'var(--warm-dark)',
                  border: aiSuggestsInventory ? 'none' : '1px solid var(--warm-border)',
                }}>
                재고 등록
              </button>
              <button onClick={onRejected} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] font-medium">
                거절
              </button>
            </div>
          </>
        )}

        {editingMode && (
          <div className="space-y-1.5 pt-1">
            {/* 재고 모드만 — 품목명·규격·수량 */}
            {isInventory && (
              <>
                <div>
                  <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>품목명 *</label>
                  <input type="text" placeholder="예: 신라면, 두루마리 휴지"
                    value={itemLabel} onChange={e => setItemLabel(e.target.value)}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>규격 (선택)</label>
                    <div className="flex gap-1">
                      <input type="text" placeholder="300" value={specValue} onChange={e => setSpecValue(e.target.value)}
                        className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                      <input type="text" placeholder="ml" value={specUnit} onChange={e => setSpecUnit(e.target.value)}
                        className="w-12 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-1.5 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>수량 *</label>
                    <div className="flex gap-1">
                      <input type="text" placeholder="6" value={qtyValue} onChange={e => setQtyValue(e.target.value)}
                        className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                      <input type="text" placeholder="개" value={qtyUnit} onChange={e => setQtyUnit(e.target.value)}
                        className="w-12 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-1.5 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* 공통: 날짜·금액·카테고리·상호·메모 */}
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>날짜 *</label>
                <DatePicker value={date} onChange={setDate}
                  className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-md px-2 py-1 text-xs text-[var(--warm-dark)]" />
              </div>
              <div>
                <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>
                  금액 {isInventory ? '(영수증·구매가)' : '*'}
                </label>
                <MoneyInput value={amount} onChange={setAmount} placeholder="0원" />
              </div>
            </div>
            <div>
              <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>카테고리 *</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none">
                <option value="">선택</option>
                {(isInventory ? INVENTORY_CATEGORIES : EXPENSE_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {isInventory && (
                <p className="text-[0.5625rem] mt-0.5" style={{ color: 'var(--warm-muted)' }}>
                  ※ 재고 추적은 부식비/소모품비/폐기물 처리비만
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input type="text" placeholder="상호명 (선택)" value={vendor} onChange={e => setVendor(e.target.value)}
                className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
              <input type="text" placeholder="메모 (선택)" value={memo} onChange={e => setMemo(e.target.value)}
                className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
            </div>
            <div className="flex gap-1.5 pt-1">
              <button onClick={handleApprove} disabled={pending}
                className="flex-1 text-[0.6875rem] py-1.5 rounded-lg font-medium"
                style={{ background: isInventory ? 'var(--success-solid)' : 'var(--coral)', color: 'var(--cream)' }}>
                {pending ? '저장 중...' : (isInventory ? '재고 보충 등록' : '지출 등록')}
              </button>
              <button onClick={onCancelEdit} disabled={pending}
                className="text-[0.6875rem] px-2 py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)]">
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
