# 입퇴실 캘린더 거주 구간(RoomStay) 재시공 (2026-08-20, 운영자 승인)

캘린더가 `LeaseTerm.roomId` 한 칸만 읽고 `RoomStay` 를 안 봐서 이사한 계약이 옛 방에 0칸,
새 방에 최초 입주일부터 통째로 그려졌다. 증상 셋(옛 방 소실·허위 동시 거주·혼자 퇴실일 미정)이
이 원인 하나에서 나온다. 데이터는 옳다(check-room-stay-drift 7축 통과).

## 0단계 — 조사·패널 합의
- [x] 정본 문서 정독(AGENTS·loop·Work_log 2026-08-19/20·knowledge/INDEX·brand-guide-v2.0)
- [x] 조사 보고서 정독(scratchpad/move-calendar-fix-plan.md)
- [x] 워크트리 환경(.env.local 심링크 · npm ci · 스키마 본선과 바이트 동일 확인)
- [x] 기준선 실측(tsc 0 · eslint 491 · 월별 eventCount · RoomStay 커버리지)
- [x] 전문가 패널 4인 회수 — 도메인·백엔드·UX·웹디자이너 **전원 회신**
- [x] 설계 확정(이견은 context-notes 에 기록)

## 1단계 — 방향 A 막대 출처 전환 (ffc53c4b)
- [x] MoveCalendarLease 에 거주 구간(MoveStaySpan) 필수 칸 · 계약을 방별 조각으로 편다
- [x] 열린 구간의 끝은 계약이 말한다(구간에서 읽으면 5건 퇴행)
- [x] 이사 경계 라벨 정본 moveDateLabel(상대 호실 포함)
- [x] 조회의 창 조건·context 방 조건에 구간 편입
- [x] 이사가 입퇴실 건수에 들어온다(2026-07 이 9 에서 11)
- [x] 회귀 123 에서 154(이사 6축 신설, 기존 123 무변동)

## 2단계 — 요약 줄·키 (ed2819f4)
- [x] eventTone 이사 분기(중립 info · '이사')
- [x] 막대·요약 줄 React 키를 구간 id 로

## 3단계 — 이사일 입력 칸 (5ae3cf13)
- [x] 계약 편집 폼 조건부 날짜 칸(형제 '실제 퇴실일' 문법, 오늘 KST 기본값, 캡션)
- [x] 노출 조건이 서버의 구간 쪼개기 조건과 같은 자
- [x] lib/roomStay validateMoveDate 5축 + 회귀 14축(74 에서 88)

## 4단계 — 감지망 3축 (2c3013ee)
- [x] 조회를 lib/moveCalendarData 로 분리(그물이 화면과 같은 조회를 지나게)
- [x] scripts/check-move-calendar-drift.ts 축 A·B·C + 소스 가드 4
- [x] verify:db 편입(check-room-stay-drift 바로 뒤)
- [x] 역주입 발화 확인(B 1건 · C 66건 · exit 1)

## 5단계 — 디자인 별건 5건 + 접근성 (20d8e24f)
- [x] 거주 막대 토큰을 등재본으로(--band-paid-bg)
- [x] 거주색을 형제 여덟 자리와 통일(올리브)
- [x] hover opacity 를 코랄 outline 으로
- [x] 터치 타겟 44px(레인 유지 · ::after 히트 확장)
- [x] '오늘' 칩 10px 을 10.5px 로
- [x] 범례 2칸 + 막대 aria-label + 스크롤러 role·tabIndex

## 6단계 — 게이트
- [x] tsc 0
- [x] verify:fast exit 0
- [x] verify:db 기지 예외(소재지 3건)에서만 멈춤 · 신규 축 통과 · 후반 6축 개별 통과
- [x] 프로덕션 빌드 exit 0
- [x] eslint 신규 0(손댄 파일 기준선 동일)
- [x] 320/360/390 라이트·다크 6조합 넘침 0 · 막대 히트 44.0px · 10.5px 미만 글자 0 · aria 누락 0
- [x] 대비 실측(라이트 거주 8.01 · 예약 10.13 · 겹침 밴드 위 4.54 / 다크 7.25 · 10.35 · 6.44)
- [x] 웹디자이너 배포 전 패스 — 차단 3(포커스 링 소실·조사 '로' 깨짐·라벨 tnum) + 비차단 4 반영,
      가이드 §03 밴드 범위 한 줄 등재. 반영 후 회귀 160 · 넘침 재실측 통과 · 포커스 링 실측 확인.
