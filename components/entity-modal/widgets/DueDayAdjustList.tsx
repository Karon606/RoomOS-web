'use client'

// 납입일 변경 조정 묶음 정본. 수납 정보의 수납 내역과 입주자 수납 모달이 같은 컴포넌트를 쓴다(표시·방향과 금액 수정·삭제)
//
// 왜 따로 묶나(신고 df82ce57, 2026-10-20). 조정 행은 들어온 돈이 아니라 그 달 받을 돈을 고치는 장부 줄이고 부호가 뜻이다.
// 수납 정보 쪽은 이 행을 일반 수납 행처럼 그리고 일반 수정 폼을 열어, 금액 칸이 부호를 지웠다(513호 −128,333 이
// +130,000). 입주자 화면은 이미 '납입일 변경 조정' 묶음으로 떼어 삭제만 두었다. 두 화면이 각자 그려 갈렸으므로
// 한 컴포넌트로 모은다.
//
// 수정은 방향 세그먼트와 양수 금액 칸뿐이다. 부호는 서버가 방향으로 붙인다(rooms/actions updateDueDayAdjust).
// 납부일·방법·현금영수증 칸은 없다(조정 행에는 뜻이 없다). 메모 앞부분은 기계 키라 못 고치고 뒤 설명만 고친다.
// 금액이 일할 계산값과 다르면 메모에 '협의 N원' 이 함께 남는다(운영자 요구 2026-10-20, 원단위 절삭 등 수동 조정).

import { useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import {
  dueDayAdjustKindOf, dueDayAdjustDisplayLabel, parseDueDayAdjustMemo, buildDueDayAdjustMemo, DUE_DAY_ADJUST_KIND_TEXT, DUE_DAY_ADJUST_NOTE_MAX,
  type DueDayAdjustKind,
} from '@/lib/dueDayAdjust'
import { updateDueDayAdjust, undoPaymentEdit } from '@/app/(app)/rooms/actions'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { withSave, pushToast } from '@/lib/saveStatus'

export type DueDayAdjustRecord = { id: string; actualAmount: number; memo: string | null; targetMonth: string }

// 메모 칸은 이 폼의 금액 칸(정본 MoneyInput)과 같은 상자다(§12 한 폼 안 입력 높이 혼용 금지). 형제 수정 폼의 44px 칸을
// 쓰면 바로 위 MoneyInput(42px, 글자 125% 에서 52px)과 높이가 갈린다(하네스 실측 2026-10-20).
const INPUT_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus-visible:border-[var(--tc-text)] focus-visible:shadow-[var(--input-ring-focus)] transition-colors'
const LABEL_CLS = 'text-xs font-medium text-[var(--warm-mid)]'
// 수정 폼 바탕(--cream-soft) 위 캡션. --warm-muted 는 다크에서 4.46:1 이라(하네스 실측) 한 단 진한 --warm-mid 다.
const CAPTION_CLS = 'text-[0.65625rem] text-[var(--warm-mid)] break-keep'

const KIND_OPTIONS = [
  { value: 'extra' as const, label: DUE_DAY_ADJUST_KIND_TEXT.extra },
  { value: 'refund' as const, label: DUE_DAY_ADJUST_KIND_TEXT.refund },
]

export function DueDayAdjustList({ records, canEdit, readOnly = false, editable, lockedNote, onDelete, deletingId, onChanged }: {
  records: DueDayAdjustRecord[]
  canEdit: boolean
  /** 요약 화면처럼 수정·삭제를 안 두는 자리. */
  readOnly?: boolean
  /** 이 화면에서 고칠 수 있는가(수납 정보는 귀속월 화면 규칙, lib/paymentEditScope). 안 넘기면 늘 된다. */
  editable?: (p: DueDayAdjustRecord) => boolean
  /** 못 고칠 때 그 자리에 서는 안내. */
  lockedNote?: (p: DueDayAdjustRecord) => string
  /** 삭제는 부르는 쪽의 정본 경로(확인창·적용취소)를 그대로 쓴다. */
  onDelete: (p: DueDayAdjustRecord) => void
  deletingId?: string | null
  /** 수정·적용취소 뒤 부모가 목록과 정산을 다시 읽는다. */
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dir, setDir] = useState<DueDayAdjustKind>('extra')
  const [amount, setAmount] = useState(0)
  const [note, setNote] = useState('')

  if (records.length === 0) return null

  const startEdit = (p: DueDayAdjustRecord) => {
    const parsed = parseDueDayAdjustMemo(p.memo)
    setEditingId(p.id)
    setDir(dueDayAdjustKindOf(p.actualAmount) ?? parsed?.kind ?? 'extra')
    setAmount(Math.abs(p.actualAmount))
    setNote(parsed?.note ?? '')
  }

  const save = (p: DueDayAdjustRecord) => {
    const savedDir = dir, savedAmount = amount
    startTransition(async () => {
      const res = await withSave(() => updateDueDayAdjust(p.id, { direction: savedDir, amount: savedAmount, note }), { success: '' })
      if (!res.ok) return
      const undo = res.undo   // 운영에서 서명 키가 없으면 null. 그때는 적용취소를 숨긴다(수납 수정과 같은 규칙).
      let undone = false      // 연타 방지. 두 번째 요청은 이미 되돌린 기록과 충돌해 실패로 떨어진다
      pushToast('success', '조정 금액 수정됨', {
        detail: `${DUE_DAY_ADJUST_KIND_TEXT[savedDir]} ${fmtWon(savedAmount)}`,
        ...(undo ? { action: { label: '적용취소', run: () => {
          if (undone) return
          undone = true
          void undoPaymentEdit(undo).then(r => {
            if (r.ok) { pushToast('info', '조정 금액 수정을 적용취소했습니다'); onChanged() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '적용취소 중 통신 오류가 발생했습니다'))
        } } } : {}),
      })
      setEditingId(null)
      onChanged()
    })
  }

  return (
    <div className="space-y-2">
      <p className={LABEL_CLS}>납입일 변경 조정</p>
      {records.map(p => {
        const parsed = parseDueDayAdjustMemo(p.memo)
        if (editingId === p.id && parsed) {
          // 저장하면 남을 메모(기계 키·방향 조각 뺀 표시, 방향은 위 세그먼트가 말한다). 규칙값과 협의값이 둘 다 보인다.
          const previewMemo = dueDayAdjustDisplayLabel(buildDueDayAdjustMemo({ ...parsed, agreedAmount: amount > 0 ? amount : null, kind: dir, note }))
          return (
            <div key={p.id} className="rounded-xl border border-[var(--coral)] bg-[var(--cream-soft)] px-3 py-2.5 space-y-2">
              <div className="space-y-1">
                <p className={LABEL_CLS}>방향</p>
                <SegmentedControl size="sm" ariaLabel="조정 방향" value={dir} onChange={setDir} options={KIND_OPTIONS} />
              </div>
              <div className="space-y-1">
                <p className={LABEL_CLS}>금액</p>
                <MoneyInput value={amount} onChange={setAmount} />
                <p className={`num ${CAPTION_CLS}`}>일할 계산 {fmtWon(parsed.ruleAmount)} · 다르게 적으면 메모에 협의 금액으로 함께 남습니다.</p>
              </div>
              <div className="space-y-1">
                <p className={LABEL_CLS}>메모</p>
                <input type="text" value={note} maxLength={DUE_DAY_ADJUST_NOTE_MAX} onChange={e => setNote(e.target.value)}
                  placeholder="덧붙일 설명(선택)" aria-describedby={`${p.id}-memo-preview`} className={INPUT_CLS} />
                <p id={`${p.id}-memo-preview`} className={`num ${CAPTION_CLS}`}>저장될 메모 · {previewMemo}</p>
              </div>
              {/* 취소가 subtle 인 이유는 형제 수정 폼(PaymentRecordList)과 같다. 이 면이 --cream-soft 라 secondary 는 다크에서 경계가 사라진다. */}
              <div className="flex gap-2 justify-end">
                <Btn variant="subtle" size="sm" onClick={() => setEditingId(null)}>취소</Btn>
                <Btn variant="primary" size="sm" onClick={() => save(p)} disabled={pending || amount <= 0}>저장</Btn>
              </div>
            </div>
          )
        }
        const kind = dueDayAdjustKindOf(p.actualAmount)
        const fg = kind === 'extra' ? 'var(--danger-fg)' : kind === 'refund' ? 'var(--success-fg)' : 'var(--warm-mid)'
        const label = dueDayAdjustDisplayLabel(p.memo)   // 방향은 제목이 말한다(표시만, 저장 메모는 그대로)
        const canTouch = canEdit && !readOnly
        const here = !editable || editable(p)
        // 행 바탕은 형제 수납 행과 같은 --canvas 다. 방향은 제목·금액 글자색이 말한다. 종전 입주자 화면처럼 의미색으로
        // 통째로 칠하면 그 위의 행 액션(중립 톤)과 캡션이 대비 4.5:1 에 못 미쳤다(라이트 4.49:1·다크 3.8:1, 하네스 실측).
        return (
          <div key={p.id} className="rounded-sm px-3 py-2.5 space-y-1.5 bg-[var(--canvas)]">
            {/* 줄1: 방향 + 금액(우측, 안 줄임). 음수는 §06 의 −(U+2212), 양수는 + 를 붙인다. */}
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold" style={{ color: fg }}>{kind ? DUE_DAY_ADJUST_KIND_TEXT[kind] : '조정'}</p>
              <span className="num text-sm font-semibold whitespace-nowrap" style={{ color: fg }}>
                {p.actualAmount > 0 ? '+' : ''}{fmtWon(p.actualAmount)}
              </span>
            </div>
            {/* 줄2: 기록 내용 + 행 액션. 형제 수납 행과 같은 두 줄 문법이다. */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {/* 기록 내용은 형제 수납 행의 메모와 같은 --tc-text 다(--warm-mid 는 --canvas 위 4.11:1, 하네스 실측). */}
              {label && <p className="num text-[0.6875rem] text-[var(--tc-text)] break-keep min-w-0">{label}</p>}
              {canTouch && !here && lockedNote && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">{lockedNote(p)}</span>
              )}
              {canTouch && here && (
                <div className="flex gap-1.5 ml-auto">
                  {/* 메모 모양을 못 읽는 옛 행은 고칠 길이 없다. 눌러야 거절되는 버튼을 두지 않는다. */}
                  {parsed && <RowActionBtn tone="neutral" onClick={() => startEdit(p)}>수정</RowActionBtn>}
                  <RowActionBtn tone="danger" disabled={deletingId === p.id} onClick={() => onDelete(p)}>삭제</RowActionBtn>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
