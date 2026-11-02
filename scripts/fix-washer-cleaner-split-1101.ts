// 세탁조크리너 카드가 둘로 갈라진 것을 바로잡는 일회성 정정. 예행 기본, --apply 적용, --revert <undo.json> 되돌림
//
// 왜 (신고 573b2e06, 운영자 승인 2026-11-02). 11-01 에 450ml 구매를 저장하자 재고 시드가 같은 품명에 규격 둘(1개·450ml)을 보고
// 두 묶음 모두에 하위 이름을 붙였다. 그래서 이미 '세탁조크리너' 카드(87b7e636)에 붙어 있던 5월 코스트코 지출(fe71f7c2)까지
// '세탁조크리너 1개 (개)' 로 옮겨져 빈 새 카드(3346fd7c)에 붙었고, 병합 확인의 거절 규칙(cde22147) 한 행이 두 결정을 짊어졌다.
// 원래 카드는 지출을 잃은 채 11-02 에 숨겨졌다. 생성 경로는 inventory/seedLabel(붙은 지출은 옮기지 않는다)과
// applyMergeDecision 트랜잭션·CAS 로 막았고, 재발 감지는 scripts/check-attached-expense-move.ts(verify:db)다.
//
// 바꾸는 것(영업장 c74fd998 범위, 한 인터랙티브 트랜잭션, 모든 쓰기는 지금 값 대조 updateMany count === 1)
//   1. 지출 fe71f7c2: 품명 '세탁조크리너'(원래 카드로), 규격 530ml, 브랜드 '홈워시'. 수량 6개·제품명은 그대로.
//   2. 카드 87b7e636 숨김 해제, 개수로 세기(trackUnit qty). 점검 값이 이미 개수라 환산하지 않는다. 이름 그대로, 시작 점검은 만들지 않는다
//      (10/16 의 0 이 유효하다). 규격 단위 '개' 로 세던 카드에 530ml 지출이 붙으면 규격 곱셈이 안 걸려도 명부에 오르므로 개수 카드로 둔다.
//   3. 카드 3346fd7c 삭제. 지출·점검·입수·폐기·위치·임시저장·규칙·병합 기록이 0 인지 트랜잭션 안에서 다시 보고 행을 남긴다.
//   4. 거절 규칙 cde22147 삭제(행을 남긴다).
//   5. 450ml 카드 bfefb4ce: 이름 '세탁조크리너 450ml'(지출 5f9db967 품명도 함께), 병(개)으로 세기. 앱의 추적 단위 전환
//      (updateTrackedItem trackUnit)은 저장된 점검 값을 환산하지 않아, 수령 자동 점검 4500ml 을 같은 규격 배수(450ml)로 나눠
//      10개로 고친다(되돌림 기록에 싣는다). 위치 '4층 사무실'(87b7 에 연결된 그 위치) 연결 + 이 품목 창고로 지정.
//      위치별 잔량은 운영자가 다음 점검에서 정한다(총량 점검은 다음 위치 점검 때 창고로 보존된다).
//   6. 사후 검사: 87b7 에 붙은 지출이 fe71 하나, '1개 (개)' 카드·지출 0.
// 되돌림: 한 트랜잭션. 적용 뒤 87b7·bfef 에 점검·입수·폐기·임시저장이 생겼거나 위치 링크가 바뀌었거나, '세탁조크리너 1개 (개)'
// 이름이 다시 나타났거나, '세탁조크리너 450ml' 이름으로 새 지출이 붙었으면 전체 거부.
// 지운 행은 원래 id·시각으로 다시 넣는다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-washer-cleaner-split-1101.ts [--apply | --revert <undo.json>]
// 되돌림 기록 scripts/.fix-washer-cleaner-split-undo-<시각>.json 은 .gitignore 에 걸려 있다(커밋 금지).
import fs from 'node:fs'
import type { PrismaClient } from '@prisma/client'
import { specMultiplier } from '../lib/units'

export const PROPERTY = 'c74fd998-23cb-4c3c-8e56-9df32ecbcdcf'
export const CATEGORY = '소모품비'
export const IDS = {
  fe71: 'fe71f7c2-fcd6-4b0e-a578-549c520d95b6',
  card87: '87b7e636-9bd1-44a6-ac99-76d82b6998d2',
  card33: '3346fd7c-3606-4557-9025-170ba979ed7a',
  mute: 'cde22147-9c66-40e8-bc83-45fe2bdadfda',
  cardBf: 'bfefb4ce-b179-4475-8dee-bf5e089f012b',
  exp5f: '5f9db967-1069-449e-9329-ad0fa287a7ea',
  check81: '814d4654-c4fb-4da6-b7b3-de4c9ccde295',
  office: 'ae05ef7b-d365-4361-8027-26e1aeaa5ece',
}
export const SPLIT_LABEL = '세탁조크리너 1개 (개)'
const BASE = '세탁조크리너'
const OLD_450 = '세탁조크리너 450ml (개)'
const NEW_450 = '세탁조크리너 450ml'

// 손대기 전 값(2026-11-02 운영 DB 실측). 이 값과 하나라도 다르면 아무것도 안 바꾼다.
export const BEFORE = {
  fe71: { itemLabel: SPLIT_LABEL, specValue: 1, specUnit: '개', qtyValue: 6, qtyUnit: '개', brand: null as string | null, productName: null as string | null, updatedAt: '2026-11-01T09:21:10.382Z' },
  card87: { label: BASE, isArchived: true, trackUnit: 'spec', specUnit: '개', updatedAt: '2026-11-02T05:29:25.021Z' },
  mute: { kind: 'MUTE', normLabel: BASE, targetItemId: IDS.card87, updatedAt: '2026-11-01T09:21:11.092Z' },
  cardBf: { label: OLD_450, trackUnit: 'spec', specUnit: 'ml', qtyUnit: '개', hubLocationId: null as string | null, updatedAt: '2026-11-01T09:21:11.072Z' },
  exp5f: { itemLabel: OLD_450, specValue: 450, specUnit: 'ml', qtyValue: 10, qtyUnit: '개', updatedAt: '2026-11-02T04:50:02.141Z' },
  check81: { remainingQty: 4500, memo: '[수령 자동] +4500ml', sourceExpenseId: IDS.exp5f },
}
const AFTER_FE71 = { itemLabel: BASE, specValue: 530, specUnit: 'ml', brand: '홈워시' }

export type WasherUndo = {
  appliedAt: string
  after: { fe71UpdatedAt: string; card87UpdatedAt: string; cardBfUpdatedAt: string; exp5fUpdatedAt: string; check81: { remainingQty: number; memo: string } }
  deleted: { card33: Record<string, unknown>; mute: Record<string, unknown> }
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>
class Stop extends Error {}
const at = (s: string) => new Date(s)

// 예행(write=false)과 적용(write=true)이 같은 조건을 본다. 예행은 updateMany 대신 같은 where 로 count 한다.
async function body(tx: Tx, write: boolean, log: (s: string) => void): Promise<WasherUndo | null> {
  const cas = async (label: string, n: Promise<number>) => {
    const c = await n
    if (c !== 1) throw new Stop(`${label}: 지금 값이 예상과 달라 멈춘다(맞는 행 ${c})`)
    log(`  ok ${label}`)
  }
  const b = BEFORE
  // 1) 지출 fe71
  const fe71Where = {
    id: IDS.fe71, propertyId: PROPERTY, category: CATEGORY, itemLabel: b.fe71.itemLabel, specValue: b.fe71.specValue, specUnit: b.fe71.specUnit,
    qtyValue: b.fe71.qtyValue, qtyUnit: b.fe71.qtyUnit, brand: b.fe71.brand, productName: b.fe71.productName, updatedAt: at(b.fe71.updatedAt),
  }
  await cas(`1. 지출 fe71f7c2 '${SPLIT_LABEL}' 1개 -> '${BASE}' 530ml · 브랜드 홈워시`, write
    ? tx.expense.updateMany({ where: fe71Where, data: AFTER_FE71 }).then(r => r.count)
    : tx.expense.count({ where: fe71Where }))
  // 2) 카드 87b7 숨김 해제
  const c87Where = { id: IDS.card87, propertyId: PROPERTY, category: CATEGORY, label: b.card87.label, isArchived: true, trackUnit: b.card87.trackUnit, specUnit: b.card87.specUnit, updatedAt: at(b.card87.updatedAt) }
  await cas(`2. 카드 87b7e636 '${BASE}' 숨김 해제 · 개수로 세기(점검 값은 이미 개수)`, write
    ? tx.trackedItem.updateMany({ where: c87Where, data: { isArchived: false, trackUnit: 'qty' } }).then(r => r.count)
    : tx.trackedItem.count({ where: c87Where }))
  // 3) 카드 3346 삭제 — 비어 있는지 다시 본다(fe71 은 1 에서 옮겼다)
  const card33 = await tx.trackedItem.findFirst({ where: { id: IDS.card33, propertyId: PROPERTY, category: CATEGORY, label: SPLIT_LABEL, isArchived: false } })
  if (!card33) throw new Stop(`3. 카드 3346fd7c '${SPLIT_LABEL}' 를 찾지 못했다`)
  const [ex, ch, ad, di, lo, dr, ru, un] = await Promise.all([
    tx.expense.count({ where: { propertyId: PROPERTY, category: CATEGORY, itemLabel: SPLIT_LABEL, id: { not: IDS.fe71 } } }),
    tx.stockCheck.count({ where: { trackedItemId: IDS.card33 } }),
    tx.stockAddition.count({ where: { trackedItemId: IDS.card33 } }),
    tx.stockDisposal.count({ where: { trackedItemId: IDS.card33 } }),
    tx.trackedItemLocation.count({ where: { trackedItemId: IDS.card33 } }),
    tx.stockCheckDraft.count({ where: { trackedItemId: IDS.card33 } }),
    tx.trackedItemMergeRule.count({ where: { targetItemId: IDS.card33 } }),
    tx.trackedItemMergeUndo.count({ where: { targetItemId: IDS.card33 } }),
  ])
  if (ex + ch + ad + di + lo + dr + ru + un > 0) throw new Stop(`3. 카드 3346fd7c 가 비어 있지 않다(지출 ${ex}·점검 ${ch}·입수 ${ad}·폐기 ${di}·위치 ${lo}·임시저장 ${dr}·규칙 ${ru}·병합 기록 ${un})`)
  if (write) await tx.trackedItem.delete({ where: { id: IDS.card33 } })
  log(`  ok 3. 카드 3346fd7c '${SPLIT_LABEL}' 삭제(빈 카드 확인)`)
  // 4) 거절 규칙 cde22147
  const mute = await tx.trackedItemMergeRule.findFirst({ where: { id: IDS.mute, propertyId: PROPERTY, category: CATEGORY, kind: b.mute.kind, normLabel: b.mute.normLabel, targetItemId: b.mute.targetItemId, updatedAt: at(b.mute.updatedAt) } })
  if (!mute) throw new Stop('4. 거절 규칙 cde22147 이 예상과 달라 멈춘다')
  if (write) await cas('4. 거절 규칙 cde22147 삭제', tx.trackedItemMergeRule.deleteMany({ where: { id: IDS.mute, updatedAt: at(b.mute.updatedAt) } }).then(r => r.count))
  else log('  ok 4. 거절 규칙 cde22147 삭제')
  // 5) 450ml 카드 bfef
  const cBfWhere = { id: IDS.cardBf, propertyId: PROPERTY, category: CATEGORY, label: b.cardBf.label, trackUnit: b.cardBf.trackUnit, specUnit: b.cardBf.specUnit, qtyUnit: b.cardBf.qtyUnit, hubLocationId: null, isArchived: false, updatedAt: at(b.cardBf.updatedAt) }
  const dup = await tx.trackedItem.count({ where: { propertyId: PROPERTY, category: CATEGORY, label: NEW_450 } })
  if (dup > 0) throw new Stop(`5. '${NEW_450}' 카드가 이미 있다`)
  const office = await tx.storageLocation.findFirst({ where: { id: IDS.office, propertyId: PROPERTY, closedAt: null }, select: { id: true } })
  if (!office) throw new Stop('5. 위치 4층 사무실이 이 영업장의 열린 위치가 아니다')
  await cas(`5a. 카드 bfefb4ce '${OLD_450}' -> '${NEW_450}' · 개수로 세기 · 창고 4층 사무실`, write
    ? tx.trackedItem.updateMany({ where: cBfWhere, data: { label: NEW_450, trackUnit: 'qty', hubLocationId: IDS.office } }).then(r => r.count)
    : tx.trackedItem.count({ where: cBfWhere }))
  const e5Where = { id: IDS.exp5f, propertyId: PROPERTY, category: CATEGORY, itemLabel: b.exp5f.itemLabel, specValue: b.exp5f.specValue, specUnit: b.exp5f.specUnit, qtyValue: b.exp5f.qtyValue, qtyUnit: b.exp5f.qtyUnit, updatedAt: at(b.exp5f.updatedAt) }
  await cas(`5b. 지출 5f9db967 품명 '${NEW_450}'`, write
    ? tx.expense.updateMany({ where: e5Where, data: { itemLabel: NEW_450 } }).then(r => r.count)
    : tx.expense.count({ where: e5Where }))
  // 점검 4500ml -> 개수. 배수는 그 구매의 규격 정본(specMultiplier, 450ml -> ml = 450)
  const mult = specMultiplier(b.exp5f.specValue, b.exp5f.specUnit, b.cardBf.specUnit)
  if (!mult) throw new Stop('5c. 규격 배수를 낼 수 없다')
  const qty = b.check81.remainingQty / mult
  const memo81 = `[수령 자동] +${qty}개`
  const ckWhere = { id: IDS.check81, trackedItemId: IDS.cardBf, remainingQty: b.check81.remainingQty, memo: b.check81.memo, sourceExpenseId: b.check81.sourceExpenseId }
  const otherChecks = await tx.stockCheck.count({ where: { trackedItemId: IDS.cardBf, id: { not: IDS.check81 } } })
  const breakdown = await tx.stockCheckLocation.count({ where: { stockCheckId: IDS.check81 } })
  if (otherChecks > 0 || breakdown > 0) throw new Stop(`5c. 450ml 카드에 다른 점검(${otherChecks})이나 위치 내역(${breakdown})이 있다`)
  await cas(`5c. 수령 자동 점검 814d4654 ${b.check81.remainingQty}ml -> ${qty}개`, write
    ? tx.stockCheck.updateMany({ where: ckWhere, data: { remainingQty: qty, memo: memo81 } }).then(r => r.count)
    : tx.stockCheck.count({ where: ckWhere }))
  const linkNow = await tx.trackedItemLocation.count({ where: { trackedItemId: IDS.cardBf } })
  if (linkNow > 0) throw new Stop('5d. 450ml 카드에 이미 위치가 연결돼 있다')
  if (write) await tx.trackedItemLocation.create({ data: { trackedItemId: IDS.cardBf, storageLocationId: IDS.office } })
  log('  ok 5d. 450ml 카드에 위치 4층 사무실 연결')

  if (!write) {
    log(`  예정 6. '${BASE}' 에 붙는 지출 = fe71f7c2 하나, '${SPLIT_LABEL}' 카드·지출 0`)
    return null
  }
  // 6) 사후 검사
  const on87 = await tx.expense.findMany({
    where: { propertyId: PROPERTY, category: CATEGORY, itemLabel: BASE, excludeFromInventory: false, OR: [{ qtyUnit: null }, { qtyUnit: '개' }] },
    select: { id: true },
  })
  if (on87.length !== 1 || on87[0].id !== IDS.fe71) throw new Stop(`6. '${BASE}' 에 붙는 지출이 fe71 하나가 아니다(${on87.map(r => r.id.slice(0, 8)).join(', ')})`)
  const left = await Promise.all([
    tx.trackedItem.count({ where: { propertyId: PROPERTY, label: SPLIT_LABEL } }),
    tx.expense.count({ where: { propertyId: PROPERTY, itemLabel: SPLIT_LABEL } }),
  ])
  if (left[0] + left[1] > 0) throw new Stop(`6. '${SPLIT_LABEL}' 카드 ${left[0]}·지출 ${left[1]} 이 남았다`)
  log(`  ok 6. '${BASE}' 에 붙는 지출 fe71f7c2 하나, '${SPLIT_LABEL}' 0`)

  const ts = async (p: Promise<{ updatedAt: Date } | null>) => (await p)!.updatedAt.toISOString()
  const { updatedAt: _a, ...c33 } = card33; void _a
  return {
    appliedAt: new Date().toISOString(),
    after: {
      fe71UpdatedAt: await ts(tx.expense.findUnique({ where: { id: IDS.fe71 }, select: { updatedAt: true } })),
      card87UpdatedAt: await ts(tx.trackedItem.findUnique({ where: { id: IDS.card87 }, select: { updatedAt: true } })),
      cardBfUpdatedAt: await ts(tx.trackedItem.findUnique({ where: { id: IDS.cardBf }, select: { updatedAt: true } })),
      exp5fUpdatedAt: await ts(tx.expense.findUnique({ where: { id: IDS.exp5f }, select: { updatedAt: true } })),
      check81: { remainingQty: qty, memo: memo81 },
    },
    deleted: { card33: { ...c33, updatedAt: card33.updatedAt.toISOString(), createdAt: card33.createdAt.toISOString() }, mute: { ...mute, createdAt: mute.createdAt.toISOString(), updatedAt: mute.updatedAt.toISOString() } },
  }
}

export async function runWasherFix(db: PrismaClient, apply: boolean, log: (s: string) => void = console.log): Promise<{ ok: true; undo: WasherUndo | null } | { ok: false; error: string }> {
  try {
    if (!apply) return { ok: true, undo: await body(db, false, log) }
    const undo = await db.$transaction(tx => body(tx as Tx, true, log), { timeout: 30000 })
    return { ok: true, undo }
  } catch (e) {
    if (e instanceof Stop) return { ok: false, error: e.message }
    throw e
  }
}

export async function revertWasherFix(db: PrismaClient, u: WasherUndo, log: (s: string) => void = console.log): Promise<{ ok: true } | { ok: false; error: string }> {
  const b = BEFORE
  try {
    await db.$transaction(async tx => {
      const cas = async (label: string, n: Promise<{ count: number }>) => {
        if ((await n).count !== 1) throw new Stop(`${label}: 지금 값이 적용값과 달라 되돌리지 않는다`)
        log(`  ok ${label}`)
      }
      const after = new Date(u.appliedAt)
      for (const id of [IDS.card87, IDS.cardBf]) {
        const [c, a, d] = await Promise.all([
          tx.stockCheck.count({ where: { trackedItemId: id, createdAt: { gt: after } } }),
          tx.stockAddition.count({ where: { trackedItemId: id, createdAt: { gt: after } } }),
          tx.stockDisposal.count({ where: { trackedItemId: id, createdAt: { gt: after } } }),
        ])
        if (c + a + d > 0) throw new Stop(`적용 뒤 카드 ${id.slice(0, 8)} 에 점검·입수·폐기가 생겨 되돌리지 않는다`)
        if (await tx.stockCheckDraft.count({ where: { trackedItemId: id } }) > 0) throw new Stop(`카드 ${id.slice(0, 8)} 에 점검 임시저장이 있어 되돌리지 않는다`)
        const links = (await tx.trackedItemLocation.findMany({ where: { trackedItemId: id }, select: { storageLocationId: true, closedAt: true } }))
        if (links.length !== 1 || links[0].storageLocationId !== IDS.office || links[0].closedAt) throw new Stop(`카드 ${id.slice(0, 8)} 의 위치 연결이 적용 뒤 바뀌어 되돌리지 않는다`)
      }
      const on450 = await tx.expense.count({ where: { propertyId: PROPERTY, itemLabel: NEW_450, id: { not: IDS.exp5f } } })
      if (on450 > 0) throw new Stop(`적용 뒤 '${NEW_450}' 이름으로 새 지출 ${on450}건이 붙어 되돌리지 않는다`)
      const again = await Promise.all([
        tx.trackedItem.count({ where: { propertyId: PROPERTY, label: SPLIT_LABEL } }),
        tx.expense.count({ where: { propertyId: PROPERTY, itemLabel: SPLIT_LABEL } }),
      ])
      if (again[0] + again[1] > 0) throw new Stop(`'${SPLIT_LABEL}' 이름이 다시 나타나 되돌리지 않는다`)
      // 5 되돌림
      await cas('5d. 위치 연결 해제', tx.trackedItemLocation.deleteMany({ where: { trackedItemId: IDS.cardBf, storageLocationId: IDS.office, closedAt: null } }))
      await cas('5c. 점검 814d4654 원값', tx.stockCheck.updateMany({
        where: { id: IDS.check81, trackedItemId: IDS.cardBf, remainingQty: u.after.check81.remainingQty, memo: u.after.check81.memo },
        data: { remainingQty: b.check81.remainingQty, memo: b.check81.memo },
      }))
      await cas('5b. 지출 5f9db967 품명', tx.expense.updateMany({
        where: { id: IDS.exp5f, propertyId: PROPERTY, itemLabel: NEW_450, updatedAt: at(u.after.exp5fUpdatedAt) },
        data: { itemLabel: OLD_450, updatedAt: at(b.exp5f.updatedAt) },
      }))
      await cas('5a. 카드 bfefb4ce', tx.trackedItem.updateMany({
        where: { id: IDS.cardBf, propertyId: PROPERTY, label: NEW_450, trackUnit: 'qty', hubLocationId: IDS.office, updatedAt: at(u.after.cardBfUpdatedAt) },
        data: { label: OLD_450, trackUnit: b.cardBf.trackUnit, hubLocationId: null, updatedAt: at(b.cardBf.updatedAt) },
      }))
      // 4·3 지운 행을 원래 id·시각으로
      const m = u.deleted.mute as Record<string, string>
      await tx.trackedItemMergeRule.create({ data: { ...m, createdAt: at(m.createdAt), updatedAt: at(m.updatedAt) } as never })
      log('  ok 4. 거절 규칙 cde22147 다시 넣음')
      const c = u.deleted.card33 as Record<string, unknown>
      await tx.trackedItem.create({ data: { ...c, createdAt: at(c.createdAt as string), updatedAt: at(c.updatedAt as string) } as never })
      log('  ok 3. 카드 3346fd7c 다시 넣음')
      // 2·1
      await cas('2. 카드 87b7e636 다시 숨김', tx.trackedItem.updateMany({
        where: { id: IDS.card87, propertyId: PROPERTY, isArchived: false, trackUnit: 'qty', updatedAt: at(u.after.card87UpdatedAt) },
        data: { isArchived: true, trackUnit: b.card87.trackUnit, updatedAt: at(b.card87.updatedAt) },
      }))
      await cas('1. 지출 fe71f7c2', tx.expense.updateMany({
        where: { id: IDS.fe71, propertyId: PROPERTY, ...AFTER_FE71, updatedAt: at(u.after.fe71UpdatedAt) },
        data: { itemLabel: b.fe71.itemLabel, specValue: b.fe71.specValue, specUnit: b.fe71.specUnit, brand: b.fe71.brand, updatedAt: at(b.fe71.updatedAt) },
      }))
    }, { timeout: 30000 })
    return { ok: true }
  } catch (e) {
    if (e instanceof Stop) return { ok: false, error: e.message }
    throw e
  }
}

async function main() {
  const prisma = (await import('../lib/prisma')).default as unknown as PrismaClient
  try {
    const ri = process.argv.indexOf('--revert')
    if (ri > 0) {
      const file = process.argv[ri + 1]
      if (!file) throw new Error('--revert 뒤에 되돌림 파일을 줄 것')
      console.log('되돌림')
      const r = await revertWasherFix(prisma, JSON.parse(fs.readFileSync(file, 'utf8')) as WasherUndo)
      if (!r.ok) { console.error(`거부: ${r.error}`); process.exitCode = 1; return }
      console.log('되돌렸다. check-item-category-split · check-tracked-orphans · check-spec-dims 를 돌려 볼 것.')
      return
    }
    const apply = process.argv.includes('--apply')
    console.log(apply ? '적용(한 트랜잭션)' : '예행(읽기만)')
    const r = await runWasherFix(prisma, apply)
    if (!r.ok) { console.error(`멈춤: ${r.error}`); process.exitCode = 1; return }
    if (!apply) { console.log('\n예행만 했다. 적용은 --apply'); return }
    const file = `scripts/.fix-washer-cleaner-split-undo-${Date.now()}.json`
    fs.writeFileSync(file, JSON.stringify(r.undo, null, 2))
    console.log(`\n적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-washer-cleaner-split-1101.ts --revert ${file}`)
    console.log('이어서 돌릴 것: scripts/check-item-category-split.ts · scripts/check-tracked-orphans.mjs · scripts/check-spec-dims.ts · scripts/check-attached-expense-move.ts')
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1]?.endsWith('fix-washer-cleaner-split-1101.ts')) void main()
