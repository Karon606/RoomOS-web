# 환경설정 IA 2단계 — 8탭 재편 (2026-08-19, 운영자 승인)

1단계(2026-08-18)는 웹사이트 탭 신설. 2단계는 남은 일곱 칸의 뜻을 다시 나눈다.
탭 수는 여덟 그대로, 기능 변경 0, 위치 이동과 저장 분해만.

## 0단계 — 위험 확정
- [x] 1순위 위험 = 저장 무회귀. updatePropertySettings 가 FormData 통짜 저장이라 필드를 다른
      탭으로 옮길 때마다 미포함 필드가 null 로 덮인다(1단계 슬러그 사고와 같은 클래스)
- [x] 딥링크 전수 조사 — 앱 안의 ?tab= 링크는 website 둘뿐(대시보드·마케팅). room·finance 를
      가리키는 링크 0 → 키 개명 가능
- [x] 폼 필드 전수 18개 확인(name … contactLeadDays)

## 1단계 — 저장 경로 필드 단위 분해 (82b5ab58)
- [x] lib/propertySettingsPatch 정본 신설 — 실려 온 필드만 쓰는 순수 패치 빌더
- [x] 이동 필드 전부 formData.has 가드(19종, publicSlug 포함)
- [x] 체크박스 셋에 hidden '0' 짝(꺼진 체크박스는 FormData 에 안 실려 has 판정이 거짓말을 한다)
- [x] actions.updatePropertySettings 는 빌더에만 위임(두 번째 저장 경로 금지)
- [x] tsc 0

## 2단계 — 감지망·회귀 (848a5ced)
- [x] check-settings-slug-guard 를 이동 필드 전수로 확장 — 축 ⓐ 필드 19종 가드 · ⓓ 폼 필드 전수
      대조 · ⓔ 체크박스 짝 · ⓕ 단일 저장 경로 (종전 ⓐⓑⓒ 유지)
- [x] **주석 제거기 결함 봉합** — accept="image/\*" 가 가짜 블록 주석을 열어 기본정보 폼 전체가
      그물 시야 밖이었다(축 ⓒ 가 1단계 이후 줄곧 무력). 여는 자리를 중괄호 뒤·줄 첫머리로 좁힘
- [x] 축 ⓑ 를 임포트 확인에서 호출 확인으로 조임
- [x] scripts/test-settings-save-scope 신설(38항) + verify:fast 편입
- [x] 역주입 — 저장 정본 7/7 · 감지망 9/9 발화

## 3단계 — 8탭 재편 (5fc45b7c)
- [x] tabs.ts 키 개명·순서 정렬 (room → options, finance → pricing)
- [x] TABS 라벨 8종 · 순서 = 승인 지도
- [x] 기본정보 = 영업장명·주소·연락처·로고 둘·인수 날짜·양도인 기준일·연락 알림만
- [x] 요금·정책 = 기본 요금·환불 규정 + 단기 입실 정책 + 고정 지출 관리
- [x] 분류 관리 = 방타입·등급·창문·방향 + 부가수익·지출·결제 수단 + 요청 + 품목 세부스펙
- [x] 계약서·서류 = 현 계약서 탭 + 서류 자동채움 값(전용면적·계좌번호·임의처분 동의서)
- [x] 데이터·도구 = 위 둘이 빠진 나머지
- [x] 이사 안내 — 옛 자리 셋(기본정보·데이터·도구)과 사라진 두 탭의 착지점 둘
- [x] ShortStayPolicyCard·ItemSpecOptionsPanel 의 mt-4 제거(담는 쪽이 space-y-4)

## 4단계 — 게이트
- [x] tsc 0
- [x] verify:fast exit 0 (신규 2종 포함)
- [x] verify:db exit 0 (데이터 대조 1건은 기존 관찰 — 전기요금 예약금액)
- [x] 프로덕션 빌드 exit 0
- [x] eslint 491 → 491 (신규 0, 기준선 1bd40ad5 대조)
- [x] 좁은 폭 실측 30조합(5탭 × 320/360/390 × 라이트·다크) — 신규 넘침 0,
      탭 줄 46px 단일 행 유지(접힘 0), 트랙 662px 가로 스크롤
- [x] 저장 무회귀 실측 — 실제 DOM 이 만드는 FormData 로 탭 밖 칼럼 침범 0 · 담당 칼럼 누락 0
- [ ] 운영자 실기 확인(배포 후)

## 미결 · 범위 밖
- 계약서 본문 카드의 섹션 삭제 버튼이 320px 에서 11px 넘침 — **재편 전과 동일**(1bd40ad5 대조
  실측: 같은 4요소, 같은 right=331.2). 이번 작업이 만든 것이 아니라 손대지 않았다.
  고치려면 섹션 제목 input 에 min-w-0 한 토큰(플렉스 아이템 min-width:auto 가 축소를 막는다).
- 청소비 보증금 포함 토글이 '기본 청소비' 칸이 아니라 '퇴실 환불 규정' 블록 안에 있다.
  카드 내부 무수정 이동 원칙에 따라 그대로 옮겼다. 자리 재검토는 별건.
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
