// 수정 폼 퇴실일 전송 회귀 — 실행: npx tsx scripts/test-move-out-field.ts
//
// 여기서 고정하는 것 셋.
//   · **단기 해제는 퇴실일을 비운다** — 신고 c4b74c7d 의 처방이라 그대로 지킨다.
//   · **원래부터 일반인 계약은 퇴실일을 잃지 않는다** — 실측 2026-08-28. 화면에 칸이 없는데
//     빈 값을 보내던 탓에 연락처만 고쳐 저장해도 날짜가 사라졌다.
//   · **두 축을 같이 본다** — '지금 단기인가' 하나만 보면 위 둘 중 하나는 반드시 깨진다.
import { moveOutFieldValue } from '../lib/moveOutField'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const OUT = '2026-10-19'

// 단기를 켜 둔 채로는 칸의 값이 곧 뜻이다 — 비우면 비운 대로 간다.
eq('단기 · 날짜 있음', moveOutFieldValue({ isShortTerm: true, wasShortTerm: true, formMoveOut: OUT }), OUT)
eq('단기 · 날짜 지움', moveOutFieldValue({ isShortTerm: true, wasShortTerm: true, formMoveOut: '' }), '')
eq('단기로 새로 켬', moveOutFieldValue({ isShortTerm: true, wasShortTerm: false, formMoveOut: OUT }), OUT)

// 단기 해제 = 퇴실일이 필요 없어졌다(신고 c4b74c7d). 칸에 값이 남아 있어도 비운다.
eq('단기 해제는 비운다', moveOutFieldValue({ isShortTerm: false, wasShortTerm: true, formMoveOut: OUT }), '')

// 원래부터 일반인 계약 — 이 자리에는 지우려는 뜻이 없다. 이경호 님 건(522호, 퇴실 10/19).
eq('일반 계약의 퇴실일은 살아남는다',
  moveOutFieldValue({ isShortTerm: false, wasShortTerm: false, formMoveOut: OUT }), OUT)
eq('일반 계약에 퇴실일이 없으면 빈 값 그대로',
  moveOutFieldValue({ isShortTerm: false, wasShortTerm: false, formMoveOut: '' }), '')

console.log(`\n수정 폼 퇴실일 전송 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
