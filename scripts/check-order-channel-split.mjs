// 한 주문 안 쇼핑몰 갈림과 구매처·사업자번호 짝 어긋남을 보는 감지망(verify:db). 읽기 전용, 오류 시 exit 1.
// 실행: node --env-file=.env.local scripts/check-order-channel-split.mjs
//
// 왜 (2026-10-19 운영자 승인, 신고 a0636f36). 쇼핑몰(expenses.channel)은 주문을 받은 플랫폼이고 한 주문(한 결제)의 행은 같은
// 쇼핑몰이다(배송비 행 포함). 지출 행 칸이라 수정·일괄 수정이 한 행만 바꾸면 갈린다. 화면이 물어도(수정 폼 '이 건만 바꾸기')
// 갈린 채 남을 수 있어 장부를 여기서 본다. 형제 그물 check-order-card-split(결제 카드 갈림)과 짝이다.
//   오류 · 한 주문에 서로 다른 쇼핑몰 이름이 둘 이상(미기록 행은 안 센다).
//   경고 · 한 주문에 쇼핑몰 하나와 미기록 행이 섞였다(옛 행을 아직 안 정했다. 구매처 정리 카드 '같은 주문 N건에도 적용').
//   경고 · 구매처 이름 하나에 사업자번호 둘 이상 / 사업자번호 하나에 구매처 이름 둘 이상(표기 갈림·잘못 붙은 번호 후보).
//   경고 · 쇼핑몰 목록 이름이 구매처 자리에 남은 행(구매처 정리 카드 '쇼핑몰로 옮기기' 대상).
// 질의 정본은 scripts/order-channel-audit.mjs(통합 하네스가 같은 함수를 PGlite 에 돌린다). 칸을 SQL 로 직접 읽는다.
// 칸이 아직 없으면(prisma/migrate_expense_channel.sql 적용 전) 실패로 멈춘다. 새 코드는 그 칸을 읽으므로 칸 없이 배포하면
// 지출 조회가 깨진다. 푸시 전 이 그물이 그 순서를 지킨다(SQL 먼저, 배포 나중).
import pg from 'pg'
import { auditOrderChannel } from './order-channel-audit.mjs'

// 로컬은 SSL 없이, 운영은 SSL 로 붙는다.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } })
await c.connect()
try {
  await c.query('BEGIN READ ONLY')
  const a = await auditOrderChannel((sql, params) => c.query(sql, params))
  if (a.missingColumns) {
    console.error('[주문 쇼핑몰 갈림] 운영 DB 에 쇼핑몰 칸(expenses.channel · properties."channelOptions")이 없다. prisma/migrate_expense_channel.sql 을 먼저 적용한 뒤 배포한다(칸 없이 새 코드가 나가면 지출 조회가 깨진다).')
    process.exitCode = 1
  } else {
    const cavCount = a.channelAsVendor.reduce((n, x) => n + x.n, 0)
    console.log(`[주문 쇼핑몰 갈림] 오류 ${a.errors.length}건 · 경고(미기록 섞임 주문 ${a.mixed.length} · 이름 하나 번호 둘 ${a.nameTwoNo.length} · 번호 하나 이름 둘 ${a.noTwoName.length} · 구매처 자리의 쇼핑몰 이름 ${cavCount}건)`)
    if (a.mixed.length) console.log(`  · 쇼핑몰 하나 + 미기록 행이 섞인 주문 ${a.mixed.length}개. 구매처 정리 카드의 '같은 주문 N건에도 적용' 또는 수정 폼 '주문 전체에 적용'으로 맞춘다`)
    for (const r of a.nameTwoNo.slice(0, 5)) console.log(`  · [${r.prop}] 구매처 '${r.vendor}' 에 사업자번호 ${r.nos.length}개(${r.nos.join(', ')})`)
    for (const r of a.noTwoName.slice(0, 5)) console.log(`  · [${r.prop}] 사업자번호 ${r.no} 에 구매처 이름 ${r.names.length}개(${r.names.join(', ')})`)
    for (const x of a.channelAsVendor.slice(0, 5)) console.log(`  · [${x.prop}] 쇼핑몰 목록 이름 '${x.vendor}' 이 구매처 자리에 ${x.n}건. 구매처 정리 카드 '쇼핑몰로 옮기기' 대상`)
    if (a.errors.length) {
      for (const r of a.errors) console.error(`  - 주문 ${String(r.order_id).slice(0, 8)} · ${r.d} · 쇼핑몰 ${r.chans.join(', ')} (${r.n}행). 한 주문은 한 쇼핑몰이다. 수정 폼에서 '주문 전체에 적용'으로 맞춘다`)
      console.error('  일부러 나눠 결제한 주문이면 알려 주세요. 규칙을 고칩니다. 조용히 통과시키지 않습니다.')
      process.exitCode = 1
    }
  }
} finally {
  await c.query('ROLLBACK').catch(() => {})
  await c.end()
}
