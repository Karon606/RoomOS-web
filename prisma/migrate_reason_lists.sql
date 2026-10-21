-- 영업장별 사유 목록 칸 셋(properties."cancelReasons"·"checkoutReasons"·"withholdReasons") 추가 (2026-10-22 운영자 승인, "입실취소 사유를 추가하는게 환경설정에 있어?").
--
-- 뜻: 입실 취소 사유·퇴실 사유·보증금 미반환 사유를 영업장이 환경설정 > 분류 관리에서 고친다. 콤마 구분이고 할인 사유(discountReasons)와 같은 문법이다.
--   NULL = 코드 기본값(lib/optionLists OPTION_LIST_DEFAULTS, 종전 상수에서 '기타'만 뺀 것). 읽는 정본은 lib/optionLists parseOptionList.
-- 백필 없음. 기존 영업장은 전부 NULL 로 남아 고르는 목록이 지금과 한 글자도 안 바뀐다. 이미 남긴 사유(tenant_status_logs.reason·deposit_refunds.reason)도 안 건드린다.
-- 인덱스는 두지 않는다. 영업장 행을 읽을 때 함께 실려 온다.
--
-- 물리 테이블명은 properties(@@map). 칸 이름은 @map 이 없어 camelCase 그대로다. 멱등(IF NOT EXISTS)이라 두 번 실행해도 같다.
--
-- 적용 순서: 이 SQL 을 운영 DB 에 먼저 적용한 뒤 코드를 배포한다. 새 코드의 Prisma 클라이언트는 영업장을 select 없이 읽을 때
-- 이 칸을 함께 고르므로, 칸 없이 배포하면 영업장 조회가 'column does not exist' 로 실패한다. 칸만 먼저 생기는 것은
-- 옛 코드에 무해하다(옛 클라이언트는 이 칸을 모른다). 잠금은 짧게: lock_timeout 5초, 걸려서 실패하면 그대로 다시 돌린다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤. 목록을 고친 영업장의 목록도 함께 사라진다):
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "cancelReasons";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "checkoutReasons";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "withholdReasons";
SET lock_timeout = '5s';
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "cancelReasons" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "checkoutReasons" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "withholdReasons" TEXT;
