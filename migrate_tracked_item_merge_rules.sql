-- 병합 규칙 — 영수증→재고 자동등록 시 라벨↔카드 추천(LINK)·거절(MUTE) 기억.
-- Supabase SQL 편집기에서 1회 실행.
--
-- ⚠ 컬럼명은 camelCase + 큰따옴표 (Prisma 필드명 그대로). 테이블명은 snake_case.
--
-- kind="LINK": 이 라벨은 이 카드로 추천(과거 병합 이력/승인). 자동 병합 아님, 후보 제시용.
-- kind="MUTE": 이 (라벨, 카드) 쌍 추천 안 함('새 품목으로' 거절). 관리 UI에서 되돌리기 가능.

CREATE TABLE IF NOT EXISTS tracked_item_merge_rules (
  "id"           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId"   uuid          NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  "category"     text          NOT NULL,
  "sourceLabel"  text          NOT NULL,
  "normLabel"    text          NOT NULL,
  "targetItemId" uuid          NOT NULL REFERENCES tracked_items(id) ON DELETE CASCADE,
  "kind"         text          NOT NULL,
  "createdAt"    timestamp(3)  NOT NULL DEFAULT now(),
  "updatedAt"    timestamp(3)  NOT NULL DEFAULT now()
);

-- (라벨, 카드)당 규칙 1개 — 같은 정규화 라벨이 카드에 대해 LINK든 MUTE든 하나만.
CREATE UNIQUE INDEX IF NOT EXISTS "tracked_item_merge_rules_norm_target_key"
  ON tracked_item_merge_rules ("propertyId", "category", "normLabel", "targetItemId");
CREATE INDEX IF NOT EXISTS "tracked_item_merge_rules_property_category_idx"
  ON tracked_item_merge_rules ("propertyId", "category");
