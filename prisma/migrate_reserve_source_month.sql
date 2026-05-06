-- ReserveTransaction에 sourceMonth 컬럼 추가
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
-- DEPOSIT 거래에 한해 "어느 달 자금에서 적립했는지" 추적용 메타.
-- "YYYY-MM" 형식. 기존 적립 거래는 NULL → 표시상 "출처 미지정" 처리.

ALTER TABLE "reserve_transactions"
  ADD COLUMN "sourceMonth" TEXT;
