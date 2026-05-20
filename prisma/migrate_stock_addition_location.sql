-- 무상 입수(StockAddition)에 입고 위치 컬럼 추가
-- Supabase SQL Editor 에서 실행
--
-- storageLocationId: 입수가 들어간 보관 위치. 지출 수령(Expense)과 동일한
-- 단일 위치 패턴. 기존 데이터는 NULL — 수정 폼에서 사후 보완 가능.
-- 위치가 삭제되면 NULL로 끊김(ON DELETE SET NULL).

ALTER TABLE "stock_additions"
  ADD COLUMN IF NOT EXISTS "storageLocationId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_additions_storageLocationId_fkey'
  ) THEN
    ALTER TABLE "stock_additions"
      ADD CONSTRAINT "stock_additions_storageLocationId_fkey"
      FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "stock_additions_storageLocationId_idx"
  ON "stock_additions"("storageLocationId");
