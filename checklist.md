# 겹침 판정 개정 — 시공 체크리스트 (설계 확정 2026-08-19, 운영자 4택 전체안)

설계 정본: scratchpad/overlap-ack-design.md. 설계 밖 확대 금지.

## 1단계 — 판정 정본(층 1)
- [ ] lib/roomAssignment: occupancyOverlapSpan · isSameDayTurnover · findOverlapAck 신설
      (occupancyOverlaps 의 >= 는 무수정 — 소비처 전체가 흔들린다)
- [ ] roomAssignmentBlockReason(가져오기): 당일 회전 허용
- [ ] scripts/test-lease-subordination 에 당일 회전 케이스 추가
- [ ] 커밋

## 2단계 — LeaseOverlapAck 모델
- [ ] prisma/schema.prisma 모델 + Property·Room·LeaseTerm·User 역참조
- [ ] migrate_lease_overlap_ack.sql (CREATE TABLE IF NOT EXISTS 한정)
- [ ] 실 DB 적용(DDL 만, 행 데이터 불변)
- [ ] 커밋

## 3단계 — 기록·해제 서버 정본
- [ ] lib/overlapAck: recordOverlapAcks · releaseOverlapAck · loadOverlapAcks
- [ ] tenants/actions: allowRoomOverlap 통과 시 기록(등록·계약 추가·수정)
- [ ] 커밋

## 4단계 — 캘린더 조립(층 1·2)
- [ ] lib/moveCalendar: 당일 회전 충돌 제외 · 확인된 겹침 중립 · acks 입력
- [ ] scripts/test-move-calendar 기대값 갱신(당일 회전 — 승인됨) + 확인된 겹침 축 추가
- [ ] room-manage/actions: ack 조회 + acknowledgeOverlap·releaseOverlapAck 액션
- [ ] 커밋

## 5단계 — 캘린더 UI
- [ ] MoveCalendar: [겹침 확인] · [확인 해제] · 중립 톤 · 코랄 팁 끔
- [ ] 커밋

## 6단계 — 입주자 폼(층 1 화면)
- [ ] TenantClient: 당일 회전 캡션 · 확인창 제거 · 문구에 기록 고지 · allowRoomOverlap 표식
- [ ] 커밋

## 7단계 — 감지망 축 ②
- [ ] check-room-availability-drift: 당일 회전 제외 · 유효 ack 제외 · 확인된 겹침 N건 · 잔존 ack 정보 줄
- [ ] 커밋

## 게이트
- [ ] tsc 0
- [ ] verify:fast 무회귀(캘린더 기대값 갱신 포함)
- [ ] verify:db 개정 축 ② 실측(422 는 ack 전이라 위반 1이 정상)
- [ ] 프로덕션 빌드
- [ ] eslint 신규 0(기준선 496, stash 대조)
- [ ] 새 UI 320/360/390 라이트·다크 넘침 0
- [ ] 역주입 3종(회전 무위반 · ack 없는 겹침 검출 · ack 구간 초과 재발화)
