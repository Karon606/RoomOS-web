-- WindowType enum 변경: WINDOW→OUTER, NO_WINDOW→INNER, SKYLIGHT 제거
-- Supabase SQL Editor에서 실행 후 prisma generate 실행

-- 1. 새 enum 타입 생성
CREATE TYPE "WindowType_new" AS ENUM ('OUTER', 'INNER');

-- 2. 컬럼 변환 (WINDOW→OUTER, NO_WINDOW→INNER, SKYLIGHT→NULL)
ALTER TABLE rooms ALTER COLUMN "windowType" TYPE "WindowType_new"
  USING CASE
    WHEN "windowType"::text = 'WINDOW'    THEN 'OUTER'::"WindowType_new"
    WHEN "windowType"::text = 'NO_WINDOW' THEN 'INNER'::"WindowType_new"
    ELSE NULL
  END;

-- 3. 기존 타입 제거 후 이름 변경
DROP TYPE "WindowType";
ALTER TYPE "WindowType_new" RENAME TO "WindowType";
