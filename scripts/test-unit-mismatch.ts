// 지출 단위 확인창 판정(이력 최빈 단위·품목 묶음) 진리표. 실행: npx tsx scripts/test-unit-mismatch.ts
//
// 고정하는 것 둘.
//   · **이력 최빈 단위** — 카드 단위가 빈 개수 추적 카드는 이 값으로 묻는다. 동률이면 최근 것,
//     이력이 없으면 null(묻지 않는다). 재활용품수거봉투 100L 이 안 물린 사건(2026-10-09)의 근거다.
//   · **묶음** — 같은 (적은 단위, 바꿀 단위, 근거)는 확인창 한 번. 다른 단위로 바꿔야 하면 따로 묻고,
//     이미 같거나 단위를 안 적었거나 카드가 없으면 묻지 않는다. 묶음은 첫 등장 순이다.
import { dominantUnit, groupUnitMismatches } from '../lib/unitMismatch'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── dominantUnit ──────────────────────────────────────────────────
eq('빈 배열은 null', dominantUnit([]), null)
eq('하나면 그것', dominantUnit(['매']), '매')
eq('최빈을 고른다(6건 중 5건 매)', dominantUnit(['매', '매', '매', '매', '매', '개']), '매')
eq('최빈이 앞에 몰려 있어도 최빈', dominantUnit(['개', '개', '개', '매']), '개')
eq('동률이면 뒤에 온 것(최근)', dominantUnit(['매', '개']), '개')
eq('동률이면 뒤에 온 것, 순서를 바꾸면 결과도 바뀐다', dominantUnit(['개', '매']), '매')
eq('동률 판정은 마지막 등장 위치로', dominantUnit(['개', '매', '매', '개']), '개')
eq('빈 값은 세지 않는다', dominantUnit(['', '  ', '매']), '매')
eq('빈 값만 있으면 null', dominantUnit(['', ' ']), null)
eq('앞뒤 공백은 털고 같은 단위로 센다', dominantUnit([' 매', '매 ', '개']), '매')

// ── groupUnitMismatches ───────────────────────────────────────────
const info = {
  '재활용품수거봉투 60L': { qtyUnit: '매', source: 'card' as const },
  '재활용품수거봉투 100L': { qtyUnit: '매', source: 'card' as const },
  '키친타월': { qtyUnit: '롤', source: 'card' as const },
  '종량제쓰레기봉투 50L': { qtyUnit: '매', source: 'history' as const },
}
const it = (index: number, label: string, entered: string) => ({ index, label, entered })

eq('같은 쌍은 한 묶음',
  groupUnitMismatches([it(0, '재활용품수거봉투 60L', '개'), it(1, '재활용품수거봉투 100L', '개')], info),
  [{ entered: '개', target: '매', source: 'card', indexes: [0, 1], labels: ['재활용품수거봉투 60L', '재활용품수거봉투 100L'] }])
eq('바꿀 단위가 다르면 따로 묻는다',
  groupUnitMismatches([it(0, '재활용품수거봉투 60L', '개'), it(1, '키친타월', '개')], info).map(g => [g.target, g.indexes]),
  [['매', [0]], ['롤', [1]]])
eq('적은 단위가 다르면 따로 묻는다',
  groupUnitMismatches([it(0, '재활용품수거봉투 60L', '개'), it(1, '재활용품수거봉투 100L', '장')], info).map(g => [g.entered, g.indexes]),
  [['개', [0]], ['장', [1]]])
eq('이미 같으면 묻지 않는다',
  groupUnitMismatches([it(0, '재활용품수거봉투 60L', '매'), it(1, '재활용품수거봉투 100L', '개')], info).map(g => g.indexes),
  [[1]])
eq('단위를 안 적었으면 묻지 않는다',
  groupUnitMismatches([it(0, '재활용품수거봉투 60L', ''), it(1, '키친타월', '  ')], info), [])
eq('카드가 없으면 묻지 않는다',
  groupUnitMismatches([it(0, '라면', '봉')], info), [])
eq('품명이 비면 묻지 않는다',
  groupUnitMismatches([it(0, '', '개')], info), [])
eq('품명·단위의 앞뒤 공백은 턴다',
  groupUnitMismatches([it(0, ' 재활용품수거봉투 60L ', ' 개 '), it(1, '재활용품수거봉투 100L', '매 ')], info),
  [{ entered: '개', target: '매', source: 'card', indexes: [0], labels: ['재활용품수거봉투 60L'] }])
eq('카드 단위의 공백도 턴다(이미 같으면 침묵)',
  groupUnitMismatches([it(0, 'A', '매')], { A: { qtyUnit: ' 매 ', source: 'card' } }), [])
eq('묶음은 첫 등장 순',
  groupUnitMismatches([it(0, '키친타월', '개'), it(1, '재활용품수거봉투 60L', '개'), it(2, '재활용품수거봉투 100L', '개')], info).map(g => g.target),
  ['롤', '매'])
eq('끼어든 일치 품목은 건너뛰고 인덱스는 원래 자리',
  groupUnitMismatches([it(0, '재활용품수거봉투 60L', '개'), it(1, '키친타월', '롤'), it(2, '재활용품수거봉투 100L', '개')], info).map(g => g.indexes),
  [[0, 2]])
eq('근거가 다르면 문장이 달라 따로 묻는다',
  groupUnitMismatches([it(0, '재활용품수거봉투 100L', '개'), it(1, '종량제쓰레기봉투 50L', '개')], info).map(g => [g.source, g.labels]),
  [['card', ['재활용품수거봉투 100L']], ['history', ['종량제쓰레기봉투 50L']]])
eq('이력 근거도 같은 쌍이면 한 묶음',
  groupUnitMismatches([it(3, '종량제쓰레기봉투 50L', '개')], info),
  [{ entered: '개', target: '매', source: 'history', indexes: [3], labels: ['종량제쓰레기봉투 50L'] }])
eq('같은 품명 두 줄은 인덱스 둘, 품명은 한 번',
  groupUnitMismatches([it(0, '키친타월', '개'), it(1, '키친타월', '개')], info),
  [{ entered: '개', target: '롤', source: 'card', indexes: [0, 1], labels: ['키친타월'] }])
eq('빈 입력은 빈 묶음', groupUnitMismatches([], info), [])

console.log(`\n[단위 확인창 진리표] 통과 ${pass}건 · 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
