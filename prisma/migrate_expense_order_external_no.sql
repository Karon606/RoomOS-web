-- 쇼핑몰(쿠팡 등) 실제 주문번호 — 영수증 OCR/수동 입력, 진위확인·재주문 참조용(보조)
ALTER TABLE "expense_orders" ADD COLUMN IF NOT EXISTS "externalOrderNo" TEXT;
