-- 고정지출 주기 — 매월 말고 격월·분기·반기·연1회 (2026-08-25, 신고 7e7da5c4).
--
-- 종전에는 dueDay 하나로 주기를 표현해 **매월이 모델에 박혀 있었다.** 그 전제를 예정일 산출·
-- 홈 예상지출·푸시 알림·설정 폼이 전부 소비하고 있어, 비월간 지출을 등록하면 매달 예정 행과
-- 알림에 허수로 잡혔다.
--
-- **정수 배수형**으로 둔다(enum 아님). 운영자가 말한 네 주기가 정확히 2·3·6·12 배수이고,
-- 화면에서 다섯 선택지(매월·격월·분기·반기·연1회)로 제한하면 두 방식의 장점을 다 가진다.
-- enum 이면 '4개월마다' 같은 것이 나올 때 마이그레이션이 또 필요하다.
--
-- 기존 행은 기본값 1(매월)이라 **무변경·무백필**이다.
ALTER TABLE "recurring_expenses" ADD COLUMN IF NOT EXISTS "intervalMonths" INTEGER NOT NULL DEFAULT 1;
-- 도래 달의 기준점 (1~12). 예: 연1회이고 anchorMonth=3 이면 매년 3월에 온다.
-- null 이면 activeSince(없으면 createdAt)의 달을 기준으로 삼는다 — 등록한 달부터 주기가 돈다.
ALTER TABLE "recurring_expenses" ADD COLUMN IF NOT EXISTS "anchorMonth" INTEGER;
