// 고정지출 항목 기본 구매처와 최근 기록 구매처 갈림 감사의 질의 정본. 장부 그물(check-recurring-vendor-drift)과 통합 하네스(test-recurring-vendor-flow)가 같은 함수를 쓴다.
// query(sql) 는 { rows } 를 돌려주는 함수다(운영은 node-postgres, 하네스는 PGlite). 읽기만 한다.

/** @param {(sql: string) => Promise<{ rows: any[] }>} query */
export async function auditRecurringVendorDrift(query) {
  const { rows } = await query(`
    SELECT r."propertyId" AS prop, r.id, r.title, r.vendor AS tpl, last.vendor AS rec, last.date::text AS d
    FROM recurring_expenses r
    JOIN LATERAL (
      SELECT e.vendor, e.date FROM expenses e
      WHERE e."recurringExpenseId" = r.id AND e."propertyId" = r."propertyId"
      ORDER BY e.date DESC, e."createdAt" DESC LIMIT 1
    ) last ON true
    WHERE r.vendor IS NOT NULL AND last.vendor IS NOT NULL AND last.vendor <> r.vendor
    ORDER BY r."propertyId", r.title`)
  return rows
}

/**
 * 항목 구매처가 그 영업장 쇼핑몰 목록 이름인 항목(경고). 열쇠는 lib/expenseChannel channelKey 와 같다(앞뒤 공백·라틴 대소문자 무시).
 * @param {(sql: string, params?: unknown[]) => Promise<{ rows: any[] }>} query
 */
export async function auditRecurringVendorChannel(query) {
  const props = (await query(`SELECT id, name, "channelOptions" AS opts FROM properties WHERE "channelOptions" IS NOT NULL AND "channelOptions" <> ''`)).rows
  const out = []
  for (const p of props) {
    const names = String(p.opts).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (!names.length) continue
    const r = await query(`SELECT id, title, vendor FROM recurring_expenses WHERE "propertyId" = $1 AND lower(btrim(vendor)) = ANY($2::text[]) ORDER BY title`, [p.id, names])
    for (const x of r.rows) out.push({ prop: p.name, title: x.title, vendor: x.vendor })
  }
  return out
}
