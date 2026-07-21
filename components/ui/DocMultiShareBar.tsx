'use client'

// 서류 다중 '보내기' 하단 바 — §22 SelectionPillBar 셸을 그대로 재사용(재발명 금지).
// 준비(변환) 상태를 표시하고, 완료 후에만 전송 버튼을 활성화한다. 자동 share 는 하지 않는다 —
// 사용자가 버튼을 탭해야 send 가 호출된다(제스처 만료 재발 방지, lib/useDocShare 참조).

import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'

const MAX_PDF_BYTES = 50 * 1024 * 1024   // 브라우저 공유 용량 여유 한계

export function DocMultiShareBar({
  count, done, failedCount, mode, sendLabel, totalBytes, onSend, onClose,
}: {
  count: number             // 선택 수(셸이 'N건 선택' 으로 표시)
  done: number              // 준비 완료 수
  failedCount: number       // 재시도까지 실패 수
  mode: 'png' | 'pdf'
  sendLabel: string         // '사진 보내기' | 'PDF 보내기'(카운트 포함 금지)
  totalBytes?: number       // pdf 50MB 판정용(png 은 undefined)
  onSend: () => void
  onClose: () => void
}) {
  const settled = done + failedCount >= count        // 모든 항목이 성공/실패로 확정
  const converting = !settled
  const oversized = mode === 'pdf' && (totalBytes ?? 0) > MAX_PDF_BYTES
  const disabled = converting || oversized

  return (
    <SelectionPillBar count={count} unit="건" onClose={onClose}>
      {converting ? (
        <span className="mono tnum whitespace-nowrap text-[0.8125rem] font-medium text-white/70">변환 중 {done}/{count}</span>
      ) : oversized ? (
        <span className="whitespace-nowrap text-[0.8125rem] font-medium text-white/70">용량이 커서 나눠 보내주세요</span>
      ) : null}
      <PillButton primary disabled={disabled} onClick={onSend}>{sendLabel}</PillButton>
    </SelectionPillBar>
  )
}
