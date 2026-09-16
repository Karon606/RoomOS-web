// 단가 기준을 정하는 자리가 전부 정본을 부르는지 — 읽기 전용, 위반 시 exit 1.
//
// 왜 있나(2026-09-17, 신고 73c18e13). 기준을 정하는 자리가 **다섯**이었는데 규칙을 아는 곳은
// 하나뿐이었다. 나머지 넷이 저마다 'spec' 으로 메워서, 2026-08-05 에 운영자가 직접 지적해 만든
// 부피 판정(종량제봉투 50L 20매는 1매 1,250원)이 조용히 덮였다. 지목한 한 자리만 고치면 나머지
// 넷에서 또 샌다 — 그 자리를 여기서 지킨다.
//
// 규칙 셋.
//   (1) 정본(lib/unitBasis)이 살아 있고 판정을 lib/units 정본에서 가져오는가.
//   (2) 기준을 읽는 파일들이 정본을 **호출**하는가(임포트가 아니라 호출을 본다).
//   (3) 기준을 'spec' 으로 메우는 손박음 폴백이 되살아나지 않았는가.
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// 주석을 지운 뒤 판정 — 설명 주석의 같은 글자에 속은 전례가 있다('://'는 URL 이라 예외).
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

const violations = []
const read = f => { try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f} — 읽을 수 없음`); return '' } }

// (1) 정본 자체 — 소비자만 보면 알맹이가 빠져도 전부 통과한다.
{
  const src = read('lib/unitBasis.ts')
  for (const [re, why] of [
    [/export function storedUnitBasis\(/, '기록 판정 정본이 사라짐'],
    [/export function inferUnitBasis\(/, '규칙 정본이 사라짐'],
    [/export function resolveUnitBasis\(/, '기록·규칙 합류 지점이 사라짐'],
    [/isLengthUnit\(/, '길이 판정을 lib/units 정본에서 안 가져온다(별칭·대소문자가 샌다)'],
    [/isVolumeSizeLabel\(/, '부피 규격 + 매·장 판정이 사라짐. 봉투가 다시 리터당이 된다'],
    [/trackUnit === 'qty'/, '추적 단위가 수량인 품목의 개당 규칙이 사라짐(오류신고 c7cf6180)'],
  ]) if (!re.test(src)) violations.push(`lib/unitBasis.ts — ${why}`)
  // 기록 판정은 두 값만 인정해야 한다 — 여기가 느슨해지면 빈 문자열이 기록으로 둔갑한다.
  if (!/'spec' \|\| raw === 'qty'/.test(src)) {
    violations.push("lib/unitBasis.ts — storedUnitBasis 가 'spec'|'qty' 만 인정하는 절이 사라짐")
  }
}

// (2) 기준을 정하는 자리 전수 — 파일마다 정본 호출을 확인한다.
const CALLERS = [
  ['app/(app)/finance/FinanceClient.tsx', /(inferUnitBasis|resolveUnitBasis|storedUnitBasis)\(/,
    '지출 폼이 기준을 스스로 정한다(피커 휴리스틱·리셋·basisOf·영수증 인식 행·수정 프리필)'],
  ['app/(app)/finance/actions.ts', /(storedUnitBasis|resolveUnitBasis)\(/,
    '과거 복원(getLastItemUnits)이 기준을 스스로 정한다 — 여기가 날조하면 폼의 규칙이 통째로 꺼진다'],
  ['lib/setHint.ts', /resolveUnitBasis\(/,
    '세트 힌트의 과거 단가 역산이 기준을 스스로 정한다'],
]
for (const [f, re, why] of CALLERS) {
  const src = read(f)
  if (src && !re.test(src)) violations.push(`${f} — 정본(lib/unitBasis) 호출이 없다. ${why}`)
}

// (3) 손박음 폴백 재발 — 기록이 없을 때 'spec' 으로 메우는 문법을 막는다.
//     예: `it.unitBasis ?? 'spec'` · `x.unitBasis === 'qty' ? … : 'spec'` · `specValue ? 'spec' : 'qty'`
const FALLBACKS = [
  [/unitBasis\s*\?\?\s*'spec'/, "`unitBasis ?? 'spec'` — 기록 없음을 규격당으로 메운다"],
  [/specValue\s*\?\s*'spec'\s*:\s*'qty'/, "`specValue ? 'spec' : 'qty'` — 규격 값이 있다는 이유로 기준을 지어낸다"],
  [/unitBasis\s*===\s*'qty'\s*\?\s*1\s*:/, "`unitBasis === 'qty' ? 1 : 규격` — 기록이 없으면 무조건 규격으로 나눈다"],
]
for (const [f] of CALLERS) {
  const src = read(f)
  for (const line of src.split('\n')) {
    for (const [re, what] of FALLBACKS) {
      if (re.test(line)) violations.push(`${f} — ${what}. 판정은 lib/unitBasis 한 곳에서만 한다`)
    }
  }
}

// 기준을 **쓰는** 자리에 정본을 안 거치는 사본이 생기지 않았는지 — 저장소 전체에서 규칙 낱말을 본다.
// 부피 판정을 직접 부르는 곳은 정본 하나여야 한다(화면에서 다시 부르면 별칭·대소문자가 또 샌다).
{
  // 정본과, 그 규칙으로 **행을 고르는** 장부 도구들. 고르는 것은 판정이 아니라 조회다.
  const OWNERS = new Set([
    'lib/units.ts', 'lib/unitBasis.ts',
    'scripts/test-unit-basis.ts', 'scripts/test-unit-options.ts', 'scripts/check-unit-basis-wiring.mjs',
    'scripts/check-unit-basis-drift.ts', 'scripts/backfill-unit-basis-volume-sheet.ts',
  ])
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx|mjs)$/.test(p)) out.push(p)
    }
    return out
  }
  for (const f of [...walk('lib'), ...walk('app'), ...walk('scripts'), ...walk('components')]) {
    if (OWNERS.has(f)) continue
    if (/isVolumeSizeLabel\(/.test(strip(readFileSync(f, 'utf8')))) {
      violations.push(`${f} — 부피 판정(isVolumeSizeLabel)을 직접 부른다. 기준 판정은 lib/unitBasis 를 거칠 것`)
    }
  }
}

// 알면서 비워 둔 자리 — 목록에 사유와 함께 남긴다. 투명한 공백이 조용한 공백보다 낫다.
const KNOWN_GAPS = [
  ['components/ui/SpecWizard.tsx',
    '포장형태(통·봉·박스·롤·낱개)로 기준을 제안한다 — 단위가 아니라 사람이 고른 포장형태가 근거라 ' +
    '규칙과 다른 축이다. 다만 롤 + m 을 고르면 길이 규칙(오류신고 4e2ffe04)과 어긋난 규격당을 제안한다. ' +
    '고치려면 네 호출부(지출 품목·무상 비품·찍어올리기 승인·추적 품목 추가)를 함께 봐야 해 별건으로 남긴다.'],
]
for (const [f] of KNOWN_GAPS) {
  const src = read(f)
  if (src && !/unitBasis/.test(src)) violations.push(`${f} — 목록에 있는데 unitBasis 를 다루지 않는다. 목록에서 내릴 것`)
}

console.log(`\n[단가 기준 정본 배선] 소비자 ${CALLERS.length}곳 / 알려진 공백 ${KNOWN_GAPS.length}곳 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) process.exit(1)
