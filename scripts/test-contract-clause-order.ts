// 계약서 조항 순서·2단 구조 회귀 — 실행: npx tsx scripts/test-contract-clause-order.ts
//
// 무엇을 지키나. **조항은 문서 순서 그대로 한 흐름이고, 2단 나눔은 CSS 가 한다.**
//
// 왜 필요한가. 종전에는 splitClauseColumns 가 글자 수로 높이를 추정해 좌우를 갈랐고 CSS 는
// flex 2단이었다. flex 는 페이지 경계에서 **각 단이 독립적으로 이어 그려져**, 조항이 한 장을
// 넘치면 3조가 2페이지·4조가 1페이지가 됐다(김상혁 님 계약서, 운영자 발견 2026-08-26).
// 방아쇠는 특약 절이 하나 붙어 축소맞춤 하한을 넘기는 것이라 **보통 계약에서는 안 보인다** —
// 그래서 여기서는 일부러 특약을 다 붙인 과중 계약으로 검사한다.
//
// 순수 축만 본다. 실제 페이지별 배치는 브라우저가 정하므로 scripts/probe-contract-print-order.mjs
// 로 따로 잰다(로컬 크롬 의존이라 verify 에 안 넣는다).
import { buildContractPrintHtml } from '../lib/contractPrintHtml'
import { appendSubLeaseAddendum, buildRoomScheduleAddendum, DEFAULT_SUB_LEASE_ADDENDUM } from '../lib/contract'

let pass = 0
const fails: string[] = []
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; return }
  fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const SECTIONS = [
  { title: '1. 입실 계약', items: ['1. ' + '가나다'.repeat(30), '2. ' + '라마바'.repeat(30)] },
  { title: '2. 퇴실 및 환불', items: ['사아자'.repeat(30), '차카타'.repeat(30)] },
  { title: '3. 생활 수칙', items: ['파하가'.repeat(30), '나다라'.repeat(30)] },
  { title: '4. 강제 퇴실', items: ['마바사'.repeat(30)] },
]
const SCHEDULE_TEXT = '2026.08.31 ~ 2026.08.31 402호 · 2026.09.01부터 404호'

const html = buildContractPrintHtml({
  template: { title: '입실 계약서', sections: SECTIONS, oathText: '상기 규칙을 숙지하였습니다.' },
  businessInfo: { name: '테스트', registrationNo: '', ceoName: '', address: '' },
  phone: null, contractNo: 'T-1',
  disposalConsent: { enabled: false, title: '', body: '', signLabel: '' },
  logoImageUrl: null, stampImageUrl: null, refundClauseInContract: false,
  tenant: { name: '홍길동', birthdate: null, foreignRegNo: null, gender: '남', job: null, primaryPhone: null },
  lease: { moveInDate: '2026-08-31', expectedMoveOut: null, rentAmount: 470000, depositAmount: 50000, cleaningFee: 20000, dueDay: null, roomNo: '404', registrationStatus: '' },
  subLeaseAddendum: DEFAULT_SUB_LEASE_ADDENDUM,
  roomScheduleText: SCHEDULE_TEXT,
  smoking: '비흡연', emergencyContactText: '', signDate: '2026년 8월 26일',
  signatureImageDataUrl: '', pretendardBase64: '',
} as never)

// ── 구조 ────────────────────────────────────────────────────────────
// flex 2단으로 되돌아가면 페이지 경계에서 단이 독립 분절돼 순서가 다시 깨진다.
ok('2단은 column-count 로 낸다', /\.clauses\s*\{[^}]*column-count:\s*2/.test(html))
ok('flex 2단으로 되돌아가지 않았다', !/\.clauses\s*\{[^}]*display:\s*flex/.test(html))
ok('손 분배의 흔적(clause-col)이 없다', !html.includes('clause-col'))
// balance 가 기본값이라 명시할 필요는 없지만 auto 는 금지다(한 장짜리 계약의 좌우가 비대칭이 된다).
ok('column-fill: auto 를 쓰지 않는다', !/column-fill:\s*auto/.test(html))
// 절이 단 경계에서 통째로 점프하면 바닥 공백이 커진다.
ok('.clause-group 에 break-inside: avoid 가 없다', !/\.clause-group\s*\{[^}]*break-inside:\s*avoid/.test(html))
// 고아 헤더 방지와 항목 중간 절단 방지는 유지한다.
ok('.clause-h 는 break-after: avoid 를 유지한다', /\.clause-h\s*\{[^}]*break-after:\s*avoid/.test(html))
ok('li 는 break-inside: avoid 를 유지한다', /\.clause-list li\s*\{[^}]*break-inside:\s*avoid/.test(html))

// ── 순서 ────────────────────────────────────────────────────────────
// DOM 이 선형이면 등장 순서가 곧 읽는 순서다. 특약·일정 절까지 꼬리에 붙는다.
const expected = appendSubLeaseAddendum(SECTIONS, DEFAULT_SUB_LEASE_ADDENDUM, buildRoomScheduleAddendum(SCHEDULE_TEXT))
  .map(s => s.title)
const at = expected.map(t => html.indexOf(t))
ok('절 제목이 모두 인쇄본에 있다', at.every(i => i >= 0), `못 찾음 ${expected.filter((_, i) => at[i] < 0).join(', ')}`)
ok('절 제목이 문서 순서 그대로 등장한다', at.every((v, i) => i === 0 || v > at[i - 1]),
  at.map((v, i) => `${expected[i]}@${v}`).join(' '))
ok('특약과 일정 절이 꼬리에 붙는다', expected.length === SECTIONS.length + 2, `절 ${expected.length}개`)
ok('일정 문장이 본문에 있다', html.includes(SCHEDULE_TEXT))

// ── 번호 ────────────────────────────────────────────────────────────
// 번호는 자리에서 매긴다(CSS counter). 본문에 박힌 번호를 남기면 '1. 1. …' 이 된다.
ok('번호를 자리에서 매긴다', /\.clause-list\s*\{[^}]*counter-reset:\s*clause/.test(html))
ok('li::before 가 번호를 낸다', /\.clause-list li::before\s*\{[^}]*counter\(clause\)/.test(html))
ok('점(·)을 글머리로 쓰지 않는다', !/\.clause-list li::before\s*\{[^}]*content:\s*"·"/.test(html))
// 본문에 번호가 남으면 화면·종이 어느 쪽이든 이중 표기가 된다.
ok('본문에서 손 번호를 걷었다', !html.includes('<li>1. '), '항목이 1. 로 시작한다')

console.log(`\n계약서 조항 순서 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
