// 테스트 사이트 표시 띠 — 운영이 아닌 모든 배포에서 화면 최상단에 상시 표시.
//
// 테스트 DB 는 운영 데이터 복사본이라 두 사이트의 화면이 픽셀 단위로 같다. 주소 말고는
// 구별 단서가 없다. 표시가 없으면 운영자가 실제 수납을 테스트 DB 에 넣고 그 장부는 영영
// 반영되지 않는다. 그래서 '운영임이 증명될 때만 숨긴다'로 두고, 판정은 lib/env 정본을 쓴다.
//
// 서버 컴포넌트다. 클라이언트에서 환경변수를 읽으면 NEXT_PUBLIC 접두를 빠뜨렸을 때
// 에러도 경고도 없이 항상 undefined 가 되어 띠가 조용히 사라진다.
//
// 높이는 --sysbar-h 로 예약한다(globals.css). 운영에서는 0px 이라 셸 계산이 종전과 같다.
// aria-live 를 붙이지 않는 이유 — 이건 상태 변화가 아니라 변하지 않는 환경 사실이다.
// live 로 두면 라우트 전환마다 스크린리더가 같은 문장을 다시 읽는다.

import { isStagingEnv } from '@/lib/env'

export function StagingBanner() {
  if (!isStagingEnv()) return null
  return (
    <div
      role="region"
      aria-label="사이트 환경 안내"
      data-peek-hide
      className="no-print fixed top-0 inset-x-0 flex items-center justify-center gap-1.5 px-3 text-[11px] font-medium pointer-events-none"
      style={{
        height: 'var(--sysbar-h)',
        zIndex: 'var(--z-sysbar)',
        background: 'var(--pill-bg)',
        color: 'var(--on-solid)',
        letterSpacing: '0.02em',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.7 }}>
        <path d="M12 9v4" /><path d="M12 17h.01" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      테스트 사이트<span aria-hidden> · </span><span className="hidden sm:inline">문자와 푸시는 나가지 않습니다</span>
    </div>
  )
}
