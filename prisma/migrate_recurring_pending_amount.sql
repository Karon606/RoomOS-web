-- RecurringExpense에 pendingAmount 컬럼 추가
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
-- 변동 고정지출의 청구 금액을 미리 알았을 때 임시 저장하는 예약 금액.
-- 실제 Expense는 생성하지 않으며, 결제일 알림 모달에서 prefill되어
-- 한 번 더 확인 후 기록될 때 자동 클리어된다.

ALTER TABLE "recurring_expenses"
  ADD COLUMN "pendingAmount" INTEGER;
