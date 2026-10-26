// 고정지출 항목 기본 구매처와 그 항목 최근 기록의 구매처가 갈린 것을 보는 감지망(verify:db, 경고만). 읽기 전용.
// 실행: node --env-file=.env.local scripts/check-recurring-vendor-drift.mjs
//
// 왜 (2026-10-27 운영자 승인, 신고 5fa9cf43 결정 F). 구매처 이름 변경·합치기·비우기가 지출만 고치고 고정지출 항목
// (recurring_expenses.vendor)은 안 따라가면, 다음 기록이 옛 이름으로 다시 적혀 정리가 매달 풀린다. 이제 renameVendor 가 같은
// 트랜잭션에서 항목까지 고치지만, 그 전에 갈린 항목과 다른 길로 갈린 항목을 여기서 본다.
//   경고 · 항목 구매처가 비어 있지 않은데 그 항목의 가장 최근 기록(날짜·입력 순) 구매처가 비어 있지 않은 다른 이름이다.
//   경고 · 항목 구매처가 그 영업장 쇼핑몰 목록 이름이다(판매자가 아니라 소급을 막는다. 고정 지출 관리에서 실제로 받는 곳으로 고친다).
// 기록 모달에서 이번만 다른 구매처로 적은 경우도 같은 모양이라 오류로 세우지 않는다(운영자가 고정 지출 관리에서 본다).
// 질의 정본은 scripts/recurring-vendor-audit.mjs(통합 하네스가 같은 함수를 PGlite 에 돌린다).
import pg from 'pg'
import { auditRecurringVendorDrift, auditRecurringVendorChannel } from './recurring-vendor-audit.mjs'

// 로컬은 SSL 없이, 운영은 SSL 로 붙는다.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } })
await c.connect()
try {
  await c.query('BEGIN READ ONLY')
  const rows = await auditRecurringVendorDrift(sql => c.query(sql))
  console.log(`[고정지출 구매처 갈림] 경고 ${rows.length}건(항목 기본 구매처와 최근 기록 구매처가 다름)`)
  for (const r of rows.slice(0, 10)) {
    console.log(`  · [${String(r.prop).slice(0, 8)}] '${r.title}' 항목 '${r.tpl}' · 최근 기록(${String(r.d).slice(0, 10)}) '${r.rec}'. 이번만 다른 곳이 아니면 고정 지출 관리에서 구매처를 맞춘다`)
  }
  const ch = await auditRecurringVendorChannel((sql, params) => c.query(sql, params))
  console.log(`[고정지출 구매처 갈림] 경고 ${ch.length}건(항목 구매처가 쇼핑몰 목록 이름)`)
  for (const x of ch.slice(0, 10)) console.log(`  · [${x.prop}] '${x.title}' 항목 구매처 '${x.vendor}' 는 쇼핑몰 목록 이름이다. 고정 지출 관리에서 실제로 받는 곳으로 고친다`)
} finally {
  await c.query('ROLLBACK').catch(() => {})
  await c.end()
}
