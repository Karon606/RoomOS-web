'use client'

// 서류 다중 '보내기' 하단 바 — §22 SelectionPillBar 셸을 그대로 재사용(재발명 금지).
// 준비(변환) 상태를 표시하고, 완료 후에만 전송 버튼을 활성화한다. 자동 share 는 하지 않는다 —
// 사용자가 버튼을 탭해야 send 가 호출된다(제스처 만료 재발 방지, lib/useDocShare 참조).

import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'

const MAX_PDF_BYTES = 50 * 1024 * 1024   // 브라우저 공유 용량 여유 한계
const MAX_SHARE_FILES = 10               // 브라우저 다중 공유 하드 리밋(선택 수 상한과 같은 숫자)

export function DocMultiShareBar({
  count, done, failedCount, mode, sendLabel, totalBytes, fileCount, aboveModal, onSend, onClose,
}: {
  count: number             // 선택 수(셸이 'N건 선택' 으로 표시)
  done: number              // 준비 완료 수
  failedCount: number       // 재시도까지 실패 수
  mode: 'png' | 'pdf'
  sendLabel: string         // '사진 보내기' | 'PDF 보내기'(카운트 포함 금지)
  totalBytes?: number       // pdf 50MB 판정용(png 은 undefined)
  // 실제 첨부 파일 수. 사진 변환은 페이지마다 한 장이라 계약서가 섞이면 선택 수보다 많아진다.
  // 안 넘기면 선택 수와 같다고 본다 — 한 장짜리만 다루는 형제 3화면은 종전 동작 그대로다.
  fileCount?: number
  aboveModal?: boolean      // 모달 안 선택 모드용(§22 SelectionPillBar 와 같은 축)
  onSend: () => void
  onClose: () => void
}) {
  const settled = done + failedCount >= count        // 모든 항목이 성공/실패로 확정
  const converting = !settled
  const files = fileCount ?? count
  const oversized = mode === 'pdf' && (totalBytes ?? 0) > MAX_PDF_BYTES
  // 장수 초과는 막는다. 그냥 보내면 canShare 가 거짓을 내 '이 기기에서는 공유를 지원하지 않습니다'
  // 라는 엉뚱한 안내로 끝난다 — 기기 탓이 아니라 장수 탓임을 말해야 다음 행동이 나온다.
  const tooMany = files > MAX_SHARE_FILES
  const disabled = converting || oversized || tooMany

  return (
    <SelectionPillBar count={count} unit="건" onClose={onClose} aboveModal={aboveModal}>
      {/* 상태 문구는 줄어들 수 있어야 한다. 320px 에서 나란한 요소가 전부 nowrap 이면 알약이 화면
          밖으로 밀려 **닫기 버튼에 손이 닿지 않는다**(실측 용량 초과 문구에서 71px 이탈).
          360·390 에서는 글자가 다 들어가 종전과 픽셀이 같고, 320 에서만 말줄임으로 접힌다. */}
      {converting ? (
        <span className="mono tnum min-w-0 truncate text-[0.8125rem] font-medium text-white/70">변환 중 {done}/{count}</span>
      ) : oversized ? (
        <span className="min-w-0 truncate text-[0.8125rem] font-medium text-white/70">용량이 커서 나눠 보내주세요</span>
      ) : tooMany ? (
        // 장수만 말한다 — '어떻게 해야 하나'는 알약에 들어갈 폭이 없어 호출부 화면이 한 줄로 안내한다.
        <span className="min-w-0 truncate text-[0.8125rem] font-medium text-white/70">사진 {files}장</span>
      ) : null}
      <PillButton primary disabled={disabled} onClick={onSend}>{sendLabel}</PillButton>
    </SelectionPillBar>
  )
}
