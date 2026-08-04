'use client'

// 서류 화면 골격 정본 (가이드 §30.1·30.2·30.8).
//
// 서류 화면은 상단 크롬 · 종이 · 하단 액션바 3층이다. 층의 수와 순서는 서류별로 달라지지 않는다.
// 네 화면이 각자 문법이던 것(테두리 토큰이 갈리고, 액션이 위아래로 흩어지고, 돌아가기 히트가
// 18px 인 화면이 있던 것)을 여기 한 벌로 모은다.
//
// **상단 크롬도 하단 액션바도 문서 흐름 안이다. sticky·fixed 를 쓰지 않는다.**
// 확대가 열린 화면에서 sticky 는 layout viewport 상단에 못 박힌 채 시야 밖으로 밀려,
// 종이 가운데를 읽는 동안 돌아가기에 닿을 수 없다(신고 d9f93bdd). 상시 부유가 허용되는 것은
// 확대 컨트롤 하나뿐이다(§30.7).
//
// 레일이 100% 가 아니라 100vw 인 이유 — 확대하면 부모가 width: fit-content 로 넓어지는데
// 100% 는 그 넓어진 폭을 따라가 버린다.

import Link from 'next/link'
import { resolveDocBack } from '@/lib/docNav'

export const DOC_RAIL = 'min(210mm, 100vw - 24px)'

/** 상단 크롬 · 하단 액션바 · 안내문이 공유하는 폭. 손으로 베끼지 말고 이걸 쓴다. */
export const docRailStyle: React.CSSProperties = { width: 'var(--rail)', marginInline: 'auto', flex: 'none' }

/** 서류 화면 바깥 껍데기가 깔아야 하는 변수. 레일을 쓰는 모든 층의 조상에 있어야 한다. */
export const docShellVars = { ['--rail' as string]: DOC_RAIL } as React.CSSProperties

export const docChromeStyle: React.CSSProperties = {
  ...docRailStyle,
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
  padding: '10px 14px', background: 'var(--cream)',
  border: '1px solid var(--warm-border)', borderRadius: 10, marginBottom: 10,
  boxShadow: '0 4px 12px rgba(0,0,0,.06)',
}

export const docActionBarStyle: React.CSSProperties = {
  ...docRailStyle, display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12,
}

/** 크롬 바로 아래 안내 1줄. 크롬 안에 넣으면 늦게 나타나며 버튼 행을 통째로 민다(§17). */
export const docHintStyle: React.CSSProperties = {
  width: 'var(--rail)', fontSize: 12, color: 'var(--ink-s)', margin: '0 auto 12px',
}

/**
 * 돌아가기 — `‹ 목적지이름`. 히트 영역 44px(§09).
 * 형제 서류 화면의 복귀 링크는 패딩 없는 13px 라 히트가 약 18px 이었다. 보이는 크기는 13px 그대로 둔다.
 */
export function DocBackLink({ from, tenantId }: { from?: string; tenantId?: string }) {
  const back = resolveDocBack(from, tenantId)
  return (
    <Link href={back.href} style={{
      color: 'var(--tc-text)', fontSize: 13, textDecoration: 'none',
      display: 'inline-flex', alignItems: 'center', minHeight: 44,
    }}>{'‹'} {back.label}</Link>
  )
}
