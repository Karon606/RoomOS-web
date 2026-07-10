-- 정기지출 묶기 원본 링크 (2026-07-10, 묶기 해제용)
ALTER TABLE "recurring_expenses" ADD COLUMN IF NOT EXISTS "groupSourceIds" JSONB;
