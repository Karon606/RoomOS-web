-- TenantRequest 에 처리 내용 메모 컬럼 추가
-- Supabase SQL Editor 에서 실행
--
-- resolutionMemo: 요청을 어떻게 처리했는지 짧은 설명. 처리 완료 시점에
-- 입력해, 추후 이력 확인 시 어떻게 해결했는지 추적 가능하도록.

ALTER TABLE "tenant_requests"
  ADD COLUMN IF NOT EXISTS "resolutionMemo" TEXT;
