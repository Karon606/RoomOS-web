// 단건 문자(sms:) 링크 생성 — iOS는 body 구분자로 &, 그 외 플랫폼은 ? 를 쓴다(UA 분기).

import { pushToast } from './saveStatus'

// 문자앱으로 넘기기 직전 가로채기 — 테스트 사이트면 막고 true 를 돌려준다.
//
// 문자는 서버가 보내지 않는다. sms: 링크로 운영자 폰의 메시지앱을 여는 방식이라 자동 발송은
// 없지만, 테스트 DB 가 운영 복사본이라 **진짜 입주자 번호와 실제 미납액이 채워진 채로** 열린다.
// 거기서 한 번 더 누르면 실제로 나간다.
//
// 판정은 루트 레이아웃이 심어둔 data-env 를 읽는다. 그 값은 lib/env 정본에서 나온다 —
// 여기서 환경변수를 다시 읽으면 판정이 둘로 갈리고, 클라이언트에서는 NEXT_PUBLIC 접두를
// 빠뜨렸을 때 에러 없이 항상 빈 값이 되어 가드가 조용히 사라진다.
export function blockSmsIfStaging(e?: { preventDefault: () => void }): boolean {
  if (typeof document === 'undefined') return false
  if (document.documentElement.dataset.env !== 'staging') return false
  e?.preventDefault()
  pushToast('info', '테스트 사이트라 문자앱으로 넘기지 않습니다', {
    detail: '본문은 화면의 미리보기 그대로입니다',
  })
  return true
}

export function singleSmsHref(phone: string, body: string): string {
  const sep = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?'
  return `sms:${phone.replace(/[^0-9+]/g, '')}${sep}body=${encodeURIComponent(body)}`
}
