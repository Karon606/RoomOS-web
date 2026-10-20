// 분할 복제 유실 복구 판정(lib/cloneFieldLoss) 진리표. 실행: npx tsx scripts/test-clone-field-loss.ts
import { planCloneFieldRestore, type CloneLossRow } from '../lib/cloneFieldLoss'

let fail = 0
let pass = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.error(`  FAIL  ${name}\n        기대 ${w}\n        실제 ${g}`)
}

const t = (h: number) => new Date(Date.UTC(2026, 7, 18, h))
const row = (id: string, h: number, over: Partial<CloneLossRow> = {}): CloneLossRow => ({
  id, allocationGroupId: 'g1', createdAt: t(h), itemLabel: '매트리스 커버', category: '비품', date: '2026-08-19', vendor: 'IKEA Korea Ltd',
  vendorBizNo: null, brand: null, productName: null, specText: null, unitBasis: null, costKind: null, ...over,
})

// IKEA 실측 모양: 원행에 번호·브랜드·제품명, 조각 하나는 번호만 빠지고 하나는 셋 다 빠짐.
{
  const plan = planCloneFieldRestore([
    row('o', 1, { vendorBizNo: '106-86-82871', brand: 'IKEA', productName: 'DVALA' }),
    row('a', 2, { brand: 'IKEA', productName: 'DVALA' }),
    row('b', 3),
  ])
  eq('IKEA: 조각 a 는 번호만, b 는 셋 다', plan.map(p => `${p.id}.${p.field}`), ['a.vendorBizNo', 'b.vendorBizNo', 'b.brand', 'b.productName'])
  eq('값은 원행 것', plan.find(p => p.id === 'b' && p.field === 'brand')?.value, 'IKEA')
}
// 조각에 다른 값이 있으면 안 덮는다.
eq('조각의 다른 값은 그대로', planCloneFieldRestore([row('o', 1, { brand: 'IKEA' }), row('a', 2, { brand: '이케아' })]), [])
// 원행이 비고 조각에만 값이 있으면 퍼뜨리지 않는다(나중에 그 조각에만 적은 표식).
eq('원행 빈 칸은 조각 값을 안 퍼뜨린다', planCloneFieldRestore([row('o', 1), row('a', 2, { costKind: 'MATERIAL' }), row('b', 3)]), [])
// 같은 저장에서 함께 생긴 행(방별 분배, 몇 ms 차이)은 조각이 아니다. 대방도배사 실측 모양.
const ms = (h: number, plus: number) => new Date(t(h).getTime() + plus)
eq('같은 저장의 형제는 조각이 아니다', planCloneFieldRestore([row('o', 1, { costKind: 'LABOR' }), { ...row('a', 1), createdAt: ms(1, 40) }]), [])
eq('같은 저장끼리 갈린 칸은 건너뛴다', planCloneFieldRestore([
  row('o', 1, { costKind: 'LABOR', brand: 'X' }), { ...row('a', 1, { brand: 'X' }), createdAt: ms(1, 40) }, row('c', 5),
]).map(p => `${p.id}.${p.field}`), ['c.brand'])
eq('같은 저장 경계(2초 미만)는 형제', planCloneFieldRestore([row('o', 1, { brand: 'X' }), { ...row('a', 1), createdAt: ms(1, 1999) }]), [])
eq('2초부터는 조각', planCloneFieldRestore([row('o', 1, { brand: 'X' }), { ...row('a', 1), createdAt: ms(1, 2000) }]).length, 1)
// 원행보다 먼저 생긴 행은 없고, 같은 시각(동률 아닌 뒤 행)만 본다.
eq('묶음 없는 행은 안 본다', planCloneFieldRestore([row('o', 1, { allocationGroupId: null, brand: 'X' }), row('a', 2, { allocationGroupId: null })]), [])
eq('한 행짜리 묶음은 안 본다', planCloneFieldRestore([row('o', 1, { brand: 'X' })]), [])
// 같은 구매가 아니면(품명·카테고리·날짜·구매처 하나라도 다름) 안 채운다.
eq('품명이 다르면 안 채운다', planCloneFieldRestore([row('o', 1, { brand: 'X' }), row('a', 2, { itemLabel: '다른 것' })]), [])
eq('구매처가 다르면 안 채운다', planCloneFieldRestore([row('o', 1, { brand: 'X' }), row('a', 2, { vendor: '쿠팡' })]), [])
eq('날짜가 다르면 안 채운다', planCloneFieldRestore([row('o', 1, { brand: 'X' }), row('a', 2, { date: '2026-08-20' })]), [])
eq('카테고리가 다르면 안 채운다', planCloneFieldRestore([row('o', 1, { brand: 'X' }), row('a', 2, { category: '소모품비' })]), [])
eq('구매처 앞뒤 공백·빈 글자는 같은 것', planCloneFieldRestore([row('o', 1, { vendor: null, brand: 'X' }), row('a', 2, { vendor: ' ' })]).length, 1)
// 단가 기준(장판세상 실측 모양). 원행 'qty', 뒤 조각 비어 있음.
eq('단가 기준도 원행에서', planCloneFieldRestore([row('o', 1, { unitBasis: 'qty' }), row('a', 2), row('b', 3, { unitBasis: 'qty' })]).map(p => `${p.id}.${p.field}=${p.value}`), ['a.unitBasis=qty'])
// 칸이 생기기 전 원행의 값은 나중에 적힌 것(장판 05-29 원행의 단가 기준). 되살리지 않는다(독립 검수 2026-10-20).
{
  const early = (id: string, at: string, over: Partial<CloneLossRow> = {}) => ({ ...row(id, 1, over), createdAt: new Date(at) })
  eq('단가 기준 칸(07-03) 전 원행은 근거 없음', planCloneFieldRestore([early('o', '2026-05-29T04:27:59Z', { unitBasis: 'qty' }), early('a', '2026-07-08T03:28:10Z')]), [])
  eq('서술 규격도 같은 날 칸이라 같다', planCloneFieldRestore([early('o', '2026-06-22T00:00:00Z', { specText: '폭 183cm' }), early('a', '2026-07-08T00:00:00Z')]), [])
  eq('칸이 생긴 뒤 원행이면 되살린다', planCloneFieldRestore([early('o', '2026-07-04T00:00:00Z', { unitBasis: 'qty' }), early('a', '2026-07-08T00:00:00Z')]).map(p => p.field), ['unitBasis'])
  eq('사업자번호는 제한 없음(검수 유지 판정)', planCloneFieldRestore([early('o', '2026-05-29T00:00:00Z', { vendorBizNo: '1' }), early('a', '2026-07-08T00:00:00Z')]).map(p => p.field), ['vendorBizNo'])
}
// 입력 순서가 바뀌어도 같은 답.
{
  const rows = [row('o', 1, { brand: 'X', vendorBizNo: '1' }), row('b', 3), row('a', 2)]
  eq('순서 무관', planCloneFieldRestore([...rows].reverse()), planCloneFieldRestore(rows))
}
// 여러 묶음.
eq('묶음마다 따로', planCloneFieldRestore([
  row('o1', 1, { brand: 'A' }), row('a1', 2),
  row('o2', 1, { allocationGroupId: 'g2', brand: 'B' }), row('a2', 2, { allocationGroupId: 'g2' }),
]).map(p => `${p.groupId}:${p.id}=${p.value}`), ['g1:a1=A', 'g2:a2=B'])

console.log(`[분할 복제 유실 복구] ${pass}건 통과${fail ? `, ${fail}건 실패` : ''}`)
if (fail) process.exit(1)
