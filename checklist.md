# 입퇴실 캘린더 청소 1단계 — 작업 레인 (2026-08-20, 운영자 승인)

목표 한 줄. **청소 예정·완료를 캘린더에서 보이게 한다. 스키마는 1칸만(예정 담당자).**

성립 조건은 "보인다"가 아니라 **"거주 쪽 수가 한 톨도 안 움직인다"** 다. 공실 캡션·충돌
판정·홈 '이달 입퇴실 N건'이 전부 `bars`·`events` 를 딛기 때문이다.

## 0단계 — 준비·패널
- [x] 정본 정독(AGENTS·loop·Work_log 2026-08-19/20 캘린더·08-05/06 청소·knowledge·brand-guide)
- [x] 워크트리 환경(.env.local·node_modules 심링크, 본선 스키마 3칸 포함 확인 후 prisma generate)
- [x] 기준선 실측(tsc 0 · 회귀 186 · eslint 491 · 드리프트 행 41·막대 72 위반 0 · 청소 고아 0)
- [x] 실데이터 조사(RoomCleaning 21건 · 살아 있는 15 · PLANNED 5 · 601호는 공실 집계 제외 창고)
- [x] 전문가 패널 4인 회수 — 호실 도메인 · 정보구조 UX · 웹디자이너 · 프런트엔드 성능 **전원 회신**
- [x] 설계 확정(이견·미채택 근거는 context-notes)

## 1항목 — 조립: 작업 레인 (d3ca9cce)
- [x] `MoveWorkInput`·`MoveWork`·`MoveWorkEvent`·`MOVE_WORK_STATUS_LABEL` 신설
- [x] `MoveCalendarRow.works` · `.workLaneCount` — bars 와 **다른 배열**
- [x] `packWorkLanes` 별도 팩 — 거주 `packLanes` 와 다른 풀
- [x] 끼운 자리는 `packLanes` 직후 · `covered` 루프 직전(작업 날짜가 공백 계산에 못 닿는다)
- [x] 행 생성 규칙 셋 — 공실 작업은 행을 만들고, 거주 중은 안 만들고, 공실 집계 제외 방은 안 만든다
- [x] 지연 판정 — 예정일 **당일은 아직 지연이 아니다**(D+1 부터)
- [x] `upcomingWorks` — 아직 안 끝난 청소만, 지난 예정도 포함
- [x] 회귀 186 → 214(신설 28축, 기존 186 무변동)

## 2항목 — 예정 담당자 칸 (61b11e18)
- [x] `RoomCleaning.plannedPerformer` 스키마 1칸 — 완료 `performer` 와 **다른 칸**
- [x] 마이그레이션 **파일로만** (`prisma/migrate_cleaning_planned_performer.sql`), DB 쓰기 0
- [x] `createCleaning` 입력 · `loadCleaningRows` select · `CleaningRow` 타입
- [x] `CleaningPlanForm` 담당 세그먼트(선택, 기본 미정)
- [x] `CleaningRowBody` 예정 행 담당 칩
- [x] `reopenCleaning` 이 이 칸을 안 내린다(계획은 완료 적용취소로 안 지워진다)

## 3항목 — 조회 형제 (28e17c54)
- [x] `fetchMoveWorks` 를 `lib/moveCalendarData` 안에 신설(감지망이 같은 조회를 지난다)
- [x] SKIPPED·소프트삭제 제외 · 방은 include 대신 한 번에 따로 읽기
- [x] `fetchMoveLeases(…, workRoomIds)` — 행 목록은 안 늘리고 점유 계약만 함께
- [x] `acks` 를 변동 날짜 스캔과 `Promise.all` 로 묶어 직렬 깊이 유지

## 4항목 — 화면 (da250bc8)
- [x] `--mc-work: 20px` 레일(레인 36/44 와 다른 자)
- [x] `placeWork` — 라벨을 띠 옆에, 양옆이 막히면 트랙에서 내리고 행 아래 줄로
- [x] 표면 예정 `--inspect-bg` / 완료 `--neutral-bg` + 각 `-ring` 1px
- [x] 지연은 글자가 진다(`--overdue-fg`) — `--tc-text` 는 다크 AA 미달로 기각
- [x] 겹침 밴드 `gridRow: 1 / laneCount+1` 로 한정 · 시간축은 `1 / -1` 유지
- [x] 띠 `pointer-events: none` + `role="img"` aria 문장(그날 사람이 있었는가 포함)
- [x] `UpcomingRow` 청소 **별도 줄** · 방 모달 진입 · 배지 미사용
- [x] 범례 4칸

## 5항목 — 감지망 (7ec4ebae)
- [x] 소스 축 4 — 공백·레인·충돌이 막대만 본다(괄호 깊이로 블록을 잘라 검사)
- [x] 소스 축 5 — events·firstChangeDay 에 작업이 안 섞인다 + 반대 방향 가드
- [x] 주석 스트립(설명하려고 적은 낱말이 위반으로 안 잡히게)
- [x] 역주입 6종 전부 발화(exit 1) 확인
- [x] 그물이 아무것도 못 찾으면 그 자체를 위반으로

## 6항목 — 실측·패스가 잡은 결함
- [x] 사유 라벨에 명사가 없어 소리로 "공사·도배 후 완료"가 되던 것(열넷 중 다섯) — 449499d6
- [x] 지연 낱말이 앱 정본('예정일 경과')과 갈렸던 것 — c6e1177f

## 게이트
- [x] tsc 0
- [x] `npm run verify:fast` exit 0 (커밋 훅 6회)
- [x] `npm run verify:db` — 기지 예외(서류 표시값 소재지 3건)에서만 정지, 캘린더 축 행 41·막대 72 위반 0
- [x] 프로덕션 빌드 exit 0
- [x] eslint 491 → 491 (신규 0)
- [x] 320/360/390 x 라이트·다크 6조합 실측 — 문서 넘침 0 · 라벨 넘침 0
- [x] **작업 레일 히트 영역이 거주 막대 히트와 안 겹친다** 6조합 0개
- [x] 겹침 밴드가 작업 레일까지 안 내려온다 6조합 0개(합성 케이스로 비공허 확인)
- [x] 대비 실측 — 라이트 최저 6.14 · 다크 최저 7.05
- [x] 요약 줄 칩 44px · 범례 320px 1줄
- [x] 배포 전 디자이너 패스 — **서브에이전트 회신 없어 직접 수행**(context-notes '자체 디자이너 패스')
- [x] DB 쓰기 0 · 마이그레이션 파일만
