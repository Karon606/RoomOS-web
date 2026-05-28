-- D. 영업장 구성원 초대·참여 (2026-05-28)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용·무손실.

-- 0) 영업장 참여 요청 상태 enum
DO $$ BEGIN
  CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 1) 영업장에 참여 코드 컬럼 추가 (NULL = 코드 미발급, 운영자가 발급 시 채워짐)
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "joinCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "properties_joinCode_key" ON "properties"("joinCode");

-- 2) 영업장 참여 요청 테이블
CREATE TABLE IF NOT EXISTS "join_requests" (
  "id"          UUID                NOT NULL DEFAULT gen_random_uuid(),
  "propertyId"  UUID                NOT NULL,
  "userId"      UUID                NOT NULL,
  "status"      "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "role"        "UserRole"          NOT NULL DEFAULT 'STAFF',
  "message"     TEXT,
  "createdAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt"   TIMESTAMP(3),
  "decidedBy"   UUID,
  CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "join_requests_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "properties"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "join_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "join_requests_propertyId_userId_key" ON "join_requests"("propertyId", "userId");
CREATE INDEX IF NOT EXISTS "join_requests_propertyId_status_idx" ON "join_requests"("propertyId", "status");
