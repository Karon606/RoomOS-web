-- #14 월세 할인 (2026-05-26)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용(기존 데이터 무손실).
-- 입주자(계약)별 월세 할인 — 금액/퍼센트, 영구/일시(기간).

CREATE TABLE IF NOT EXISTS "rent_discounts" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "leaseTermId"  UUID         NOT NULL,
  "discountType" TEXT         NOT NULL,   -- 'amount' | 'percent'
  "value"        INTEGER      NOT NULL,   -- 원(amount) 또는 %(percent)
  "scope"        TEXT         NOT NULL,   -- 'permanent' | 'temporary'
  "startMonth"   TEXT,                    -- 'YYYY-MM' (temporary)
  "endMonth"     TEXT,                    -- 'YYYY-MM' (temporary)
  "memo"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rent_discounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rent_discounts_leaseTermId_fkey"
    FOREIGN KEY ("leaseTermId") REFERENCES "lease_terms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "rent_discounts_leaseTermId_idx" ON "rent_discounts"("leaseTermId");
