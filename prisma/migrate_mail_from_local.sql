-- 영업장별 발신 로컬파트 (2026-08-26 운영자 승인) — 도메인은 stayeum.com 고정, 앞부분만 영업장 몫.
-- null = no-reply 기본이라 백필이 없다. 되돌림: 인덱스·칼럼 DROP 으로 충분(추가만 있음).
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "mailFromLocal" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "properties_mailFromLocal_key" ON "properties"("mailFromLocal");
