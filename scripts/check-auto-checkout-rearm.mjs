// 퇴실일을 쓰면서 자동 전환 재무장을 빠뜨린 저장 경로를 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. autoCheckoutAt 은 '이미 자동으로 바꿨다'는 표식이고, 그 값이 차 있으면 크론이
// 다시 안 바꾼다(사람이 되돌린 것을 존중하는 장치다). 그래서 **퇴실일이 바뀌면 반드시 null 로
// 되돌려야** 새 날짜 기준으로 다시 전환된다.
//
// 실측 2026-08-28. leaseTerm.expectedMoveOut 을 쓰는 저장 경로가 일곱인데 재무장은 셋에만
// 있었다. 단기가 '퇴실일 변경'을 연장 모달로 타서 안 드러났을 뿐이고, 일반 계약까지 자동 전환
// 대상이 되면 "퇴실일을 바꿨는데 자동 전환이 안 온다"가 즉시 실버그가 된다. 이 저장소에서
// 반복된 실패가 바로 '진입점 하나만 고치고 다른 길을 놓치는' 것이라, 규칙으로 세운다.
//
// 판정. **갱신 블록 안에서 퇴실일을 쓰는가**만 본다. 읽기(select 의 expectedMoveOut: true)와
// 새로 만드는 경로(create — 표식이 애초에 비어 있다)는 재무장할 것이 없다. 넓게 잡으면
// 납부일 변경·일할 미리보기·엑셀 덮어쓰기까지 걸린다(실측 오탐 셋).
//
// 실행: node scripts/check-auto-checkout-rearm.mjs
import { readFileSync } from 'node:fs'

const TARGETS = [
  'app/(app)/tenants/actions.ts',
  'app/api/import/route.ts',
]

/** 여는 괄호 위치에서 짝이 맞는 닫는 괄호까지. */
function blockAt(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(openIdx, i) }
  }
  return src.slice(openIdx)
}

/** 이 위치를 감싼 함수 이름 — 앞쪽에서 가장 가까운 함수 머리. */
function enclosingFn(src, at) {
  const heads = [...src.slice(0, at).matchAll(/(?:export )?(?:async )?function (\w+)/g)]
  return heads.length ? heads[heads.length - 1][1] : '(최상위)'
}

const violations = []
let scanned = 0

for (const file of TARGETS) {
  const src = readFileSync(file, 'utf8')

  // ⓐ leaseTerm.update / updateMany 의 인자 블록에서 퇴실일을 쓰는가
  for (const m of src.matchAll(/leaseTerm\.(update|updateMany)\(/g)) {
    const open = m.index + m[0].length - 1
    const block = blockAt(src, open)
    if (!/expectedMoveOut:\s*(?!true\b)/.test(block)) continue
    scanned++
    if (!/autoCheckoutAt/.test(block)) {
      violations.push(`${file} ${enclosingFn(src, m.index)}() — 퇴실일을 갱신하는데 autoCheckoutAt 재무장이 없다`)
    }
  }

  // ⓑ data 객체를 미리 조립해 넘기는 경로 — 대입문으로 쓴다
  for (const m of src.matchAll(/(\w+)\.expectedMoveOut\s*=/g)) {
    const fn = enclosingFn(src, m.index)
    scanned++
    // 같은 함수 안에서 표식을 건드리는지 — 함수 머리부터 다음 머리까지를 본다
    const headRe = new RegExp(`(?:export )?(?:async )?function ${fn}\\b`)
    const hm = src.match(headRe)
    if (!hm) continue
    const start = hm.index
    const nextHead = src.slice(start + 1).search(/^(?:export )?(?:async )?function /m)
    const body = nextHead === -1 ? src.slice(start) : src.slice(start, start + 1 + nextHead)
    if (!/autoCheckoutAt/.test(body)) {
      violations.push(`${file} ${fn}() — 퇴실일을 갱신하는데 autoCheckoutAt 재무장이 없다`)
    }
  }
}

console.log(`[퇴실 자동 전환 재무장] 갱신 지점 ${scanned}개 검사 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of [...new Set(violations)]) console.error(`  - ${v}`)
  console.error('')
  console.error('  퇴실일이 실제로 바뀌면 autoCheckoutAt 을 null 로 두어야 새 날짜 기준으로 다시 전환된다.')
  console.error('  본보기: updateTenant 의 "퇴실일이 바뀌면 단기 자동 전환 기록을 리셋" 줄.')
  process.exit(1)
}
