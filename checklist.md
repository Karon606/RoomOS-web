# 창고 특약(추가 호실 특약) 시공 체크리스트 — 2026-08-19

확정 설계: 창고 특약 확정 설계(패널 산출 + 운영자 위임 확정, 2026-08-19).
형태는 본문에 조건부 절 하나. 기존 24개 조항 무수정, 별지 기각, 문안 코드 정본 고정.

## 1단계 — 문안·부착 정본 (lib/contract.ts)
- [x] DEFAULT_SUB_LEASE_ADDENDUM (절 제목 + 8항, 설계 문안 그대로)
- [x] appendSubLeaseAddendum — null 이면 받은 배열 그대로 반환(diff 0 보장), 번호 동적(기본 5)
- [x] SignedContractSnapshot·ResolvedBody·resolveSignedBody 에 선택 필드(옛 박제 = null)
- [x] 커밋

## 2단계 — 조건 정본 (lib/contractData.ts)
- [x] room select 에 nonResidentVacant 추가
- [x] contractSubLeaseAddendum — NON_RESIDENT + nonResidentVacant=false, 박제본은 동결값
- [x] ContractData.subLeaseAddendum
- [x] 커밋

## 3단계 — 렌더 (화면·인쇄)
- [x] ContractView 1155행 splitClauseColumns 앞에 헬퍼(편집 목록 미노출, 옛 스냅샷 ?? null)
- [x] contractPrintHtml 166행 동일 적용(renderFrag 재사용)
- [x] 커밋

## 4단계 — 사영 축 (lib/contractPrintedFacts.ts)
- [x] 축 subLeaseAddendum + 라벨 '추가 호실 특약', 없으면 undefined
- [x] IssuedContractSheet — 표시값 표에서 빼고 '본문 출처'에 조건부 한 줄(기존 발급본 시트 무변동)
- [x] 커밋

## 5단계 — 발급·서명 박제
- [x] generate route: room select · 판정 · printData · 발급본 박제 facts · 대면 서명 박제
- [x] sign actions 127행 newSnapshot 동결
- [x] contractShare 무변경 확인(withoutPlainPii 가 `...d` 전개라 새 칸 보존)
- [x] 커밋

## 게이트
- [x] tsc 0
- [x] verify:fast 전 축 통과 (커밋 훅 5회 + 최종 1회)
- [x] verify:db 계약 축 전부 통과 — 발급본 박제 6/6(기준선 6) · 본문 잠금 위반 0 ·
      계약일 정합 위반 0 · 신원번호 평문 0. 기존 데이터 결함 3건은 무관(아래 관찰)
- [x] 프로덕션 빌드 성공 (컴파일 14.0s · 정적 47/47)
- [x] eslint 496 (기준선 496 · 신규 0, stash 대조)
- [x] 계약서 화면 320/360/390 × 라이트/다크 12조합 넘침 0

## 검증 필수 4종
- [x] 종속 없는 실계약 전건 렌더 문자열 대조 — 164건 중 162건 문자 단위 동일,
      차이 2건은 김상혁 509(auto·지목) 즉 특약 대상 그 자체
- [x] 김상혁 합본 — 특약 절 '5. 추가 호실 특약(보관 용도)' 8항 렌더 + PDF 실측
      (특약 전후 모두 100% 배율·3장, 88% 하한 되돌림 동일 = 다중 페이지 경로 정상)
- [x] 기존 발급본·박제·서명 링크 기준선 무변동 — 링크 23건·박제 6건 전부 새 축 없음(undefined)
- [x] 감지망 축(특약 조건 대 렌더 일치) — 164건 대조 불일치 0
