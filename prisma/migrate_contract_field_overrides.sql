-- 계약서 발급물 표시값 오버라이드 컬럼 추가 (운영자 승인 2026-08-05).
-- 수납·청구 무접점, 계약서 렌더(화면·PDF·서명 링크 스냅샷) 전용.
ALTER TABLE lease_terms ADD COLUMN IF NOT EXISTS "contractFieldOverrides" JSONB;
