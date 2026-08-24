# 오류신고 1건(증상 둘) 시공 체크리스트 (2026-08-24, 운영자 승인 완료)

대상: [16f691e1] /room-manage?tab=moves — ① 왼쪽 호실 열이 안 눌린다 ② 스케줄 막대가 스침에 발화한다.
**표시·인터랙션 층만.** 데이터·계산 무접점(DB 쓰기 0, 스키마 변경 0, `lib/moveCalendar` 조립 무수정).

## 0. 전제
- [x] 워크트리를 최신 main 에서 땀 (68f1638c, 0단계 e245aa06 포함 확인)
- [x] `.env.local`·`node_modules` 심링크
- [x] 기준선 — tsc 0 · eslint 491 · 빌드 exit 0 · 조립 회귀 236 · 드리프트 위반 0(행 41·막대 72)
- [x] 실측 하네스 세움 — 실데이터 SSR + 빌드된 Tailwind CSS + 로컬 Pretendard + 헤드리스 Chrome
- [x] 0단계 불변 기준선 재현 (16조합 전부 동일)
      노드 609 · 트랙 높이 1040(fine)/1200(coarse) · 인터랙티브 36 · sticky 80 · 행 19 ·
      거주 레인 20 · 막대 36 · 표식 14 · 공실 캡션 20 · 호실칸 최소 높이 36(fine)/44(coarse)

## 1. 전문가 패널 (서브에이전트 3인)
- [x] UX/UI — 임계값, 호실 열에도 같은 가드를 걸지, 20px 터치 타겟, aria 문안, 어포던스
- [x] **웹디자이너(가이드 정합)** — focus 링 문자열·오프셋, div→button 기하 리셋 전수, §23 식별자 색, 대비
- [x] 프런트엔드 성능 — 핸들러 배치, 좌표 보관처, pointermove 대 pointerup, Blink 래치 재발 여부
- [x] 세 회신 모두 최종 출력으로 수령 — UX/UI · 웹디자이너 · 성능. 배포 후 디자이너 재패스 1회 추가

## 2. 증상 ① 호실 열 열기
- [x] `GanttRow` 호실 셀 `<div>` → `<button type="button">`
- [x] `entityModal.open({ kind: 'room', roomId })` — 계약 시드 없음, 열기 경로는 `MoveCalendar` 안
- [x] `aria-label` · `focus-visible` 링
- [x] sticky · z-index · 배경 · `.attn` 코랄 3px 팁 그대로
- [x] 스페이서 셀 둘(행 아래 줄·꼬리)은 `<div>` 유지
- [x] 기하 무변동 실증 (노드 +N 외 전항 동일)

## 3. 증상 ② 스침 무시
- [x] 순수 함수 정본 신설 — 임계 상수 + 이동 판정 + click 억제 판정
- [x] 선례 문법 재사용 (RoomCard 10px §23 · ErrorReportButton 8px)
- [x] 막대·호실 열 양쪽에 같은 가드
- [x] 시간 임계 없음 · `touch-action` 무변경 · 히트영역 무축소
- [x] 키보드·보조기기 활성화는 언제나 통과
- [x] Blink 관성 스크롤 중 click 성립 여부 — 흐름 축으로 덮게 설계, **실기 확인 대상으로 보고**

## 4. 회귀
- [x] 제스처 순수 함수 회귀 신설 (임계 이내 탭 통과 · 초과 억제 · 세로만 이동 · 키보드 통과)
- [x] 호실 열 접근성 축 (role · aria-label · focus · 스페이서 제외)
- [x] `verify:fast` 에 배선
- [x] 조립 회귀 **236 무변동** 확인(verify:fast 로그 33행) — 새 축은 별도 파일이라 이 수가 안 움직인다

## 5. 게이트
- [x] tsc 0
- [x] `npm run verify:fast` — **선재 red 에서 정지**(check-datepicker-shell 3건, main 68f1638c 에 이미 있던 보증금 트랙 잔재). 이번 변경분 무접점, 잔여 17종 따로 돌려 전부 통과
- [x] `npm run verify:db` 기지 예외(서류 표시값 소재지 3건)에서만 정지
- [x] 프로덕션 빌드 exit 0
- [x] eslint 신규 0 (491 유지)
- [x] 320/360/390 라이트·다크 넘침 0
- [x] 44px 터치 타겟·대비 실측 — coarse 44px 미달 0(합성 행 포함) · 링 대비 2.78→4.63:1
- [x] **배포 전 디자이너 패스**

## 6. 마무리
- [x] 임시 하네스 파일 전부 삭제 (`scripts/_tmp-*`)
- [x] Work_log·knowledge·컨텍스트 노트 갱신
- [x] 항목별 커밋 (푸시 금지 — 메인이 검증 후 머지)
