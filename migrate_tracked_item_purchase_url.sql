-- 재고 품목에 구매 링크(쿠팡·아마존 등) 추가 (2026-05-28, #1e)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용·무손실.

ALTER TABLE "tracked_items" ADD COLUMN IF NOT EXISTS "purchaseUrl" TEXT;
