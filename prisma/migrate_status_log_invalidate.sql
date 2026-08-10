-- 상태 이력 무효 처리(소프트삭제) — 신고 e000c791, 운영자 승인 2026-08-10.
-- 프로덕션(Supabase) DIRECT_URL 로 1회 실행. 추가 전용·무손실(ADD COLUMN 만).
--
-- 왜 하드삭제가 아닌가. 이력은 감사 추적이라 지우면 "언제 무엇이 있었는지"가 함께 사라진다.
-- 잘못 입력한 행을 없던 일로 만들되 흔적은 남긴다 — PaymentRecord·TenantRequest 와 같은 문법
-- (deletedAt null=유효, 값=무효 처리한 시각). 복원은 deletedAt 을 null 로 되돌린다.
--
-- deletedById 는 누가 무효 처리했는지다. changedById 와 같은 규약(users FK, ON DELETE SET NULL) —
-- 계정이 지워져도 이력 행 자체는 남아야 한다.
ALTER TABLE "tenant_status_logs" ADD COLUMN IF NOT EXISTS "deletedAt"   TIMESTAMP(3);
ALTER TABLE "tenant_status_logs" ADD COLUMN IF NOT EXISTS "deletedById" UUID;

ALTER TABLE "tenant_status_logs" DROP CONSTRAINT IF EXISTS "tenant_status_logs_deletedById_fkey";
ALTER TABLE "tenant_status_logs"
  ADD CONSTRAINT "tenant_status_logs_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL;
