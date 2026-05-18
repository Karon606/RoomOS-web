-- 재고 이동 확인 (③) — stock_check_locations 에 유입 출처 위치 컬럼 추가.
-- Supabase SQL 편집기에서 1회 실행.
--
-- ⚠ 컬럼명은 camelCase + 큰따옴표로. 이 프로젝트는 컬럼명을 Prisma 필드명 그대로
--    쓴다 (snake_case 아님 — fromHubQty·stockCheckId 등 참고). 따옴표 없이 만들면
--    Postgres가 소문자로 접어버려 Prisma("fromLocationId")와 불일치 → 쿼리 실패.

ALTER TABLE stock_check_locations
  ADD COLUMN IF NOT EXISTS "fromLocationId" uuid REFERENCES storage_locations(id);

-- 이미 from_location_id(snake_case)로 잘못 추가한 경우엔 위 줄 대신 아래로 교정:
--   ALTER TABLE stock_check_locations RENAME COLUMN from_location_id TO "fromLocationId";
