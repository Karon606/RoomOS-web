-- 스테이음 관리자 감사 기록 표(admin_audit_logs)와 가입자 정리 표(user_archives) 추가 (2026-11-04 운영자 승인 '추천대로', 갈림길 C·F).
--
-- 뜻: 관리자 페이지에서 스테이음 관리자 권한을 주고 회수하거나 가입 상태(승인·거절·대기)를 바꾸면 누가·언제·누구를·전후 값을
--   admin_audit_logs 에 남긴다. 쓰기와 같은 트랜잭션이라 기록 없이 권한만 바뀌는 일이 없다. 종전에는 updatedAt 하나뿐이었다.
--   user_archives 는 '오래된 계정 정리'로 목록에서 걷은 가입자다. 행이 있으면 정리됨, 지우면 되살림. 계정 삭제가 아니다.
-- 백필 없음. users 표에는 칸을 더하지 않는다.
--
-- 멱등(IF NOT EXISTS)이라 두 번 실행해도 같다. 물리 테이블명은 @@map, 칸 이름은 camelCase 그대로다.
-- 보안: RLS 를 켠다(정책 없음 = anon 전부 차단, 앱은 postgres 롤 Prisma 로 우회. migrate_property_notes.sql 과 같은 관례).
--
-- 배포 절차(이 순서를 지킨다):
--   1. 이 SQL 을 운영 DB 에 적용한다(멱등).
--   2. 확인: SELECT to_regclass('public.admin_audit_logs'), to_regclass('public.user_archives');  둘 다 이름이 나와야 한다.
--   3. 그다음에 코드를 배포한다.
-- 표 없이 코드가 먼저 나가면: 관리자 페이지의 가입자 목록 읽기와 쓰기 전부(권한 주기·회수, 승인·거절·대기, 정리, 초대코드 삭제·되살림)가
--   'relation does not exist' 로 실패한다. 스테이음 관리자 계정의 앱 셸(사이드바 대기 건수)과 관리자 레이아웃(탭 대기 건수)도
--   user_archives 를 읽는다. 이 둘은 실패하면 0 으로 보이게 감쌌지만(lib/adminSignups countPendingSignups) 건수가 틀린다.
--   일반 사용자의 앱 화면과 로그인은 이 표를 읽지 않는다.
-- 잠금은 짧게: lock_timeout 5초, 걸려서 실패하면 그대로 다시 돌린다.
--
-- 되돌리기(코드를 먼저 되돌린 뒤. 감사 기록이 함께 사라진다):
--   DROP TABLE IF EXISTS "admin_audit_logs";
--   DROP TABLE IF EXISTS "user_archives";
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorId" UUID NOT NULL,
  "targetUserId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "admin_audit_logs_targetUserId_createdAt_idx" ON "admin_audit_logs"("targetUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");
ALTER TABLE "admin_audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "user_archives" (
  "userId" UUID PRIMARY KEY,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedBy" UUID NOT NULL
);
ALTER TABLE "user_archives" ENABLE ROW LEVEL SECURITY;
