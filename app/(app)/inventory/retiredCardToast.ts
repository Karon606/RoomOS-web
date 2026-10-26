// 지출 쓰기 뒤 함께 정리된 고아 재고 카드를 알리고 같은 id 로 되살리는 토스트 정본(신고 f3866bca, 2026-10-26).
// 재고에서 제외·지출 삭제·품명 변경·카테고리 '지출만'이 같은 문장과 같은 되살림을 쓴다. 화면마다 따로 쓰면 문장이 갈린다.
// 되살림은 품목 삭제의 적용취소(undoDeleteTrackedItem)를 그대로 부른다. 스냅샷 모양이 같다(trackedItemSnapshot).
// 문형은 형제 토스트('재고 카드를 정리했습니다' / '재고 카드 정리를 적용취소했습니다 · 목록에 다시 표시', FinanceClient '같이 변경')와 맞춘다.
// 주 동작에 제 토스트와 적용취소가 있는 자리(지출 삭제·재고 제외)는 따로 띄우지 않고 그 토스트의 둘째 줄(retiredCardLine)로 싣는다.
import { pushToast } from '@/lib/saveStatus'
import { SEP } from './assets/receiptPlacement'
import { undoDeleteTrackedItem } from './actions'
import type { TrackedItemDeleteUndo } from './trackedItemSnapshot'

/** '재고 카드 …도 정리했습니다' + 적용취소. 되살리면 onRestored 로 화면을 다시 읽는다. */
export function pushRetiredCardToast(card: TrackedItemDeleteUndo, onRestored: () => void) {
  pushToast('info', `재고 카드 '${card.item.label}'도 정리했습니다`, {
    action: { label: '적용취소', run: () => { void undoDeleteTrackedItem(card).then(r => {
      if (r.ok) { pushToast('info', `재고 카드 정리를 적용취소했습니다${SEP}목록에\u00a0다시\u00a0표시`); onRestored() }
      else pushToast('error', r.error)
    }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
  })
}

/** 주 동작 토스트의 둘째 줄. */
export function retiredCardLine(card: TrackedItemDeleteUndo): string {
  return `재고 카드 '${card.item.label}'도 정리했습니다.`
}

/**
 * 주 동작(제외·삭제)의 적용취소가 먼저 부른다. 지출만 되살리고 카드를 안 되살리면 그 구매가 이을 카드가 없어 재고에서 사라진다.
 * 카드 토스트로 이미 되살렸으면 서버가 멱등으로 통과시킨다. 되살리지 못해도(같은 이름 카드가 새로 생김 등) 주 동작의 적용취소는 이어 간다.
 */
export async function restoreRetiredCardFirst(card: TrackedItemDeleteUndo | null | undefined): Promise<void> {
  if (!card) return
  const r = await undoDeleteTrackedItem(card).catch(() => ({ ok: false as const, error: '재고 카드를 되살리는 중 통신 오류가 발생했습니다' }))
  if (!r.ok) pushToast('error', r.error)
}
