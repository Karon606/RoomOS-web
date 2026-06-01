-- 재고관리 카테고리 설정 — Property.inventoryCategories (추가 전용)
-- JSON: [{"cat":"부식비","alias":"식료품"},...]. null 이면 코드 기본값 사용.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS "inventoryCategories" TEXT;
