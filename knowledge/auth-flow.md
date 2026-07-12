# 인증·세션·복귀(returnTo) 흐름

이 저장소의 인증 구조는 표준 Next.js와 달라 비직관적이다. 정본으로 기록한다.

## 미들웨어는 middleware.ts 가 아니라 proxy.ts
- 이 수정된 Next.js는 미들웨어를 루트 `proxy.ts`(export `proxy`, `config.matcher`)로 쓴다. 빌드 로그의 "Proxy (Middleware)"가 이것.
- `lib/supabase/middleware.ts`(export `updateSession`)는 **어디서도 호출 안 되는 죽은 코드**(옛 잔재). 여기 고쳐봐야 효과 없음. proxy.ts를 봐야 한다.

## 세션 갱신·진입 라우팅 = proxy.ts
- 매 요청 `supabase.auth.getUser()`로 세션 갱신(응답 쿠키 재설정).
- `/`·`/login`만 리다이렉트 처리. 로그인 상태면 returnTo(또는 hasProperty ? /dashboard : /property-select)로, 비로그인 `/`는 /login으로.
- **보호 라우트(/dashboard·/rooms 등)의 인증 가드는 proxy가 안 함** — 아래 layout이 함.
- 서버 컴포넌트가 현재 경로를 알도록 요청 헤더 `x-pathname`(경로+쿼리) 주입. `set()`이라 클라이언트 위조값은 덮어써 무시.

## 실제 인증 가드 = (app)/layout.tsx
- `supabase.auth.getClaims()`(JWT 로컬 검증, getUser 네트워크 왕복 제거 — 의도된 최적화. proxy가 세션 갱신하므로 layout은 검증만).
- `if (!claims) redirect('/login?returnTo=<x-pathname>')` — 세션 만료 시 딥링크 복귀. returnTo는 `isInternalPath`로 정제.
- 이후 승인(/pending)·프로필(/profile-setup)·영업장(/property-select) 게이팅.
- 이 가드는 **(app) 그룹에만** 적용. 공용/입주자 페이지는 그룹 밖이라 무관.

## 공용(인증 불필요) 라우트
`/login` · `/callback`(OAuth) · `/reset-password`(이메일 링크) · 입주자용 `/contract/[tenantId]` · `/rent-receipt/[tenantId]` · `/residence-cert/[tenantId]`. 이들에 인증 게이팅 넣으면 입주자가 서명·열람 못 함 — proxy 전역 게이팅 금지.

## returnTo 오픈 리다이렉트 방어
`lib/auth/returnTo.ts` — `isInternalPath`(안전 판정)·`safeReturnTo`(위반 시 /property-select). '/' 단일 슬래시 내부 경로만 허용, 절대 URL·'//'·'/\\'·제어문자 차단. 소비 지점 전부 경유: proxy.ts·(app)/layout.tsx·callback/route.ts·EmailLoginForm·LoginButton(OAuth redirectTo는 encodeURIComponent).

관련: [[decisions]] · [[soft-delete-pattern]]
