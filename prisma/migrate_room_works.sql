-- 방 작업 이력 — 청소가 아닌 작업(도배·장판 등) (2026-08-25, 신고 b21e4e98 후속).
--
-- 왜 room_cleanings 와 따로 두나. 청소는 이미 제 표가 있고 퇴실 정산·청소비 몫과 얽혀 있다
-- (fromCleaningFund·performer). 그것을 일반화하려면 회계 접점을 건드려야 하는데, 이번 작업은
-- 표시·기록 층이다. 캘린더는 두 표를 합쳐 하나로 그린다(lib/moveCalendarData 가 그 자리다).
--
-- 종류(kind)는 문자열이다. 목록은 환경설정의 Property.workKindOptions 가 들고 있고, 이 표는
-- 그때 고른 이름을 그대로 적어 둔다 — 목록에서 이름을 지워도 지나간 기록이 사라지면 안 된다.
--
-- 회계에 접점이 없다. 돈은 Expense 가 계속 만들고 여기는 가리키기만 한다(Expense.roomWorkId).
CREATE TABLE IF NOT EXISTS "room_works" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "roomId" UUID NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "scheduledDate" DATE,
  "doneDate" DATE,
  "performer" TEXT,
  "performerName" TEXT,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "room_works_propertyId_status_idx" ON "room_works"("propertyId", "status");
CREATE INDEX IF NOT EXISTS "room_works_roomId_doneDate_idx" ON "room_works"("roomId", "doneDate");

-- 지출 → 작업. **여러 지출이 한 작업에 붙는다**(자재를 여러 날 사고 시공은 하루다).
-- 그래서 링크를 지출 쪽에 둔다. room_cleanings.expenseId 는 1:1 이라 이 모양이 아니다.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "roomWorkId" UUID REFERENCES "room_works"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "expenses_roomWorkId_idx" ON "expenses"("roomWorkId");

-- 작업 종류 목록 — 다른 분류 옵션과 같은 방식(쉼표 구분 문자열).
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "workKindOptions" TEXT;
