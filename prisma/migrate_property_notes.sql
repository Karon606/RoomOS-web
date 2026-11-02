-- 영업장 관리 메모 표(property_notes) 추가 (신고 d1e5fecc, 2026-11-02 운영자 승인).
--
-- 뜻: 계절마다 바꾸는 설정처럼 때가 지나면 잊는 내용을 영업장 단위로 적어 둔다. 호실 관리 헤더 '관리 메모' 가 연다.
--   제목·본문·분류 한 개(tag)·차례(sortOrder). 삭제는 deletedAt 도장이라 적용취소가 되살린다. 회계에 접점이 없다.
-- 백필 없음. 처음에는 영업장마다 빈 목록이다.
--
-- 물리 테이블명은 @@map, 칸 이름은 camelCase 그대로다. 멱등(IF NOT EXISTS)이라 두 번 실행해도 같다.
-- 외래키는 ON UPDATE CASCADE 를 함께 둔다(Prisma 기본·migrate_room_inspection.sql 관례). 영업장을 지우면 메모도 함께 지워진다.
-- 보안: RLS 를 켠다(정책 없음 = anon 전부 차단, 앱은 postgres 롤 Prisma 로 우회. migrate_room_inspection.sql 과 같은 관례).
--
-- 적용 순서: 이 SQL 을 운영 DB 에 먼저 적용한 뒤 코드를 배포한다. 영업장 표에는 칸을 더하지 않으므로 다른 화면은 표가 없어도
-- 깨지지 않는다. 표 없이 배포하면 '관리 메모' 창의 목록 읽기와 추가·수정·삭제만 'relation does not exist' 로 실패한다.
-- 잠금은 짧게: lock_timeout 5초, 걸려서 실패하면 그대로 다시 돌린다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤. 적어 둔 메모가 함께 사라진다):
--   DROP TABLE IF EXISTS "property_notes";
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "property_notes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "propertyId" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "tag" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "property_notes_propertyId_sortOrder_idx" ON "property_notes"("propertyId", "sortOrder");
ALTER TABLE "property_notes" ENABLE ROW LEVEL SECURITY;
