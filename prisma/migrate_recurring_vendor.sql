-- 고정지출 구매처 (신고 6d1cf1ea)
ALTER TABLE "recurring_expenses" ADD COLUMN IF NOT EXISTS "vendor" TEXT;
