// 정합 감사 규칙 1-b(거주 전 납부일 오염) 판정 진리표 — DB 불필요, 순수 함수 케이스 고정.
//
// 왜 필요한가(2026-09-07). 납부일 게이트(설계 D)가 예약 단계에도 원천 dueDay 를 채우는 것을 정식
// 경로로 만들면서, 입주 희망일에서 파생한 등가값까지 오염으로 신고되기 시작했다(타가토바 아루잔).
// 반대로 느슨하게 풀면 2026-07-30 신고의 원래 오염 — 희망일과 다른 임의값이 박혀 거주 전환의
// 파생(dueDay 가 null 일 때만 돈다)이 안 돌고 옛 값이 청구일로 굳는 클래스 — 을 놓친다.
// 그 두 경계를 이 진리표가 잡아 둔다.
import { pendingDueDayViolation } from '../lib/integrityAudit'
import { dueDayFromMoveIn } from '../lib/dueDay'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (got === want) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

// moveInDate 는 @db.Date 라 그 날의 UTC 자정으로 저장된다(lib/kstDate ymdToDbDate 와 같은 모양).
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

// 판정 한 건 — 기본은 '거주 전 · 계약서 흔적 없음'이고 케이스마다 필요한 것만 덮는다.
const v = (o: { status?: string; dueDay: string | null; moveInDate?: Date | null; trace?: boolean }) =>
  pendingDueDayViolation({
    status: o.status ?? 'RESERVED',
    dueDay: o.dueDay,
    moveInDate: o.moveInDate ?? null,
    hasContractTrace: o.trace ?? false,
  })

// ── 희망일 파생 등가 = 무위반 ──────────────────────────────
// 전환이 어차피 만들 값과 같아 정보량이 0이다.
eq('8일 입주에 8 (타가토바 아루잔 실사례)', v({ dueDay: '8', moveInDate: day('2026-09-08') }), false)
eq('15일 입주에 15', v({ dueDay: '15', moveInDate: day('2026-09-15') }), false)
eq('31일 입주에 말일', v({ dueDay: '말일', moveInDate: day('2026-08-31') }), false)
eq('30일 입주에 말일(경계)', v({ dueDay: '말일', moveInDate: day('2026-09-30') }), false)
eq("30일 입주에 '30' (sameDueDay 가 말일과 같게 본다)", v({ dueDay: '30', moveInDate: day('2026-09-30') }), false)
eq("31일 입주에 '31'", v({ dueDay: '31', moveInDate: day('2026-08-31') }), false)
eq('1일 입주에 1', v({ dueDay: '1', moveInDate: day('2026-09-01') }), false)

// ── 희망일과 다른 값 = 위반 (2026-07-30 신고의 원래 오염) ──
eq("8일 입주에 '말일'", v({ dueDay: '말일', moveInDate: day('2026-09-08') }), true)
eq("8일 입주에 '15'", v({ dueDay: '15', moveInDate: day('2026-09-08') }), true)
eq("29일 입주에 '말일'(29는 말일이 아니다)", v({ dueDay: '말일', moveInDate: day('2026-09-29') }), true)
eq("말일 입주에 '1'", v({ dueDay: '1', moveInDate: day('2026-08-31') }), true)

// ── 거주 전 네 상태 모두 규칙 대상 ─────────────────────────
for (const s of ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED']) {
  eq(`${s}: 어긋난 값은 위반`, v({ status: s, dueDay: '말일', moveInDate: day('2026-09-08') }), true)
  eq(`${s}: 파생 등가는 무위반`, v({ status: s, dueDay: '8', moveInDate: day('2026-09-08') }), false)
}

// ── 거주 이후 상태는 규칙 대상 아님 ────────────────────────
// 청구가 도는 계약의 납부일은 있는 것이 정상이라, 어긋나 보여도 이 규칙이 말할 일이 아니다.
for (const s of ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'CHECKED_OUT']) {
  eq(`${s}: 규칙 대상 아님`, v({ status: s, dueDay: '말일', moveInDate: day('2026-09-08') }), false)
}

// ── 계약서 흔적이 있으면 제외 (설계 D 정식 경로) ───────────
eq('흔적 있음 + 어긋난 값', v({ dueDay: '말일', moveInDate: day('2026-09-08'), trace: true }), false)
eq('흔적 있음 + 희망일 없음', v({ dueDay: '말일', moveInDate: null, trace: true }), false)

// ── 희망일이 없는 계약 ─────────────────────────────────────
// 견줄 기준이 없어 위반으로 남긴다. 게이트가 채운 정상 건은 위 흔적 예외에서 이미 빠진다.
eq('희망일 없음 + 납부일 있음', v({ dueDay: '말일', moveInDate: null }), true)
eq('희망일 없음 + 일자형 납부일', v({ dueDay: '8', moveInDate: null }), true)

// ── 납부일이 없으면 애초에 말할 것이 없다 ──────────────────
eq('납부일 null', v({ dueDay: null, moveInDate: day('2026-09-08') }), false)
eq('납부일 빈 문자열', v({ dueDay: '', moveInDate: day('2026-09-08') }), false)

// ── 파생 규칙 자체(dueDayFromMoveIn) — actions.ts 에서 올려 온 그대로인가 ──
eq('파생: 8일', dueDayFromMoveIn(day('2026-09-08')), '8')
eq('파생: 29일', dueDayFromMoveIn(day('2026-09-29')), '29')
eq('파생: 30일은 말일', dueDayFromMoveIn(day('2026-09-30')), '말일')
eq('파생: 31일은 말일', dueDayFromMoveIn(day('2026-08-31')), '말일')
// 로컬 게터 회귀 방어 — UTC 자정을 로컬로 읽으면 UTC 서쪽 시간대에서 하루 앞의 날이 나온다.
// KST(UTC+9)에서는 UTC 자정이 같은 날 09시라 로컬 게터도 우연히 맞아, 개발 기기에서만 돌리면
// 이 결함이 안 보인다(Vercel 도 UTC 라 마찬가지다). 그래서 이 두 케이스만 시간대를 서쪽으로
// 옮겨 견준다. Node 는 process.env.TZ 변경을 그 자리에서 반영한다.
{
  const savedTz = process.env.TZ
  process.env.TZ = 'America/New_York'
  eq('파생: UTC 서쪽에서도 8일 (로컬 게터면 7)', dueDayFromMoveIn(day('2026-09-08')), '8')
  eq('파생: UTC 서쪽에서도 말일 (로컬 게터면 29)', dueDayFromMoveIn(day('2026-09-30')), '말일')
  if (savedTz === undefined) delete process.env.TZ
  else process.env.TZ = savedTz
}

console.log(`\n거주 전 납부일 감사 진리표: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
