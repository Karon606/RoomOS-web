# 체크리스트 — 사업자등록증 보내기 (운영자 오더 2026-08-18)

오더 원문: "상담도구에 사업자등록증도 바로 문자메시지나 이메일 첨부파일 등으로 보낼 수 있도록
들어가면 좋겠어 (이 자료를 업로드하는 곳은 환경설정 내에 있으면 좋겠어)"

## 0단계 — 설계 (코딩 전)
- [x] AGENTS.md · loop.md · Work_log 2026-08-17 (3) 3건 통독
- [x] 정본 대조 — ConsultToolsModal · lib/shareFile · lib/docShareQueue · lib/useDocShare · SendDocButton
- [x] 기존 파일 업로드 문법 대조 — 도장(stampDriveFileId) · 계약서용 로고 · 앱 로고 · 계약서 스캔본
- [x] 디자인가이드 검토 — 행 문법(§14·§09·§05·§13) · 어휘 정본(§29 + knowledge/doc-vocabulary) ·
      다크 토큰 쌍(§28) · 파일 input label 은 btnClass(§10)
- [x] 기준선 측정 — tsc 0 · eslint 497 · 프로덕션 빌드 47/47

## 1단계 — 스키마
- [x] Property.bizCertDriveFileId · bizCertMimeType (둘 다 nullable)
- [x] prisma/migrate_biz_cert.sql
- [x] 실 DB 에 ALTER TABLE 한 문장 적용 (행 데이터 변경 0 · 적용 후 값 있는 행 0)
- [x] npx prisma generate
- [x] 커밋 9928147f

## 2단계 — 저장 축 (서버)
- [x] lib/google-drive.ownedDriveFileMime — 소유 검증 + mime 판정 1회 왕복
- [x] createBizCertUploadSession (이미지·PDF · 4MB · origin)
- [x] finalizeBizCert (mime 서버 판정 · 이전 파일 휴지통 · 실패 시 업로드분 정리)
- [x] deleteBizCert (휴지통 + 컬럼 null)
- [x] getContractSettings 에 bizCert 실림 (바이트는 안 내려받음)
- [x] check-server-action-exports 통과
- [x] 커밋 427f0350

## 3단계 — 열람·전송 경로
- [x] app/api/biz-cert/route.ts — id 인자 없음(영업장 자기 것만) · 공개 권한 없음 · private 캐시
- [x] 무인증 401 · 위조 쿠키 401 · ?id= 주입 시도 401 실측(빌드 서버 3999)
- [x] 커밋 0c81631b

## 4단계 — 환경설정 카드
- [x] 사업자 정보 카드 바로 아래 배치
- [x] 이미지 썸네일(프록시 직결 · v= 캐시 끊기) · PDF 표식 · 미등록 상태
- [x] 업로드/교체 = btnClass('primary','sm') · 삭제 = Btn danger sm + caution 확인창
- [x] 미리보기 바탕 --cream-soft(§28) · '미등록' --warm-mid (다크 4.46 → 8.39)
- [x] 커밋 40af1059

## 5단계 — 상담 도구 줄
- [x] getConsultInfo 에 bizCertMimeType (빈 문자열 = 줄 없음)
- [x] 구분선 아래 · 단기 요금 계산 위 · ROW_CLS 재사용 · 2행 스택 · chevron
- [x] 라벨 '사업자등록증 보내기' (복사 아님이 드러남 · '공유' 금지어 회피)
- [x] 코너 열 때 프리페치(제스처 만료 방지) · 실패 시 탭 시점에 알림 + 캐시 폐기
- [x] shareOrDownloadFile 정본 · 형식 무변환 · 미지원 기기 다운로드 폴백
- [x] 커밋 e8d35f24

## 6단계 — 검증
- [x] tsc 0
- [x] eslint 497 → 497 (신규 0)
- [x] verify:fast 전항 통과
- [x] verify:db 전항 위반 0
- [x] 프로덕션 빌드 성공 · 47/47 · /api/biz-cert 라우트 등재
- [x] 좁은 폭 실측 320/360/390 × 라이트·다크 6조합 — 문서 넘침 0 · 잘림 0
- [x] 대비 실측 — 라이트 최저 4.74 · 다크 최저 4.91 (전부 4.5 상회)
- [x] 전송 경로 헤드리스·목 검증 16건 통과
- [ ] 운영자 실기 확인 (업로드 → 상담 도구 → 공유 시트 전송)

## 범위 밖 — 승인 대기
- [ ] 기존 업로드 카드 3종(도장·계약서용 로고·앱 로고) 토큰 정리
      (--canvas 미리보기 바탕 · 도장 --coral 손사본 · 로고 2종 raw button 삭제)
- [ ] check-contract-issued-snapshot 기준선 2 → 6 상향 (verify:db 가 계속 안내 중)
