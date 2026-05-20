-- 재고 점검(StockCheckLocation)에 "보충한 양" 컬럼 추가
-- Supabase SQL Editor 에서 실행
--
-- restockedQty: 이번 점검에서 이 위치에 보충한 양. NULL = 보충 없음(단순 잔량 점검).
-- "채우기 전" 잔량은 remainingQty - restockedQty 로 역산. 위치별 합계만큼 허브
-- StockCheckLocation.remainingQty 에서 자동 차감 (액션 단계에서 처리).
--
-- 기존 fromHubQty/fromLocationId 컬럼은 레거시 명시적 위치 간 이동 기록용으로
-- 유지하되, 신규 UI는 restockedQty 만 사용. 두 컬럼 모두 nullable 이라 기존
-- 데이터에 영향 없음.

ALTER TABLE "stock_check_locations"
  ADD COLUMN IF NOT EXISTS "restockedQty" DOUBLE PRECISION;
