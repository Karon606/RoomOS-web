-- 문자 템플릿·이력에 kind 컬럼 — 'unpaid'(미납 안내) / 'notice'(단체 공지) 구분 (R4, 2026-07-10)
ALTER TABLE "sms_templates" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "sms_logs" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'unpaid';
