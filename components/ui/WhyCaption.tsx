// 막힌 자리의 이유와 푸는 법을 그 자리 한 줄로 말하는 캡션 정본(가이드 §27.8)
//
// 왜 정본이 따로 서는가. 비활성 칸·버튼의 이유가 title(마우스를 올려야 뜨는 말풍선)이나 코드 주석에만 있어
// 터치 화면에서는 이유를 볼 길이 없었다. 운영자가 "왜 안 되느냐"를 묻게 되는 자리다(2026-10-23 '문의' 비활성).
// 문장은 '~라서 고를 수 없습니다 · ~하면 됩니다' 두 마디이고 서버 거부 문장과 한 벌이다.
// 막힌 컨트롤은 이 캡션의 id 를 aria-describedby 로 가리킨다(Btn·RowActionBtn 은 reason 프롭이 대신한다).

import type { ReactNode } from 'react'

export function WhyCaption({ id, children, action, className = '' }: {
  id: string
  children: ReactNode
  /** 그 자리에서 푸는 링크(선택). 확인창 없이 바로 실행된다. 보이는 글자는 10.5px 이지만 누르는 자리는 44px 이다. */
  action?: { label: string; onClick: () => void }
  className?: string   // 위 간격(mt-1 등)만. 글자 크기·색은 정본이 정한다.
}) {
  return (
    <p id={id} className={`text-[0.65625rem] leading-relaxed text-[var(--warm-muted)] break-keep ${className}`}>
      {children}
      {action && (
        <>
          {' · '}
          {/* 히트 44px 를 위아래 음수 여백으로 줄 높이 안에 접는다. 줄이 커지지 않고 누르는 자리만 넓다(RowActionBtn 과 같은 수). */}
          <button type="button" onClick={action.onClick}
            className="-my-[13px] inline-flex min-h-[44px] items-center whitespace-nowrap align-middle font-medium text-[var(--tc-text)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)]">
            {action.label}
          </button>
        </>
      )}
    </p>
  )
}
