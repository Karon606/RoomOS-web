-- A. 운영자(슈퍼관리자) 대시보드 + 베타 접근 게이팅 (2026-05-27)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용(기존 데이터 무손실).
-- ⚠️ 반드시 이 SQL을 먼저 적용한 뒤 코드를 배포할 것 (신규 컬럼/테이블 사용).

-- 0) 접근 상태 enum
DO $$ BEGIN
  CREATE TYPE "AccessStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 1) users 에 접근 제어 컬럼 추가
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status"       "AccessStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isSuperAdmin" BOOLEAN        NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approvedAt"   TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approvedBy"   UUID;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "inviteCode"   TEXT;

-- 2) ⚠️ 기존 가입자는 전부 승인 처리 (실사용자 잠김 방지)
--    이 줄은 마이그레이션 시점의 기존 사용자에게만 적용됨. 이후 신규 가입은 DEFAULT 'PENDING'.
UPDATE "users"
   SET "status" = 'APPROVED', "approvedAt" = COALESCE("approvedAt", now())
 WHERE "status" = 'PENDING';

-- 3) 초대코드/쿠폰 테이블 (선착순 N명 무료 베타)
CREATE TABLE IF NOT EXISTS "invite_codes" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "code"        TEXT         NOT NULL,
  "note"        TEXT,
  "maxUses"     INTEGER      NOT NULL DEFAULT 1,
  "usedCount"   INTEGER      NOT NULL DEFAULT 0,
  "autoApprove" BOOLEAN      NOT NULL DEFAULT true,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "expiresAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"   UUID,
  CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invite_codes_code_key" ON "invite_codes"("code");
