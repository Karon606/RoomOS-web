-- 청소비를 보증금에 포함해서 받는 영업장 설정 (2026-08-10, 운영자 승인 — loop.md 4번 DB 스키마)
-- 프로덕션(Supabase) SQL 에디터에서 1회 실행. 추가 전용·무손실.
--
-- 왜 새 칼럼인가. 옛 칼럼 refundDeductCleaning('환불 시 청소비 차감')은 코드가 한 줄도 읽지 않는
-- 죽은 칼럼이고 의미도 다르다(퇴실 공제 여부 vs 수령 방식). 되돌릴 여지를 남기려 지우지 않고 둔다.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "cleaningFeeInDeposit" BOOLEAN NOT NULL DEFAULT false;

-- 백필 — 제기역점이 실제로 그 방식이고 옛 칼럼에 true 로 남아 있다(운영자 승인).
UPDATE "properties" SET "cleaningFeeInDeposit" = "refundDeductCleaning";
