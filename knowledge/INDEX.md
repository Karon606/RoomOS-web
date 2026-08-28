# 스테이음 지식 베이스 (INDEX)

이 폴더는 **Obsidian Vault**다(마크다운 + `[[위키링크]]`). 코드와 함께 버전관리되는 "제2의 두뇌".
목적: 새 세션이 Work_log를 *추론*하지 않고, 여기서 **사실**로 시작하도록.

## 사용 규칙
- **세션 시작 시**: `Work_log.md`(최근 진행) + 이 `INDEX.md`(지도)를 읽고, 작업 주제 관련 노트를 본다.
- **중요한 도메인 규칙·결정**이 생기면 여기에 노트로 적립한다(Work_log는 "무엇을 했나" 시간순, 여기는 "무엇이 참인가" 주제별).
- **자동 메모리**(`~/.claude/.../memory/`)는 매 세션 자동 로딩되는 *핵심 요약*만. 상세본은 여기로 링크.
- 두 곳이 충돌하면 **코드가 진실** — 노트의 file:line은 시점 기록이라 단정 전 확인.

## 도메인
- [[domain-billing]] — 월 청구·임대료·할인·일할·예약 인상·락인(결제 핵심 엔진)
- [[domain-inventory]] — 추적품목·수령배치·위치별 점검·단위 매칭(specMultiplier 정본)·평균 소모율(30일 합산)
- [[domain-vacancy]] — 공실 집계 정본(lib/vacancy)·집계 제외(창고·사무실)·입실 파생식
- [[domain-room-stay]] — 거주 구간(RoomStay)과 이사(지금 방 대 거쳐 간 방·이사일 검증 5축·이사 어휘·입퇴실 건수 포함·표시 감지망)
- [[domain-cleaning]] — 청소 결함 대장(D1~D5)·미반환분 분류 규칙(청소비 대 몰취)·수행자 규칙·캘린더 작업 레인 규칙·예정 담당자
- [[domain-auto-checkout]] — 퇴실 예정 **자동 전환**: 리드(한 달 이하 7일 / 그 밖 달력 한 달)·두 축 판정·autoCheckoutAt 재무장·시점 선택과 되돌리기
- [[domain-room-work]] — 방 작업(도배·장판) 도메인: **시공비 대 자재비**(자재는 살 때 이미 지출·이중계상 없음)·백필 규칙·검산 불변식(도배와 장판은 같은 날)
- [[design-visual-identity]] — 'AI 티' 시각 판정 원칙: 원은 도형-기능만·글자면은 각·립은 예외 전용(수납 관리 예외)·코랄 채움은 CTA만, 존치 목록과 클로드 디자인 인계 경계
- [[double-submit-guard]] — 중복 제출 방어(대기 표시 정본·서버 가드 문법·전수 감사 결과·화면 잠금 단일 의존 자리)
- [[domain-contracts]] — 계약서/동의서 서명·환불조항·주소·인쇄
- [[deposit-entry-paths]] — 보증금 수납 진입로 셋·실입금 대 소급 기록 역할 경계·귀속월 규칙·분해 제안 확인형·승계 계약 게이트
- [[property-public-facts]] — 영업장 공개 값의 진실 원천(입금 계좌·주소 3갈래·공개 URL·사업자번호·사업자등록증 사본)·섞으면 안 되는 값·멀티테넌트 가정
- [[doc-vocabulary]] — 서류 동사 정본 5개(발급·보내기·저장·보기·작성)·금지 표현·행 액션 구성·기기별 인쇄 경로

## 운영 지식
- [[decisions]] — 주요 의사결정 로그(왜 그렇게 했나)
- [[month-scope]] — 보고 있는 월의 흐름(URL 정본·내비 전파·localStorage 는 쓰기 전용)·미래 월은 입퇴실 캘린더에서만(해석 정본 lib/monthParam)·팝오버 클립과 착지 루프 함정
- [[mobile-scroll-viewport]] — 모바일 스크롤·뷰포트 함정(overscroll-contain 은 진짜 스크롤러에만, iOS/Android 키보드·핀치줌 차이, 두 엔진 실기 검증 규칙, 셸 밖 단독 라우트 스크롤 계약 A/B)
- [[money-display-feedback]] — 돈 표시·저장 피드백 정본(표시 정본 수렴·원가 직표시 금지, 받은 돈은 조회월 무관 표시, 저장 피드백 3종·수납일 기본값 오늘, 크리티컬 신고 50a2a69b)
- [[cash-receipt-refund]] — 현금영수증은 앱 표시일 뿐 실제 발행은 홈택스(임형진 사례)·환불 재기록의 증빙 메타 유실·**현금영수증 합계는 발행일 축, 카드는 입금일 축**(2026-08-24 정정)
- [[domain-contract-archive]] — 보관용(발급 아닌 밀려남·전환은 채움 문과 한 트랜잭션·묻는 자리 둘·되돌림은 마지막 이력만·감지망 위반과 주의)
- [[domain-room-schedule]] — 호실 일정(입주일이 바뀐 것일 뿐·일정이 진실이고 구간은 파생·이동은 자동·끝점은 계약 호실이 비는 날·후보에 예약 포함)
- [[domain-recurring-cycle]] — 고정지출 주기(달력 달 mod 판정·기준 달 폴백·비도래 달을 감추지 않는다·게이트 전수·표기가 판정에서 파생)
- [[doc-file-format]] — 저장 서류의 형식과 판본(바이트 스니핑이 정본·이미지는 PDF 로 안 싼다·판본 선택 키·용도 번복은 증거와 지위 분리·삭제 복구 30일)
- [[privacy-compliance]] — 개인정보(동의서보다 처리방침이 먼저·주민번호는 동의로도 불가·두 개의 모자(처리자/수탁자)·국외이전은 처리방침으로 갈음)
- [[doc-mail]] — 서류 메일 정본(한 프레임 두 모드·변수 단괄호·잠금화면 원칙·새니타이즈 allowlist·설정 vs 1회성 수정 경계·발신 고정·mail_logs)
- [[glossary]] — 용어집(귀속월·확정/예정·허브·일할 등) + 사람을 부르는 말(입주자/입실자·입주/입실 경계)·다호실 종속(메인 계약)
- [[open-issues]] — 미해결·후속 작업
- [[soft-delete-pattern]] — deletedAt 소프트삭제·적용취소 인프라(2단계 마이그레이션·익스텐션·seqNo 함정)
- [[auth-flow]] — 인증·세션·returnTo 흐름(proxy.ts가 미들웨어, layout이 가드, 공용 라우트, 오픈 리다이렉트 방어)
- [[design-audit-2026-07]] — 디자인 가이드 감사(Phase 1 완료, 보류 목록)
- [[regression-nets]] — 회귀 감지망 목록·자동 실행 배치(커밋 전 빠른 6종·푸시 전 타입체크+DB 4종)·훅 우회법
- [[public-asset-exposure]] — Drive 공개 권한 판정 기준·열람 경로 세 가지·이관 순서(프록시→주소→회수)·명단형 감지망

## 핵심 파일 맵 (자주 건드리는 곳)
- 빌링 엔진: `lib/billing.ts` `billForLeaseMonth`
- 수납: `app/(app)/rooms/actions.ts` `getRoomPaymentStatus`·`savePayment`
- 지출/재무: `app/(app)/finance/{FinanceClient.tsx, actions.ts, page.tsx}`
- 카드 정산: `app/(app)/card-settlement/`
- 재고: `app/(app)/inventory/{overview.ts, actions.ts, InventoryClient.tsx}`
- 계약서: `app/contract/[tenantId]/`, `lib/contract.ts`, `lib/contractPrintHtml.ts`
- 대시보드: `app/(app)/dashboard/{page.tsx, unpaid.ts}`

## 지침 문서 사본 (refs/ — 자동 미러)
- [[refs/AGENTS(프로젝트 규칙)]] · [[refs/CLAUDE(전역 행동지침)]] · [[refs/loop(검증 규칙)]]
- 원본은 저장소 루트(AGENTS.md·loop.md)와 ~/.claude/CLAUDE.md — 수정은 원본에서, 커밋 시 .githooks/pre-commit이 자동 갱신.
