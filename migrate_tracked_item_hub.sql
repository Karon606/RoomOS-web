-- 품목별 창고(허브) — TrackedItem.hubLocationId (추가 전용)
-- null 이면 영업장 기본 허브(storage_locations.isHub)로 폴백.
ALTER TABLE tracked_items ADD COLUMN IF NOT EXISTS "hubLocationId" UUID;
