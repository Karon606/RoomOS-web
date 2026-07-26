-- 청구 조정 전표 식별자 — Supabase SQL 편집기에서 1회 실행.
-- ⚠ 컬럼명은 camelCase + 큰따옴표 (이 프로젝트 규칙 — Prisma 필드명 그대로).
-- 단기 연장·감액 마커(actualAmount=0)를 '0원 납부'가 아닌 '청구 조정 전표'로 분류한다.
-- memo 는 updatePayment 로 편집 가능하므로 식별은 반드시 이 컬럼으로 한다(memo 파싱 금지).

ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS "isBillingAdjust" boolean NOT NULL DEFAULT false;

-- 백필 — 기존 마커(연장 시점엔 태그가 '[단기연장'뿐)
UPDATE payment_records
   SET "isBillingAdjust" = true
 WHERE "actualAmount" = 0
   AND memo LIKE '[단기연장%'
   AND "isBillingAdjust" = false;
