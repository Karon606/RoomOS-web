-- 양도인 정산 기능 — Supabase SQL 편집기에서 1회 실행.
-- ⚠ 컬럼명은 camelCase + 큰따옴표 (이 프로젝트 규칙 — Prisma 필드명 그대로).

ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS "isPrevOwner" boolean NOT NULL DEFAULT false;

ALTER TABLE lease_terms
  ADD COLUMN IF NOT EXISTS "prevOwnerSettleMenu" text NOT NULL DEFAULT 'auto';
