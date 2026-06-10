-- 퇴실 정산(일할) — 선납 모델에서 퇴실일이 기간 중간이면 마지막 달 청구를 사용 일수만큼만.
-- checkoutProratedAmount: 확정 일할 청구액(원, null=미적용). checkoutProratedMonth: 적용 달 "YYYY-MM".
ALTER TABLE "lease_terms"
  ADD COLUMN IF NOT EXISTS "checkoutProratedAmount" INTEGER,
  ADD COLUMN IF NOT EXISTS "checkoutProratedMonth" TEXT,
  -- 적용취소(롤백)용 — 적용 직전 스냅샷 {prevStatus, prevExpectedMoveOut, prevAmount, prevMonth}
  ADD COLUMN IF NOT EXISTS "checkoutProrationUndo" JSONB;
