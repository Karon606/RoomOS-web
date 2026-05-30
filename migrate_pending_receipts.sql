-- 등록 대기 영수증·사진 — 사용자가 찍어 올린 사진의 OCR/분류 결과를 검토 전 임시 보관.

CREATE TABLE IF NOT EXISTS pending_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId"      UUID NOT NULL,
  "uploaderId"      UUID NOT NULL,
  "imageUrl"        TEXT NOT NULL,
  "driveFileId"     TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected

  -- OCR · 분류 추론
  "inferredKind"     TEXT,
  "inferredVendor"   TEXT,
  "inferredDate"     TEXT,                              -- YYYY-MM-DD
  "inferredAmount"   INTEGER,
  "inferredCategory" TEXT,
  "parsedJson"       JSONB,

  -- 처리 결과
  "linkedExpenseId" UUID,

  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "reviewedAt"      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pending_receipts_prop_status_created_idx
  ON pending_receipts ("propertyId", status, "createdAt" DESC);

-- FK
ALTER TABLE pending_receipts DROP CONSTRAINT IF EXISTS pending_receipts_property_fk;
ALTER TABLE pending_receipts
  ADD CONSTRAINT pending_receipts_property_fk
  FOREIGN KEY ("propertyId") REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE pending_receipts DROP CONSTRAINT IF EXISTS pending_receipts_uploader_fk;
ALTER TABLE pending_receipts
  ADD CONSTRAINT pending_receipts_uploader_fk
  FOREIGN KEY ("uploaderId") REFERENCES auth.users(id) ON DELETE CASCADE;

-- RLS (Prisma 우회). anon 접근 차단.
ALTER TABLE pending_receipts ENABLE ROW LEVEL SECURITY;
