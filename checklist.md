# 계약서 '폐기하고 다시 작성' (긴급 신고 63cd1049, 2026-08-19)

신고 원문.
"계약서에 이름이 한국어로 된 채 발급까지 되어버려서 폐기하고 다시 작성을 하기 위해 삭제를 누르고
작성하려니 안 되네. 아래에 안내는 지우라고 하는데 이미 지워졌는데도 안 돼. 계약서 페이지로 가서
보니 발급 안 한 거 있다고 발급하라고 하고. 발급하니 원래대로 돌아왔어. 이 상황이면 이중계약서
(지난번에 어쩔 수 없이 필요한 경우가 있다고 했어) 작성도 못하게 되는 거야."

대상 입주자 e1fe94c6(501호). 실데이터는 읽기 전용으로만 본다 — 정정은 배포 후 운영자 실기 몫.

## 0단계 — 원인 확정 (읽기 전용, 완료)
- [x] 실데이터 재구성: 링크 f0c0b642 서명(8/19 06:10) → 발급 #014(06:13) → 삭제(06:17) → 재발급 #015(06:19)
- [x] 잠금 사슬 지목: isSignatureLocked(4칸 OR) → saveContractFieldOverride 거부 → nameStyle 전환 불가
- [x] 발급본 삭제(deletedAt)가 잠금 사슬 어느 고리도 안 건드림을 확인
- [x] "지우라" 안내(FIELD_LOCK_MSG)와 실제 조건(4칸 OR·전량 삭제 문이 드리프트 경고에만) 갈림 확인
- [x] /contracts 발급 대기 부활 경로(isContractIssued 의 deletedAt: null) 확인
- [x] 재발급이 옛 이름으로 나가는 이유(nameStyle 오버라이드 부재 → 기본 'ko') 확인
- [x] 기준선 채취: tsc 0 · verify:db 통과 · 박제 8건(기준선 6, 스크립트가 8 로 상향 안내)

## 1단계 — 폐기 정본 (스키마 + 서버)
- [x] lib/contractVersion.ts — 폐기 이력 모양·조립·복원·'지금 서명을 만든 링크' 판정 정본
- [x] schema.prisma: lease_terms.contractVersionArchive(Json?) · contract_files.voidedAt(DateTime?)
- [x] prisma/migrate_contract_version_void.sql (IF NOT EXISTS, 행 데이터 불변) + DIRECT_URL 적용
- [x] voidContractVersion / restoreContractVersion 서버 액션
- [x] clearContractSignature 가 '서명 0' 이 되는 모든 갈래에서 같은 정본을 타게 (증거 파괴 경로 봉합)
- 검증: tsc 0 · 함수 단위 테스트 통과

## 2단계 — 진입로와 표시
- [x] ContractView 툴바 [이 계약서 폐기] (잠긴 상태에서만) + 확인창 + 토스트 적용취소
- [x] 드리프트 '재서명 받기' 갈래도 같은 정본으로
- [x] ContractFilesPanel · /contracts 목록 [폐기됨] 배지 + [현재] 후보에서 제외
- 검증: 320/360/390 라이트·다크 넘침 0

## 3단계 — 오판 문구·판정 봉합
- [x] 잠금 안내 3종(표시값·본문·계약일)이 실제 조건과 폐기 진입로를 말하게
- [x] 발급본 삭제 확인창이 "삭제는 폐기가 아니다"를 먼저 말하게 (두 화면 동일 문구)
- [x] /contracts 발급 대기 안내에 '내용을 바꾸려면 폐기' 경로 한 줄
- [x] 드리프트 비교 대상을 '지금 서명을 만든 링크'로 한정 (폐기 후 허위 경고 차단)

## 4단계 — 감지망·검증
- [x] check-sign-date-integrity 축 1 에서 폐기본 제외 (폐기된 종이의 계약일은 그때가 맞다)
- [x] check-contract-override-lock G1·G5 대조 대상을 같은 정본으로 + G7(폐기 이력 증거 결손) 신설
- [x] check-contract-issued-snapshot SNAPSHOT_BASELINE 6 → 8 (스크립트 자체 안내)
- [x] scripts/test-contract-void.ts + verify:fast 편입, 역주입 발화 확인
- [x] 실데이터 함수 수준 실증(쓰기 없음): 폐기 → 이름 표기 전환 → 재발급 값 확인
- [x] tsc 0 · verify:fast · verify:db · 프로덕션 빌드 · eslint 신규 0
