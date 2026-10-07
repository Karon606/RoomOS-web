-- 통장사본 국문·영문 + 영업장 서류 적용취소 스냅샷 (2026-10-07, 운영자 승인)
-- 환경설정에서 올리고 상담 도구에서 문자·메일 첨부로 보낸다. 사업자등록증(migrate_biz_cert.sql)과 같은 축이다.
--
--   bankBookKoDriveFileId / bankBookEnDriveFileId TEXT — 국문·영문 통장사본 원본 (Drive 파일 ID). null = 미등록.
--   bankBookKoMimeType    / bankBookEnMimeType    TEXT — Drive 가 판정한 mime. 화면 분기·전송 Content-Type.
--   propertyDocPrev JSONB — 영업장 서류(사업자등록증·통장사본) 교체·삭제 직전 스냅샷, 적용취소용.
--                           { [kind]: { driveFileId, mimeType, replacedBy, at } } (선례 floorPlanPrevData).
--
-- 부가·널 허용 컬럼이라 기존 행은 전부 null 로 남는다(행 데이터 변경 없음).
-- 공개 읽기 권한은 붙이지 않는다. 예금주·계좌번호가 찍힌 서류라 입금 계좌와 같은 money 스코프로
-- /api/bank-book 인증 프록시에서만 나간다.
-- 되돌림은 아래 다섯 칼럼 DROP.
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "bankBookKoDriveFileId" TEXT,
  ADD COLUMN IF NOT EXISTS "bankBookKoMimeType"    TEXT,
  ADD COLUMN IF NOT EXISTS "bankBookEnDriveFileId" TEXT,
  ADD COLUMN IF NOT EXISTS "bankBookEnMimeType"    TEXT,
  ADD COLUMN IF NOT EXISTS "propertyDocPrev"       JSONB;
