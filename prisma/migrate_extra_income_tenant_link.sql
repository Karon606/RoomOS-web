-- 부가수익 입주자 연결(2026-07-02) — 과납분·보증금 미반환분처럼 수납에서 파생된 수익을
-- 그 사람/계약에 묶는다. 부가수익 탭을 수납관리로 이동하며 보강. 무관 수입(자판기 등)은 null.
ALTER TABLE "extra_incomes" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "extra_incomes" ADD COLUMN IF NOT EXISTS "leaseTermId" UUID;

DO $$ BEGIN
  ALTER TABLE "extra_incomes"
    ADD CONSTRAINT "extra_incomes_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "extra_incomes"
    ADD CONSTRAINT "extra_incomes_leaseTermId_fkey"
    FOREIGN KEY ("leaseTermId") REFERENCES "lease_terms"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "extra_incomes_tenantId_idx" ON "extra_incomes" ("tenantId");

-- 기존 5건 백필 ① 보증금 미반환분 — detail "이름 퇴실 — 보증금 미반환분"의 이름으로 입주자·최근 계약 매칭
UPDATE "extra_incomes" e
SET "tenantId" = t.id,
    "leaseTermId" = (
      SELECT lt.id FROM "lease_terms" lt
      WHERE lt."tenantId" = t.id ORDER BY lt."createdAt" DESC LIMIT 1
    )
FROM "tenants" t
WHERE e."tenantId" IS NULL
  AND e.detail LIKE '%퇴실%보증금%'
  AND t."propertyId" = e."propertyId"
  AND e.detail LIKE t.name || '%';

-- 기존 5건 백필 ② 임대료 과납분 — detail "NNN 임대료 과납분"의 방번호로 그 방의 최근 계약 매칭
UPDATE "extra_incomes" e
SET "leaseTermId" = sub.lease_id, "tenantId" = sub.tenant_id
FROM (
  SELECT ei.id AS income_id, lt.id AS lease_id, lt."tenantId" AS tenant_id,
         ROW_NUMBER() OVER (PARTITION BY ei.id ORDER BY lt."createdAt" DESC) AS rn
  FROM "extra_incomes" ei
  JOIN "rooms" r ON r."propertyId" = ei."propertyId"
    AND ei.detail LIKE r."roomNo" || ' %과납분%'
  JOIN "lease_terms" lt ON lt."roomId" = r.id
  WHERE ei."tenantId" IS NULL AND ei.detail LIKE '%과납분%'
) sub
WHERE e.id = sub.income_id AND sub.rn = 1;
