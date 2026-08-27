// 메모 표시 — 빈 메모면 렌더 안 함.
//
// 형제 면(TenantBody 의 메모 절)과 같은 문법이다. 종전에는 InfoRow 였는데 그 값 칸은
// text-right 라 긴 메모가 오른쪽으로 뭉개지고 줄바꿈이 사라졌다. 메모는 길이를 모르는
// 자유 입력이라 좌우 한 줄 문법에 안 맞는다.

import { Section } from './Section'

export function MemoSection({ memo }: { memo: string | null | undefined }) {
  if (!memo) return null
  return (
    <Section title="메모">
      <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap">{memo}</p>
    </Section>
  )
}
