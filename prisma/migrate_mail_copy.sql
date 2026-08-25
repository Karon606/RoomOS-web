-- 보낸 메일 사본 (2026-08-26 운영자 요구) — 답장 받을 주소로 BCC.
-- 기본 꺼짐이라 기존 영업장의 발송 거동은 변하지 않는다. 되돌림: 두 칼럼 DROP 으로 충분.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "mailCopyToSelf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mail_logs" ADD COLUMN IF NOT EXISTS "copyTo" TEXT;
