-- 영업장별 계약서 템플릿 + 사업자 정보 + 도장 이미지 + 입실자별 본문 덮어쓰기
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
-- 영업장 공통:
--   contractTemplate JSONB — { title, sections: [{ id, title, items: string[] }], oathText, emergencyContactNote? }
--   businessInfo     JSONB — { name, registrationNo, ceoName, address }
--   stampDriveFileId TEXT  — 도장 PNG (Drive 파일 ID, 투명 배경 권장)
--
-- 입실자별 (개별 특약·문구 수정용):
--   LeaseTerm.contractOverride JSONB — Property.contractTemplate 와 동일한 형식. null이면 공통 템플릿 사용.

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "contractTemplate" JSONB,
  ADD COLUMN IF NOT EXISTS "businessInfo"     JSONB,
  ADD COLUMN IF NOT EXISTS "stampDriveFileId" TEXT;

ALTER TABLE "lease_terms"
  ADD COLUMN IF NOT EXISTS "contractOverride" JSONB;
