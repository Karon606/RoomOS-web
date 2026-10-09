// 지출 단위 확인창 배선 감지. 실행: node scripts/check-unit-mismatch-wiring.mjs
//
// 왜 필요한가. 진리표(test-unit-mismatch)는 판정 함수만 본다. 함수가 맞아도 **부르지 않으면**
// 2026-10-09 재활용품수거봉투 사건이 그대로 돌아온다. 화면이 품목마다 따로 묻는 옛 루프로 되돌아가거나,
// 서버가 단위 빈 카드를 다시 통째로 빼면 60L 은 묻고 100L 은 안 묻는다.
//
// 잡는 것 셋.
//   ① 지출 저장 직전 단위 확인창이 groupUnitMismatches 로 묶어서 묻는다.
//   ② 그 확인창 안에 품목별 choiceDialog 루프(for (let i = 0; i < finalItems.length ...)가 없다.
//   ③ getUnitTrackedInfo 가 개수 추적(trackUnit) 카드의 빈 단위를 이력 최빈 단위(dominantUnit)로 채운다.
import { readFileSync } from 'node:fs'

const client  = readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8')
const finance = readFileSync('app/(app)/finance/actions.ts', 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }

// 주석 사이 한 덩어리. 형제 게이트(용량·재단 물음)의 문법이 섞이지 않게 이 확인창만 본다.
function between(src, from, to) {
  const start = src.indexOf(from)
  if (start < 0) return ''
  const end = src.indexOf(to, start)
  return src.slice(start, end < 0 ? src.length : end)
}
// 함수 하나만 잘라 본다. 끝은 첫 줄머리 닫는 중괄호다(다음 함수 머리 주석까지 섞이면 거짓 통과한다).
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const end = src.indexOf('\n}\n', start + header.length)
  return src.slice(start, end < 0 ? src.length : end + 2)
}

// ── ① 묶어서 묻는다 ───────────────────────────────────────────────
const gate = between(client, '// 수량 단위가 재고 카드와 어긋나면 한 번 묻는다', '// 잔량을 길이로 셀지 세트로 셀지')
need('단위 확인창 블록을 찾음', gate.length > 0, '블록 머리 주석이 바뀌었으면 이 검사도 함께 고친다')
need('lib/unitMismatch 에서 묶음 판정을 가져온다', /import \{[^}]*\bgroupUnitMismatches\b[^}]*\} from '@\/lib\/unitMismatch'/.test(client))
need('확인창이 groupUnitMismatches 를 부른다', /groupUnitMismatches\(/.test(gate))
need('서버 조회 결과를 묶음 판정에 넘긴다', /getUnitTrackedInfo\(/.test(gate) && /groupUnitMismatches\([\s\S]*uinfo\)/.test(gate))
need('묶음마다 choiceDialog 한 번', /for \(const g of groups\)[\s\S]*choiceDialog\(\{/.test(gate))
need('취소·X 는 저장 중단(무변경)', /if \(pick === null \|\| pick === 'back'\) return/.test(gate), '§27.5')
need('수락하면 묶음의 모든 품목에 바꿀 단위를 적용',
  /const hit = new Set\(g\.indexes\)/.test(gate) && /hit\.has\(xi\) \? \{ \.\.\.x, qtyUnit: g\.target \}/.test(gate),
  '묶음의 첫 품목에만 적용하면 나머지는 옛 단위로 저장된다')
need('바꾼 단위가 itemsJson 으로 흐른다', /if \(unitChanged\) fd\.set\('itemsJson'/.test(gate), '1품목 저장에서 교정이 증발한 김치 사고(2026-09-07)')

// ── ② 품목별 루프로 되돌아가지 않는다 ─────────────────────────────
need('품목별 루프가 없다', !/for \(let i = 0; i < finalItems\.length/.test(gate),
  '품목마다 따로 물으면 같은 단위 쌍을 연달아 묻고, 조회 결과 밖 품목은 조용히 빠진다')

// ── ③ 서버가 빈 단위 카드를 빼지 않는다 ───────────────────────────
const info = body(finance, 'export async function getUnitTrackedInfo(')
need('getUnitTrackedInfo 를 찾음', info.length > 0)
need('개수 추적 카드만 이력으로 채운다', /\.trackUnit === 'qty'/.test(info), "용량(spec) 카드는 수량 단위가 집계에 안 쓰여 빼 둔다")
need('빈 단위는 이력 최빈 단위로 채운다', /dominantUnit\(/.test(info))
need('단위 빈 카드를 조회에서 통째로 빼지 않는다', !/NOT: \{ qtyUnit: null \}/.test(info), '2026-10-09 사건의 원인')
need('근거(source)를 돌려준다', /source: 'card'/.test(info) && /source: 'history'/.test(info))

if (fails.length) {
  console.error(`[단위 확인창 배선] 실패 ${fails.length}건`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log('[단위 확인창 배선] 통과 — 묶음 판정·품목별 루프 없음·빈 단위 이력 채움')
