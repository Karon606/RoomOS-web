-- 서류 메일 커스터마이즈 (2026-08-25 운영자 승인) — 답장 주소 + 영업장별 메일 문안.
-- 발신 주소는 no-reply@stayeum.com 고정(도메인 인증)이라 답장 주소가 영업장 구분을 진다.
-- docMailTemplate null = 내장 기본 문안(lib/docMail). 되돌림: 두 칼럼 DROP 으로 충분(추가만 있음).
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "replyToEmail" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "docMailTemplate" JSONB;
