-- 품목 세부스펙 사전 (2026-07-06, 신고 ba9feb6b)
CREATE TABLE IF NOT EXISTS "item_spec_options" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "itemLabel" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "item_spec_options_unique" UNIQUE ("propertyId", "itemLabel", "label")
);
CREATE INDEX IF NOT EXISTS "item_spec_options_prop_item_idx" ON "item_spec_options" ("propertyId", "itemLabel");
