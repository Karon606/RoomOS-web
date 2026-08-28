-- 영업장별 단위 목록 (2026-08-28 운영자 요구) — 규격·수량 단위 어휘를 영업장 단위로 적립.
-- NULL = 코드 기본값 사용이라 기존 영업장 거동은 안 변한다. 되돌림은 두 칼럼 DROP 으로 끝.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "specUnitOptions" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "qtyUnitOptions" TEXT;
