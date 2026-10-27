-- 방 점검 표 둘(room_inspections·room_inspection_items)과 영업장 목록 칸 넷 추가 (2026-10-27 운영자 승인, 신고 2911c217).
--
-- 뜻: 퇴실 점검(퇴실일)·청소 검수(청소 완료 직후)·입실 전 점검(다음 입실 전)을 방마다 항목 체크리스트로 남긴다.
--   퇴실 처리가 퇴실 점검과 입실 전 점검을, 청소 완료가 청소 검수를 만든다. 항목은 그때의 영업장 목록과 그 방 비품 품명을
--   베낀 스냅샷이라(label) 목록을 고쳐도 이미 만든 점검은 안 바뀐다. 회계에 접점이 없다.
--   목록 칸 넷은 분류 관리 '청소·작업' 묶음 카드가 고친다. 콤마 구분이고 NULL = 코드 기본값(lib/optionLists OPTION_LIST_DEFAULTS).
-- 백필 없음. 지금 비어 있는 방에는 점검이 없다(호실 관리 > 작업 > '+ 점검 등록' 으로 손수 만든다). 기존 영업장 목록 칸은 전부 NULL 로 남는다.
--
-- 물리 테이블명은 @@map, 칸 이름은 camelCase 그대로다. 멱등(IF NOT EXISTS)이라 두 번 실행해도 같다.
-- 보안: 두 표 모두 RLS 를 켠다(정책 없음 = anon 전부 차단, 앱은 postgres 롤 Prisma 로 우회. migrate_expense_order.sql 과 같은 관례).
--
-- 적용 순서: 이 SQL 을 운영 DB 에 먼저 적용한 뒤 코드를 배포한다. 새 Prisma 클라이언트는 영업장을 select 없이 읽을 때 새 칸 넷을 함께
-- 고르므로, 칸 없이 배포하면 영업장 조회가 'column does not exist' 로 실패한다. 표와 칸만 먼저 생기는 것은 옛 코드에 무해하다.
-- 잠금은 짧게: lock_timeout 5초, 걸려서 실패하면 그대로 다시 돌린다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤. 남긴 점검 기록과 고친 목록이 함께 사라진다):
--   DROP TABLE IF EXISTS "room_inspection_items";
--   DROP TABLE IF EXISTS "room_inspections";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "checkoutInspectionItems";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "cleaningInspectionItems";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "moveinInspectionItems";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "inspectionExcludedItems";
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "room_inspections" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "roomId" UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "leaseTermId" UUID REFERENCES "lease_terms"("id") ON DELETE SET NULL,
  "cleaningId" UUID,
  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "scheduledDate" DATE,
  "doneDate" DATE,
  "doneBy" TEXT,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "room_inspections_propertyId_status_idx" ON "room_inspections"("propertyId", "status");
CREATE INDEX IF NOT EXISTS "room_inspections_roomId_stage_idx" ON "room_inspections"("roomId", "stage");
CREATE INDEX IF NOT EXISTS "room_inspections_leaseTermId_idx" ON "room_inspections"("leaseTermId");
ALTER TABLE "room_inspections" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "room_inspection_items" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "inspectionId" UUID NOT NULL REFERENCES "room_inspections"("id") ON DELETE CASCADE,
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'TEMPLATE',
  "expenseId" UUID,
  "result" TEXT NOT NULL DEFAULT 'PENDING',
  "checkedAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "room_inspection_items_inspectionId_sortOrder_idx" ON "room_inspection_items"("inspectionId", "sortOrder");
ALTER TABLE "room_inspection_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "checkoutInspectionItems" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "cleaningInspectionItems" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "moveinInspectionItems" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "inspectionExcludedItems" TEXT;
