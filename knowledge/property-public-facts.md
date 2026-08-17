# 영업장 공개 값의 진실 원천 (상담·서류·소개 페이지가 공유하는 값)

상담 중 고객에게 알려주는 값, 서류에 찍히는 값, 공개 소개 페이지에 실리는 값은
겹치지만 원천이 다르다. 어느 것을 읽어야 하는지 여기 고정한다.
(2026-08-17 적립, 오류신고 ce05bb74 상담 도구 설계 중 도메인 검토 결과)

## 값별 정본

| 값 | 정본 | 아닌 것 |
|---|---|---|
| 입금 계좌 | `Property.bankAccount` (자유 문자열 1줄) | `FinancialAccount` 표 |
| 영업장 위치 | `Property.address` | `businessInfo.address` |
| 사업자등록번호 | `businessInfo.registrationNo` (`lib/bizNo` 정규화 통과값) | 손 포맷 |
| 대표 연락처 | `Property.phone` | |
| 공개 소개 페이지 URL | `lib/publicSite.publicSiteUrl(publicSlug)` | 화면마다 손조립 |

## 왜 계좌는 FinancialAccount 가 아닌가

`FinancialAccount` 는 **지출·카드정산 원장**이다. 실데이터(제기역점) 11행에 은행계좌 4·신용카드 6·
선불 1 이 섞여 있고 운영자 개인 카드도 들어 있다.

1. 카드 행의 `identifier` 는 **끝 4자리**다(FinanceClient 라벨이 "번호 (끝 4자리)"). 고객이 그걸
   계좌번호로 받으면 이체가 실패한다.
2. 은행계좌 4행 중 어느 것이 수납 계좌인지 **스키마에 표식이 없다**. 정렬이 `createdAt asc` 라
   등록 순서에 따라 첫 행이 바뀐다. 엉뚱한 계좌로 입금이 들어오면 수납 대사가 불능이 된다.
3. 카드의 `linkedAccount` 는 카드 대금 출금계좌다. 고객 입금과 섞이면 안 된다.

`Property.bankAccount` 는 환경설정 라벨이 "입금 계좌번호" 이고, 미납 안내 문자 `{계좌번호}` 치환과
입실료 납부 확인서 '납부방법' 이 이미 이 값을 쓴다. **운영자가 직접 지정한 하나의 수납 계좌**다.

형식은 자유 문자열이다(저장은 `trim` 뿐). 실데이터는 `신한 110-626-594570 | 김건우` 인데
환경설정 placeholder 는 괄호 표기라 한 테넌트 안에서도 형식이 갈려 있다. **파싱하지 말고
원문 통째로 다룬다** — 숫자만 추출·예금주 분리·은행명 매칭은 다음 영업장에서 깨진다.

## 주소가 세 갈래인 것

같은 건물이 서로 다른 문자열로 세 곳에 있다.
- `Property.address` = 찾아오는 건물 소재지. `lib/tenantAddress` 가 실거주 주소를 여기서 조립한다.
- `businessInfo.address` = 사업자등록증 표기. 계약서 헤더·푸터의 임대인 주소.
- `public/members/<slug>/index.html` = **DB 를 읽지 않는 정적 파일**. 설정에서 고쳐도 안 따라온다.

상담 안내는 `Property.address` 다. 사업장 주소와 건물 소재지가 다른 테넌트에서
`businessInfo.address` 를 안내하면 엉뚱한 곳으로 보낸다.

## 이 계열에 절대 섞으면 안 되는 값

- `Property.calendarToken` — 인증 없이 전 입주자 일정을 내려주는 비밀 토큰.
- `Property.joinCode` — 직원 초대용 참여 코드(고객용 아님).
- `stampDriveFileId` — 인영 원본. 위조 서류에 얹힌다([[public-asset-exposure]]).
- `FinancialAccount.identifier`·`owner`·`linkedAccount` — 내부 회계 정보.
- `publicSlug` 원시값 — URL 로 조립한 형태만 쓴다.

## 멀티테넌트에서 깨지기 쉬운 가정

1. **공개 URL 도메인이 항상 `www.stayeum.com`** — `lib/publicSite` 와 `next.config.ts` 리다이렉트,
   환경설정 안내 문구 세 곳에 리터럴이 남아 있다. 자체 도메인 테넌트에서 틀린 링크가 나간다.
2. **슬러그가 있으면 페이지도 있다** — 링크의 실체는 `public/members/<slug>/index.html` 정적 파일이다.
   슬러그만 설정하고 폴더가 없는 영업장은 404 를 복사시키게 된다. 유효성 신호가 코드에 없다.
3. **한 영업장의 주소가 하나** — 위 세 갈래. 영업장이 늘수록 갈래가 세 배씩 는다.

## 권한

`/dashboard` 는 LIMITED_STAFF 화이트리스트 밖이라 제한 스태프는 상담 도구에 닿지 않는다.
OWNER·MANAGER·STAFF 는 이미 `/settings` 에서 같은 값을 본다(새 노출 아님).
다만 **서버 액션은 `requireRouteAccess` 가 못 막는 자리**라 계좌는 액션 안에서
`canReadScope(role, 'money')` 로 직접 끊는다.

관련: [[glossary]] · [[public-asset-exposure]] · [[domain-contracts]]
