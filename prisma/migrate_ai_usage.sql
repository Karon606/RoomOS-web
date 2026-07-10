-- 공용 AI 키 월 사용량 카운터 — 영업장별 월 10회 무료 체험, 초과 시 본인 키 등록 유도 (운영자 결정 2026-07-10)
CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "month" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ai_usage_property_month" UNIQUE ("propertyId", "month")
);
