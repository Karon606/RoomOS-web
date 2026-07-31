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
- [[double-submit-guard]] — 중복 제출 방어(대기 표시 정본·서버 가드 문법·전수 감사 결과·화면 잠금 단일 의존 자리)
- [[domain-contracts]] — 계약서/동의서 서명·환불조항·주소·인쇄

## 운영 지식
- [[decisions]] — 주요 의사결정 로그(왜 그렇게 했나)
- [[mobile-scroll-viewport]] — 모바일 스크롤·뷰포트 함정(overscroll-contain 은 진짜 스크롤러에만, iOS/Android 키보드·핀치줌 차이, 두 엔진 실기 검증 규칙, 셸 밖 단독 라우트 스크롤 계약 A/B)
- [[money-display-feedback]] — 돈 표시·저장 피드백 정본(표시 정본 수렴·원가 직표시 금지, 받은 돈은 조회월 무관 표시, 저장 피드백 3종·수납일 기본값 오늘, 크리티컬 신고 50a2a69b)
- [[glossary]] — 용어집(귀속월·확정/예정·허브·일할 등)
- [[open-issues]] — 미해결·후속 작업
- [[soft-delete-pattern]] — deletedAt 소프트삭제·적용취소 인프라(2단계 마이그레이션·익스텐션·seqNo 함정)
- [[auth-flow]] — 인증·세션·returnTo 흐름(proxy.ts가 미들웨어, layout이 가드, 공용 라우트, 오픈 리다이렉트 방어)
- [[design-audit-2026-07]] — 디자인 가이드 감사(Phase 1 완료, 보류 목록)

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
