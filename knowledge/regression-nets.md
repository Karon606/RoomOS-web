# 회귀 감지망 (2026-08-01 자동화)

"기존에 잘 되던 게 새 기능 때문에 먹통되는" 것을 막는 장치. 관련: [[mobile-scroll-viewport]], [[money-display-feedback]].

## 왜 자동화했나
감지망 9종이 있었지만 **커밋·배포 어디에서도 자동 실행되지 않았다**(F페이즈에서 확인).
그동안 회귀가 잡힌 건 사람이 매번 손으로 돌렸기 때문이지 체계가 막아준 게 아니었다.

## 배치

| 시점 | 무엇 | 시간 | 조건 |
|---|---|---|---|
| **커밋 전**(`.githooks/pre-commit`) | test-money · test-due-date · **test-settlement-period** · **test-accounting-guard** · test-tour-feed · test-birthdate · check-standalone-scroll · check-public-tracking | 약 1.7초 | DB·네트워크 불필요 |
| **푸시 전**(`.githooks/pre-push`) | iCloud 중복 파일 정리 → `tsc --noEmit` → verify-money-consistency · verify-recurring-estimate · check-restock-hub-drift · check-room-stay-drift | 약 9초 | `.env.local` 있을 때만 DB 4종 |

푸시가 곧 배포(Vercel)라 **마지막 관문은 pre-push**다. 커밋 훅은 자주 도니 DB를 태우지 않는다.

수동: `npm run verify:fast` · `npm run verify:db` · `npm run verify`

**우회**: `git commit --no-verify` / `git push --no-verify` / `STAYEUM_SKIP_HOOKS=1`.
우회는 기대값이 바뀐 게 확실할 때만. 규칙 변경은 loop.md 4번(운영자 승인) 대상이다.

**iCloud 주의**: 저장소가 iCloud Drive 위에 있어 `.next` 에 "파일 2.ts" 사본이 생기고, 그대로 두면
tsc 가 중복 식별자 오류로 실패한다. pre-push 가 먼저 지운다(`find .next -name "* [0-9].*" -delete`).

## 감지망이 검사하는 것

- **test-money**(99) 일할·환불·단기 견적·할인 등 금전 계산
- **test-due-date**(33) 납부일 3포맷·임시조정·cutoff 비교
- **test-settlement-period**(57) 퇴실 정산 기간·퇴실해야 하는 날(다음 납부일 −1일)·말일/짧은 달 클램프·연말 경계·입주월 보정·임시조정 무시(유예는 기한만 미룬다)·30일 상한(계약서 조항)
- **test-accounting-guard**(33) 과거 회계월 보호 — 경계선은 연도가 아니라 신고 기한 날짜. 소득세 확정신고(다음해 5/31) 지난 귀속연도만 차단, 부가세·사업장현황신고 기한은 강한 고지, 인수 이전 차단
- **test-tour-feed**(36) 투어 표시 판정 매트릭스
- **test-birthdate**(27) 원격 서명 생년월일 게이트
- **check-standalone-scroll** 셸 밖 라우트의 스크롤 계약(A/B) + **정본 컴포넌트 알맹이**
  (DocumentScroll 의 클래스 토글, Modal 의 배경 잠금 호출, globals 의 잠금 규칙)
- **check-public-tracking** 공개 페이지 트래킹 참조 유지
- **verify-money-consistency** 원가 직표시·중복 수납·할인 미반영 락·미래 수납일·스트립 RESERVED 혼입·단기 일할
- **check-public-site** 공개 홍보 사이트 — 4벌 규칙·§29 금지 문자·og 5종·CSS 클래스 충돌·
  갤러리 다국어 사전(언어별 키 구성 일치)·갤러리 접근성 6종·추적 정합(geo 순서·CTA 셀렉터·
  ctaClicks·activeMs·유령 섹션 선언). build 게이트에 물려 있다
- **verify-recurring-estimate** / **check-restock-hub-drift** / **check-room-stay-drift** 데이터 드리프트

verify-money-consistency 는 돈 밖으로도 넓어졌다 — 상태 전이표 검사·예약 선납 재앵커 호출부 4곳·
Drive 공개 권한 명단·영수증 주소 형태·도장 임베드·캘린더 토큰 CSPRNG. 자세히는 [[public-asset-exposure]].

## 만들 때의 교훈 — 마운트만 보면 알맹이가 빠져도 통과한다

`check-standalone-scroll` 은 원래 `<DocumentScroll />` 이 **마운트됐는지**만 봤다.
그래서 DocumentScroll **안의 클래스 토글을 지워도 통과**했다(자동화 검증 중 실측).
Modal 검사도 처음엔 `/lockBackgroundScroll/` 이라 **import 만 남아도 통과**했다 — 호출(`()`)을 봐야 한다.

**감지망을 새로 만들면 반드시 회귀를 일부러 주입해 잡히는지 확인한다.** 통과만 보면 무력한 감지망을 신뢰하게 된다.

D 페이즈에서 새로 짠 그물 넷이 역주입에서 안 잡혀 고쳤다. 실패 양상이 반복된다.

1. **부분 문자열** — `includes('activeMs')` 는 `activeMsX` 로 이름만 바꿔도 통과한다.
   `lastFocus` 도 같았다. 검사 문자열은 **호출 형태까지** 잡아야 한다(`r.activeMs ?? r.durationMs`).
2. **같은 문자열이 주석에도 있다** — `open.kakao.com` 이 셀렉터에서 빠져도 주석 때문에 통과했다.
   파일 전체가 아니라 **그 선언 줄만** 본다.
3. **정규식으로 중첩 구조를 가른다** — `@media` 블록을 정규식으로 벗기려다 규칙 절반을 놓쳤다.
   중괄호 깊이를 직접 세야 한다.

## 감지망이 운영 흐름을 끊는 것도 결함이다

B 페이즈 상태 전이표를 먼저 짜고 실측했더니 **실제로 쓰이는 흐름 5종을 막고 있었다**
(RESERVED -> WAITING_TOUR 가 19건). 쓰이는 것은 뜻이 성립하는 것이다. 표를 넓혔다.
그리고 "실제로 쓰인 전이를 표가 막으면 위반"을 그물에 넣었다 — 그물 자신을 감시하는 그물이다.

## 데이터 조건으로 걸면 영구 실패 게이트가 된다

"지금 공개인 파일이 있나" 같은 데이터 조건은 이관이 끝나기 전까지 계속 실패한다.
그런 자리에서는 **코드가 규칙을 다시 어기는지**를 본다(명단·소스 가드).
데이터 그물은 이관이 끝나 상시 참이 된 뒤에 겹친다.

## 목록은 package.json 이 정본이다 (2026-08-03)

훅은 `npm run verify:fast` / `verify:db` 를 부르기만 한다. **훅에 스크립트 이름을 나열하지 않는다.**
전에는 훅과 package.json 이 각자 목록을 들었고 실제로 5종이 어긋났다 —
공개 사이트 감지망이 커밋 때 안 돌았고, 재고 규격·경계 두 종이 푸시 때 안 돌았다.
`npm run verify` 는 계속 실패하는 상태였는데 훅이 그걸 안 불러서 아무도 몰랐다.

| 묶음 | 무엇 | 어디서 도나 |
|---|---|---|
| `verify:fast` | 순수 로직 9종 (DB 불필요) | pre-commit · 2.1초 |
| `verify:db` | DB 대조 9종 | pre-push · 3.6초 |
| `verify:data` | **운영자 입력 대기** (규격 누락) | pre-push 에서 경고만, 막지 않는다 |
| build 게이트 | check-public-tracking · check-public-site | Vercel 배포 |

## 게이트와 입력 대기를 가른다

`check-spec-missing` 은 "낱개 용량이 안 들어간 지출"을 잡는다. 진짜 문제지만
**개발자가 푸시 시점에 채울 수 있는 값이 아니다.** 게이트로 두면 값이 채워질 때까지 모든 배포가 막힌다.
그래서 `verify:data` 로 분리해 pre-push 가 **보여주되 막지 않는다**. 조용히 넘어가지도 않는다.

판정 기준 — **개발자가 지금 고칠 수 있으면 게이트, 운영자가 값을 넣어야 하면 입력 대기다.**

## 만들었는데 안 도는 감지망이 또 있었다

F 페이즈에서 "감지망은 만들어만 두면 안 돌아간다"를 고쳤는데, 그때 목록에서 셋이 빠졌다.
전부 실제 신고를 보고 만든 것들인데 **한 번도 자동으로 돈 적이 없었다.**
게다가 셋 다 출력만 하고 `exit 0` 이라 물려도 통과만 했을 것이다.

- `check-deposit-settlement` 퇴실 보증금 정산 누락 (신고 249b5652)
- `check-tracked-categories` 비추적 카테고리 활성 카드 (서빙집게 사건)
- `check-spec-dims` 규격 차원 불일치 (신고 0d6242f0)

세 번째는 판정도 틀렸다. **차원 불일치 자체는 정상이다** — '라면 120g x 100개'는 올바른 입력이다.
결함은 그 상태에서 곱셈이 실제로 걸리는 것이다. 불일치 존재로 걸면 늘 실패한다.

**새 감지망을 만들면 그 자리에서 훅에 연결하고, 실패 조건을 넣고, 역주입으로 종료코드 1 을 확인한다.**
셋 중 하나라도 빠지면 없는 것과 같다.

## 감지망이 없는 축은 없다 (2026-08-03)

사람 상태 전이(B)·대외 다국어 4벌(D)·서류 발급 문구를 전부 붙였다.
서류 쪽은 두 겹이다 — 화면(ContractView)과 인쇄(contractPrintHtml)의 **변수 표가 같아야 하고**,
저장된 템플릿의 `{{키}}` 를 코드가 전부 채울 수 있어야 한다. 못 채우면 renderContractText 가
원문을 그대로 남겨 **자리표시자가 실제 계약서에 찍혀 나간다**(실제로 29건이 비문이었다).

## 못 읽으면 통과가 아니라 위반이다

계약서 변수 그물을 정규식으로 짰다가 `useMemo<Record<string,string>>` 제네릭에서 빗나가
null 을 돌려줬고, **대조 자체가 조용히 건너뛰어졌다.** 통과처럼 보였다.
깊이 추적으로 바꾸면서 "파싱 실패 = 위반" 을 명시했다.

소스를 파싱하는 그물은 파싱이 깨지는 순간 무력해진다. 그러니 **파싱 실패를 통과로 두지 않는다.**
