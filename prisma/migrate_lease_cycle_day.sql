-- 계약의 이용 기간 시작일 칸(lease_terms."cycleDay") 추가 (2026-10-21 운영자 승인, 504호 "납입일은 바뀌어도 나중 퇴실일을 입실일 전날짜까지면").
--
-- 뜻: 이용 기간이 매월 며칠에 시작하는가. NULL = 납부일(dueDay)과 같다(지금 모든 계약). 값이 있으면 기간 경계(청구 기간·퇴실 정산·
--   입주달 첫 달 규칙·무청구 판정)는 이 날을, 납부 기한(미납·연체·알림·문자)은 dueDay 를 읽는다. 읽는 정본은 lib/dueDay cycleDayOf.
-- 백필 없음. 기존 행은 전부 NULL 로 남고 그래서 청구·정산이 한 글자도 안 바뀐다. 504호만 정정 스크립트(scripts/fix-504-cycle-day.ts)로 '1' 을 넣는다.
-- 인덱스는 두지 않는다. 이 칸만으로 찾는 조회가 없다(계약을 읽을 때 함께 실려 온다).
--
-- 물리 테이블명은 lease_terms(@@map). 칸 이름은 @map 이 없어 camelCase 그대로다. 멱등(IF NOT EXISTS)이라 두 번 실행해도 같다.
--
-- 적용 순서: 이 SQL 을 운영 DB 에 먼저 적용한 뒤 코드를 배포한다. 새 코드의 Prisma 클라이언트는 계약을 select 없이 읽을 때
-- 이 칸을 함께 고르므로, 칸 없이 배포하면 계약 조회가 'column does not exist' 로 실패한다. 칸만 먼저 생기는 것은
-- 옛 코드에 무해하다(옛 클라이언트는 이 칸을 모른다). 잠금은 짧게: lock_timeout 5초, 걸려서 실패하면 그대로 다시 돌린다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤. 504호 정정을 적용했다면 scripts/fix-504-cycle-day.ts --revert 를 먼저):
--   ALTER TABLE "lease_terms" DROP COLUMN IF EXISTS "cycleDay";
SET lock_timeout = '5s';
ALTER TABLE "lease_terms" ADD COLUMN IF NOT EXISTS "cycleDay" TEXT;
