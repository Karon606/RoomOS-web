// 재고 시드 이름 판정(inventory/seedLabel) 진리표. 붙은 묶음은 이름 그대로, 하위 이름 꼴, 거절 규칙의 크기. 실패 시 exit 1
// 실행: npx tsx scripts/test-seed-relabel.ts
import { planSubLabels, deriveSubLabel, attachedToCard, muteApplies, normalizeLabel, differsBySize, type SeedGroup } from '../app/(app)/inventory/seedLabel'
import { sizeIdentityAsks, sizeText } from '../lib/sizeIdentity'
import { splitSizeLabel } from '../lib/units'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}

const G = (baseLabel: string, specValue: number | null, specUnit: string | null, qtyUnit: string | null): SeedGroup =>
  ({ category: '소모품비', baseLabel, specValue, specUnit, qtyUnit })
const plan = (list: SeedGroup[], card: { qtyUnit: string | null } | null) =>
  list.map(g => planSubLabels(list, x => attachedToCard(card, x.qtyUnit)).get(g))

// ── 붙음(수량 단위 느슨 매칭, sumPurchases 와 같은 규칙) ──
eq('A1 카드 없음 = 안 붙음', attachedToCard(null, '개'), false)
eq('A2 단위 같음', attachedToCard({ qtyUnit: '개' }, '개'), true)
eq('A3 카드 단위 없음(병합 카드)', attachedToCard({ qtyUnit: null }, '팩'), true)
eq('A4 지출 단위 없음', attachedToCard({ qtyUnit: '롤' }, null), true)
eq('A5 단위 다름', attachedToCard({ qtyUnit: '롤' }, '팩'), false)

// ── 세탁조크리너 재현(신고 573b2e06): 붙은 5월 묶음은 이름 그대로, 450ml 만 하위 이름 ──
{
  const may = G('세탁조크리너', 1, '개', '개'), nov = G('세탁조크리너', 450, 'ml', '개')
  // 크기가 다른 새 구매(450ml)는 이름·수량 단위가 같아도 원래 카드에 붙이지 않는다(운영자 결정 2026-11-02 '다른 제품은 따로 둔다').
  // 물음 정본(lib/sizeIdentity)이 '묻는다' 이고, 답이 없으면 서버가 '세탁조크리너 450ml' 하위 이름으로 나눠 결정 대기로 세운다.
  const card = { trackUnit: 'spec', specUnit: '개' }
  const asks = sizeIdentityAsks({ label: '세탁조크리너', specValue: 450, specUnit: 'ml', qtyUnit: '개' }, card, [{ value: 1, unit: '개' }])
  eq('S1 450ml 새 구매는 묻는다(답 없으면 하위 이름)', asks ? `세탁조크리너 ${sizeText(450, 'ml')}` : '세탁조크리너', '세탁조크리너 450ml')
  eq('S1a 이미 붙어 있던 묶음은 시드가 옮기지 않는다', plan([may, nov], { qtyUnit: '개' }), ['세탁조크리너', '세탁조크리너'])
  eq('S1b 붙은 5월은 그대로, 붙지 않은 450ml 은 규격만 꼬리', plan([may, G('세탁조크리너', 450, 'ml', '병')], { qtyUnit: '개' }), ['세탁조크리너', '세탁조크리너 450ml'])
  eq('S2 카드가 없으면(둘 다 안 붙음) 둘 다 하위 이름', plan([may, nov], null), ['세탁조크리너 1개', '세탁조크리너 450ml'])
  eq("S3 하위 이름은 splitSizeLabel 이 '세탁조크리너'/'450ml' 로 나눈다", splitSizeLabel('세탁조크리너 450ml'), { base: '세탁조크리너', size: '450ml' })
}
// ── 키친타월: 롤 카드에 팩 구매. 롤은 그대로, 팩만 갈라진다 ──
{
  const roll = G('키친타월', null, null, '롤'), pack = G('키친타월', null, null, '팩')
  eq('K1 붙은 롤은 그대로, 팩은 수량 단위 꼬리', plan([roll, pack], { qtyUnit: '롤' }), ['키친타월', '키친타월 (팩)'])
  eq('K2 병합 카드(단위 무시)면 모두 흡수', plan([roll, pack], { qtyUnit: null }), ['키친타월', '키친타월'])
  eq('K3 카드 없으면 종전처럼 둘 다 꼬리', plan([roll, pack], null), ['키친타월 (롤)', '키친타월 (팩)'])
}
// ── 같은 규격에 수량 단위만 다르면 꼬리를 남겨 이름이 겹치지 않는다 ──
{
  const a = G('세제', 500, 'ml', '개'), b = G('세제', 500, 'ml', '박스'), c = G('세제', 1, 'L', '개')
  eq('T1 같은 규격·다른 단위는 꼬리, 다른 규격은 규격만', plan([a, b, c], null), ['세제 500ml (개)', '세제 500ml (박스)', '세제 1L'])
}
// ── 크기 물음 정본(lib/sizeIdentity) ──
{
  const ask = (it: Partial<{ label: string; specValue: number; specUnit: string; qtyUnit: string }>, card: { trackUnit: string; specUnit: string | null } | null, hist: { value: number; unit: string }[]) =>
    sizeIdentityAsks({ label: '세탁조크리너', specValue: 450, specUnit: 'ml', qtyUnit: '개', ...it }, card, hist)
  const SPEC_EA = { trackUnit: 'spec', specUnit: '개' }
  eq('Z1 써 본 규격이면 침묵', ask({}, SPEC_EA, [{ value: 450, unit: 'ml' }]), false)
  eq('Z2 물리 동치(0.45L)면 침묵', ask({}, SPEC_EA, [{ value: 0.45, unit: 'L' }]), false)
  eq('Z3 규격으로 세고 환산되면(ml 카드) 양이라 침묵', ask({}, { trackUnit: 'spec', specUnit: 'ml' }, [{ value: 530, unit: 'ml' }]), false)
  eq('Z4 개수로 세는 카드는 묻는다', ask({}, { trackUnit: 'qty', specUnit: 'ml' }, [{ value: 530, unit: 'ml' }]), true)
  eq('Z5 카드가 없으면 침묵', ask({}, null, [{ value: 1, unit: '개' }]), false)
  eq('Z6 이력이 없으면 침묵', ask({}, SPEC_EA, []), false)
  eq('Z7 이름에 숫자가 있으면 침묵', ask({ label: '세탁조크리너 2' }, SPEC_EA, [{ value: 1, unit: '개' }]), false)
  eq('Z8 규격이 수량과 곱해지면(매 x 매) 양이라 침묵', ask({ specValue: 30, specUnit: '매', qtyUnit: '매' }, SPEC_EA, [{ value: 1, unit: '개' }]), false)
}
// ── 병합 확인 창 기본 선택: 크기가 다르면 '새 품목으로 등록' ──
eq('B1 규격 꼬리가 후보 이름에 없으면 새 품목', differsBySize('세탁조크리너 450ml', '세탁조크리너', [{ specValue: 450, specUnit: 'ml' }]), true)
eq('B2 이름 크기 충돌', differsBySize('종량제봉투 50L', '종량제봉투 20L', []), true)
eq('B3 수량 단위만 다르면 합치기 기본', differsBySize('키친타월 (팩)', '키친타월', [{ specValue: null, specUnit: null }]), false)

// ── 묶음 하나면 이름 그대로(붙든 말든) ──
eq('O1 묶음 하나', plan([G('라면', 120, 'g', '개')], null), ['라면'])
// ── 이름에 이미 크기·괄호가 있으면 그대로 ──
eq('D1 이름에 크기', deriveSubLabel('음식물쓰레기봉투 5L', 5, 'L', '매'), '음식물쓰레기봉투 5L')
eq('D2 이름에 괄호', deriveSubLabel('종량제봉투 (20L)', 20, 'L', '매'), '종량제봉투 (20L)')
eq('D3 규격 없음은 수량 단위 꼬리', deriveSubLabel('키친타월', null, null, '팩'), '키친타월 (팩)')
eq('D4 규격 있음은 꼬리 없음', deriveSubLabel('세탁조크리너', 530, 'ml', '개'), '세탁조크리너 530ml')
eq('D5 꼬리 요청이면 붙임', deriveSubLabel('세탁조크리너', 530, 'ml', '개', true), '세탁조크리너 530ml (개)')

// ── 거절(MUTE) 규칙은 크기까지 같은 이름에만 ──
eq('M1 450ml 거절이 530ml 을 막지 않는다', muteApplies('세탁조크리너 450ml (개)', '세탁조크리너 530ml'), false)
eq('M2 같은 크기면 막는다', muteApplies('세탁조크리너 450ml (개)', '세탁조크리너 450ml'), true)
eq('M3 한쪽만 크기가 있으면 막는다(판단 안 함)', muteApplies('세탁조크리너 1개 (개)', '세탁조크리너 450ml'), true)
eq('M4 정규화 키는 크기를 지운다(키는 그대로)', [normalizeLabel('세탁조크리너 450ml (개)'), normalizeLabel('세탁조크리너 530ml')], ['세탁조크리너', '세탁조크리너'])

console.log(`\n[시드 이름 판정] 통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
