-- 점검 임시저장(드래프트) — #2 서버 드래프트. Supabase SQL 편집기에서 1회 실행.
--
-- ⚠ 컬럼명은 camelCase + 큰따옴표 (Prisma 필드명 그대로). 테이블명은 snake_case.
--    따옴표 없이 만들면 Postgres가 소문자로 접어 Prisma("trackedItemId")와 불일치 → 쿼리 실패.
--
-- StockCheck 와 별도 테이블이라 실제 잔량/이력 계산엔 영향 없음.
-- '보충 전'만 입력하고 나중에 이어서 마무리하기 위한 폼 상태(JSON) 보관. 항목+위치당 1개.

CREATE TABLE IF NOT EXISTS stock_check_drafts (
  "id"            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "trackedItemId" uuid          NOT NULL REFERENCES tracked_items(id) ON DELETE CASCADE,
  "locationId"    uuid          REFERENCES storage_locations(id) ON DELETE CASCADE,
  "data"          jsonb         NOT NULL,
  "updatedAt"     timestamp(3)  NOT NULL DEFAULT now(),
  "createdAt"     timestamp(3)  NOT NULL DEFAULT now()
);

-- 항목+위치당 드래프트 1개. (NULL locationId 는 Postgres 기본상 서로 distinct 라
--  아이템별 점검 드래프트의 유일성은 앱 액션이 보장한다 — 저장 시 deleteMany 후 create.)
CREATE UNIQUE INDEX IF NOT EXISTS "stock_check_drafts_trackedItemId_locationId_key"
  ON stock_check_drafts ("trackedItemId", "locationId");
CREATE INDEX IF NOT EXISTS "stock_check_drafts_trackedItemId_idx"
  ON stock_check_drafts ("trackedItemId");
