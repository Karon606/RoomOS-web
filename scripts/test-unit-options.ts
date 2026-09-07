// 단위 어휘 회귀 — 실행: npx tsx scripts/test-unit-options.ts
//
// 여기서 고정하는 것 다섯.
//   · **접기는 비교에만, 저장은 운영자 표기로** — canonicalUnit 결과를 저장하면 '인치'가 'inch' 가 된다.
//   · **뜻이 같으면 접고 오타는 안 접는다** — 'M'/'m' 은 접고 '개'/'게' 는 안 접는다. 오타를
//     사전으로 잡으려 들면 정당한 새 단위까지 앱이 지운다.
//   · **새 어휘가 환산을 안 건드린다** — '봉'·'컵'·'회' 는 물리 단위가 아니라 곱셈에 안 끼어든다.
//   · **목록에 없으면 친 그대로 쌓인다** — 운영자 요구가 '자동 추가' 다.
//   · **부피 규격 + 장수 단위는 크기 표시다** — 50L 20매의 단가 기준은 개당이지 리터당이 아니다.
import {
  DEFAULT_SPEC_UNITS, DEFAULT_QTY_UNITS, UNIT_LIST_MAX,
  normalizeUnitInput, unitFoldKey, resolveUnitForSave, parseUnitOptions,
} from '../lib/unitOptions'
import {
  isConvertibleUnit, specMultiplier, isSpecDimensionMismatch, listCompatibleUnits,
  isVolumeUnit, isVolumeSizeLabel, isLengthUnit,
} from '../lib/units'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 정화 ───────────────────────────────────────────────────────────
eq('앞뒤 공백을 턴다', normalizeUnitInput('  개 '), '개')
eq('콤마는 저장 구분자라 지운다', normalizeUnitInput('ml,'), 'ml')
eq('글자 없는 표기는 버린다', normalizeUnitInput('—'), null)
eq('빈 값은 null', normalizeUnitInput(''), null)
eq('null 은 null', normalizeUnitInput(null), null)

// ── 접기 ───────────────────────────────────────────────────────────
eq('M 과 m 은 같다', unitFoldKey('M') === unitFoldKey('m'), true)
eq('리터 표기 셋은 같다', [unitFoldKey('ℓ'), unitFoldKey('리터')].every(k => k === unitFoldKey('L')), true)
eq('봉지와 봉은 같다', unitFoldKey('봉지') === unitFoldKey('봉'), true)
// 오타는 접지 않는다 — 접으면 정당한 새 단위까지 앱이 지운다.
eq('개와 게는 다르다', unitFoldKey('개') === unitFoldKey('게'), false)
eq('봉과 팩은 다르다', unitFoldKey('봉') === unitFoldKey('팩'), false)

// ── 저장 계약 ──────────────────────────────────────────────────────
eq('목록에 m 이 있으면 M 을 쳐도 m 으로 저장',
  resolveUnitForSave(['개', 'm'], 'M'), { value: 'm', nextList: null })
eq('목록에 봉이 있으면 봉지를 쳐도 봉으로 저장',
  resolveUnitForSave(['개', '봉'], '봉지'), { value: '봉', nextList: null })
eq('처음 보는 단위는 친 그대로 쌓인다',
  resolveUnitForSave(['개'], '컵'), { value: '컵', nextList: ['개', '컵'] })
eq('빈 값은 목록을 안 건드린다', resolveUnitForSave(['개'], ''), { value: null, nextList: null })
// 저장 값이 canonical 로 바뀌면 한국어 화면에 영문이 뜬다.
eq('인치는 inch 로 바뀌지 않는다', resolveUnitForSave(['개'], '인치').value, '인치')
eq('상한을 넘으면 저장은 되고 목록만 안 는다',
  resolveUnitForSave(Array.from({ length: UNIT_LIST_MAX }, (_, i) => `u${i}`), '컵'),
  { value: '컵', nextList: null })

// ── 목록 읽기 ──────────────────────────────────────────────────────
eq('비면 기본값', parseUnitOptions(null, DEFAULT_QTY_UNITS), [...DEFAULT_QTY_UNITS])
eq('빈 문자열도 기본값', parseUnitOptions('  ', DEFAULT_SPEC_UNITS), [...DEFAULT_SPEC_UNITS])
eq('콤마 문자열을 편다', parseUnitOptions('개, 봉 ,컵', DEFAULT_QTY_UNITS), ['개', '봉', '컵'])

// ── 기본값 구성 ────────────────────────────────────────────────────
// 실사용이 있는데 목록에 없던 말들 — 이번에 넣는 것이 이 작업의 목적이다.
eq("수량에 '회'", DEFAULT_QTY_UNITS.includes('회'), true)
eq("수량에 '매'", DEFAULT_QTY_UNITS.includes('매'), true)
eq("수량에 '컵'", DEFAULT_QTY_UNITS.includes('컵'), true)
eq("규격에 '봉'", DEFAULT_SPEC_UNITS.includes('봉'), true)
eq("규격에 '컵'", DEFAULT_SPEC_UNITS.includes('컵'), true)
// 같은 뜻 두 갈래를 기본값에 두지 않는다 — 그 자체가 파편화의 씨앗이다.
eq("'봉지'는 어느 목록에도 없다",
  [...DEFAULT_SPEC_UNITS, ...DEFAULT_QTY_UNITS].includes('봉지'), false)
eq('기본값 안에 접기 충돌이 없다', (() => {
  for (const list of [DEFAULT_SPEC_UNITS, DEFAULT_QTY_UNITS]) {
    const keys = list.map(unitFoldKey)
    if (new Set(keys).size !== keys.length) return false
  }
  return true
})(), true)

// ── 환산 불변 ──────────────────────────────────────────────────────
// 새 어휘는 물리 단위가 아니다. 곱셈에 안 끼어들고 변환 드롭다운에도 안 뜬다.
eq('봉은 환산 대상이 아니다', isConvertibleUnit('봉'), false)
eq('컵은 환산 대상이 아니다', isConvertibleUnit('컵'), false)
eq('회는 환산 대상이 아니다', isConvertibleUnit('회'), false)
eq('컵 규격은 원값 그대로 곱해진다(개와 같은 길)', specMultiplier(3, '컵', '봉'), 3)
// 신고 0d6242f0 고정 — 차원이 다르면 규격을 안 곱한다. 어휘가 늘어도 그대로다.
eq('g 규격과 개 품목은 안 곱한다', specMultiplier(120, 'g', '개'), null)
eq('차원 불일치 판정 불변', isSpecDimensionMismatch('g', '개'), true)
eq('새 어휘는 불일치로 안 센다', isSpecDimensionMismatch('컵', '봉'), false)
eq('변환 목록에 새 어휘가 안 뜬다',
  listCompatibleUnits('ml').some(u => ['봉', '컵', '회'].includes(u)), false)

// ── 부피 판정 ──────────────────────────────────────────────────────
// 길이 판정과 같은 UNIT_DIMS 에서 나온다 — 별칭·대소문자가 전부 산다.
eq('L 은 부피다', isVolumeUnit('L'), true)
eq('소문자 l 도 부피다', isVolumeUnit('l'), true)
eq('리터도 부피다', isVolumeUnit('리터'), true)
eq('ℓ 도 부피다', isVolumeUnit('ℓ'), true)
eq('ml 은 부피다', isVolumeUnit('ml'), true)
eq('㎖ 도 부피다', isVolumeUnit('㎖'), true)
eq('밀리리터도 부피다', isVolumeUnit('밀리리터'), true)
eq('cc 는 부피다', isVolumeUnit('cc'), true)
eq('시시도 부피다', isVolumeUnit('시시'), true)
eq('oz 는 액량온스라 부피다', isVolumeUnit('oz'), true)
eq('앞뒤 공백은 턴다', isVolumeUnit('  L  '), true)
eq('대문자 ML 도 부피다', isVolumeUnit('ML'), true)
eq('kg 은 무게라 부피가 아니다', isVolumeUnit('kg'), false)
eq('m 는 길이라 부피가 아니다', isVolumeUnit('m'), false)
eq('개는 물리 단위가 아니다', isVolumeUnit('개'), false)
eq('빈 값은 부피가 아니다', isVolumeUnit(''), false)
eq('null 은 부피가 아니다', isVolumeUnit(null), false)
eq('모르는 표기는 부피가 아니다', isVolumeUnit('꾸러미'), false)

// ── 부피 규격 = 크기 표시인가 ──────────────────────────────────────
// 지출 화면의 단가 기준 기본값이 이 판정 하나로 선다. 종전에는 화면이 ['L','ml'] 를
// 소문자로 다듬은 값과 비교해서 ml 일 때만 우연히 서 있었다.
eq('50L 20매는 크기 표시다', isVolumeSizeLabel('L', '매'), true)
eq('소문자 l 도 잡힌다', isVolumeSizeLabel('l', '장'), true)
eq('리터도 잡힌다', isVolumeSizeLabel('리터', '매'), true)
eq('ml 은 종전대로 잡힌다', isVolumeSizeLabel('ml', '장'), true)
eq('㎖ 도 잡힌다', isVolumeSizeLabel('㎖', '매'), true)
eq('cc 도 잡힌다', isVolumeSizeLabel('cc', '장'), true)
eq('대소문자·공백이 섞여도 잡힌다', isVolumeSizeLabel(' L ', ' 매 '), true)
eq('수량 단위 앞뒤 공백을 턴다', isVolumeSizeLabel('L', '장 '), true)
// 부피가 진짜 양인 경우 — 세제 1.5L 는 리터당 단가가 맞다.
eq('개는 크기 표시가 아니다', isVolumeSizeLabel('L', '개'), false)
eq('통은 크기 표시가 아니다', isVolumeSizeLabel('L', '통'), false)
eq('병은 크기 표시가 아니다', isVolumeSizeLabel('L', '병'), false)
eq('무게 규격은 이 갈래가 아니다', isVolumeSizeLabel('kg', '매'), false)
eq('모르는 표기는 이 갈래가 아니다', isVolumeSizeLabel('꾸러미', '매'), false)
eq('규격이 비면 거짓', isVolumeSizeLabel('', '매'), false)
eq('규격이 null 이면 거짓', isVolumeSizeLabel(null, '매'), false)
eq('수량 단위가 비면 거짓', isVolumeSizeLabel('L', ''), false)
eq('수량 단위가 null 이면 거짓', isVolumeSizeLabel('L', null), false)
// 길이 규격은 이 갈래 앞에서 이미 걸러진다 — 화면이 isLengthUnit 을 먼저 본다.
eq('cm 은 길이라 앞에서 걸린다', isLengthUnit('cm'), true)
eq('길이 규격은 이 갈래에 안 온다', isVolumeSizeLabel('cm', '매'), false)

console.log(`\n단위 어휘 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
