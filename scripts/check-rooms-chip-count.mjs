// 수납 관리 상태 칩 숫자가 보이는 목록과 같은 집합(패널 필터를 거친 행)을 세는지 지키는 정적 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜(독립 검수 R1, 2026-11-02 운영자 승인). 칩은 필터라 숫자가 곧 그 목록의 행 수여야 한다(RoomsClient SegmentedControl 주석).
// 그런데 칩은 패널 필터(층·납부일·월 이용료·수납 방법) 전의 전체를 셌다. 수납 방법을 켜면 '전체 3명' 아래 목록이 2장이었다.
//   ⓐ 패널 필터 조건 다섯은 panelRows 한 곳에만 있다(목록 filtered 가 따로 들고 있지 않다).
//   ⓑ 목록은 panelRows 를 상태 판정 matchesStatus 로 거른다.
//   ⓒ 칩 숫자 여섯(전체·미납·퇴실 예정·납부 예정·완납·임시 조정)은 panelRows 와 같은 matchesStatus 로 센다. occupied 를 직접 세지 않는다.
//   ⓓ 패널이 꺼지면 panelRows 는 occupied 그대로다(조건이 전부 '켜졌을 때만' 꼴).
// 실행: node scripts/check-rooms-chip-count.mjs
import { readFileSync } from 'node:fs'

const src = readFileSync('app/(app)/rooms/RoomsClient.tsx', 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const v = []
const need = (name, ok) => { if (!ok) v.push(name) }

const panel = src.match(/const panelRows = occupied\.filter\(r => \{([\s\S]*?)\n  \}\)/)
need('ⓐ panelRows 가 occupied 에서 패널 필터로 선다', !!panel)
const conds = [
  'if (floorFilter && getRoomFloor(r) !== floorFilter) return false',
  'if (dueDayFilter && dueDayBucketOf(effectiveDueDayStr(r), targetMonth) !== dueDayFilter) return false',
  'if (rentMinFilter != null && r.expected < rentMinFilter) return false',
  'if (rentMaxFilter != null && r.expected > rentMaxFilter) return false',
  'if (activeMethod && !rowHasMethodPay(r.methodPays, activeMethod)) return false',
]
for (const c of conds) {
  need(`ⓐⓓ 패널 조건이 panelRows 안에 '켜졌을 때만' 꼴로: ${c}`, !!panel && panel[1].includes(c))
  need(`ⓐ 패널 조건은 한 곳에만: ${c}`, src.split(c).length === 2)
}
need('ⓑ 목록은 panelRows 를 matchesStatus 로', /const filtered = panelRows\.filter\(r => matchesStatus\(r, filter\)\)/.test(src))
need('ⓒ 칩 셈은 panelRows·matchesStatus', /const statusCount = \(f: RoomFilter\) => panelRows\.filter\(r => matchesStatus\(r, f\)\)\.length/.test(src))
for (const k of ['unpaid', 'checkout', 'awaiting', 'paid', 'adjusted']) {
  need(`ⓒ ${k} 칩 숫자가 statusCount 에서`, new RegExp(`const ${k}Count\\s*= statusCount\\('${k}'\\)`).test(src))
}
need("ⓒ '전체' 칩은 panelRows.length", /label: `전체 \$\{panelRows\.length\}명`/.test(src))
need('ⓒ 칩 숫자가 occupied 를 직접 세지 않는다', !/occupied\.filter\([^)]*\)\.length/.test(src) && !/전체 \$\{occupied\.length\}/.test(src))

console.log(`[수납 상태 칩 숫자] 축 ⓐ 패널 조건 한 곳 · ⓑ 목록 · ⓒ 칩 여섯 · ⓓ 꺼지면 그대로 / 위반 ${v.length}건`)
for (const x of v) console.error(`  - ${x}`)
process.exit(v.length ? 1 : 0)
