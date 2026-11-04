// 기한 상태 판정 사본 금지 감지망. 납부일 전·납부일 당일·미납 판정과 기한 날짜 고르기는 lib/dueState 한 곳만 한다. 실행 node scripts/check-due-state-canon.mjs
//
// 왜(2026-11-04 운영자 원문 "납부일 당일은 납부일 당일이라고 표시하는게 좋을 것 같아. 납기 전도 아니고 미납도 아니고", 승인 '추천대로').
// 같은 뜻의 판정이 다섯 자리(수납 관리 행·첫 미납 달 루프·홈 미수·종과 푸시·수납 등록 기본값)에 따로 있어 당일을 서로 다르게 불렀고,
// 기한 날짜 자체도 갈렸다(29일 납부의 평년 2월을 한쪽은 2/28, 한쪽은 넘침 3/1). 사본이 다시 생기면 여기서 붉어진다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const fails = []
const need = (ok, msg) => { if (!ok) fails.push(msg) }
// 주석을 걷은 본문(판정 식만 본다)
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')

const SITES = [
  'lib/roomMonth.ts', 'app/(app)/rooms/actions.ts', 'lib/targetMonthOptions.ts', 'lib/paymentSuggest.ts', 'lib/dueDayAdjust.ts',
  'app/(app)/dashboard/unpaid.ts', 'app/(app)/dashboard/getDashboardData.ts', 'lib/roomsStatusSort.ts',
]

// ⓐ 옛 비교 식·옛 판정 함수 금지
const BANNED = [
  [/\bdays\s*>=\s*0\b/, '경과일 0 이상을 도래로 보는 식(days >= 0)'],
  [/<=\s*todayKstEnd\b|<=\s*todayEnd\b/, '오늘 끝 시각 이하를 도래로 보는 식'],
  [/\bduePassed\b/, '옛 기한 도래 칸(duePassed)'],
  [/\bmonthDuePassed\b|\beffDueDateForMonth\b|\bresolveDueRawEnd\b/, '옛 기한 함수(monthDuePassed·effDueDateForMonth·resolveDueRawEnd)'],
  [/function\s+(calcDaysOverdueForMonth|overrideAbsDate|effectiveDueDayForMonth|dueYmdOf)\s*\(/, '기한 날짜를 스스로 고르는 사본 함수'],
]
for (const f of SITES) {
  const c = code(read(f))
  for (const [re, what] of BANNED) need(!re.test(c), `${f}: ⓐ ${what}가 남아 있다. 판정은 lib/dueState(dueStateOf·monthDueState·dueYmdOfLeaseMonth)만 쓴다.`)
}

// ⓑ 다섯 자리(와 그 조각)가 정본을 부른다
const IMPORT = /from ['"](@\/lib\/dueState|\.\/dueState)['"]/
for (const f of SITES) need(IMPORT.test(read(f)), `${f}: ⓑ lib/dueState 를 import 하지 않는다.`)
const ra = code(read('app/(app)/rooms/actions.ts'))
need(/const viewOverdue = viewFacts\.dueState === 'overdue'/.test(ra), 'rooms/actions: ⓑ 행 isPaid·nextDueDate 가 정본 상태(viewFacts.dueState)로 갈리지 않는다.')
need(/monthDueState\(ms, dueYmdOfMonth\(ms\), todayYmd\) === 'overdue'/.test(ra), 'rooms/actions: ⓑ 첫 미납 달 루프가 정본 monthDueState 를 부르지 않는다.')
need(/dueYmdOfLeaseMonth\(\{ dueDay: lease\.dueDay, overrideDueDay: l\.overrideDueDay, overrideDueDayMonth: l\.overrideDueDayMonth, moveInDate: lease\.moveInDate, cycleDay: lease\.cycleDay \?\? null \}/.test(ra), 'rooms/actions: ⓑ 행 기한이 첫 달 입주일까지 담은 정본 dueYmdOfLeaseMonth 로 오지 않는다.')
for (const f of ['app/(app)/dashboard/unpaid.ts', 'app/(app)/dashboard/getDashboardData.ts']) {
  const c = code(read(f))
  need(/monthDueState\(mon, dueYmdOfLeaseMonth\(l, mon\),/.test(c), `${f}: ⓑ 달마다 미납·예정 가르기가 정본 monthDueState 가 아니다.`)
  need(/=== 'overdue'\) \{?\s*leaseOverdue \+= monthUnpaid/.test(c), `${f}: ⓑ 미납 몫이 overdue 만 담지 않는다(납부일 당일이 미납에 섞인다).`)
}
need(/state === 'today'\) leaseToday \+= monthUnpaid/.test(code(read('app/(app)/dashboard/unpaid.ts'))), 'dashboard/unpaid: ⓑ 납부일 당일 몫(dueTodayLeases)을 따로 모으지 않는다.')
need(/o\.dueState === 'overdue'/.test(code(read('lib/paymentSuggest.ts'))), 'lib/paymentSuggest: ⓑ 자동 기본값이 기한 지난 달(overdue)만 합치지 않는다.')
need(/input\.dueState === 'overdue' \? \{ kind: 'unpaid' \} : \{ kind: 'before' \}/.test(code(read('lib/dueDayAdjust.ts'))), 'lib/dueDayAdjust: ⓑ 조정 칩이 당일을 수납 전(before)으로 두지 않는다(새 종류 금지, 독립 검토 M5).')

// ⓒ 정본 밖 기한 날짜 생성 금지(넘침 클램프 재발)
for (const f of SITES) {
  const c = code(read(f))
  need(!/new Date\(Date\.UTC\([^)]*dayNum/.test(c) && !/parseInt\(dueDay\b/.test(c), `${f}: ⓒ 기한 날짜를 정본 밖에서 만든다(2월 31일 넘침 재발 자리). dueYmdForMonth 를 쓴다.`)
}

// ⓓ 알림 카테고리 '오늘 납부일'(dueday)이 라벨·요약 초깃값·순서·종 점 색에 다 있다(끄기 키는 만들지 않는다, 독립 검토 F3)
const al = read('app/(app)/dashboard/alerts.ts')
need(/export type AlertCategory = [^\n]*'dueday'/.test(al), 'alerts: ⓓ AlertCategory 에 dueday 가 없다.')
need(/dueday: '오늘 납부일'/.test(al), "alerts: ⓓ CATEGORY_LABEL dueday 가 '오늘 납부일'이 아니다.")
need(/byCategory = \{[^}]*dueday: 0/.test(al), 'alerts: ⓓ summarizeAlerts byCategory 초깃값에 dueday 가 없다.')
need(/const order: AlertCategory\[\] = \[[^\]]*'dueday'/.test(al), 'alerts: ⓓ 푸시 요약 순서(order)에 dueday 가 없다. 종은 울리는데 푸시에서만 침묵한다.')
need(/unpaidStatus\.dueTodayLeases/.test(al), 'alerts: ⓓ 오늘 납부일 항목이 정본(computeUnpaidStatus dueTodayLeases)에서 오지 않는다.')
need(/\n\s*dueday:\s*'var\(--/.test(read('components/layout/NotificationBell.tsx')), 'NotificationBell: ⓓ dueday 점 색이 없다.')

// ⓔ 낱말: 받을 돈에 '오늘 도래' 금지, '오늘 납부'(나갈 돈, 고정지출)는 manualpay 라벨에만
const SCAN = ['app', 'components', 'lib']
const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : [])
for (const f of SCAN.flatMap(walk)) {
  const c = code(read(f))
  if (/['"`][^'"`\n]*오늘 도래/.test(c)) fails.push(`${f}: ⓔ 화면 문자열에 '오늘 도래'가 있다. 받을 돈의 당일은 '오늘 납부일'이다(가이드 §29).`)
  const bare = c.match(/['"`][^'"`\n]*오늘 납부(?!일)[^'"`\n]*['"`]/g) ?? []
  for (const m of bare) if (!(f.endsWith('dashboard/alerts.ts') && /^'오늘 납부'$/.test(m))) fails.push(`${f}: ⓔ ${m} '오늘 납부'는 나갈 돈(고정지출 manualpay) 낱말이다. 받을 돈은 '오늘 납부일'.`)
}

// ⓕ 홈 '이달 미수납' 건수 칩은 미납만(unpaidCount) 센다
const dc = read('app/(app)/dashboard/DashboardClient.tsx')
need(/\{data\.unpaidCount\}건/.test(dc) && !/unpaidCount\s*\+/.test(dc), "DashboardClient: ⓕ '이달 미수납' 칩이 unpaidCount 만 읽지 않는다(납부일 당일을 미납으로 센다).")
need(/납부 유예 포함/.test(dc) && !/납부일 전 인원 포함/.test(dc), "DashboardClient: ⓕ 카드 부제가 실제 뜻('납부 유예 포함')이 아니다.")

// ⓖ 수납 관리 배지: 당일은 dueToday 종류(납부 예정 묶음), 지난달분 오늘 유예 행 라벨도 '납부일 당일'(독립 검토 M2)
const rs = code(read('lib/roomsStatusSort.ts'))
need(/dueToday: 'awaiting'/.test(rs), "roomsStatusSort: ⓖ dueToday 가 납부 예정 묶음(awaiting)이 아니다.")
need(/if \(days === 0\) return '납부일 당일'/.test(rs), "roomsStatusSort: ⓖ unpaidBadgeLabel 의 당일 가지가 '납부일 당일'이 아니다(지우지 말 것, M2).")
need(/'dueToday'/.test(rs) && /isDueTodayRow\(room, targetMonth, today\) \? 'dueToday'/.test(rs), 'roomsStatusSort: ⓖ 미납 분기(isPaid=false)의 당일 행이 dueToday 로 가지 않는다.')
const rc = read('app/(app)/rooms/RoomsClient.tsx')
need((rc.match(/kind === 'dueToday'\) \{/g) ?? []).length === 2, "RoomsClient: ⓖ 카드·표 쌍둥이가 둘 다 납부일 당일 배지를 그리지 않는다.")
need(/if \(paymentBadgeKind\(room, targetMonth\) === 'dueToday'\) return 'await'/.test(rc), 'RoomsClient: ⓖ roomStatusTone 이 당일을 await 로 두지 않는다.')

if (fails.length) {
  console.log(`[기한 상태 정본] 위반 ${fails.length}건`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('[기한 상태 정본] ⓐ 옛 식 0 · ⓑ 정본 호출 · ⓒ 기한 생성 · ⓓ 알림 카테고리 · ⓔ 낱말 · ⓕ 홈 칩 · ⓖ 수납 관리 배지 / 위반 0건')
