# 재고 보정 소비 귀속 선택지 (운영자 승인 2026-08-19)

## 0단계 — 착수 전 발견한 회귀 (선행 처리)
- [x] 전체 보정 모달의 DatePicker·보충 완료 체크박스가 e24c4e03(2026-07-02)에서 삭제됨 확인
- [x] disabled={!restockDone} 만 남아 실측 칸·저장 버튼이 영구 잠김 → 삭제 마크업 원문 복구
- [x] 커밋 (5bbcfdf7)

## 1단계 — 판정 정본 + 서버 분기
- [x] constants.resolveDiffAttribution — 순수 판정(기본 'exclude', 증가분·근거없음은 항상 보정)
- [x] saveFullReconcile 에 attribution(화면 단위) + 품목별 expectedQty(부호 판정용)
- [x] scripts/test-reconcile-attribution.ts 12케이스 · verify:fast 등록
- [x] 커밋 (cd3c93c6)

## 2단계 — 타임라인 보정 폼
- [x] DiffAttributionChoice 공용 조각(CheckForm 보정 라벨 박스 문법 그대로)
- [x] 차이 음수일 때만 노출 · 기준 구간 날짜를 부연에 박음
- [x] 폼 머리글·저장 버튼·저장/되돌리기 토스트가 선택을 따라감
- [x] 같은 날 점검 경고에 dedupSameDay 승격 함정 한 줄
- [x] 커밋 (36dc4218)

## 3단계 — 전체 재고 보정 모달
- [x] 모달 단위 선택 1개(행별 아님) · 줄어든 품목 있을 때만 노출
- [x] 품목별 expectedQty 전달 — 증가분은 선택과 무관하게 보정 저장
- [x] 부모의 중복 완료 토스트 제거(적용취소 후에도 '보정 완료'가 뜨던 것)
- [x] 커밋 (a3b29372)

## 4단계 — 점검 폼 부연 + 감사 정합
- [x] 보정 체크박스에 '체크하지 않으면 …' 한 줄
- [x] audit-reconcile-baselines 범위 주석(사용 기록 저장분은 의도적 제외)
- [x] 커밋 (14108588, 6e47cfca)

## 게이트
- [x] tsc 0 (단계마다)
- [x] verify:fast 전 항목 통과 (커밋 훅 5회 + 최종 1회)
- [x] verify:db — 재고 축 전부 위반 0. 기존 데이터 결함 3건은 무관(아래 관찰)
- [x] 프로덕션 빌드 성공 (컴파일 15.0s · 정적 47/47)
- [x] eslint 496 → 494 (546c6927 대조 · 신규 0 · 회귀 복구로 미사용 setter 경고 2건 해소)
- [x] 새 UI 320/360/390 × 라이트·다크 6조합 문서 넘침 0 · 요소 위반 0
- [x] 실데이터 변경 0 (verify:db 는 읽기 전용, 마이그레이션·백필 없음)

# 겹침 판정 개정 — 시공 체크리스트 (설계 확정 2026-08-19, 운영자 4택 전체안)

설계 정본: scratchpad/overlap-ack-design.md. 설계 밖 확대 금지.

## 1단계 — 판정 정본(층 1)
- [x] lib/roomAssignment: occupancyOverlapSpan · isSameDayTurnover · findOverlapAck 신설
      (occupancyOverlaps 의 >= 는 무수정 — 소비처 전체가 흔들린다)
- [x] roomAssignmentBlockReason(가져오기): 당일 회전 허용
- [x] scripts/test-lease-subordination 에 당일 회전·확인 케이스 20건 추가
- [x] 커밋 8bfda62d

## 2단계 — LeaseOverlapAck 모델
- [x] prisma/schema.prisma 모델 + Property·Room·LeaseTerm·User 역참조
- [x] migrate_lease_overlap_ack.sql (CREATE TABLE/INDEX IF NOT EXISTS 한정)
- [x] 실 DB 적용 — 컬럼 11개 생성 확인 · 행 0 (행 데이터 무변경)
- [x] 커밋 4ec6a1a7

## 3단계 — 기록·해제 서버 정본
- [x] lib/overlapAck: loadOverlapAcks · recordOverlapAcksForLease · createOverlapAck · softDeleteOverlapAck
- [x] tenants/actions: allowRoomOverlap 통과 시 기록(등록·계약 추가·수정)
- [x] 커밋 2c4bcda6

## 4단계 — 캘린더 조립(층 1·2)
- [x] lib/moveCalendar: 당일 회전 충돌 제외 · 확인된 겹침 중립 · acks 입력
- [x] scripts/test-move-calendar 기대값 갱신(당일 회전 — 승인됨) + 확인된 겹침 축 추가 → 123 통과
- [x] room-manage/actions: ack 조회 + acknowledgeOverlap·releaseOverlapAck
- [x] 커밋 0e626f94

## 5단계 — 캘린더 UI
- [x] MoveCalendar: [겹침 확인] · [확인 해제] · 중립 톤 · 코랄 팁 끔
- [x] 커밋 cc6775dd

## 6단계 — 입주자 폼(층 1 화면)
- [x] TenantClient: 당일 회전 캡션 · 확인창 제거 · 문구에 기록 고지 · allowRoomOverlap 표식
- [x] 커밋 b5da86d1

## 7단계 — 감지망 축 ②
- [x] check-room-availability-drift: 당일 회전 제외 · 유효 ack 제외 · 확인된 겹침 N건 · 잔존 ack 정보 줄
- [x] 커밋 bb1ac52d

## 게이트
- [x] tsc 0
- [x] verify:fast 전 축 통과 (커밋 훅 7회 + 최종 1회) — 캘린더 123 · 종속 75 · 금전 200
- [x] verify:db 개정 축 실측 — 축 ② 위반 1건(422호, ack 전이라 정상). 나머지 21축 통과.
      무관한 기존 결함 2건(아래 관찰)
- [x] 프로덕션 빌드 성공 (컴파일 14.0s · 정적 47/47)
- [x] eslint 496 (기준선 496 · 신규 0, stash 대조)
- [x] 새 UI 320/360/390 × 라이트/다크 12조합 넘침 0 · 버튼 히트 44px 이상
- [x] 역주입 5종(회전 무위반 · ack 없는 겹침 검출 · ack 시 제외 · 구간 초과 재발화 · 잔존 ack 정보 줄)
