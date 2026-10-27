// 세트 상품 감지·개당 단가 진리표 — 실행: npx tsx --tsconfig scripts/tsconfig.pii.json scripts/test-set-hint.ts
//
// 여기서 고정하는 것(2026-10-27 운영자 승인, 신고 bc5bae0c·82661a30). 돈의 축이라 기대값을 먼저 세웠다.
//   · 쿠팡 영수증 '40개 묶음' 이 4개면 실물은 160개이고 개당 단가는 금액 ÷ 160 이다. 종전에는 '40개 묶음' 을 세트로 못 읽어
//     '1개 아이템이 4개' 로 들어갔고 개당 단가를 넣을 자리가 없었다.
//   · AI 가 규칙대로 규격(40·개)·수량(4)으로 나눠 주면 되물을 까닭이 없다(세트 의심 없음). 그때 단가 기준은 정본 규칙상
//     규격당(개당)이라 기준수량이 4 × 40 = 160 이다.
//   · 종전 'N개입·N입·N매입·Npcs·Nea·xN' 감지는 그대로다(회귀). 맨 개수('4개')는 세트가 아니다.
// 라벨 근거 갈래는 DB 를 안 본다(과거 단가 배수 갈래만 본다). 그래서 이 진리표는 DB 없이 돈다.
// 라벨 갈래가 깨져 DB 갈래로 떨어지면 운영 DB 가 아니라 닫힌 포트로 가서 실패하게 한다(이 진리표는 DB 를 안 본다).
process.env.DATABASE_URL = 'postgresql://no-db:no-db@127.0.0.1:1/no-db'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

async function main() {
  const { countFromLabel, computeSetHint: rawSetHint } = await import('../lib/setHint')
  // 라벨 갈래를 못 타면 DB 갈래로 떨어져 닫힌 포트에서 던진다. 그때는 실패로 적고 다음 줄로 간다.
  const computeSetHint = async (...a: Parameters<typeof rawSetHint>) => {
    try { return await rawSetHint(...a) } catch { return 'DB 갈래로 떨어졌다(라벨을 못 읽음)' }
  }
  const { resolveUnitBasis } = await import('../lib/unitBasis')
  const { buildReceiptOcrPrompt } = await import('../lib/receiptOcr')
  // ── 신규: N개 묶음·세트·팩 ─────────────────────────────────────────
  eq("'칫솔 40개 묶음' = 40", countFromLabel('칫솔 40개 묶음'), 40)
  eq("'40개묶음' = 40(붙여 씀)", countFromLabel('일회용 수저 40개묶음'), 40)
  eq("'40개 묶음 x 4' 는 묶음 수 40(뒤 x4 는 주문 수량)", countFromLabel('칫솔 40개 묶음 x 4'), 40)
  eq("'10개 팩' = 10", countFromLabel('물티슈 10개 팩'), 10)
  eq("'3개 세트' = 3", countFromLabel('수건 3개 세트'), 3)
  eq("'5개세트' = 5", countFromLabel('행거 5개세트'), 5)
  // ── 회귀: 종전 표기 ─────────────────────────────────────────────
  eq("'3개입' = 3", countFromLabel('하수구트랩 3개입'), 3)
  eq("'20입' = 20", countFromLabel('라면 20입'), 20)
  eq("'10매입' = 10", countFromLabel('봉투 10매입'), 10)
  eq("'12pcs' = 12", countFromLabel('의자발커버 12pcs'), 12)
  eq("'x12' = 12", countFromLabel('행주 x12'), 12)
  eq('원문(rawLabel)을 먼저 본다', countFromLabel('칫솔 40개 묶음', '칫솔'), 40)
  // ── 세트가 아닌 것 ───────────────────────────────────────────────
  eq("맨 개수 '4개' 는 세트가 아니다", countFromLabel('칫솔 4개'), null)
  eq("'1개 묶음' 은 세트가 아니다(2 이상만)", countFromLabel('칫솔 1개 묶음'), null)
  eq("'40개 묶음가격' 은 가격 낱말이라 아니다", countFromLabel('40개 묶음가격'), null)
  eq("'10개 묶음가 9,900원' 도 아니다", countFromLabel('10개 묶음가 9,900원'), null)
  eq("'3개 세트값' 도 아니다", countFromLabel('3개 세트값'), null)
  eq("조사가 붙어도 읽는다('40개 묶음으로')", countFromLabel('칫솔 40개 묶음으로 4개'), 40)
  eq("'3개 세트로' = 3", countFromLabel('수건 3개 세트로'), 3)
  eq("'5개 묶음상품' = 5", countFromLabel('행주 5개 묶음상품'), 5)
  eq('라벨에 표기가 없으면 없다', countFromLabel('칫솔'), null)

  // ── 돈의 축: 40개 묶음 x 4 = 160개, 개당 = 금액 ÷ 160 ─────────────────
  {
    const h = await computeSetHint('no-db', { label: '칫솔', rawLabel: '칫솔 40개 묶음', amount: 32000, qtyValue: '4' })
    eq('라벨 근거 세트 의심 = 40개, 개당 = 32,000 ÷ (4 × 40) = 200', h, { count: 40, perPiece: 200, basis: 'label' })
  }
  {
    const h = await computeSetHint('no-db', { label: '칫솔', rawLabel: '칫솔 40개 묶음', amount: 33000, qtyValue: '4' })
    eq('개당은 반올림(33,000 ÷ 160 = 206.25)', typeof h === 'object' ? h?.perPiece : h, 206)
  }
  {
    const h = await computeSetHint('no-db', { label: '칫솔', rawLabel: '칫솔 40개 묶음', amount: 32000, qtyValue: '4', specValue: '40' })
    eq('AI 가 규격 40 으로 나눠 주면 되묻지 않는다', h, null)
    const basis = resolveUnitBasis({ recorded: null, specUnit: '개', qtyUnit: '묶음' })
    const baseQty = 4 * (basis === 'spec' ? 40 : 1)
    eq('규격 40개 · 수량 4묶음의 단가 기준은 규격당(개당)', basis, 'spec')
    eq('기준수량 160, 개당 단가 = 32,000 ÷ 160 = 200', [baseQty, Math.round(32000 / baseQty)], [160, 200])
    const recorded = resolveUnitBasis({ recorded: 'qty', specUnit: '개', qtyUnit: '묶음' })
    eq('지난번에 묶음당으로 적었으면 기록을 따른다(날조하지 않는다)', recorded, 'qty')
  }
  {
    const h = await computeSetHint('no-db', { label: '칫솔', rawLabel: '칫솔 40개 묶음', amount: 0, qtyValue: '4' })
    eq('금액이 없으면 개당 0(표시 안 함)', h, { count: 40, perPiece: 0, basis: 'label' })
  }

  // ── 비품: 규격으로 나뉘어 온 세트도 확인 대상(독립 검수 B1, 신고 91b812ce) ──────────
  const { specSetCount, durableSetCount } = await import('../lib/setStructure')
  eq("'의자 4개 세트 x 1' 이 규격 4개로 오면 비품 세트 확인 대상 4", specSetCount({ specValue: '4', specUnit: '개' }), 4)
  eq('규격 단위가 개가 아니면 대상 아님(120g)', specSetCount({ specValue: '120', specUnit: 'g' }), null)
  eq('규격 1개는 대상 아님', specSetCount({ specValue: '1', specUnit: '개' }), null)
  eq('규격 없음은 대상 아님', specSetCount({ specValue: '', specUnit: '' }), null)
  eq('비품 개수 환산: 4개 세트 x 1, 80,000원 = 4개 · 개당 20,000', durableSetCount('1', 4, 80000), { qty: 4, unitPrice: 20000 })
  eq('비품 개수 환산: 40개 묶음 x 4, 32,000원 = 160개 · 개당 200', durableSetCount('4', 40, 32000), { qty: 160, unitPrice: 200 })
  eq('금액이 없으면 단가 없음', durableSetCount('2', 3, null), { qty: 6, unitPrice: null })

  // ── 프롬프트 규칙: N개 묶음·세트·팩 x M 은 규격 N개 · 수량 M ─────────────
  const prompt = buildReceiptOcrPrompt({ categories: '소모품비' })
  eq('영수증 프롬프트가 묶음 규칙을 말한다', /N개 묶음·세트·팩 x M/.test(prompt) && /specValue 에 N, specUnit 에 '개', qtyValue 에 M/.test(prompt), true)
  const kind = buildReceiptOcrPrompt({ categories: '소모품비', withKind: true })
  eq('홈 찍어올리기 프롬프트도 같은 규칙(한 벌)', /N개 묶음·세트·팩 x M/.test(kind), true)

  if (fails.length) {
    console.error(`[세트 감지·개당 단가] 통과 ${pass} / 실패 ${fails.length}`)
    for (const f of fails) console.error('  - ' + f)
    process.exit(1)
  }
  console.log(`[세트 감지·개당 단가] 통과 ${pass} / 실패 0`)
}
main().catch(e => { console.error(e); process.exit(2) })
