-- 지출의 쇼핑몰 칸과 영업장 쇼핑몰 목록 (2026-10-19 운영자 승인, 신고 a0636f36 "구매처랑 실제 구매한 쿠팡이나 옥션, 지마켓과 같은 채널").
--
-- expenses.channel: 주문을 받은 플랫폼 서비스 이름(화면 낱말 '쇼핑몰'). 구매처(vendor·vendorBizNo, 실제 판매자)와 다른 축이다.
--   NULL = 미기록. 기존 행은 전부 NULL 로 시작하고 자동으로 채우지 않는다(주문번호 모양·구매처 글자로 추정 금지).
--   옛 기록은 운영자가 구매처 정리 카드의 '쇼핑몰로 옮기기'·'이 구매처의 지출 전부에 쇼핑몰 지정'으로 직접 정한다.
-- properties."channelOptions": 쇼핑몰 목록(콤마 구분). NULL = 빈 목록(기본값 없음, 멀티테넌트).
--
-- 인덱스는 두지 않는다. 쇼핑몰을 고르는 조회는 전부 영업장(propertyId) 범위 안의 부분 일치 검색이거나 주문(orderId,
-- 인덱스 있음) 단위라 이 칸만으로 찾는 길이 없다.
--
-- 물리 테이블명은 expenses·properties(@@map). 칸 이름은 @map 이 없어 camelCase 그대로다. 멱등(IF NOT EXISTS)이라 두 번 실행해도 같다.
--
-- 적용 순서: 이 SQL 을 운영 DB 에 먼저 적용한 뒤 코드를 배포한다. 새 코드의 Prisma 클라이언트는 지출·영업장을 select 없이 읽을 때
-- 이 칸을 함께 고르므로, 칸 없이 배포하면 지출 조회·환경설정 조회가 'column does not exist' 로 실패한다. 칸만 먼저 생기는 것은
-- 옛 코드에 무해하다(옛 클라이언트는 이 칸을 모른다). 잠금은 짧게: SET lock_timeout = '5s' 를 앞에 두고 실패하면 다시 돌린다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤):
--   ALTER TABLE "expenses" DROP COLUMN IF EXISTS "channel";
--   ALTER TABLE "properties" DROP COLUMN IF EXISTS "channelOptions";
SET lock_timeout = '5s';
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "channelOptions" TEXT;
