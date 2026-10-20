// 한 주문 쇼핑몰 갈림·구매처 번호 짝 감사의 질의 정본. 장부 그물(check-order-channel-split)과 통합 하네스(test-expense-channel-flow)가 같은 함수를 쓴다.
// query(sql, params) 는 { rows } 를 돌려주는 함수다(운영은 node-postgres, 하네스는 PGlite). 읽기만 한다.

/** @param {(sql: string, params?: unknown[]) => Promise<{ rows: any[] }>} query */
export async function auditOrderChannel(query) {
  const cols = await query(`SELECT table_name, column_name FROM information_schema.columns WHERE (table_name = 'expenses' AND column_name = 'channel') OR (table_name = 'properties' AND column_name = 'channelOptions')`)
  if (cols.rows.length < 2) return { missingColumns: true, errors: [], mixed: [], nameTwoNo: [], noTwoName: [], channelAsVendor: [] }
  const split = await query(`
    SELECT e."orderId" AS order_id, MIN(e.date)::text AS d, array_agg(DISTINCT e.channel) FILTER (WHERE e.channel IS NOT NULL) AS chans,
           COUNT(*) FILTER (WHERE e.channel IS NULL)::int AS unset, COUNT(*)::int AS n
    FROM expenses e WHERE e."orderId" IS NOT NULL GROUP BY e."orderId"
    HAVING COUNT(DISTINCT e.channel) > 1 OR (COUNT(DISTINCT e.channel) = 1 AND COUNT(*) FILTER (WHERE e.channel IS NULL) > 0)`)
  const errors = split.rows.filter(r => (r.chans ?? []).length > 1)
  const mixed = split.rows.filter(r => (r.chans ?? []).length === 1)
  const nameTwoNo = (await query(`
    SELECT p.name AS prop, e.vendor, array_agg(DISTINCT e."vendorBizNo") AS nos FROM expenses e JOIN properties p ON p.id = e."propertyId"
    WHERE e.vendor IS NOT NULL AND e."vendorBizNo" IS NOT NULL GROUP BY p.name, e."propertyId", e.vendor HAVING COUNT(DISTINCT e."vendorBizNo") > 1`)).rows
  const noTwoName = (await query(`
    SELECT p.name AS prop, e."vendorBizNo" AS no, array_agg(DISTINCT e.vendor) AS names FROM expenses e JOIN properties p ON p.id = e."propertyId"
    WHERE e.vendor IS NOT NULL AND e."vendorBizNo" IS NOT NULL GROUP BY p.name, e."propertyId", e."vendorBizNo" HAVING COUNT(DISTINCT e.vendor) > 1`)).rows
  const props = (await query(`SELECT id, name, "channelOptions" AS opts FROM properties WHERE "channelOptions" IS NOT NULL AND "channelOptions" <> ''`)).rows
  const channelAsVendor = []
  for (const p of props) {
    const names = String(p.opts).split(',').map(s => s.trim()).filter(Boolean)
    if (!names.length) continue
    const r = await query(`SELECT vendor, COUNT(*)::int AS n FROM expenses WHERE "propertyId" = $1 AND btrim(vendor) = ANY($2::text[]) GROUP BY vendor`, [p.id, names])
    for (const x of r.rows) channelAsVendor.push({ prop: p.name, vendor: x.vendor, n: x.n })
  }
  return { missingColumns: false, errors, mixed, nameTwoNo, noTwoName, channelAsVendor }
}
