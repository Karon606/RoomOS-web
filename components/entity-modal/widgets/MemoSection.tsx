// 메모 표시 — 빈 메모면 렌더 안 함. 편집은 Phase 2.5+에서 같은 위젯에 mode='edit' 추가 예정.

import { InfoRow } from './InfoRow'

export function MemoSection({ memo }: { memo: string | null | undefined }) {
  if (!memo) return null
  return <InfoRow label="메모" value={memo} />
}
