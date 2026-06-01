-- 전체 재고 보정(총점검) — StockCheck.isReconcile 추가 (추가 전용)
-- 보정 점검: 실측을 새 기준선으로 박되, 사용량 계산에서 직전 구간 차이를 소모로 안 잡음.
ALTER TABLE stock_checks ADD COLUMN IF NOT EXISTS "isReconcile" BOOLEAN NOT NULL DEFAULT false;
