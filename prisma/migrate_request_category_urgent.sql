-- TenantRequest 에 카테고리 + 긴급 플래그 추가
-- Supabase SQL Editor 에서 실행
--
-- category: '시설' | '소음' | '청결' | '편의' | '기타' (자유 텍스트)
-- isUrgent: 긴급 처리 필요 여부 (필터/정렬용)

ALTER TABLE "tenant_requests"
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "isUrgent" BOOLEAN NOT NULL DEFAULT false;
