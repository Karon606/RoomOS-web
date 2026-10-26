// 고정지출 기본 구매처를 새로 적어 저장한 뒤 과거 빈 구매처에도 채울지 한 번 묻는 화면 정본(재무·환경설정 고정지출 폼 공용).
//
// 결정 D(2026-10-27 운영자 승인, 신고 5fa9cf43). 묻는 때는 저장한 구매처가 비어 있지 않고 저장 전 값과 다를 때뿐이고,
// 채울 행이 0건이면 아무것도 안 띄운다. 대상과 값은 서버가 정한다(countRecurringVendorBackfill · backfillRecurringVendor).
// 채운 뒤에는 토스트 '적용취소'가 그때 채운 행만 되돌린다(undoExpenseFieldChange, 그사이 바뀐 행이 있으면 아무것도 안 고친다).
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast, humanError } from '@/lib/saveStatus'
import { withParticle } from '@/lib/koParticle'
import { countRecurringVendorBackfill, backfillRecurringVendor, undoExpenseFieldChange } from './actions'

export async function askRecurringVendorBackfill(opts: {
  recurringExpenseId: string
  /** 저장 전 항목 구매처(새 항목이면 null) */
  prevVendor: string | null
  /** 이번 저장이 실은 구매처 */
  nextVendor: string | null
  /** 채우기·적용취소 뒤 화면 새로 고침 */
  onChanged: () => void
}): Promise<void> {
  const prev = opts.prevVendor?.trim() || null
  const next = opts.nextVendor?.trim() || null
  if (!next || next === prev) return
  try {
    const c = await countRecurringVendorBackfill(opts.recurringExpenseId)
    if (!c.ok || c.count === 0 || !c.vendor) return
    const ok = await confirmDialog({
      title: `이 항목으로 기록한 과거 지출 중 구매처가 빈 ${c.count}건에도 채울까요?`,
      // 조사는 따옴표 밖 이름의 끝소리로 고른다('대동빌딩'으로 · 'KT'로).
      message: `구매처를 '${c.vendor}'${withParticle(c.vendor, '으로/로').slice(c.vendor.length)} 채웁니다. 이미 구매처가 적힌 지출은 바꾸지 않습니다.`,
      confirmLabel: '채우기',
      cancelLabel: '채우지 않기',
    })
    if (!ok) return
    const r = await backfillRecurringVendor(opts.recurringExpenseId)
    if (!r.ok) { pushToast('error', r.error); return }
    if (r.count === 0) { pushToast('info', '채울 지출이 없었습니다'); return }
    opts.onChanged()
    const undo = r.undo
    pushToast('success', `과거 지출 ${r.count}건에 구매처를 채웠습니다`, undo ? {
      action: {
        label: '적용취소',
        run: () => { void undoExpenseFieldChange(undo).then(u => {
          if (!u.ok) { pushToast('error', u.error); return }
          pushToast('info', '구매처 채우기를 적용취소했습니다')
          opts.onChanged()
        }).catch(e => pushToast('error', humanError(e, '적용취소에 실패했습니다. 다시 시도해 주세요.'))) },
      },
    } : undefined)
  } catch (e) {
    pushToast('error', humanError(e, '과거 지출을 확인하지 못했습니다.'))
  }
}
