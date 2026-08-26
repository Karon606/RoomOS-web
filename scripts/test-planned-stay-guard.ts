// 계획 구간 배정 가드 회귀 — 실행: npx tsx scripts/test-planned-stay-guard.ts
//
// 여기서 고정하는 것 넷.
//   · **남이 임시로 잡아 둔 밤에는 못 들어간다** — 계획은 계약서에 인쇄되는 확정 사실이라
//     퇴실 예정일 겹침과 달리 운영자 재량으로 넘기지 않는다.
//   · **선은 역방향과 같다** — 들어오는 쪽 끝은 퇴실일 **다음 날**(freeFromAfter).
//     순방향만 당일 회전을 허용하면 어느 쪽을 먼저 저장했느냐로 답이 갈린다.
//   · **계획이 끝나는 날은 통과한다** — 그날 아침 계획자가 방을 비운다(반개구간).
//   · **거주계만 본다** — 문의·투어의 희망 호실 메모는 방을 비우는 약속이 아니고,
//     비거주(명의)는 구간을 차지하지 않는다.
import { plannedStayDenial, type PlannedStaySpan } from '../lib/roomAssignment'

let pass = 0
const fails: string[] = []
function blocked(name: string, got: string | null, want: boolean) {
  if (!!got === want) { pass++; return }
  fails.push(`${name}: 기대 ${want ? '거부' : '통과'} / 실제 ${got ?? '통과'}`)
}

// 박정후 님이 8/31 하루만 402호에 지낸다(9/1 에 404호로 옮긴다).
const PARK: PlannedStaySpan[] = [{ tenantName: '박정후', from: '2026-08-31', to: '2026-09-01' }]
// 사흘 머무는 일반형.
const LONG: PlannedStaySpan[] = [{ tenantName: '박정후', from: '2026-08-31', to: '2026-09-03' }]

const ask = (o: { status?: string; moveIn: string | null; moveOut: string | null; plan?: PlannedStaySpan[] }) =>
  plannedStayDenial({
    incomingStatus: o.status ?? 'RESERVED',
    moveIn: o.moveIn, moveOut: o.moveOut, plannedStays: o.plan ?? PARK,
  })

// ── 그날 밤 ────────────────────────────────────────────────────────
blocked('그날 입주는 막는다', ask({ moveIn: '2026-08-31', moveOut: null }), true)
blocked('계획이 끝나는 날 입주는 통과', ask({ moveIn: '2026-09-01', moveOut: null }), false)
blocked('한참 뒤 입주는 통과', ask({ moveIn: '2026-10-01', moveOut: null }), false)
// 앞사람이 8/31 에 나가면 그날 밤은 청소 뒤 계획자 몫이다 — 하루를 민다(freeFromAfter).
blocked('내 퇴실일이 계획 시작일이면 막는다', ask({ moveIn: '2026-08-01', moveOut: '2026-08-31' }), true)
blocked('내 퇴실일이 계획 하루 전이면 통과', ask({ moveIn: '2026-08-01', moveOut: '2026-08-30' }), false)
blocked('무기한 점유는 그 뒤 전부와 겹친다', ask({ moveIn: '2026-08-01', moveOut: null }), true)

// ── 여러 날 구간 ───────────────────────────────────────────────────
blocked('사흘 중 가운데 날도 막는다', ask({ moveIn: '2026-09-01', moveOut: null, plan: LONG }), true)
blocked('사흘이 끝나는 날은 통과', ask({ moveIn: '2026-09-03', moveOut: null, plan: LONG }), false)

// ── 상태 ───────────────────────────────────────────────────────────
blocked('입실 처리도 막는다', ask({ status: 'ACTIVE', moveIn: '2026-08-31', moveOut: null }), true)
blocked('퇴실 예정도 막는다', ask({ status: 'CHECKOUT_PENDING', moveIn: '2026-08-31', moveOut: null }), true)
// 희망 호실 메모는 방을 비우는 약속이 아니다.
blocked('문의는 안 본다', ask({ status: 'WAITING_TOUR', moveIn: '2026-08-31', moveOut: null }), false)
blocked('투어 완료도 안 본다', ask({ status: 'TOUR_DONE', moveIn: '2026-08-31', moveOut: null }), false)
// 명의는 구간을 차지하지 않는다.
blocked('비거주(명의)는 안 본다', ask({ status: 'NON_RESIDENT', moveIn: '2026-08-31', moveOut: null }), false)
blocked('퇴실 완료는 안 본다', ask({ status: 'CHECKED_OUT', moveIn: '2026-08-31', moveOut: null }), false)

// ── 빈 입력 ────────────────────────────────────────────────────────
blocked('계획이 없으면 통과', ask({ moveIn: '2026-08-31', moveOut: null, plan: [] }), false)
// 입주일 미정은 '이미 시작된 점유'로 읽는다(이 저장소의 기존 규약) — 그 뒤 계획과 겹친다.
blocked('입주일 미정은 막는다', ask({ moveIn: null, moveOut: null }), true)

// ── 문구 ───────────────────────────────────────────────────────────
const one = ask({ moveIn: '2026-08-31', moveOut: null })
const many = ask({ moveIn: '2026-08-31', moveOut: null, plan: LONG })
function has(name: string, text: string | null, part: string) {
  if (text?.includes(part)) { pass++; return }
  fails.push(`${name}: '${part}' 없음 / 실제 ${text}`)
}
has('하루짜리는 하루로 적는다', one, '2026.08.31 하루')
has('이름을 부른다', one, '박정후님')
has('언제부터 되는지 말한다', one, '2026.09.01부터 입주 가능합니다')
has('출구를 지목한다', one, '거주 호실 일정을 먼저 바꿔 주세요')
// to 를 그대로 찍으면 하루 더 머무는 것으로 읽힌다 — 마지막 날은 전날이다.
has('여러 날은 마지막 날을 전날로 적는다', many, '2026.08.31 ~ 2026.09.02')

console.log(`\n계획 구간 배정 가드 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
