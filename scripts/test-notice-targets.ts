// 단체 공지 대상 정본(lib/noticeTargets) 회귀 + 기본 템플릿 — 실행: npx tsx scripts/test-notice-targets.ts
//
// 고정하는 것(2026-10-06 운영자 승인, 단체 공지에 문의·예약자 대상 추가).
//   · 분할: 거주(방 있음) = 입주자, 리드(확정 아님) = 문의·예약, 나머지 null
//   · 확정 제외는 리드에만 — 예약 확정 뒤 입실한 거주자(확정 시각 보유)는 입주자로 남는다
//   · 확정자·취소자·퇴실·비거주 제외, 리드는 방이 없어도 들어온다
//   · 단계: 입주자 관리 2차 필터와 같은 판정(inquiryStageOf)
//   · 문의일 범위: KST 일 경계(시작일 00:00 포함 · 끝일 23:59 포함 · 다음 날 00:00 제외), 문의 일시 없으면 등록 일시
//   · 정렬·순번: 문의일 오름차순, 순번은 범위로 거르기 전 리드 전체 기준(거른 뒤에도 같은 번호)
//   · 예시 템플릿: 저장 목록을 덮지 않고 뒤에 붙는다, 같은 이름·본문이면 빠진다, 본문 규칙(180자·§29)
//   · 표시: 보조줄 '문의 · 투어 · 공지' 어순, 칩 범위 — 해가 다를 때만 연도(웹디자이너 패스)
import { classifyNoticeTarget, inInquiryRange, inquiryRangeLabel, leadRanks, leadSubLine, noticeGroupRows, type NoticeTargetRow } from '../lib/noticeTargets'
import { NOTICE_TEMPLATE_EXAMPLES, withNoticeTemplateExamples } from '../lib/noticeTemplates'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}
const KST = (ymdhm: string) => new Date(`${ymdhm}:00+09:00`)   // 'YYYY-MM-DDTHH:mm' KST → Date

// ── 분할·단계 ──
const C = (status: string, extra: { roomId?: string | null; reservationConfirmedAt?: Date | null; tourDate?: Date | null } = {}) =>
  classifyNoticeTarget({ status, roomId: extra.roomId === undefined ? 'room-1' : extra.roomId, reservationConfirmedAt: extra.reservationConfirmedAt ?? null, tourDate: extra.tourDate ?? null })
eq('거주중 = 입주자', C('ACTIVE'), { group: 'resident', stage: null })
eq('퇴실 예정 = 입주자', C('CHECKOUT_PENDING'), { group: 'resident', stage: null })
eq('확정 뒤 입실한 거주자도 입주자(확정 제외는 리드에만)', C('ACTIVE', { reservationConfirmedAt: KST('2026-08-01T10:00') }), { group: 'resident', stage: null })
eq('방 없는 거주 = 제외', C('ACTIVE', { roomId: null }), null)
eq('문의(투어일 없음)', C('WAITING_TOUR', { roomId: null }), { group: 'lead', stage: 'INQUIRY' })
eq('투어 예정', C('WAITING_TOUR', { roomId: null, tourDate: KST('2026-10-03T00:00') }), { group: 'lead', stage: 'TOUR' })
eq('투어 완료', C('TOUR_DONE', { roomId: null }), { group: 'lead', stage: 'TOUR' })
eq('입실 예약(미확정, 방 있음)', C('RESERVED'), { group: 'lead', stage: 'RESERVED' })
eq('확정자 제외', C('RESERVED', { reservationConfirmedAt: KST('2026-09-20T12:00') }), null)
eq('취소자 제외', C('CANCELLED', { roomId: null }), null)
eq('퇴실 제외', C('CHECKED_OUT'), null)
eq('비거주 제외', C('NON_RESIDENT'), null)

// ── 문의일 범위 경계(KST) ──
const R = (inquiryAt: Date | null, createdAt: Date = KST('2026-01-01T00:00')) => ({ inquiryAt, createdAt })
const SEPT = { from: '2026-09-01', to: '2026-09-30' }
eq('시작일 00:00 포함', inInquiryRange(R(KST('2026-09-01T00:00')), SEPT), true)
eq('시작 전날 23:59 제외', inInquiryRange(R(KST('2026-08-31T23:59')), SEPT), false)
eq('끝일 23:59 포함', inInquiryRange(R(KST('2026-09-30T23:59')), SEPT), true)
eq('끝 다음 날 00:00 제외', inInquiryRange(R(KST('2026-10-01T00:00')), SEPT), false)
// UTC 로 읽으면 갈리는 자리 — KST 9/1 08:59 는 UTC 8/31 23:59 다.
eq('KST 9/1 오전(UTC 로는 8/31) 포함', inInquiryRange(R(KST('2026-09-01T08:59')), SEPT), true)
eq('문의 일시 없으면 등록 일시', inInquiryRange(R(null, KST('2026-09-15T12:00')), SEPT), true)
eq('등록 일시도 범위 밖이면 제외', inInquiryRange(R(null, KST('2026-10-02T12:00')), SEPT), false)
eq('범위 없음 = 전부', inInquiryRange(R(KST('2020-01-01T00:00')), null), true)
eq('열린 시작', inInquiryRange(R(KST('2020-01-01T00:00')), { from: '', to: '2026-09-30' }), true)
eq('열린 끝', inInquiryRange(R(KST('2026-12-31T23:59')), { from: '2026-09-01', to: '' }), true)

// ── 그룹 목록·정렬·순번 ──
type Row = NoticeTargetRow & { name: string }
const rows: Row[] = [
  { leaseTermId: 'r1', group: 'resident', name: '301호', inquiryAt: null, createdAt: KST('2025-03-01T00:00').toISOString() },
  { leaseTermId: 'l-oct', group: 'lead', name: '10월 문의', inquiryAt: KST('2026-10-02T09:00').toISOString(), createdAt: KST('2026-10-02T09:00').toISOString() },
  { leaseTermId: 'r2', group: 'resident', name: '205호', inquiryAt: KST('2025-01-01T00:00').toISOString(), createdAt: KST('2025-01-02T00:00').toISOString() },
  { leaseTermId: 'l-sep2', group: 'lead', name: '9월 둘째', inquiryAt: KST('2026-09-20T14:00').toISOString(), createdAt: KST('2026-09-20T14:00').toISOString() },
  { leaseTermId: 'l-sep1', group: 'lead', name: '9월 첫째(문의일 없음·등록일)', inquiryAt: null, createdAt: KST('2026-09-03T10:00').toISOString() },
  { leaseTermId: 'l-aug', group: 'lead', name: '8월 문의', inquiryAt: KST('2026-08-28T18:00').toISOString(), createdAt: KST('2026-09-05T10:00').toISOString() },
]
eq('입주자 목록은 받은 순서 그대로', noticeGroupRows(rows, 'resident').map(r => r.leaseTermId), ['r1', 'r2'])
eq('문의·예약 목록은 문의일 오름차순', noticeGroupRows(rows, 'lead').map(r => r.leaseTermId), ['l-aug', 'l-sep1', 'l-sep2', 'l-oct'])
eq('입주자 그룹에는 범위가 안 걸린다', noticeGroupRows(rows, 'resident', SEPT).map(r => r.leaseTermId), ['r1', 'r2'])
eq('9월 범위', noticeGroupRows(rows, 'lead', SEPT).map(r => r.leaseTermId), ['l-sep1', 'l-sep2'])
const ranks = leadRanks(rows)
eq('순번은 리드 전체 기준', [...ranks.entries()], [['l-aug', 1], ['l-sep1', 2], ['l-sep2', 3], ['l-oct', 4]])
eq('입주자에는 순번 없음', ranks.has('r1') || ranks.has('r2'), false)
eq('범위로 걸러도 순번 고정(2·3번)', noticeGroupRows(rows, 'lead', SEPT).map(r => ranks.get(r.leaseTermId)), [2, 3])
// 같은 시각이면 등록 순 → id 순. 입력 순서를 뒤집어도 같은 답이어야 화면을 다시 열 때 번호가 안 흔들린다.
const tie: NoticeTargetRow[] = [
  { leaseTermId: 'b', group: 'lead', inquiryAt: KST('2026-09-10T10:00').toISOString(), createdAt: KST('2026-09-10T11:00').toISOString() },
  { leaseTermId: 'a', group: 'lead', inquiryAt: KST('2026-09-10T10:00').toISOString(), createdAt: KST('2026-09-10T11:00').toISOString() },
  { leaseTermId: 'c', group: 'lead', inquiryAt: KST('2026-09-10T10:00').toISOString(), createdAt: KST('2026-09-10T10:30').toISOString() },
]
eq('동률: 등록 순 → id 순', [...leadRanks(tie).keys()], ['c', 'a', 'b'])
eq('동률: 입력 순서 무관', [...leadRanks([...tie].reverse()).keys()], ['c', 'a', 'b'])

// ── 표시: 보조줄·칩 범위(해가 다를 때만 연도) ──
const TODAY = KST('2026-10-06T12:00')
eq('보조줄 문의·투어·공지 어순', leadSubLine({ inquiryAt: KST('2026-09-09T10:00'), createdAt: KST('2026-09-09T10:00'), tourDate: new Date('2026-10-01T00:00:00.000Z'), lastNoticeAt: KST('2026-09-20T15:00') }, TODAY),
  '문의 9/9 · 투어 10/1 · 공지 9/20')
eq('문의 일시 없으면 등록, 빈 칸은 생략', leadSubLine({ inquiryAt: null, createdAt: KST('2026-10-01T09:00'), tourDate: null, lastNoticeAt: null }, TODAY), '등록 10/1')
eq('지난해 문의는 연도', leadSubLine({ inquiryAt: KST('2025-12-01T10:00'), createdAt: KST('2025-12-01T10:00'), tourDate: null, lastNoticeAt: null }, TODAY), '문의 2025. 12/1')
eq('KST 새벽 문의는 그날(UTC 전날 아님)', leadSubLine({ inquiryAt: KST('2026-09-01T03:00'), createdAt: KST('2026-09-01T03:00'), tourDate: null, lastNoticeAt: null }, TODAY), '문의 9/1')
eq('보조줄에 단정 어휘(안내함) 없음', /안내함/.test(leadSubLine({ inquiryAt: null, createdAt: TODAY, tourDate: null, lastNoticeAt: TODAY }, TODAY)), false)
eq('칩 범위 같은 해', inquiryRangeLabel({ from: '2026-09-01', to: '2026-10-06' }, TODAY), '9/1~10/6')
eq('칩 범위 해 넘김', inquiryRangeLabel({ from: '2025-12-01', to: '2026-01-05' }, TODAY), '2025. 12/1~1/5')
eq('칩 범위 열린 끝', inquiryRangeLabel({ from: '2026-09-01', to: '' }, TODAY), '9/1~')

// ── 예시 템플릿 ──
const def = NOTICE_TEMPLATE_EXAMPLES[0]
eq('예시 템플릿 이름', def.name, '선착순 입실 안내')
eq('본문 180자 이내', def.body.length <= 180, true)
eq('느낌표·이모지·em dash 없음', /[!！—\u{1F300}-\u{1FAFF}☀-➿]/u.test(def.body), false)
eq('치환 변수 표기 없음(§29 단체 발송)', /[{}]/.test(def.body), false)
const saved = [{ id: 's2', name: '수도 점검', body: '수도 점검 안내' }, { id: 's1', name: '분리수거', body: '분리수거 요일' }]
eq('저장 목록이 없으면 예시만', withNoticeTemplateExamples([]).map(t => [t.id, t.example]), [[`example:${def.key}`, true]])
eq('저장 목록은 순서·내용 그대로, 예시는 뒤에', withNoticeTemplateExamples(saved).map(t => [t.id, t.name, t.example]),
  [['s2', '수도 점검', false], ['s1', '분리수거', false], [`example:${def.key}`, '선착순 입실 안내', true]])
eq('같은 이름을 저장했으면 예시는 빠진다', withNoticeTemplateExamples([{ id: 'x', name: '선착순 입실 안내', body: '고쳐 쓴 본문' }]).map(t => t.id), ['x'])
eq('같은 본문을 저장했으면 예시는 빠진다', withNoticeTemplateExamples([{ id: 'y', name: '내 이름', body: def.body }]).map(t => t.id), ['y'])

if (fails.length) {
  console.error(`test-notice-targets: ${fails.length}건 실패 (${pass}건 통과)`)
  for (const f of fails) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`test-notice-targets: ${pass}건 통과`)
