-- WindowType·Direction enum → TEXT 변환 (데이터 보존)
-- Supabase SQL Editor에서 먼저 실행 후 prisma db push 실행

-- 1. windowType 컬럼: enum → TEXT (기존 OUTER/INNER 값 보존)
ALTER TABLE rooms ALTER COLUMN "windowType" TYPE TEXT USING "windowType"::TEXT;

-- 2. direction 컬럼: enum → TEXT (기존 NORTH/SOUTH 등 값 보존)
ALTER TABLE rooms ALTER COLUMN "direction" TYPE TEXT USING "direction"::TEXT;

-- 3. properties 테이블에 directionOptions 컬럼 추가
ALTER TABLE properties ADD COLUMN IF NOT EXISTS "directionOptions" TEXT;

-- 4. 기존 enum 타입 제거
DROP TYPE IF EXISTS "WindowType";
DROP TYPE IF EXISTS "Direction";
