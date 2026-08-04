'use client'

// 서류 화면 골격 정본 (가이드 §30.1·30.2·30.8).
//
// 서류 화면은 **상단 크롬 · 종이 2층**이다. 층의 수와 순서는 서류별로 달라지지 않는다.
// 네 화면이 각자 문법이던 것(테두리 토큰이 갈리고, 액션이 위아래로 흩어지고, 돌아가기 히트가
// 18px 인 화면이 있던 것)을 여기 한 벌로 모은다.
//
// **실행 동사는 상단 크롬에 있다**(운영자 규칙 6 '미리보기 화면 상단 액션'). 하단 액션바를 두지 않는다.
// 한 번 하단으로 내려봤는데 2장짜리 계약서에서 종이를 다 지나쳐야 버튼이 나왔다 — 문서는 화면보다
// 길고 읽는 화면일수록 더 길다. 하단은 열자마자 안 보이는 자리라 '그 버튼이 어디 있느냐'를 만든다.
// 같은 동사를 위아래 두 벌로 두지도 않는다. 상태 동기화가 두 곳이 되어 이 정본이 없애려는 드리프트를
// 이 정본이 만든다.
//
// **크롬은 문서 흐름 안(static)이다.** 그래서 상시 점유가 0 이고, 그것이 이 층이 실행 동사를
// 다 담을 수 있는 이유다. sticky 는 금지다 — 네이티브 핀치줌이 열린 화면에서 layout viewport 상단에
// 못 박힌 채 시야 밖으로 밀리고(신고 d9f93bdd), 세로만 잡아 확대 상태의 가로 이동에서 흘러간다.
// fixed 승격은 **자체 확대를 가진 화면에만** 실기 확인 뒤에 한다. 자체 확대는 종이 폭만 키우고
// 브라우저 핀치를 꺼두므로 밀려날 수 없다. 붙박이 권한과 자체 확대는 한 몸으로 움직인다.
//
// **크롬을 확대 트랙 안에 넣지 마라.** 확대는 종이에만 적용된다. 트랙 안에 두면 배율만큼 넓어진
// 트랙 기준으로 가운데 정렬되어 화면 밖으로 밀린다.
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
