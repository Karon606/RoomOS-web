# 서류 메일 재설계 체크리스트 (2026-08-25, 운영자 "추천대로 진행해줘" 승인)

대상: 즉시 발송 폐지 + 확인 화면, 환경설정 문안 커스터마이즈(텍스트·HTML 두 모드),
답장 주소 칸, 발송 이력. Fable 5 설계 패널 산출 그대로(임의 확대 금지).

## 승인 사항
- [x] sanitize-html 신규 의존성 (직접 구현 기각)
- [x] HTML 모드에서 발송 직전 본문 수정 잠금
- [x] 직접 HTML 편집 권한 = 편집 권한 멤버 전부
- [x] 발송 이력 로그 신설 (7번째 커밋으로)
- [x] 문구: 버튼 '메일 쓰기' · 환경설정 라벨 '메일 주소' · 카드명 '서류 메일 문안'

## 커밋
- [x] 1/7 스키마·환경설정 칸 — replyToEmail·docMailTemplate, migrate_doc_mail.sql 프로덕션 적용, 기본정보 '메일 주소' 칸, 저장 범위 회귀 45 (3d7e22d8)
- [x] 2/7 lib/docMail 정본 — 개칭·확장, 변수·새니타이즈·렌더, 회귀 38, verify:fast 등재 (c445832a)
- [x] 3/7 서버 — sendMail html, driveFileSize, 초안·미리보기·발송 3액션 한 렌더 (b051ba02)
- [x] 4/7 확인 화면 — TenantDocMailComposeSheet, '메일 쓰기' 버튼 (e1275e6a)
- [x] 5/7 환경설정 카드 — 두 모드·인라인 검증·미리보기·복원 (8440a27b)
- [x] 6/7 발송 이력 — MailLog, migrate_mail_log.sql 프로덕션 적용 (08eba445)
- [x] 7/7 기록 — Work_log·knowledge/doc-mail·INDEX·체크리스트·컨텍스트 노트

## 게이트 (loop.md)
- [x] tsc 0
- [x] `npm run verify:fast` exit 0 (신규 test-doc-mail-render 38 포함)
- [x] `npm run verify:db` exit 0
- [x] 프로덕션 빌드 exit 0 (ENOTEMPTY 1회는 iCloud 사본 — .next 정리 후 재현 없음)
- [x] eslint 신규 0 (대상 파일 기준선 48 유지, 변경 줄 전수 대조)
- [x] DB 쓰기 보고 — DDL 2건(properties 칼럼 2개 추가·mail_logs 신설)뿐, 데이터 행 무변경
- [x] 배포 전 웹디자이너 패스 — 패널이 세션 한도로 중단, 전례대로 직접 수행. 차단 3건 수정(f93a33a6: cream-soft 대비 2·문장 끝 콜론 1), z 위계·§26 프레임·§14·§16·320px·글자 알약 확인
- [x] 커밋·푸시(=배포)

## 안 한 것(의도)
- [ ] 발송 이력 조회 화면 — 백로그(knowledge/open-issues). 표만 먼저(분쟁 근거 확보가 목적)
- [ ] 문안 여러 벌(문자 템플릿식 목록) — 요구는 한 벌 기본값. 필요 시 별건(스키마가 막지 않음)
- [ ] 컴포즈에서 맺음말 별도 편집 — 본문 칸 하나로 충분, 맺음말은 미리보기로 확인
- [ ] Resend 배달 상태(webhook) 추적 — resendId 만 보존, 필요 시 별건
