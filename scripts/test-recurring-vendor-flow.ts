// 고정지출 구매처(납부처) 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-recurring-vendor-flow.ts
//
// 왜 통합인가(2026-10-27 운영자 승인, 신고 5fa9cf43). 기록 모달의 구매처 칸은 '부재 = 항목 값, 실림 = 그 값, 비움 = null' 세 갈래고,
// '기본 구매처로 저장'은 지출 생성과 같은 트랜잭션에서 항목을 고치며, 소급·이름 변경은 여러 행을 한 번에 바꾼다. 셋 다 적용취소가
// '그사이 바뀌었으면 아무것도 안 고친다'를 지켜야 한다. 정적 그물(check-recurring-vendor-wiring)은 모양만 보므로 실제 쓰기를 돌린다.
// 판은 기타수익·고정지출 영업장 범위 하네스(scripts/test-income-recurring-scope-flow.ts)와 같다(대역·운영 DB 차단).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x4e).toString('base64')   // 서명 키가 있는 판(위조·교차 용도 거부를 실제로 본다)

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  // 외래키는 뺀다(부모 없는 대역 행을 만든다).
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const fin = await import('@/app/(app)/finance/actions')
  const settings = await import('@/app/(app)/settings/actions')
  const crl = await import('@/app/(app)/rooms/cashReceiptLine')
  const rvu = await import('@/lib/recurringVendorUndo')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1

  const recurring = async (pid: string, title: string, vendor: string | null) => (await prisma.recurringExpense.create({
    data: { propertyId: pid, title, amount: 500000, category: '임대료', dueDay: 10, vendor },
  })).id as string
  const tplVendor = async (id: string) => (await prisma.recurringExpense.findUnique({ where: { id }, select: { vendor: true } }))?.vendor ?? null
  // updatedAt 은 무변경 쓰기(기록이 예약 금액을 비우는 갱신)에도 움직이므로 뺀 나머지를 바이트로 견준다.
  const tplRow = async (id: string) => { const r = await prisma.recurringExpense.findUnique({ where: { id } }) as Record<string, unknown> | null; if (r) delete r.updatedAt; return JSON.stringify(r) }
  const recordedVendor = async (recId: string, month: string) => (await prisma.expense.findFirst({
    where: { recurringExpenseId: recId, date: new Date(`${month}-10T00:00:00Z`) }, select: { vendor: true },
  }))?.vendor
  const record = (recurringExpenseId: string, month: string, extra: Record<string, unknown> = {}) =>
    fin.recordRecurringExpense({ recurringExpenseId, amount: 500000, date: `${month}-10`, ...extra } as never)

  // ── 1단계: 기록의 구매처 칸 세 갈래 ──
  {
    const r = await recurring(P1, '건물 임대료', '대동빌딩')
    eq('부재: 항목 구매처로 기록', [await record(r, '2026-01'), await recordedVendor(r, '2026-01')], [{ ok: true }, '대동빌딩'])
    eq("빈 글자: 비운 채 기록", [await record(r, '2026-02', { vendor: '' }), await recordedVendor(r, '2026-02')], [{ ok: true }, null])
    eq('null: 비운 채 기록', [await record(r, '2026-03', { vendor: null }), await recordedVendor(r, '2026-03')], [{ ok: true }, null])
    eq('공백만: 비운 채 기록', [await record(r, '2026-04', { vendor: '   ' }), await recordedVendor(r, '2026-04')], [{ ok: true }, null])
    const before = await tplRow(r)
    eq('다른 글자: 그 글자로 기록(앞뒤 공백은 뗀다)', [await record(r, '2026-05', { vendor: ' 대동빌딩 관리단 ' }), await recordedVendor(r, '2026-05')], [{ ok: true }, '대동빌딩 관리단'])
    eq('다른 글자, 체크 없음: 항목은 그대로', await tplRow(r), before)
  }

  // ── 2단계: 기본 구매처로 저장(결정 C) ──
  {
    const r = await recurring(P1, '통신비', null)
    const res = await record(r, '2026-01', { vendor: 'KT', saveVendorAsDefault: true })
    eq('빈 항목 + 체크: 지출과 항목 모두 KT', [res.ok, await recordedVendor(r, '2026-01'), await tplVendor(r)], [true, 'KT', 'KT'])
    const tok = res.ok ? res.templateVendorUndo : undefined
    eq('토큰: 전후 값과 서명', [tok?.before, tok?.after, typeof tok?.sig], [null, 'KT', 'string'])

    // 위조·교차 용도는 '쓴 직후' 상태에서 시험한다(그래야 서명 검사만이 막는다).
    eq('위조(값 바꿈) 거부', (await fin.undoRecurringTemplateVendor({ ...J(tok!), before: '아무개' })).ok, false)
    const { sig: _s, ...body } = J(tok!); void _s
    eq('교차 용도 서명(cash-receipt) 거부', (await fin.undoRecurringTemplateVendor({ ...body, sig: crl.signUndoBody('cash-receipt', P1, rvu.canonicalRecurringVendorUndo(body)) as string })).ok, false)
    eq('서명 빠짐 거부', (await fin.undoRecurringTemplateVendor(body)).ok, false)
    eq('위조 거부 뒤 항목 그대로', await tplVendor(r), 'KT')

    eq('적용취소: 항목만 되돌림', [(await fin.undoRecurringTemplateVendor(J(tok!))).ok, await tplVendor(r), await recordedVendor(r, '2026-01')], [true, null, 'KT'])
    eq('같은 토큰 두 번째는 거부', (await fin.undoRecurringTemplateVendor(J(tok!))).ok, false)

    // 바이트 동일: 다른 값이 있던 항목을 바꿨다 되돌리면 행 전체가 그때와 같다.
    const r2 = await recurring(P1, '정수기', '오성미네랄')
    const snap = await tplRow(r2)
    const res2 = await record(r2, '2026-01', { vendor: '오성미네랄(주)', saveVendorAsDefault: true })
    eq('다른 값 + 체크: 항목이 새 값', await tplVendor(r2), '오성미네랄(주)')
    await fin.undoRecurringTemplateVendor(J(res2.ok ? res2.templateVendorUndo : null))
    eq('적용취소 뒤 항목 행 바이트 동일(updatedAt 제외)', await tplRow(r2), snap)

    // 그사이 바뀌면 안 한다.
    const res3 = await record(r2, '2026-02', { vendor: '오성미네랄(주)', saveVendorAsDefault: true })
    await settings.updateRecurringExpense(r2, { vendor: '청호나이스' })
    eq('그사이 항목을 고쳤으면 적용취소 거부', (await fin.undoRecurringTemplateVendor(J(res3.ok ? res3.templateVendorUndo : null))).ok, false)
    eq('거부 뒤 항목 무변경', await tplVendor(r2), '청호나이스')

    // 같은 값이면 쓸 것이 없다(토큰도 없다).
    const res4 = await record(r2, '2026-03', { vendor: '청호나이스', saveVendorAsDefault: true })
    eq('같은 값 + 체크: 토큰 없음', res4, { ok: true })
    // 비워서 저장도 된다(항목 구매처를 지운다). 되돌리면 돌아온다.
    const res5 = await record(r2, '2026-04', { vendor: '', saveVendorAsDefault: true })
    eq('빈 칸 + 체크: 항목 구매처 지움', [await tplVendor(r2), res5.ok ? res5.templateVendorUndo?.after : 'x'], [null, null])
    await fin.undoRecurringTemplateVendor(J(res5.ok ? res5.templateVendorUndo : null))
    eq('빈 칸 저장 적용취소', await tplVendor(r2), '청호나이스')
  }

  // ── 영업장 범위 ──
  {
    const theirs = await recurring(P2, '남 임대료', '남빌딩')
    const before = await tplRow(theirs)
    eq('남의 영업장 기록 거부', await record(theirs, '2026-01', { vendor: '내 이름', saveVendorAsDefault: true }), { ok: false, error: '고정 지출 항목을 찾을 수 없습니다.' })
    // 내 영업장 서명으로 남의 항목을 가리키는 토큰. 서명은 맞지만 영업장 범위 갱신이라 아무것도 안 바뀐다.
    const body = { v: 1 as const, recurringExpenseId: theirs, before: '내 이름', after: '남빌딩' }
    const sig = crl.signUndoBody(rvu.RECURRING_TEMPLATE_VENDOR_UNDO_DOMAIN, P1, rvu.canonicalRecurringVendorUndo(body)) as string
    eq('남의 항목 적용취소 거부', (await fin.undoRecurringTemplateVendor({ ...body, sig })).ok, false)
    eq('남의 항목 소급 거부', (await fin.backfillRecurringVendor(theirs)).ok, false)
    eq('남의 항목 소급 건수 거부', (await fin.countRecurringVendorBackfill(theirs)).ok, false)
    eq('남의 항목 무변경', await tplRow(theirs), before)
  }

  // ── 재무 관리 폼 저장이 환경설정에서 적은 구매처를 안 지운다 ──
  {
    const r = await recurring(P1, '관리비', '대동빌딩')
    // 재무 폼은 지금 값을 채워 열고 그대로 싣는다(손대지 않은 저장).
    eq('재무 폼 꼴 저장(프리필 그대로)', await settings.updateRecurringExpense(r, { title: '관리비 2', payMethod: null, vendor: '대동빌딩', memo: null, financialAccountId: null }), { ok: true })
    eq('구매처 그대로', await tplVendor(r), '대동빌딩')
    eq('재무 폼에서 비우면 지운다', [await settings.updateRecurringExpense(r, { vendor: null }), await tplVendor(r)], [{ ok: true }, null])
  }

  // ── 소급(결정 D) ──
  {
    const r = await recurring(P1, '건물 임대료 소급', null)
    const other = await recurring(P1, '다른 항목', null)
    const e = async (pid: string, recId: string | null, vendor: string | null, d: string) => (await prisma.expense.create({
      data: { propertyId: pid, date: new Date(`${d}T00:00:00Z`), amount: 500000, category: '임대료', detail: '오성미네랄-정수기 관리', memo: '연납 / 한화손해보험', vendor, recurringExpenseId: recId },
    })).id as string
    const a = await e(P1, r, null, '2026-01-10'), b = await e(P1, r, null, '2026-02-10'), k = await e(P1, r, 'KT', '2026-03-10')
    const o = await e(P1, other, null, '2026-01-10')
    const x = await e(P2, r, null, '2026-01-10')   // 다른 영업장 행이 이 항목 id 를 가리켜도 안 건드린다
    const row = async (id: string) => JSON.stringify(await prisma.expense.findUnique({ where: { id } }))
    const snap = { a: await row(a), b: await row(b), k: await row(k), o: await row(o), x: await row(x) }

    eq('항목 구매처가 비면 건수 0', await fin.countRecurringVendorBackfill(r), { ok: true, count: 0, vendor: null })
    eq('항목 구매처가 비면 소급 거부', (await fin.backfillRecurringVendor(r)).ok, false)

    await settings.updateRecurringExpense(r, { vendor: '대동빌딩' })
    eq('건수: 이 항목·이 영업장·빈 구매처만', await fin.countRecurringVendorBackfill(r), { ok: true, count: 2, vendor: '대동빌딩' })
    const res = await fin.backfillRecurringVendor(r)
    eq('소급 2건', res.ok ? res.count : -1, 2)
    const v = async (id: string) => (await prisma.expense.findUnique({ where: { id }, select: { vendor: true } }))?.vendor
    eq('빈 행만 채우고 이미 적힌 행·다른 항목·다른 영업장은 그대로', [await v(a), await v(b), await v(k), await v(o), await v(x)], ['대동빌딩', '대동빌딩', 'KT', null, null])
    eq('제목·메모는 안 건드린다', (await prisma.expense.findUnique({ where: { id: a }, select: { detail: true, memo: true } })), { detail: '오성미네랄-정수기 관리', memo: '연납 / 한화손해보험' })
    const tok = res.ok ? res.undo : undefined
    eq('소급 토큰 용도와 서명', [tok?.kind, typeof tok?.sig, tok?.rows.length], ['recurring-vendor-backfill', 'string', 2])
    eq('소급 적용취소', (await fin.undoExpenseFieldChange(J(tok!))).ok, true)
    eq('적용취소 뒤 다섯 행 바이트 동일(updatedAt 제외)', await Promise.all([a, b, k, o, x].map(async id => { const r0 = JSON.parse(await row(id)); delete r0.updatedAt; return JSON.stringify(r0) })),
      Object.values(snap).map(s => { const r0 = JSON.parse(s); delete r0.updatedAt; return JSON.stringify(r0) }))
    eq('같은 토큰 두 번째는 거부', (await fin.undoExpenseFieldChange(J(tok!))).ok, false)

    // 그사이 한 행을 고치면 전부 안 한다.
    const res2 = await fin.backfillRecurringVendor(r)
    await prisma.expense.update({ where: { id: a }, data: { vendor: '손으로 고침' } })
    eq('그사이 바뀐 행이 있으면 소급 적용취소 거부', (await fin.undoExpenseFieldChange(J(res2.ok ? res2.undo : null))).ok, false)
    eq('거부 뒤 다른 행은 채운 값 그대로', await v(b), '대동빌딩')
  }

  // ── 구매처 이름 변경·합치기·비우기가 항목까지(결정 F) ──
  {
    const r = await recurring(P1, '청소 용역', '깨끗상사')
    const keep = await recurring(P1, '다른 용역', '다른상사')
    const theirs = await recurring(P2, '남 용역', '깨끗상사')
    const ex = (await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-01-05T00:00:00Z'), amount: 1000, category: '용역', vendor: '깨끗상사' } })).id as string
    const ev = async () => (await prisma.expense.findUnique({ where: { id: ex }, select: { vendor: true } }))?.vendor
    const snapT = await tplRow(theirs), snapK = await tplRow(keep), snapR = await tplRow(r)

    const ren = await fin.renameVendor('깨끗상사', '깨끗상사(주)')
    eq('이름 변경: 지출과 내 항목이 따라간다', [ren.ok, await ev(), await tplVendor(r)], [true, '깨끗상사(주)', '깨끗상사(주)'])
    eq('이름 변경: 다른 이름 항목·남의 영업장 항목은 그대로', [await tplRow(keep), await tplRow(theirs)], [snapK, snapT])
    const tok = ren.ok ? ren.undo : undefined
    eq('이름 변경 토큰에 항목 줄', tok?.recurring, [{ id: r, before: '깨끗상사', after: '깨끗상사(주)' }])

    // 항목 줄을 다른 용도로 옮겨 쓰면 거부(모양 검사).
    eq('항목 줄을 다른 용도로 옮긴 토큰 거부', (await fin.undoExpenseFieldChange({ ...J(tok!), kind: 'bizno-backfill' })).ok, false)
    eq('이름 변경 적용취소: 지출·항목 둘 다', [(await fin.undoExpenseFieldChange(J(tok!))).ok, await ev(), await tplRow(r)], [true, '깨끗상사', snapR])

    // 합치기(이미 있는 이름으로) 와 비우기.
    const merge = await fin.renameVendor('깨끗상사', '다른상사')
    eq('합치기: 항목도 합쳐진 이름', [await tplVendor(r), await tplVendor(keep)], ['다른상사', '다른상사'])
    await fin.undoExpenseFieldChange(J(merge.ok ? merge.undo : null))
    eq('합치기 적용취소: 옮겨 간 항목만 돌아온다', [await tplVendor(r), await tplVendor(keep)], ['깨끗상사', '다른상사'])
    const clear = await fin.renameVendor('깨끗상사', '')
    eq('비우기: 항목 구매처도 비운다', [await ev(), await tplVendor(r)], [null, null])
    await fin.undoExpenseFieldChange(J(clear.ok ? clear.undo : null))
    eq('비우기 적용취소', [await ev(), await tplVendor(r)], ['깨끗상사', '깨끗상사'])

    // 그사이 항목만 바뀌어도 지출까지 전부 안 되돌린다.
    const ren2 = await fin.renameVendor('깨끗상사', '깨끗상사(주)')
    await settings.updateRecurringExpense(r, { vendor: '손으로 고친 이름' })
    eq('그사이 항목이 바뀌면 이름 변경 적용취소 거부', (await fin.undoExpenseFieldChange(J(ren2.ok ? ren2.undo : null))).ok, false)
    eq('거부 뒤 지출도 그대로', [await ev(), await tplVendor(r)], ['깨끗상사(주)', '손으로 고친 이름'])
    eq('남의 영업장 항목은 끝까지 그대로', await tplRow(theirs), snapT)
  }

  // ── 검수 권고(R3·R4·R5) ──
  {
    // R3: 이름 변경이 바꾼 항목 수를 돌려준다.
    const r = await recurring(P1, '세무 기장', '바른세무')
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-02-05T00:00:00Z'), amount: 1, category: '세무', vendor: '바른세무' } })
    const ren = await fin.renameVendor('바른세무', '바른세무회계')
    eq('이름 변경: 바꾼 항목 수', ren.ok ? [ren.updated, ren.recurringUpdated] : null, [1, 1])
    // R5: 항목을 지운 뒤의 적용취소는 항목 까닭으로 막힌다(지출도 그대로).
    await prisma.recurringExpense.delete({ where: { id: r } })
    const u = await fin.undoExpenseFieldChange(J(ren.ok ? ren.undo : null))
    eq('항목을 지운 뒤 적용취소는 항목 까닭 문장으로 거부', u, { ok: false, error: '그 사이 고정 지출 항목의 구매처가 바뀌거나 항목이 삭제되어 되돌리지 않았습니다. 고정 지출 관리에서 지금 상태를 확인해 주세요.' })
    eq('거부 뒤 지출은 바뀐 이름 그대로', (await prisma.expense.findFirst({ where: { propertyId: P1, category: '세무' }, select: { vendor: true } }))?.vendor, '바른세무회계')
    eq('항목 없는 이름 변경은 항목 0개', await (async () => { await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-02-06T00:00:00Z'), amount: 1, category: '세무', vendor: '홀로상사' } }); const x = await fin.renameVendor('홀로상사', '홀로상사2'); return x.ok ? x.recurringUpdated : -1 })(), 0)

    // R4: 항목 구매처가 쇼핑몰 목록 이름이면 소급하지 않는다(묻지도 않는다).
    await prisma.property.update({ where: { id: P1 }, data: { channelOptions: '쿠팡, 지마켓' } as never })
    const c = await recurring(P1, '쿠팡 정기배송', '쿠팡')
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-03-05T00:00:00Z'), amount: 1, category: '소모품', vendor: null, recurringExpenseId: c } })
    eq('쇼핑몰 이름 항목: 건수 0(묻지 않는다)', await fin.countRecurringVendorBackfill(c), { ok: true, count: 0, vendor: null })
    eq('쇼핑몰 이름 항목: 소급 거절(정본 문장)', await fin.backfillRecurringVendor(c), { ok: false, error: '쇼핑몰 목록의 이름이라 과거 지출의 구매처로 채울 수 없습니다 · 이 항목의 구매처를 실제로 받는 곳으로 고치면 됩니다.' })
    eq('쇼핑몰 이름 항목: 지출 구매처 그대로', (await prisma.expense.findFirst({ where: { recurringExpenseId: c }, select: { vendor: true } }))?.vendor, null)
    const { auditRecurringVendorChannel } = await import('./recurring-vendor-audit.mjs')
    const chRows = await auditRecurringVendorChannel((sql: string, params?: unknown[]) => pg.query(sql, params) as Promise<{ rows: never[] }>)
    eq('쇼핑몰 이름 경고 축이 그 항목을 센다', chRows.map((x: { title: string }) => x.title), ['쿠팡 정기배송'])
    await prisma.property.update({ where: { id: P1 }, data: { channelOptions: null } as never })
  }

  // ── verify:db 경고 축(check-recurring-vendor-drift)이 갈린 항목을 실제로 센다 ──
  // 자식 프로세스로 띄우면 PGlite 소켓이 둘째 연결을 끊는다. 같은 질의 함수(scripts/recurring-vendor-audit)를 PGlite 에 바로 돌린다.
  {
    const { auditRecurringVendorDrift } = await import('./recurring-vendor-audit.mjs')
    const drift = async () => (await auditRecurringVendorDrift((sql: string) => pg.query(sql) as Promise<{ rows: never[] }>)).length
    const base = await drift()
    const same = await recurring(P1, '갈림 없음', '같은상사')
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-06-10T00:00:00Z'), amount: 1, category: '용역', vendor: '같은상사', recurringExpenseId: same } })
    eq('갈림 경고: 최근 기록과 같은 이름이면 안 센다', await drift(), base)
    const moved = await recurring(P1, '갈린 항목', '옛상사')
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-05-10T00:00:00Z'), amount: 1, category: '용역', vendor: '옛상사', recurringExpenseId: moved } })
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-06-10T00:00:00Z'), amount: 1, category: '용역', vendor: '새상사', recurringExpenseId: moved } })
    eq('갈림 경고: 최근 기록 이름이 다르면 한 건 더 센다', await drift(), base + 1)
  }

  console.log(`[고정지출 구매처 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
