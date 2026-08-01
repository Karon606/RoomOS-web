# 회귀 감지망 (2026-08-01 자동화)

"기존에 잘 되던 게 새 기능 때문에 먹통되는" 것을 막는 장치. 관련: [[mobile-scroll-viewport]], [[money-display-feedback]].

## 왜 자동화했나
감지망 9종이 있었지만 **커밋·배포 어디에서도 자동 실행되지 않았다**(F페이즈에서 확인).
그동안 회귀가 잡힌 건 사람이 매번 손으로 돌렸기 때문이지 체계가 막아준 게 아니었다.

## 배치

| 시점 | 무엇 | 시간 | 조건 |
|---|---|---|---|
| **커밋 전**(`.githooks/pre-commit`) | test-money · test-due-date · **test-settlement-period** · test-tour-feed · test-birthdate · check-standalone-scroll · check-public-tracking | 약 1.5초 | DB·네트워크 불필요 |
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
- **test-settlement-period**(48) 퇴실 정산 기간·퇴실해야 하는 날(다음 납부일 −1일)·말일/짧은 달 클램프·연말 경계·입주월 보정·임시조정
- **test-tour-feed**(36) 투어 표시 판정 매트릭스
- **test-birthdate**(27) 원격 서명 생년월일 게이트
- **check-standalone-scroll** 셸 밖 라우트의 스크롤 계약(A/B) + **정본 컴포넌트 알맹이**
  (DocumentScroll 의 클래스 토글, Modal 의 배경 잠금 호출, globals 의 잠금 규칙)
- **check-public-tracking** 공개 페이지 트래킹 참조 유지
- **verify-money-consistency** 원가 직표시·중복 수납·할인 미반영 락·미래 수납일·스트립 RESERVED 혼입·단기 일할
- **verify-recurring-estimate** / **check-restock-hub-drift** / **check-room-stay-drift** 데이터 드리프트

## 만들 때의 교훈 — 마운트만 보면 알맹이가 빠져도 통과한다

`check-standalone-scroll` 은 원래 `<DocumentScroll />` 이 **마운트됐는지**만 봤다.
그래서 DocumentScroll **안의 클래스 토글을 지워도 통과**했다(자동화 검증 중 실측).
Modal 검사도 처음엔 `/lockBackgroundScroll/` 이라 **import 만 남아도 통과**했다 — 호출(`()`)을 봐야 한다.

**감지망을 새로 만들면 반드시 회귀를 일부러 주입해 잡히는지 확인한다.** 통과만 보면 무력한 감지망을 신뢰하게 된다.

## 아직 감지망이 없는 축

돈 계산 외 영역(사람 상태 전이, 서류 발급 문구, 대외 페이지 다국어 4벌 일치)은 상시 감지가 없다.
각 페이즈에서 발견한 클래스마다 추가한다. 진행은 `docs/audit-2026-08/checklist.md`.
