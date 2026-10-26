// 발급 알림 계약 상태 축 진리표 — lib/contractIssue issueReminderApplies. 실패 시 exit 1.
// 실행: npx tsx scripts/test-issue-reminder.ts
//
// 왜 고정하는가(신고 0fd00b7e). 입실 취소한 계약에 발급 대기·홈 알림이 남았다. 이 판정이 흔들리면
// 반대로 살아 있는 계약의 발급 알림이 사라져 서명만 받고 종이가 안 나간 계약이 화면에서 없어진다
// (오류신고 d41eea8c 와 같은 클래스). 그래서 상태 전부를 표로 박는다.
//
// 스키마의 LeaseStatus 를 읽어 표가 전부를 덮는지도 본다. 새 상태가 생기면 표에 답을 적기 전까지 붉다
// (말할지 말지는 사람이 정한다, 조용히 기본값으로 흘리지 않는다).
import { readFileSync } from 'node:fs'
import { issueReminderApplies } from '../lib/contractIssue'

const EXPECT: Record<string, boolean> = {
  WAITING_TOUR: true,
  TOUR_DONE: true,
  RESERVED: true,
  ACTIVE: true,
  CHECKOUT_PENDING: true,
  // 살다 나간 계약의 서명본은 보관할 종이다 — 퇴실은 말한다.
  CHECKED_OUT: true,
  // 입실 취소는 발급할 종이가 아니다 — 이번 신고의 축.
  CANCELLED: false,
  NON_RESIDENT: true,
}

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  if (got === want) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const enumBody = schema.match(/enum LeaseStatus\s*\{([^}]*)\}/)?.[1] ?? ''
const statuses = enumBody.split('\n').map(s => s.replace(/\/\/.*$/, '').trim()).filter(Boolean)
eq('스키마에서 LeaseStatus 를 읽었다', statuses.length > 0, true)
for (const s of statuses) {
  if (!(s in EXPECT)) { fails.push(`표에 없는 상태 ${s} — 발급 알림을 낼지 표에 먼저 적는다`); continue }
  eq(`상태 ${s}`, issueReminderApplies(s), EXPECT[s])
}
for (const s of Object.keys(EXPECT)) if (!statuses.includes(s)) fails.push(`표에만 있는 상태 ${s} — 스키마에서 사라졌다`)

// 상태를 모르는 값은 종전대로 말한다(축이 없던 시절의 답).
eq('null', issueReminderApplies(null), true)
eq('undefined', issueReminderApplies(undefined), true)
// 정확히 그 값만 — 대소문자 변형이나 다른 문자열을 취소로 읽지 않는다.
eq('소문자 cancelled 는 취소가 아니다', issueReminderApplies('cancelled'), true)

console.log(`\n발급 알림 상태 축 진리표: ${pass} 통과 / ${fails.length} 실패`)
for (const m of fails) console.error(`  - ${m}`)
if (fails.length) process.exit(1)
