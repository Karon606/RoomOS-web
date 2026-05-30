'use client'

// 대시보드 — '찍어 올리기' 입력 + AI 분류된 등록 대기 큐.
// 사용자 흐름:
//   1) 📸 사진 올리기 버튼 → 카메라/갤러리 → 업로드(progress)
//   2) AI 가 영수증/재고/기타 분류 + 추출값 표시
//   3) 사용자가 검토 후 [등록] 또는 [거절]

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  uploadPendingReceipt, getPendingReceipts, approvePendingReceipt, rejectPendingReceipt,
  type PendingReceiptRow,
} from '@/app/(app)/dashboard/pendingReceipt'
import { Btn } from '@/components/ui/Btn'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast } from '@/lib/saveStatus'

const EXPENSE_CATEGORIES = [
  '부식비', '소모품비', '폐기물 처리비', '수선유지비', '공과금', '마케팅/광고비',
  '인건비', '청소용역비', '관리비', '임대료', '통신/렌탈/보험료', '세금/수수료',
]

const KIND_LABEL: Record<string, { label: string; color: string }> = {
  expense:   { label: '지출(영수증)', color: 'var(--coral)' },
  inventory: { label: '재고/물품',     color: '#16a34a' },
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

export function PendingReceiptSection() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<PendingReceiptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
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
          <h2 className="text-sm font-bold" style={{ color: 'var(--warm-dark)' }}>📸 찍어 올리기 · 등록 대기</h2>
          <p className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>영수증/물품 사진을 올리면 AI 가 분류하고, 검토 후 등록</p>
        </div>
        <Btn variant="primary" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '업로드 중...' : '📸 사진 올리기'}
        </Btn>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      </header>

      {loading && rows.length === 0 && (
        <p className="text-xs text-center py-3" style={{ color: 'var(--warm-muted)' }}>불러오는 중…</p>
      )}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-center py-3" style={{ color: 'var(--warm-muted)' }}>대기 중인 항목이 없습니다.</p>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <PendingCard key={r.id} row={r} editing={editingId === r.id}
            onStartEdit={() => setEditingId(r.id)}
            onCancelEdit={() => setEditingId(null)}
            onApproved={async () => { setEditingId(null); await reload() }}
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

function PendingCard({ row, editing, onStartEdit, onCancelEdit, onApproved, onRejected }: {
  row: PendingReceiptRow
  editing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onApproved: () => void
  onRejected: () => void
}) {
  const kindInfo = KIND_LABEL[row.inferredKind ?? 'unknown'] ?? KIND_LABEL.unknown
  const [pending, startTransition] = useTransition()
  const [date, setDate] = useState(row.inferredDate ?? new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState<number>(row.inferredAmount ?? 0)
  const [category, setCategory] = useState(row.inferredCategory ?? '')
  const [vendor, setVendor] = useState(row.inferredVendor ?? '')
  const [memo, setMemo] = useState(row.notes ?? '')

  const handleApprove = () => {
    if (!category) { pushToast('error', '카테고리를 선택하세요'); return }
    if (!(amount > 0)) { pushToast('error', '금액을 입력하세요'); return }
    startTransition(async () => {
      const res = await approvePendingReceipt(row.id, { date, amount, category, vendor: vendor || undefined, memo: memo || undefined })
      if (res.ok) { pushToast('success', '지출로 등록됨'); onApproved() }
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
          <span className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>{fmtAgo(row.createdAt)}</span>
        </div>

        {!editing && (
          <>
            <p className="text-sm" style={{ color: 'var(--warm-dark)' }}>
              {row.notes ?? row.inferredVendor ?? '(AI 분류 정보 없음)'}
            </p>
            <p className="text-xs" style={{ color: 'var(--warm-mid)' }}>
              {row.inferredDate ?? '—'}
              {row.inferredAmount != null && <> · <span className="font-semibold">{row.inferredAmount.toLocaleString()}원</span></>}
              {row.inferredCategory && <> · {row.inferredCategory}</>}
            </p>
            <div className="flex gap-1.5 pt-1">
              <button onClick={onStartEdit} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-lg font-medium"
                style={{ background: 'var(--coral)', color: '#fff' }}>
                등록
              </button>
              <button onClick={onRejected} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-lg border border-red-200 text-red-500 font-medium">
                거절
              </button>
            </div>
          </>
        )}

        {editing && (
          <div className="space-y-1.5 pt-1">
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>날짜</label>
                <DatePicker value={date} onChange={setDate}
                  className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-md px-2 py-1 text-xs text-[var(--warm-dark)]" />
              </div>
              <div>
                <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>금액</label>
                <MoneyInput value={amount} onChange={setAmount} placeholder="0원" />
              </div>
            </div>
            <div>
              <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>카테고리</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-md px-2 py-1 text-xs text-[var(--warm-dark)] outline-none">
                <option value="">선택</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input type="text" placeholder="상호명 (선택)" value={vendor} onChange={e => setVendor(e.target.value)}
                className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-md px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
              <input type="text" placeholder="메모 (선택)" value={memo} onChange={e => setMemo(e.target.value)}
                className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-md px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
            </div>
            <div className="flex gap-1.5 pt-1">
              <button onClick={handleApprove} disabled={pending}
                className="flex-1 text-[0.6875rem] py-1.5 rounded-lg font-medium"
                style={{ background: 'var(--coral)', color: '#fff' }}>
                {pending ? '저장 중...' : '지출 등록'}
              </button>
              <button onClick={onCancelEdit} disabled={pending}
                className="text-[0.6875rem] px-2 py-1.5 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)]">
                취소
              </button>
            </div>
            {row.inferredKind === 'inventory' && (
              <p className="text-[0.5625rem]" style={{ color: 'var(--warm-muted)' }}>
                ※ AI 는 재고로 추정. 지출로 등록하지 않을 거면 거절 후 재고 페이지에서 수동 입력.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
