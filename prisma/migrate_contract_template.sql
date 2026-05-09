-- 영업장별 계약서 템플릿 + 사업자 정보 + 도장 이미지
-- Supabase SQL Editor에서 실행 후 npx prisma generate 실행
--
-- contractTemplate: 섹션 본문 JSON
--   shape: { title, sections: [{ id, title, items: string[] }], oathText }
-- businessInfo: 사업자 정보 JSON
--   shape: { name, registrationNo, ceoName, address }
-- stampDriveFileId: 도장 PNG (Drive 파일 ID, 투명 배경 권장)

ALTER TABLE "properties"
  ADD COLUMN "contractTemplate" JSONB,
  ADD COLUMN "businessInfo"     JSONB,
  ADD COLUMN "stampDriveFileId" TEXT;
