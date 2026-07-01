-- 비품·자재 배정일 — Expense 에 assignedAt(DATE) 추가. 입력·수정 가능, 기본=배정 순간.
-- 기존 배정분은 배정 이력 로그(asset_assignment_log)의 최근 배정 시각(KST)으로 백필한다.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "assignedAt" DATE;

-- 방 배정분 백필 — 품목·방번호가 일치하는 최근 배정 로그의 날짜(KST)로 채움.
UPDATE "expenses" e
SET "assignedAt" = sub.d
FROM (
  SELECT DISTINCT ON (l."propertyId", l."itemLabel", l."toLabel")
         l."propertyId", l."itemLabel", l."toLabel",
         (l."createdAt" AT TIME ZONE 'Asia/Seoul')::date AS d
  FROM "asset_assignment_log" l
  WHERE l."toKind" = 'room' AND l."itemLabel" IS NOT NULL
  ORDER BY l."propertyId", l."itemLabel", l."toLabel", l."createdAt" DESC
) sub
-- 로그의 방 toLabel 은 placeLabel 규칙상 숫자 방번호에 '호'를 붙임(예: '412' -> '412호').
JOIN "rooms" r
  ON (CASE WHEN r."roomNo" ~ '^\d+$' THEN r."roomNo" || '호' ELSE r."roomNo" END) = sub."toLabel"
  AND r."propertyId" = sub."propertyId"
WHERE e."roomId" = r."id"
  AND e."itemLabel" = sub."itemLabel"
  AND e."assignedAt" IS NULL;

-- 공용부 배정분 백필 — 품목·공용부명이 일치하는 최근 배정 로그의 날짜(KST)로 채움.
UPDATE "expenses" e
SET "assignedAt" = sub.d
FROM (
  SELECT DISTINCT ON (l."propertyId", l."itemLabel", l."toLabel")
         l."propertyId", l."itemLabel", l."toLabel",
         (l."createdAt" AT TIME ZONE 'Asia/Seoul')::date AS d
  FROM "asset_assignment_log" l
  WHERE l."toKind" IN ('location', 'common') AND l."itemLabel" IS NOT NULL
  ORDER BY l."propertyId", l."itemLabel", l."toLabel", l."createdAt" DESC
) sub
JOIN "storage_locations" s ON s."name" = sub."toLabel" AND s."propertyId" = sub."propertyId"
WHERE e."assignedLocationId" = s."id"
  AND e."itemLabel" = sub."itemLabel"
  AND e."assignedAt" IS NULL;
