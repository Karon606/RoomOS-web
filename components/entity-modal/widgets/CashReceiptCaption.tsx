// 수납 행 아래 현금영수증 발행 금액 캡션. 다를 때만 선다. 문장은 lib/cashReceiptCopy 정본, 여기는 그리기만 한다.
//
// 수납 내역(PaymentRecordList)과 입주자 수납 모달(TenantClient)이 같은 컴포넌트를 쓴다. 두 자리가 각자
// 마크업을 들면 한쪽만 덩이 접힘·숫자 강조가 갈린다. 덩이는 각각 한 줄로 붙어 다니고(whitespace-nowrap)
// 접힘은 구분점에서만 일어난다. 아주 큰 글자에서도 비교어와 금액이 갈라지지 않는다(2026-10-13 웹디자이너 패널).
// 경고색은 목록에만 쓴다. 입력 폼은 경고색을 안 쓴다(운영자 결정 2026-08-25).
import type { CrCaption } from '@/lib/cashReceiptCopy'

const TONE: Record<CrCaption['tone'], string> = {
  warning: 'text-[var(--warning-fg)]',
  muted: 'text-[var(--warm-muted)]',
  danger: 'text-[var(--danger-fg)]',
}

export function CashReceiptCaption({ caption, id, className = '' }: {
  caption: CrCaption; id?: string
  /** 자리별 여백만(입주자 수납 모달은 줄 사이 mt-0.5). 글자·색은 여기서 정한다. */
  className?: string
}) {
  return (
    <p id={id} className={`num text-[0.65625rem] ${TONE[caption.tone]} flex flex-wrap gap-x-1 ${className}`}>
      {caption.chunks.map((chunk, i) => (
        <span key={i} className="whitespace-nowrap">
          {chunk.map((part, j) => (part.strong
            ? <span key={j} className="font-semibold text-[var(--warm-dark)]">{part.text}</span>
            : <span key={j}>{part.text}</span>))}
        </span>
      ))}
    </p>
  )
}
