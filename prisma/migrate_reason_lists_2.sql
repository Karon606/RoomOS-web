-- 영업장별 2차 목록 칸 여섯(properties."dueDayReasons"·"cleaningReasons"·"stockDisposalReasons"·"stockSourceOptions"·"assetDisposalReasons"·"visitRouteOptions") 추가 (2026-10-22 운영자 승인, 2차 패널 '추천대로').
--
-- 뜻: 납부일 임시 조정 사유·청소 사유·소모품 폐기 사유·무상 입수 출처·비품 폐기 사유·방문 경로를 영업장이 환경설정 > 분류 관리에서 고친다.
--   콤마 구분이고 사유 목록 셋(prisma/migrate_reason_lists.sql)과 같은 문법이다. '기타'는 목록에 넣지 않는다(고르는 자리 맨 끝 고정, lib/reasonLists).
--   NULL = 코드 기본값(lib/optionLists OPTION_LIST_DEFAULTS). 읽는 정본은 lib/optionLists parseOptionList.
-- 백필 없음. 기존 영업장은 전부 NULL 로 남는다. 이미 남긴 기록(lease_terms."overrideDueDayReason"·"visitRoute", room_cleanings.reason,
-- stock_disposals.reason, stock_additions.source, expenses."disposalReason")도 안 건드린다. 청소 사유 코드(CHECKOUT 따위)와 옛 'OTHER' 도 그대로다.
-- 인덱스는 두지 않는다. 영업장 행을 읽을 때 함께 실려 온다.
--
-- 물리 테이블명은 properties(@@map). 칸 이름은 @map 이 없어 camelCase 그대로다. 멱등(IF NOT EXISTS)이라 두 번 실행해도 같다.
--
-- 적용 순서: 이 SQL 을 운영 DB 에 먼저 적용한 뒤 코드를 배포한다. 새 코드의 Prisma 클라이언트는 영업장을 select 없이 읽을 때
-- 이 칸을 함께 고르므로, 칸 없이 배포하면 영업장 조회가 'column does not exist' 로 실패한다. 칸만 먼저 생기는 것은
-- 옛 코드에 무해하다(옛 클라이언트는 이 칸을 모른다). 잠금은 짧게: lock_timeout 5초, 걸려서 실패하면 그대로 다시 돌린다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤. 목록을 고친 영업장의 목록도 함께 사라진다):
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "dueDayReasons";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "cleaningReasons";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "stockDisposalReasons";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "stockSourceOptions";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "assetDisposalReasons";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "visitRouteOptions";
SET lock_timeout = '5s';
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "dueDayReasons" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "cleaningReasons" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "stockDisposalReasons" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "stockSourceOptions" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "assetDisposalReasons" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "visitRouteOptions" TEXT;
