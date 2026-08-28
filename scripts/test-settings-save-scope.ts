// 환경설정 탭별 저장 범위 회귀 — DB 불필요, lib/propertySettingsPatch 정본을 직접 돌린다.
//
// 지키는 것: **어느 탭에서 저장하든 그 탭이 담지 않은 칼럼은 손대지 않는다.**
// 2026-08-19 IA 2단계로 요금·서류 필드가 기본정보에서 요금·정책·계약서·서류 탭으로 흩어졌다.
// 통짜 저장 시절 문법(formData.get 을 그냥 읽고 전부 덮기)이 한 줄이라도 살아남으면,
// 운영자가 기본정보에서 영업장명 한 글자 고쳐 저장하는 순간 보증금·청소비·계좌번호·동의서가
// 통째로 null 이 된다. 그 사고는 저장 클릭 뒤에야 발현되므로 화면으로는 못 잡는다.
//
// 대조 방식은 스냅샷이다 — 저장 전 전 칼럼 값을 두고, 탭별 폼을 그대로 재현해 패치를 만든 뒤
// 패치를 얹은 결과가 "그 탭 칼럼만 바뀌고 나머지는 글자 하나까지 같은가"를 전수로 본다.
import { buildPropertySettingsPatch, type PropertySettingsPatch } from '../lib/propertySettingsPatch'

let pass = 0
const fails: string[] = []

function ok(label: string, cond: boolean, detail = '') {
  if (cond) pass++
  else fails.push(`${label}${detail ? ': ' + detail : ''}`)
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  ok(label, g === w, `기대 ${w} / 실제 ${g}`)
}

// ── 저장 전 스냅샷 — 전 칼럼이 "지워지면 티가 나는" 값으로 채워져 있다 ───────────────
type Row = Record<string, unknown>
const BEFORE: Row = {
  name: '더스테이 제기역점',
  address: '서울시 동대문구 제기동 1-1',
  phone: '02-000-0000',
  replyToEmail: 'contact@thestay.kr',
  mailFromLocal: 'thestay.jegi',
  mailCopyToSelf: true,
  acquisitionDate: new Date('2026-03-01'),
  prevOwnerCutoffDate: new Date('2026-02-28'),
  contactLeadDays: 14,
  checkoutLeadShortDays: 7,
  checkoutLeadMonths: 1,
  defaultDeposit: 50000,
  defaultCleaningFee: 20000,
  reservationDepositMode: 'prepaid',
  refundPenaltyPct: 10,
  refundClauseInContract: true,
  cleaningFeeInDeposit: true,
  multiContractVersions: false,
  defaultAreaM2: 13.2,
  bankAccount: '카카오뱅크 3333-01-2345678 (홍길동)',
  disposalConsentTemplate: { enabled: true, days: 7, title: '잔여 소지품 임의처분 동의서', body: '본문' },
  publicSlug: 'thestayjegi',
}
const ALL_COLUMNS = Object.keys(BEFORE)

/** 탭별 담당 칼럼 — 확정 재편 지도(2026-08-19 운영자 승인)를 그대로 옮긴 것. */
const OWNED: Record<string, string[]> = {
  기본정보:    ['name', 'address', 'phone', 'replyToEmail', 'mailFromLocal', 'mailCopyToSelf', 'acquisitionDate', 'prevOwnerCutoffDate', 'contactLeadDays', 'checkoutLeadShortDays', 'checkoutLeadMonths'],
  '요금·정책': ['defaultDeposit', 'defaultCleaningFee', 'reservationDepositMode', 'refundPenaltyPct', 'refundClauseInContract', 'cleaningFeeInDeposit'],
  '계약서·서류': ['multiContractVersions', 'defaultAreaM2', 'bankAccount', 'disposalConsentTemplate'],
  웹사이트:    ['publicSlug'],
}

/** 화면의 폼이 실제로 실어 보내는 것 — 체크박스는 hidden '0' 짝이 늘 함께 간다. */
const fd = (pairs: [string, string][]) => {
  const f = new FormData()
  for (const [k, v] of pairs) f.append(k, v)
  return f
}
const BASIC_FORM: [string, string][] = [
  ['name', '더스테이 제기역점'], ['address', '서울시 동대문구 제기동 1-1'], ['phone', '02-000-0000'],
  ['replyToEmail', 'contact@thestay.kr'], ['mailFromLocal', 'thestay.jegi'],
  ['mailCopyToSelf', '0'], ['mailCopyToSelf', '1'],
  ['acquisitionDate', '2026-03-01'], ['prevOwnerCutoffDate', '2026-02-28'], ['contactLeadDays', '14'], ['checkoutLeadShortDays', '7'], ['checkoutLeadMonths', '1'],
]
const PRICING_FORM: [string, string][] = [
  ['defaultDeposit', '50000'], ['defaultCleaningFee', '20000'], ['reservationDepositMode', 'prepaid'],
  ['refundPenaltyPct', '10'],
  ['refundClauseInContract', '0'], ['refundClauseInContract', '1'],
  ['cleaningFeeInDeposit', '0'], ['cleaningFeeInDeposit', '1'],
]
const DOC_FORM: [string, string][] = [
  ['multiContractVersions', '0'],
  ['defaultAreaM2', '13.2'], ['bankAccount', '카카오뱅크 3333-01-2345678 (홍길동)'],
  ['disposalEnabled', '0'], ['disposalEnabled', '1'],
  ['disposalTitle', '잔여 소지품 임의처분 동의서'], ['disposalDays', '7'], ['disposalBody', '본문'],
]

const apply = (patch: PropertySettingsPatch): Row => ({ ...BEFORE, ...patch })
const same = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b)

// ── ① 탭별 저장이 옆 탭 칼럼을 건드리지 않는다(전 칼럼 전수 대조) ──────────────────
const TAB_FORMS: [string, [string, string][]][] = [
  ['기본정보', BASIC_FORM], ['요금·정책', PRICING_FORM], ['계약서·서류', DOC_FORM],
]
for (const [tab, form] of TAB_FORMS) {
  const patch = buildPropertySettingsPatch(fd(form), { isOwner: true })
  const after = apply(patch)
  const owned = OWNED[tab]
  const touched = ALL_COLUMNS.filter(c => !same(BEFORE[c], after[c]))
  ok(`${tab} 저장이 값을 바꾼 칼럼 0`, touched.length === 0, `바뀐 칼럼 ${touched.join(', ')}`)
  const written = Object.keys(patch)
  const stray = written.filter(c => !owned.includes(c))
  ok(`${tab} 저장이 제 탭 밖 칼럼을 쓰지 않는다`, stray.length === 0, `밖의 칼럼을 씀 ${stray.join(', ')}`)
  // 담당 칼럼은 실제로 쓰인다 — 안 쓰면 위 두 항은 공짜로 통과하므로 반대편도 못박는다.
  const missing = owned.filter(c => !written.includes(c))
  ok(`${tab} 담당 칼럼 전부가 패치에 실린다`, missing.length === 0, `빠진 칼럼 ${missing.join(', ')}`)
}

// ── ② 한 탭에서 값을 바꾸면 그 칼럼만 바뀐다(옆 탭은 글자 하나까지 그대로) ────────────
{
  const patch = buildPropertySettingsPatch(fd(BASIC_FORM.map(([k, v]) =>
    k === 'name' ? ['name', '더스테이 제기역점 2호'] as [string, string] : [k, v] as [string, string])), { isOwner: true })
  const after = apply(patch)
  eq('기본정보에서 이름만 고치면 이름만 바뀐다', ALL_COLUMNS.filter(c => !same(BEFORE[c], after[c])), ['name'])
  eq('그때 소개 페이지 주소는 그대로', after.publicSlug, 'thestayjegi')
  eq('그때 입금 계좌번호도 그대로', after.bankAccount, '카카오뱅크 3333-01-2345678 (홍길동)')
  eq('그때 임의처분 동의서 본문도 그대로', (after.disposalConsentTemplate as { body: string }).body, '본문')
}

// ── ③ 체크박스 해제가 저장된다(hidden '0' 짝) ─────────────────────────────────
{
  // 해제한 폼 = hidden '0' 만 실린다. 이 짝이 없으면 필드가 통째로 사라져 "안 건드림"이 되고
  // 운영자는 체크를 아무리 풀어도 다음 새로고침에 되살아나는 화면을 보게 된다.
  const off = PRICING_FORM.filter(([k, v]) => !(v === '1' && (k === 'refundClauseInContract' || k === 'cleaningFeeInDeposit')))
  const patch = buildPropertySettingsPatch(fd(off), { isOwner: true })
  eq('환불 규정 표시 해제가 false 로 저장된다', patch.refundClauseInContract, false)
  eq('청소비 보증금 포함 해제가 false 로 저장된다', patch.cleaningFeeInDeposit, false)
  const docOff = DOC_FORM.filter(([k, v]) => !(k === 'disposalEnabled' && v === '1'))
  eq('동의서 동반 출력 해제가 false 로 저장된다',
    buildPropertySettingsPatch(fd(docOff), { isOwner: true }).disposalConsentTemplate?.enabled, false)
  // 여러 판본 만들기 — 켜는 쪽도 못박는다. hidden '0' 만 실린 폼이 기본이라 반대편이 필요하다.
  const docMulti: [string, string][] = [...DOC_FORM, ['multiContractVersions', '1']]
  eq('여러 판본 만들기 켜기가 true 로 저장된다',
    buildPropertySettingsPatch(fd(docMulti), { isOwner: true }).multiContractVersions, true)
  eq('여러 판본 만들기 끄기가 false 로 저장된다',
    buildPropertySettingsPatch(fd(DOC_FORM), { isOwner: true }).multiContractVersions, false)
}

// ── ④ 소유자 아닌 멤버의 저장은 청소비 구성을 못 바꾼다 ────────────────────────────
{
  const patch = buildPropertySettingsPatch(fd(PRICING_FORM), { isOwner: false })
  ok('비소유자 저장에 cleaningFeeInDeposit 이 없다', !('cleaningFeeInDeposit' in patch))
  eq('그래도 나머지 요금 칼럼은 저장된다', patch.defaultDeposit, 50000)
  // 여러 판본 만들기도 같은 이유로 소유자 전용이다 — 법적 위험이 걸린 설정이라 위조 폼 한 번에
  // 뒤집히면 안 된다. 체크박스는 소유자에게만 렌더되지만 서버가 역할을 다시 본다.
  const docPatch = buildPropertySettingsPatch(fd([...DOC_FORM, ['multiContractVersions', '1']]), { isOwner: false })
  ok('비소유자 저장에 multiContractVersions 이 없다', !('multiContractVersions' in docPatch))
  eq('그래도 나머지 서류 칼럼은 저장된다', docPatch.bankAccount, '카카오뱅크 3333-01-2345678 (홍길동)')
}

// ── ⑤ 옛 폼(캐시된 번들)이 전 필드를 통째로 보내도 종전대로 저장된다 ────────────────
{
  const legacy = fd([...BASIC_FORM, ...PRICING_FORM, ...DOC_FORM, ['publicSlug', 'TheStay Jegi!']])
  const patch = buildPropertySettingsPatch(legacy, { isOwner: true })
  const written = Object.keys(patch).sort()
  eq('전 칼럼이 다 실린다', written, [...ALL_COLUMNS].sort())
  eq('슬러그는 정규화되어 저장된다', patch.publicSlug, 'thestayjegi')
}

// ── ⑥ 값 해석은 종전과 같다(분해 과정에서 산식이 바뀌지 않았는가) ──────────────────
{
  const p = (pairs: [string, string][]) => buildPropertySettingsPatch(fd(pairs), { isOwner: true })
  eq('빈 영업장명은 이름을 지우지 않는다', 'name' in p([['name', '']]), false)
  eq('빈 주소는 null', p([['address', '']]).address, null)
  eq('빈 보증금은 null', p([['defaultDeposit', '']]).defaultDeposit, null)
  eq('보증금 0 은 0', p([['defaultDeposit', '0']]).defaultDeposit, 0)
  eq('보증금은 숫자만 남긴다', p([['defaultDeposit', '50,000원']]).defaultDeposit, 50000)
  eq('위약금은 공정위 10% 캡', p([['refundPenaltyPct', '30']]).refundPenaltyPct, 10)
  eq('빈 위약금은 null', p([['refundPenaltyPct', '  ']]).refundPenaltyPct, null)
  eq('예약금 미허용값은 기본으로', p([['reservationDepositMode', 'weird']]).reservationDepositMode, 'deposit')
  eq('연락 알림은 1~90 로 조인다', p([['contactLeadDays', '900']]).contactLeadDays, 90)
  eq('연락 알림 빈 값은 기본 14', p([['contactLeadDays', '']]).contactLeadDays, 14)
  eq('전용면적은 소수점을 남긴다', p([['defaultAreaM2', '13.2㎡']]).defaultAreaM2, 13.2)
  eq('빈 전용면적은 null', p([['defaultAreaM2', ' ']]).defaultAreaM2, null)
  eq('계좌번호는 앞뒤 공백을 턴다', p([['bankAccount', '  국민 123  ']]).bankAccount, '국민 123')
  eq('빈 계좌번호는 null', p([['bankAccount', '   ']]).bankAccount, null)
  eq('메일 주소는 앞뒤 공백을 턴다', p([['replyToEmail', '  contact@thestay.kr  ']]).replyToEmail, 'contact@thestay.kr')
  eq('빈 메일 주소는 null', p([['replyToEmail', '   ']]).replyToEmail, null)
  eq('메일 주소 미포함이면 칼럼을 안 쓴다', 'replyToEmail' in p([['name', 'ㅇ']]), false)
  // 보내는 주소는 lib/mailFrom 정규화를 지난다 — 전체 주소를 붙여넣어도 앞부분만 저장된다.
  eq('보내는 주소는 앞부분만 저장', p([['mailFromLocal', 'TheStay@gmail.com']]).mailFromLocal, 'thestay')
  eq('보내는 주소 금칙문자 제거', p([['mailFromLocal', 'the stay!jegi']]).mailFromLocal, 'thestayjegi')
  eq('빈 보내는 주소는 null', p([['mailFromLocal', '  ']]).mailFromLocal, null)
  eq('한글만이면 null(기본 no-reply 로 나간다)', p([['mailFromLocal', '제기역점']]).mailFromLocal, null)
  eq('보내는 주소 미포함이면 칼럼을 안 쓴다', 'mailFromLocal' in p([['name', 'ㅇ']]), false)
  eq('사본 받기 해제가 false 로 저장된다', p([['mailCopyToSelf', '0']]).mailCopyToSelf, false)
  eq('사본 받기 켜기가 true 로 저장된다', p([['mailCopyToSelf', '0'], ['mailCopyToSelf', '1']]).mailCopyToSelf, true)
  eq('동의서 칸이 한 칸이라도 빠지면 안 쓴다',
    'disposalConsentTemplate' in p([['disposalEnabled', '0'], ['disposalTitle', 'ㅇ'], ['disposalDays', '7']]), false)
  eq('동의서 제목이 비면 기본 제목',
    p([['disposalEnabled', '0'], ['disposalTitle', '  '], ['disposalDays', ''], ['disposalBody', '']])
      .disposalConsentTemplate, { enabled: false, days: 7, title: '잔여 소지품 임의처분 동의서', body: '' })
  eq('슬러그 미포함이면 칼럼을 안 쓴다', 'publicSlug' in p([['name', 'ㅇ']]), false)
  eq('빈 슬러그는 null', p([['publicSlug', '']]).publicSlug, null)
}

console.log(`\n환경설정 탭별 저장 범위 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
