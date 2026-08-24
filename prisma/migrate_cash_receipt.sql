-- 현금영수증 발행 기록 (2026-08-24, 운영자 확정 — 신고 8b9b6c43 후속).
--
-- 왜 표를 새로 만드나. 종전에는 PaymentRecord.cashReceiptIssuedAt 하나로 "이 수납은 발행함"만
-- 저장했다. 그래서 합계가 **발행한 금액이 아니라 발행 표시가 붙은 수납 금액**이었다. 45만 받고
-- 30만만 끊으면 앱은 45만이라 말한다 — 그 차이를 담을 자리가 없었다.
-- 운영자 원문 — "항목별로 선택말고 금액으로 발행하게 하는건 어때? 기본은 그 달 받은 금액이
-- 기준이며 보증금이나 청소비, 월이용료 등을 체크 또는 체크 해제함으로서 해당 합계금액이 바뀌고
-- 수동으로 직접 금액을 바꿀 수도 있고".
--
-- 청소비 몫이 ExtraIncome(다른 표)에 있어 발행을 기록할 자리가 아예 없던 문제도 여기서 풀린다.
-- 발행은 입금 단위로 한 줄이고, 그 줄이 금액을 들고 있으므로 어느 표에 몫이 흩어져 있든 상관없다.
--
-- 돈 계산에는 접점이 없다. 충당·잔액·미납은 PaymentRecord 가 계속 정한다.
CREATE TABLE IF NOT EXISTS "cash_receipts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "leaseTermId" UUID NOT NULL REFERENCES "lease_terms"("id") ON DELETE CASCADE,
  "tenantId" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- 발행일. 이 값의 KST 달이 곧 집계 축이다(홈택스에 올라간 날).
  "issuedAt" TIMESTAMP(3) NOT NULL,
  -- 실제 발행 금액. 받은 금액과 다를 수 있다 — 그것이 이 표의 존재 이유다.
  "amount" INTEGER NOT NULL,
  -- 어느 입금에서 나왔나. 화면이 '이 입금은 발행됨'을 말하는 근거이고,
  -- payMethod 는 카드 봉인 대조용이다(카드는 현금영수증 대상이 아니다).
  "payDate" DATE NOT NULL,
  "payMethod" TEXT,
  -- 무엇을 포함했나. 금액만 남기면 '왜 35만인가'가 사라진다.
  "inclDeposit" BOOLEAN NOT NULL DEFAULT false,
  "inclCleaning" BOOLEAN NOT NULL DEFAULT false,
  "inclRent" BOOLEAN NOT NULL DEFAULT false,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 적용취소 — 발행 기록을 지워도 되살릴 수 있어야 한다(저장소 원칙).
  "deletedAt" TIMESTAMP(3)
);
-- 월 집계 — propertyId + issuedAt 창으로 긁는다.
CREATE INDEX IF NOT EXISTS "cash_receipts_propertyId_issuedAt_idx" ON "cash_receipts"("propertyId", "issuedAt");
-- 화면 — 이 입금이 발행됐는지 되찾는 축.
CREATE INDEX IF NOT EXISTS "cash_receipts_leaseTermId_payDate_idx" ON "cash_receipts"("leaseTermId", "payDate");
