-- 사업자등록증 사본 — 환경설정에서 올리고 상담 도구에서 문자·메일 첨부로 그대로 보낸다 (2026-08-18)
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
--   bizCertDriveFileId TEXT — 사업자등록증 원본 (Drive 파일 ID). null = 미등록.
--   bizCertMimeType    TEXT — 판정한 mime ('application/pdf' | 'image/*'). 화면 분기·전송 Content-Type.
--
-- 부가·널 허용 컬럼이라 기존 행은 전부 null 로 남는다(행 데이터 변경 없음).
-- 공개 읽기 권한은 붙이지 않는다 — 도장과 같은 이유로 /api/biz-cert 인증 프록시로만 나간다.

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "bizCertDriveFileId" TEXT,
  ADD COLUMN IF NOT EXISTS "bizCertMimeType"    TEXT;
