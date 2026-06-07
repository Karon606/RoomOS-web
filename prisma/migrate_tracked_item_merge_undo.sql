-- 병합 되돌리기(병합 해제)용 복원 정보 테이블 추가
-- Supabase SQL Editor 에서 실행 후 `npx prisma generate` (배포 빌드시 자동 실행됨)
--
-- payload(JSONB) 형태:
--   kind='IMPORT' (자동등록 병합 — 지출 라벨만 대상으로 이전, 카드 삭제 없음):
--     { "kind":"IMPORT", "origLabel":"...", "category":"...", "specUnit":null,
--       "qtyUnit":"5L", "expenseIds":["..."] }
--   kind='CARD' (두 카드 병합 — source 카드 삭제):
--     { "kind":"CARD", "source":{label,category,specUnit,qtyUnit,trackUnit,hubLocationId,
--       alertThresholdDays,reorderMemo,purchaseUrl,memo}, "movedExpenseIds":[...],
--       "movedCheckIds":[...], "movedAdditionIds":[...], "targetQtyUnitBefore":"10L" }

CREATE TABLE IF NOT EXISTS "tracked_item_merge_undos" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "propertyId"   UUID         NOT NULL,
    "targetItemId" UUID         NOT NULL,
    "label"        TEXT         NOT NULL,
    "payload"      JSONB        NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_item_merge_undos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tracked_item_merge_undos_propertyId_idx"
  ON "tracked_item_merge_undos" ("propertyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracked_item_merge_undos_propertyId_fkey'
  ) THEN
    ALTER TABLE "tracked_item_merge_undos"
      ADD CONSTRAINT "tracked_item_merge_undos_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 보안: RLS 활성화(정책 없음 = anon 전부 차단). 앱은 postgres 롤(Prisma)로 우회.
ALTER TABLE "tracked_item_merge_undos" ENABLE ROW LEVEL SECURITY;
