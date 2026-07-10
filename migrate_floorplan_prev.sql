-- 도면 직전 저장본 슬롯 (2026-07-10, 저장 적용취소용)
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "floorPlanPrevData" JSONB;
