# 보안 점검 (2026-07-04)

운영자 요청 "전반적 보안 문제 없는지". 저장소가 public(Vercel 메타 확인)이라 비밀 노출·격리를 우선 축으로.

## 안전 확인 (문제 없음)
- **비밀키**: `.env*` gitignore, 커밋된 시크릿 0건.
- **SQL 인젝션**: `queryRawUnsafe`/`executeRawUnsafe` 0건 — 전부 Prisma 파라미터화.
- **XSS**: report `renderMarkdown`이 `& < >` 먼저 이스케이프 후 처리. 나머지 dangerouslySetInnerHTML은 정적 테마 스크립트.
- **공개 문서(계약서·영수증·거주확인)**: `/contract·/rent-receipt·/residence-cert`는 (app) 밖이지만 액션이 `requireAuthAndProperty()` + `where {id, propertyId}` 스코프 → PII 유출 없음.
- **cron**: `/api/cron/push-alerts` CRON_SECRET Bearer 검증.
- **calendar/[token]**: DB `calendarToken` 매칭 — 토큰 기반(엔트로피 확인은 후속 권장).
- **track/pageview·closeup**: 쓰기 전용 텔레메트리 — 저위험.

## 조치 완료
- **[중간→해결, 584eba7] 유료 API denial-of-wallet**: ai-analysis·market-analyze(Gemini)·naver-places(네이버)가 인증 없이 열려 외부가 우리 API 비용 소진 가능 → `getClaims()` 게이트 추가(401). 앱 내부 호출은 세션 동반이라 불변.
- **[IME, 35dfef4]** 영업장 이름 입력 자모 분리 — 보안 아님(렌더 리마운트). 인라인 컴포넌트 → JSX 상수.

## 해결 (2026-07-06, ee5225e — 운영자 승인 후 시공)
**영업장 격리 중앙화 완료**: lib/auth/propertyAccess.ts `requirePropertyAccess()`(redirect)/`getPropertyAccess()`(nullable, API용).
허용 = UserPropertyRole 행 | property.ownerId(레거시) | 슈퍼관리자. React cache()로 요청당 1회 조회.
- 22개 파일 로컬 getPropertyId/requireAuthAndProperty → 관문 위임, getMyRole STAFF 폴백 제거(비멤버는 /property-select).
- (app)/layout 격리 가드(슈퍼관리자 관리자 뷰는 유지), export·doc-file 403 게이트, import 2종은 중앙 관문+canEdit(오탐 해소).
- generate 3종 라우트는 requireEdit→getMyRole→관문으로 전이적 검증(쿠키 직독 잔존하나 동일 요청서 검증됨).
- 검증: scripts/verify-property-access.mjs — 전 (user×property) 조합 구/신 판정 diff, 정상 사용자 잠김 0, 신규 차단은 구 STAFF 폴백 무단 읽기뿐.

### (기록) 원 문제 — 영업장 격리가 UUID 비밀성에 의존:
- 모든 서버 액션의 `getPropertyId()`/`requireAuthAndProperty()`가 쿠키 `selected_property_id`를 **멤버십 재검증 없이 신뢰**.
- 정상 경로(selectProperty)는 멤버십 확인 후에만 쿠키를 씀 + 쿠키 httpOnly. 그러나 인증된 사용자가 **요청 헤더에 남의 영업장 UUID를 직접 실어 보내면** 그 영업장 데이터를 읽을 수 있음(쓰기는 requireEdit→canEdit=STAFF 차단, **읽기는 무방비**).
- **실질 위험 낮음**: UUID v4(추측·목록화 불가) 필요. 하지만 접근통제를 ID 비밀성에 기대는 것은 원칙 위반(방어심층화). 상용화 시 영업장 증가 + UUID가 에러리포트·공유링크·지원채널로 유출 가능.
- **제안**: 공용 `requirePropertyAccess()` — userId×propertyId `UserPropertyRole` 존재(또는 슈퍼관리자/오너) 확인. 약 15개 액션 파일의 로컬 getPropertyId를 이 헬퍼로 대체. 멤버십 조회 1회 추가(성능 영향 극소, 캐시 가능). getMyRole의 STAFF 폴백도 '멤버 아니면 접근 거부'로 정정.
- **위험**: 인증층 광범위 변경 → 회귀 시 정상 사용자 접근 차단 가능. 소단위·페이지별 검증 필요. §4 규칙상 승인 후 착수.
