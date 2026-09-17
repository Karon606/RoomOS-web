// 완료 처리 날짜 정본 회귀 테스트 — lib/completionDate. 실패 시 exit 1.
// 실행: npx tsx scripts/test-completion-date.ts
//
// 왜 고정하는가. 이 판정은 '언제 완료했나'의 축이고, 그 값으로 이력·주기·집계가 움직인다.
// 종전에는 경로마다 `new Date()` 를 즉발로 박아 **클릭한 날**이 기록됐다(운영자 지시 2026-09-17).
// 축이 다시 조용히 되돌아가면 어제 한 일이 오늘로 적히고 아무도 모른다.
//
// 특히 **KST 자정 경계**를 반드시 건다. 두 가지가 걸린다.
//   1. `today` 를 UTC 로 뽑으면 KST 00~09시에 어제가 되어, 운영자가 사는 '오늘'이 미래로 거부된다.
//   2. 같은 'YYYY-MM-DD' 가 `@db.Date` 칸에서는 UTC 자정, 타임스탬프 칸에서는 KST 자정이어야 한다.
//      바꿔 넣으면 날짜가 하루 밀리는데, 프로덕션(UTC)에서만 맞는 코드라 사람 눈에 안 보인다.
import { resolveCompletionAt, assertNotFuture } from '../lib/completionDate'
import { kstYmdStr } from '../lib/kstDate'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}

const kst = (s: string) => new Date(`${s}+09:00`)
const iso = (d: Date) => d.toISOString()

const TODAY = '2026-09-17'
const NOW = kst('2026-09-17T14:20:00')
const EXISTING = kst('2026-09-10T09:30:00')

// ── 값 결정 — 고른 날 > 기존 값 > 지금 ─────────────────────────

eq('고른 날짜가 이긴다(타임스탬프 칸)',
  iso(resolveCompletionAt({ picked: '2026-09-16', today: TODAY, now: NOW })),
  kst('2026-09-16T00:00:00').toISOString())

eq('오늘도 고를 수 있다(경계)',
  iso(resolveCompletionAt({ picked: TODAY, today: TODAY, now: NOW })),
  kst('2026-09-17T00:00:00').toISOString())

eq('먼 과거도 그대로 받는다',
  iso(resolveCompletionAt({ picked: '2026-05-06', today: TODAY, now: NOW })),
  kst('2026-05-06T00:00:00').toISOString())

// **기존 값 보존이 급소다.** 다른 칸만 고쳐 재저장했는데 날짜가 오늘로 밀리면 합계가 조용히 움직인다.
eq('날짜 미지정이면 기존 값 보존',
  iso(resolveCompletionAt({ existing: EXISTING, today: TODAY, now: NOW })), iso(EXISTING))
eq('기존 값도 없으면 지금',
  iso(resolveCompletionAt({ today: TODAY, now: NOW })), iso(NOW))
eq('명시한 날짜는 기존 값을 덮는다',
  iso(resolveCompletionAt({ picked: '2026-09-15', existing: EXISTING, today: TODAY, now: NOW })),
  kst('2026-09-15T00:00:00').toISOString())

// 형식이 깨졌거나 빈 값은 '안 고른 것'과 같이 다룬다 — 여기서 Invalid Date 를 만들면 DB 로 샌다.
eq('빈 문자열은 폴백', iso(resolveCompletionAt({ picked: '', existing: EXISTING, today: TODAY, now: NOW })), iso(EXISTING))
eq('형식 깨진 값은 폴백', iso(resolveCompletionAt({ picked: '2026-9-6', today: TODAY, now: NOW })), iso(NOW))
eq('null 은 폴백', iso(resolveCompletionAt({ picked: null, today: TODAY, now: NOW })), iso(NOW))
eq('시각이 붙어 와도 날짜부만 본다',
  iso(resolveCompletionAt({ picked: '2026-09-16T23:59', today: TODAY, now: NOW })),
  kst('2026-09-16T00:00:00').toISOString())

// 미래는 **값 결정이 안 막는다** — 부르기 전에 assertNotFuture 로 거부한다.
// 그래도 새어 들어오면 폴백이 마지막 방어선이다(미래가 박히는 것보다 낫다).
eq('미래는 폴백으로 떨어진다(가드가 먼저 막는다)',
  iso(resolveCompletionAt({ picked: '2026-12-31', existing: EXISTING, today: TODAY, now: NOW })), iso(EXISTING))

// ── 칸 타입 — 같은 날짜가 칸에 따라 다른 Date 로 간다 ───────────
//
// @db.Date 는 UTC 날짜부를 잘라 저장한다. 타임스탬프 칸은 KST 달력으로 읽힌다.
// 바꿔 넣으면 하루가 밀리는데 Vercel(UTC)에서는 맞게 나와 안 드러난다.

const asDate = resolveCompletionAt({ picked: '2026-09-01', column: 'date', today: TODAY, now: NOW })
const asTs = resolveCompletionAt({ picked: '2026-09-01', column: 'timestamp', today: TODAY, now: NOW })
eq('@db.Date 칸은 UTC 자정', iso(asDate), '2026-09-01T00:00:00.000Z')
eq('타임스탬프 칸은 KST 자정', iso(asTs), '2026-08-31T15:00:00.000Z')
eq('두 칸은 같은 값이 아니다', iso(asDate) === iso(asTs), false)
eq('column 기본값은 타임스탬프',
  iso(resolveCompletionAt({ picked: '2026-09-01', today: TODAY, now: NOW })), iso(asTs))

// @db.Date 읽기는 UTC 날짜부다 — 타임스탬프 값을 넣으면 전날로 읽힌다(그 하루가 이 구분의 이유).
eq('@db.Date 값의 UTC 날짜부가 곧 달력 날짜', iso(asDate).slice(0, 10), '2026-09-01')
eq('타임스탬프 값을 @db.Date 로 읽으면 전날', iso(asTs).slice(0, 10), '2026-08-31')
// 타임스탬프 읽기는 KST 다 — 그쪽에서는 KST 자정 값이 맞는 날을 낸다.
eq('타임스탬프 값을 KST 로 읽으면 고른 날', kstYmdStr(asTs), '2026-09-01')

// ── KST 자정 경계 — '오늘'을 UTC 로 뽑으면 운영자의 오늘이 미래가 된다 ──

// KST 2026-09-17 00:10 = UTC 2026-09-16 15:10. UTC 날짜부로 오늘을 뽑으면 '2026-09-16' 이다.
const MIDNIGHT = kst('2026-09-17T00:10:00')
eq('KST 자정 직후의 오늘은 그 날이다', kstYmdStr(MIDNIGHT), '2026-09-17')
eq('UTC 날짜부로 뽑으면 어제가 된다(안 쓰는 이유)', MIDNIGHT.toISOString().slice(0, 10), '2026-09-16')
eq('KST 오늘이면 통과', assertNotFuture('2026-09-17', kstYmdStr(MIDNIGHT)), { ok: true })
eq('UTC 오늘로 재면 운영자의 오늘이 거부된다',
  assertNotFuture('2026-09-17', MIDNIGHT.toISOString().slice(0, 10)).ok, false)
// 그 시각에 오늘을 고르면 KST 자정 값이 나오고, 되읽어도 같은 날이다.
eq('자정 직후에 오늘을 고르면 그 날로 되읽힌다',
  kstYmdStr(resolveCompletionAt({ picked: '2026-09-17', today: kstYmdStr(MIDNIGHT), now: MIDNIGHT })), '2026-09-17')

// ── 미래 가드 ──────────────────────────────────────────────────

eq('과거는 통과', assertNotFuture('2026-09-16', TODAY), { ok: true })
eq('오늘은 통과(경계)', assertNotFuture(TODAY, TODAY), { ok: true })
eq('하루 뒤는 거부', assertNotFuture('2026-09-18', TODAY).ok, false)
eq('거부 사유에 고른 날짜가 들어간다',
  (assertNotFuture('2026-09-18', TODAY) as { reason: string }).reason.includes('2026-09-18'), true)
// 빈 값·형식 깨짐은 '안 고름'이다 — 여기서 같이 에러를 내면 두 사정이 같은 말이 된다.
eq('빈 값은 미래가 아니다', assertNotFuture('', TODAY), { ok: true })
eq('null 은 미래가 아니다', assertNotFuture(null, TODAY), { ok: true })
eq('형식 깨진 값은 미래가 아니다', assertNotFuture('2026-9-18', TODAY), { ok: true })
// 연 경계 — 문자열 비교라 자릿수만 맞으면 해가 바뀌어도 맞는다.
eq('연말에서 다음 해는 거부', assertNotFuture('2027-01-01', '2026-12-31').ok, false)
eq('연초에서 전 해는 통과', assertNotFuture('2026-12-31', '2027-01-01'), { ok: true })

console.log(`[완료 처리 날짜 정본] ${pass}개 통과 / ${fail}개 실패`)
process.exit(fail > 0 ? 1 : 0)
