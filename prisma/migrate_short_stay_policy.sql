-- 단기 입실 정책 템플릿 (2026-07-06, 운영자 기준 §4 승인)
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "shortStayPolicy" JSONB;
