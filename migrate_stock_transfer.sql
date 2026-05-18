-- 재고 이동 확인 (③) — StockCheckLocation에 유입 출처 위치 컬럼 추가.
-- Supabase SQL 편집기에서 1회 실행. nullable + FK라 안전 (기존 데이터 영향 없음).

ALTER TABLE stock_check_locations
  ADD COLUMN IF NOT EXISTS from_location_id uuid REFERENCES storage_locations(id);
