'use client'

// 대시보드 — '찍어 올리기' 입력 + AI 분류된 등록 대기 큐.
// 사용자 흐름:
//   1) 사진 올리기 → 카메라/갤러리 → 업로드
//   2) AI 가 영수증/재고/기타 분류 + 추출값 표시
//   3) 사용자가 검토 후 [지출 등록] 또는 [재고 등록] 또는 [거절]

import { ReceiptScanModal, tryDetectDocumentCorners, dataUrlToFile } from '@/components/ReceiptScanModal'
import { notifyAiQuota } from '@/lib/aiQuotaToast'
import { SpecWizard, type SpecWizardResult } from '@/components/ui/SpecWizard'
import { useEffect, useRef, useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  uploadPendingReceipt, getPendingReceipts, approvePendingReceipt, rejectPendingReceipt, checkSetHint,
  type PendingReceiptRow,
} from '@/app/(app)/dashboard/pendingReceipt'
import { Btn } from '@/components/ui/Btn'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast } from '@/lib/saveStatus'
import { getExpenseCategories } from '@/app/(app)/settings/actions'
import { getTrackedCategoriesForClient } from '@/app/(app)/inventory/actions'

// 카테고리는 설정 기반으로 로드 — 하드코딩 금지(상용화 감사 A2·A4, 2026-07-10). 아래는 로드 전 폴백.
const FALLBACK_EXPENSE_CATEGORIES = [
  '부식비', '소모품비', '폐기물 처리비', '수선유지비', '공과금', '마케팅/광고비',
  '인건비', '청소용역비', '관리비', '임대료', '통신/렌탈/보험료', '세금/수수료',
]
const FALLBACK_INVENTORY_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비']

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
  // 카테고리 목록 — 영업장 설정 기반(하드코딩 폴백은 로드 전 잠깐만)
  const [EXPENSE_CATEGORIES, setExpCats] = useState<string[]>(FALLBACK_EXPENSE_CATEGORIES)
  const [INVENTORY_CATEGORIES, setInvCats] = useState<string[]>(FALLBACK_INVENTORY_CATEGORIES)
  useEffect(() => {
    getExpenseCategories().then(c => { if (c.length) setExpCats(c) }).catch(() => {})
    getTrackedCategoriesForClient().then(c => { if (c.length) setInvCats(c) }).catch(() => {})
  }, [])
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

  // 영수증 스캔(모서리 인식) — 지출 등록과 동일 UX 공유
  const [scanBitmap, setScanBitmap] = useState<ImageBitmap | null>(null)
  const [scanFile, setScanFile]     = useState<File | null>(null)

  const doUpload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await uploadPendingReceipt(fd)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '업로드 + AI 분류 완료')
      void notifyAiQuota()
      await reload()
    } finally { setUploading(false) }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    // 영수증 감지 — 문서 영역이 잡히면 지출 등록과 동일한 모서리 스캔 UX 자동 활성화.
    // 감지 실패(물품 사진 등)·비트맵 불가 포맷(HEIC 등)은 기존처럼 원본 그대로 업로드.
    try {
      const bmp = await createImageBitmap(f)
      if (tryDetectDocumentCorners(bmp)) { setScanFile(f); setScanBitmap(bmp); return }
      bmp.close?.()
    } catch { /* 감지 불가 포맷 — 원본 업로드로 진행 */ }
    await doUpload(f)
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
            EXPENSE_CATEGORIES={EXPENSE_CATEGORIES} INVENTORY_CATEGORIES={INVENTORY_CATEGORIES}
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
      {scanBitmap && (
        <ReceiptScanModal
          bitmap={scanBitmap}
          onConfirm={async ({ dataUrl }) => {
            scanBitmap.close?.()
            setScanBitmap(null); setScanFile(null)
            await doUpload(dataUrlToFile(dataUrl, 'receipt_scan.jpg'))
          }}
          onCancel={async () => {
            // 여기선 업로드가 곧 목적 — 크롭을 취소해도 원본 그대로 업로드 진행(지출 등록의 '첨부 취소'와 다른 맥락)
            const f = scanFile
            scanBitmap.close?.()
            setScanBitmap(null); setScanFile(null)
            if (f) await doUpload(f)
          }}
        />
      )}
    </section>
  )
}

function PendingCard({ row, editingMode, onStartEdit, onCancelEdit, onApproved, onRejected, EXPENSE_CATEGORIES = FALLBACK_EXPENSE_CATEGORIES, INVENTORY_CATEGORIES = FALLBACK_INVENTORY_CATEGORIES }: {
  EXPENSE_CATEGORIES?: string[]
  INVENTORY_CATEGORIES?: string[]
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
  const [specText, setSpecText] = useState('')
  const [wizOpen, setWizOpen] = useState(false)
  // 세트 상품 의심(주문 1=실물 N) — 폼 열릴 때 1회 감지, 승인 전 "1세트에 몇 개?" 확인(운영자 2026-07-06)
  const [setHint, setSetHint] = useState<Awaited<ReturnType<typeof checkSetHint>>>(null)
  useEffect(() => {
    if (!isInventory) return
    const label = (row.itemLabel ?? '').trim()
    if (!label) return
    let alive = true
    checkSetHint({
      label, rawLabel: row.rawItemLabel ?? undefined,
      amount: row.inferredAmount ?? 0,
      qtyValue: row.qtyValue ?? undefined, specValue: row.specValue ?? undefined,
    }).then(h => { if (alive) setSetHint(h) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const applySetHint = () => {
    if (!setHint) return
    setSpecValue(String(setHint.count)); setSpecUnit('개')
    if (!qtyUnit.trim() || qtyUnit === '개') setQtyUnit('세트')
    setSetHint(null)
  }
  const applyWizard = (r: SpecWizardResult) => {
    setSpecValue(r.specValue); setSpecUnit(r.specUnit); setSpecText(r.specText)
    if (r.qtyValue) setQtyValue(r.qtyValue); setQtyUnit(r.qtyUnit)
  }

  const handleApprove = () => {
    if (!category) { pushToast('error', '카테고리를 선택하세요'); return }
    if (isInventory) {
      if (!itemLabel.trim()) { pushToast('error', '품목명을 입력하세요'); return }
      if (!INVENTORY_CATEGORIES.includes(category)) { pushToast('error', `재고는 재고 추적 카테고리(${INVENTORY_CATEGORIES.join('/')}) 중에서 선택해야 추적됩니다.`); return }
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
          specText:  specText.trim() || undefined,
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
            <SpecWizard open={wizOpen} onClose={() => setWizOpen(false)} onComplete={applyWizard}
              itemLabel={itemLabel || undefined} z={260} />
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
                    <label className="text-[0.625rem]" style={{ color: 'var(--warm-muted)' }}>규격 (선택)
                      <button type="button" onClick={() => setWizOpen(true)}
                        className="ml-1.5 text-[0.625rem] font-semibold text-[var(--coral)] underline decoration-dotted underline-offset-2">단계별</button>
                    </label>
                    <div className="flex gap-1">
                      <input type="text" placeholder="300" value={specValue} onChange={e => setSpecValue(e.target.value)}
                        className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                      <input type="text" placeholder="ml" value={specUnit} onChange={e => setSpecUnit(e.target.value)}
                        className="w-12 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-1.5 py-1 text-xs text-[var(--warm-dark)] outline-none" />
                    </div>
                    {specText.trim() && <p className="mt-0.5 text-[0.625rem] text-[var(--coral)]">서술 규격: {specText}</p>}
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
                {setHint && !(Number(specValue) > 1) && (
                  <div className="flex items-center gap-1.5 flex-wrap rounded-lg bg-[var(--cream)] ring-1 ring-[var(--coral)]/30 px-2 py-1.5">
                    <span className="text-[0.625rem] text-[var(--warm-dark)] flex-1 min-w-[8rem]">
                      {setHint.basis === 'price'
                        ? `단가가 평소(${(setHint.histUnit ?? 0).toLocaleString()}원/개)의 ${setHint.count}배예요. 1세트에 ${setHint.count}개입인가요?`
                        : `표기상 ${setHint.count}개입 세트로 보여요. 실물 ${setHint.count}개 맞나요?`}
                    </span>
                    <button type="button" onClick={applySetHint}
                      className="px-2 py-1 text-[0.625rem] font-medium rounded-md bg-[var(--coral)] text-[var(--cream)]">
                      네, {setHint.count}개입{setHint.perPiece > 0 ? ` (개당 ${setHint.perPiece.toLocaleString()}원)` : ''}
                    </button>
                    <button type="button" onClick={() => setSetHint(null)}
                      className="px-2 py-1 text-[0.625rem] rounded-md border border-[var(--warm-border)] text-[var(--warm-muted)]">
                      아니요
                    </button>
                  </div>
                )}
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
