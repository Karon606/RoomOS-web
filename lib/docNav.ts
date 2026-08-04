// 서류 화면의 돌아가기 목적지 정본 (가이드 §30.8).
//
// 목적지는 **열거 키**로만 받는다. 경로를 받으면 오픈 리디렉트가 되고, 라벨을 받으면
// 우리 크롬 안에 임의 문자열이 그려진다. 라벨은 각 목적지의 h1 을 그대로 옮겼다.
//
// 표는 여기 한 곳이다. 새 서류 목록이 생기면 여기에만 추가한다 —
// 화면마다 하드코딩하던 것이 "입주자 상세에서 들어갔는데 목록으로 튕긴다"를 만들었다.
// 진입 링크가 from 을 안 실으면 조용히 홈으로 떨어지므로, 링크를 새로 놓을 때 반드시 함께 싣는다.

export type DocFrom = 'contracts' | 'rent-receipts' | 'residence-certs' | 'tenant'

const BACK: Record<Exclude<DocFrom, 'tenant'>, { label: string; href: string }> = {
  contracts:         { label: '계약서',              href: '/contracts' },
  'rent-receipts':   { label: '납부 확인서 · 영수증', href: '/rent-receipts' },
  'residence-certs': { label: '실거주 확인서',        href: '/residence-certs' },
}
const HOME = { label: '홈', href: '/dashboard' }

/** from 열거 키를 돌아갈 라벨·경로로 옮긴다. 모르는 키는 홈이다. */
export function resolveDocBack(from?: string, tenantId?: string): { label: string; href: string } {
  if (from === 'tenant' && tenantId) {
    return { label: '입실자 정보', href: `/tenants?tenantId=${encodeURIComponent(tenantId)}` }
  }
  return (from && from !== 'tenant' ? BACK[from as Exclude<DocFrom, 'tenant'>] : undefined) ?? HOME
}

/** 서류 라우트로 갈 때 붙일 질의문자열. 진입점이 이걸 써야 돌아가기가 제 목적지를 안다. */
export function docFromQuery(from?: DocFrom, tenantId?: string): string {
  const q = new URLSearchParams()
  if (from) q.set('from', from)
  if (from === 'tenant' && tenantId) q.set('tenantId', tenantId)
  const s = q.toString()
  return s ? `?${s}` : ''
}
