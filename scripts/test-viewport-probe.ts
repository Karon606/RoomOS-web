// 오류신고 계측 두 스냅샷 조립 회귀 — 실행: npx tsx scripts/test-viewport-probe.ts
//
// 여기서 고정하는 것(2026-09-17, 디자이너 검수 반영).
//   · 열었을 때 스냅샷이 없으면 '제출할 때만' 머리줄을 단다 — 라벨이 없으면 옛 형식 신고와
//     생김새가 같아, 읽는 쪽이 둘을 못 가른다(다음 재현에서 볼 곳이 서로 다르다).
//   · 둘이 같으면 한 덩이로 접는다 — 같은 일곱 줄을 두 번 읽히지 않는다.
//   · 둘이 다르면 **달라진 열쇠의 이름**을 짚는다. 이 한 줄이 이번 회차의 목적이다.
//     줄 이름까지만 짚으면 이 계측이 겨누는 바로 그 값(등장모션잔존)이 갈려도 'modal' 이라고만
//     적히고, 변수 넷이 든 vars 줄도 'vars' 하나로 접힌다.
//     깨진 신고(bf0a6fff)와 멀쩡한 신고(be42800d)의 계측이 한 글자도 다르지 않았던 것은,
//     사진 앱 왕복이 visibilitychange 로 화면을 고쳐 놓은 뒤에야 쟀기 때문이다.
//   · (2026-10-13, 키보드 가림 0단계) 센티널·문서 줄의 달라진 열쇠, 직전 키보드 세션 표의 직렬화·
//     한도 덜기·기록의 값만 담기·링버퍼 상한.
import { probeReport, probeAfterEntrance } from '../lib/viewportProbe'
import { kbdTrace, kbdTraceFreeze, kbdTraceTable, KBD_TRACE_CAP, type KbdTraceRow, type KbdTraceFrozen } from '../lib/kbdTrace'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; return }
  fails.push(`${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}

const SUBMIT = [
  'vv h=812 w=402 top=0 pageTop=0 scale=1',
  'inner h=812 w=402 dpr=3',
  'kbd-open=n',
  'vars kbd-inset=0px vvh=812px vv-top=0px vv-bottom=0px',
  'modal open=2 등장모션잔존=0',
  'focus BODY',
].join('\n')

// 신고 bf0a6fff 가 남겼어야 할 모습 — 열었을 때는 등장 모션이 굳어 있었다.
const OPENED_STUCK = SUBMIT.replace('등장모션잔존=0', '등장모션잔존=1')

eq('열었을 때가 없으면 스냅샷 하나임을 머리줄이 말한다', probeReport(null, SUBMIT), `제출할 때만\n${SUBMIT}`)
eq('제출 계측이 비면(서버 렌더) 빈 문자열', probeReport(OPENED_STUCK, ''), '')
eq('둘이 같으면 한 덩이로 접는다', probeReport(SUBMIT, SUBMIT), `열었을 때·제출할 때 같음\n${SUBMIT}`)
eq('둘이 다르면 달라진 열쇠를 짚고 둘 다 편다',
  probeReport(OPENED_STUCK, SUBMIT),
  `열었을 때\n${OPENED_STUCK}\n제출할 때 (달라진 줄: modal 등장모션잔존)\n${SUBMIT}`)

// 여러 줄이 갈리면 전부 짚는다 — 키보드가 닫히며 띠가 되돌아온 경우.
const OPENED_KBD = SUBMIT
  .replace('vv h=812', 'vv h=416')
  .replace('kbd-open=n', 'kbd-open=y')
  .replace('kbd-inset=0px', 'kbd-inset=266px')
eq('달라진 줄이 여럿이면 이름을 모두 짚는다',
  probeReport(OPENED_KBD, SUBMIT).split('\n').find(l => l.startsWith('제출할 때')),
  '제출할 때 (달라진 줄: vv h · kbd-open · vars kbd-inset)')

// 한 줄에서 둘이 갈리면 둘 다 짚는다 — vars 줄은 변수 넷이 한 줄에 선다.
const OPENED_VARS = SUBMIT
  .replace('kbd-inset=0px', 'kbd-inset=266px')
  .replace('vv-bottom=0px', 'vv-bottom=266px')
eq('한 줄 안에서 갈린 열쇠를 전부 짚는다',
  probeReport(OPENED_VARS, SUBMIT).split('\n').find(l => l.startsWith('제출할 때')),
  '제출할 때 (달라진 줄: vars kbd-inset · vars vv-bottom)')

// 줄 모양 자체가 바뀌면 열쇠를 짝지을 수 없다 — 머리말 하나로 덜 말한다(지어내지 않는다).
eq('줄 모양이 바뀌면 머리말 하나로 답한다',
  probeReport(SUBMIT.replace('vv h=812 w=402 top=0 pageTop=0 scale=1', 'vv 미지원'), SUBMIT)
    .split('\n').find(l => l.startsWith('제출할 때')),
  '제출할 때 (달라진 줄: vv)')

// 브라우저 밖에서는 아무것도 안 하고 취소 함수만 돌려준다(서버 렌더 안전).
{
  let called = false
  const cancel = probeAfterEntrance(() => { called = true })
  cancel()
  eq('브라우저 밖에서는 재지 않는다', called, false)
  eq('브라우저 밖에서도 취소 함수를 돌려준다', typeof cancel, 'function')
}

// ── 0단계 계측(키보드 가림 패널 2026-10-13) ─────────────────────────────
//
// 새 줄 둘(sentinel·doc)도 같은 문법이라 달라진 열쇠를 짚는다. 이 계측이 겨누는 것은 iOS 홈화면
// 앱이 팬할 때 innerHeight 가 줄어도 fixed 상자 H 는 그대로인가, T0 가 어디로 가는가다.
{
  const WITH_FRAME = SUBMIT.replace('inner h=812 w=402 dpr=3',
    'inner h=812 w=402 dpr=3\nsentinel H=812 T0=0 bottom=812\ndoc clientH=812 scrollTop=0')
  const OPENED_PAN = WITH_FRAME
    .replace('vv h=812 w=402 top=0', 'vv h=416 w=402 top=189.66')
    .replace('inner h=812', 'inner h=622')
    .replace('sentinel H=812 T0=0 bottom=812', 'sentinel H=812 T0=-189.66 bottom=622.34')
  eq('센티널·문서 줄도 달라진 열쇠를 짚는다',
    probeReport(OPENED_PAN, WITH_FRAME).split('\n').find(l => l.startsWith('제출할 때')),
    '제출할 때 (달라진 줄: vv h · vv top · inner h · sentinel T0 · sentinel bottom)')
}

// 키보드 세션 표 — 얼린 링버퍼를 사람이 읽는 표 한 덩이로.
const AT = 10000
const row = (t: number, ev: string, verdict: string, inner: number, vvh: number | null, top: number | null,
  H: number | null, T0: number | null, sy: number | null, open: boolean, inset: string, focus: string): KbdTraceRow =>
  ({ t, ev, verdict, inner, vvh, top, H, T0, sy, open, inset, focus })
// 홈화면 앱 가설의 모양 — 팬이 커지며 inner 가 줄고 판정이 shut 으로 뒤집혀 복원이 팬을 되감는다.
// H·T0 는 열린 모달 오버레이를 잰 값이다(마지막 rep 줄만 누른 순간의 센티널).
const FROZEN: KbdTraceFrozen = {
  at: AT,
  rows: [
    row(4679, 'fi', 'shut', 812, 812, 0, 812, 0, 0, false, '0px', 'INPUT:text'),
    row(4710, 'vr', 'open', 812, 416, 0, 812, 0, 0, true, '396px', 'INPUT:text'),
    row(4880, 'vs', 'open', 700, 416, 112, 812, -112, 0, true, '396px', 'INPUT:text'),
    row(5200, 'vs', 'shut', 476, 416, 335.66, 812, -335.66, 0, true, '396px', 'INPUT:text'),
    row(5200.4, 'rst', '·', 476, 416, 335.66, 812, -335.66, 0, true, '396px', 'INPUT:text'),
    row(AT, 'rep', '·', 812, 812, 0, 812, 0, 0, false, '0px', 'BODY'),
  ],
}
const TABLE_ROWS = [
  't     ev  verdict inner vvh top    H   T0      sy kbd inset focus',
  '-5321 fi  shut    812   812 0      812 0       0  n   0     INPUT:text',
  '-5290 vr  open    812   416 0      812 0       0  y   396',
  '-5120 vs  open    700   416 112    812 -112    0  y   396',
  '-4800 vs  shut    476   416 335.66 812 -335.66 0  y   396',
  '-4800 rst ·       476   416 335.66 812 -335.66 0  y   396',
  '0     rep ·       812   812 0      812 0       0  n   0     BODY',
]
const LEGEND = [
  'ev vr=vv resize · vs=vv scroll · fi/fo=focus in/out · rs=복귀 재동기 · rst=복원(맨 위로 되감기) · rep=신고창 열림 · verdict=가드 판정',
  'vs×n=판정·표식이 같은 팬 n건을 첫 줄과 끝 줄로 접음 · rs 바로 뒤 같은 t 의 vr 은 재동기가 부른 판정'
    + ' · H·T0=fixed 상자 높이·client top(모달 오버레이, rep 줄은 누른 순간의 센티널) · sy=문서 scrollTop',
].join('\n')
eq('키보드 세션 표 — 상대 ms·열 맞춤·포커스는 바뀔 때만·H·T0·sy 열',
  kbdTraceTable(FROZEN),
  ['키보드 세션 (신고창을 연 순간까지 6건 · t=그 순간 기준 ms)', LEGEND, ...TABLE_ROWS].join('\n'))

// 판정·표식이 같은 vs 가 셋 이상 이어지면 첫 줄과 끝 줄로 접는다(독립 검수 2026-10-13).
// 큰 팬 한 번이 수십 줄을 먹어 세션 앞부분과 판정이 바뀐 줄을 밀어내던 것.
const pan = (t0: number, n: number, verdict: string) => Array.from({ length: n }, (_, i) =>
  row(t0 + i * 16, 'vs', verdict, 812 - 17 * (i + 1), 416, 17 * (i + 1), 812, -17 * (i + 1), 0, true, '396px', 'INPUT:text'))
{
  const folded = kbdTraceTable({ at: AT, rows: [FROZEN.rows[0], FROZEN.rows[1], ...pan(4800, 5, 'open'), ...pan(4900, 2, 'shut'), FROZEN.rows[5]] })
  const data = folded.split('\n').filter(l => /^-?\d/.test(l))
  eq('접은 건수를 머리줄에 적는다', folded.split('\n')[0], '키보드 세션 (신고창을 연 순간까지 10건, 팬 3건 접음 · t=그 순간 기준 ms)')
  eq('접힌 묶음은 첫 줄과 끝 줄(×n)만 남는다', data.slice(2, 4).join('\n'),
    ['-5200 vs   open    795   416 17  812 -17 0  y   396', '-5136 vs×5 open    727   416 85  812 -85 0  y   396'].join('\n'))
  eq('둘만 이어지면 접지 않는다', data.slice(4, 6).map(l => l.split(/\s+/)[1]).join(' '), 'vs vs')
  eq('판정이 바뀌면 묶음이 끊긴다', data[4].split(/\s+/)[2], 'shut')

  // 묶음 안에서 화면 고정 상자가 모형(H 그대로, T0 = -top)을 벗어나면 그 줄을 접지 않는다(재검수 2026-10-13).
  const p = pan(4800, 5, 'open')
  const hJump = [...p.slice(0, 2), { ...p[2], H: 700 }, ...p.slice(3)]
  const t0Drift = [...p.slice(0, 2), { ...p[2], T0: 0 }, ...p.slice(3)]
  const evsOf = (rs: KbdTraceRow[]) => kbdTraceTable({ at: AT, rows: [...rs, FROZEN.rows[5]] })
    .split('\n').filter(l => /^-?\d/.test(l)).map(l => l.split(/\s+/)[1]).join(' ')
  eq('모형대로 움직이면 다섯 건이 접힌다', evsOf(p), 'vs vs×5 rep')
  eq('묶음 중간에 H 가 바뀌면 끊긴다', evsOf(hJump), 'vs vs vs vs vs rep')
  eq('묶음 중간에 T0 가 팬과 따로 놀면 끊긴다', evsOf(t0Drift), 'vs vs vs vs vs rep')
  const shellPan = p.map(x => ({ ...x, H: null, T0: null }))
  eq('상자를 못 잰 셸 폼 팬은 판정·표식만으로 접는다', evsOf(shellPan), 'vs vs×5 rep')
}

// 자리가 모자라면 **덜기 차례대로** 덜어낸다. 판정이나 표식이 바뀐 줄은 끝까지 남고, 마지막 줄
// (신고창을 연 순간)은 안 덜어낸다. 오래된 줄부터 무작정 버리던 때는 앞쪽의 vs shut·vr shut 이
// 먼저 사라졌다(독립 검수 2026-10-13, 2600자 메모에서 표가 9건만 남던 경우).
{
  // 앞쪽에 판정이 뒤집히는 줄 넷, 뒤로는 복원·재동기가 판정 그대로 되풀이된다(접히지 않는 모양).
  const rows: KbdTraceRow[] = [
    row(1000, 'fi', 'shut', 812, 812, 0, 812, 0, 0, false, '0px', 'INPUT:text'),
    row(1100, 'vr', 'open', 812, 416, 0, 812, 0, 0, true, '396px', 'INPUT:text'),
    row(1300, 'vs', 'shut', 472, 416, 340, 812, -340, 0, true, '396px', 'INPUT:text'),
    row(1400, 'vr', 'shut', 472, 416, 340, 812, -340, 0, false, '0px', 'INPUT:text'),
  ]
  for (let i = 0; i < 12; i++) {
    const t = 1500 + i * 100
    rows.push(row(t, 'vs', 'shut', 416, 416, 396, 812, -396, 0, false, '0px', 'INPUT:text'))
    rows.push(row(t + 1, 'rst', '·', 416, 416, 396, 812, -396, 0, false, '0px', 'INPUT:text'))
    rows.push(row(t + 50, 'rs', 'focus', 416, 416, 396, 812, -396, 0, false, '0px', 'INPUT:text'))
    rows.push(row(t + 50, 'vr', 'shut', 416, 416, 396, 812, -396, 0, false, '0px', 'INPUT:text'))
  }
  rows.push(row(AT, 'rep', '·', 812, 812, 0, 812, 0, 0, false, '0px', 'BUTTON'))
  const fr: KbdTraceFrozen = { at: AT, rows }
  const evs = (t: string) => t.split('\n').filter(l => /^-?\d/.test(l)).map(l => l.split(/\s+/).slice(1, 3).join(':'))
  const FLIPS = 'fi:shut vr:open vs:shut vr:shut'
  const full = kbdTraceTable(fr)
  eq('한도 안이면 다 싣는다', evs(full).length, rows.length)

  // 판정이 그대로인 vs·vr 를 먼저 덜고, 재동기는 오래된 것부터 덜고, 복원은 남긴다.
  const mid = kbdTraceTable(fr, Math.floor(full.length * 0.45))
  const rsAll = rows.filter(x => x.ev === 'rs').map(x => String(Math.round(x.t - AT)))
  const rsKept = mid.split('\n').filter(l => /^-?\d+\s+rs\s/.test(l)).map(l => l.split(/\s+/)[0])
  eq('판정이 바뀐 줄은 남는다', evs(mid).slice(0, 4).join(' '), FLIPS)
  eq('앞 줄 그대로인 vs·vr 부터 덜어낸다', evs(mid).slice(4, -1).every(e => e === 'rst:·' || e === 'rs:focus'), true)
  eq('복원 줄은 재동기보다 오래 남는다', evs(mid).filter(e => e === 'rst:·').length, 12)
  eq('같은 차례 안에서는 오래된 줄부터 덜어낸다', rsKept.length > 0 && rsKept.length < 12 && rsKept.join() === rsAll.slice(-rsKept.length).join(), true)
  eq('덜어낸 줄 수를 머리줄에 적는다', /, \d+줄 덜어냄\(판정이 그대로인 줄부터\)/.test(mid.split('\n')[0]), true)
  eq('범례는 아직 남는다', mid.includes('vs×n='), true)
  eq('마지막 줄(신고창을 연 순간)은 남는다', mid.split('\n').pop()?.split(/\s+/).slice(0, 2).join(' '), '0 rep')
  eq('덜어낸 표는 한도 안에 든다', mid.length <= Math.floor(full.length * 0.45), true)

  // 더 좁으면 복원 줄, 그다음 범례를 덜고, 판정이 바뀐 줄과 마지막 줄만 남긴다.
  const tight = kbdTraceTable(fr, 520)
  eq('좁으면 범례까지 덜고 판정이 바뀐 줄은 끝까지 남긴다', evs(tight).join(' '), `${FLIPS} rep:·`)
  eq('범례를 덜어냈다', tight.includes('vs×n='), false)
  eq('좁게 덜어도 한도 안에 든다', tight.length <= 520, true)

  // 판정이 바뀐 줄마저 다 못 들어가면 세션 첫 세 줄은 남기고 그 뒤 줄부터 덜며, 마지막 줄은 끝까지 남긴다.
  const tighter = kbdTraceTable(fr, tight.length - 20)
  eq('판정이 바뀐 줄 안에서는 첫 세 줄을 남기고 그 뒤부터 덜어낸다', evs(tighter).join(' '), 'fi:shut vr:open vs:shut rep:·')
  eq('표 한 줄도 못 들어가면 생략했다고만 적는다', kbdTraceTable(fr, 40), `키보드 세션 ${rows.length}건 생략 (메모 길이 한도)`)
  eq('그것도 못 들어가면 빈 문자열', kbdTraceTable(fr, 5), '')
}

// 판정이 자주 뒤집혀(복원과 재팬이 번갈아) 뒤집힌 줄만으로 자리를 넘어도 세션 첫 뒤집힘은 남는다.
{
  const flips = Array.from({ length: 40 }, (_, i) => row(2000 + i * 100, 'vs', i % 2 ? 'shut' : 'open',
    i % 2 ? 512 : 812, 416, i % 2 ? 300 : 0, 812, i % 2 ? -300 : 0, 0, true, '396px', 'INPUT:text'))
  const t = kbdTraceTable({ at: AT, rows: [...flips, FROZEN.rows[5]] }, 900)
  const ts = t.split('\n').filter(l => /^-?\d/.test(l)).map(l => l.split(/\s+/)[0])
  eq('뒤집힌 줄만으로 넘쳐도 한도 안에 든다', t.length <= 900, true)
  eq('세션 첫 세 뒤집힘이 남는다', ts.slice(0, 3).join(' '), '-8000 -7900 -7800')
  eq('가장 최근 뒤집힘도 남는다', ts.at(-2), '-4100')
  eq('가운데부터 덜어냈다', ts.length < 41 && !ts.includes('-6000'), true)
}

// 가드가 한 줄도 안 적었으면 '기록 없음'이라고 적어 기능이 없던 신고와 가른다. 그래도 누른 순간의
// rep 줄(센티널 H·T0)은 남긴다. 가드 밖 화면의 폼이 바로 그 경우다(독립 검수 2026-10-13).
{
  const REP_PAN = row(AT, 'rep', '·', 622, 416, 189.66, 812, -189.66, 0, false, '', 'INPUT:text')
  const only = kbdTraceTable({ at: AT, rows: [row(2000, 'rep', '·', 812, 812, 0, 812, 0, 0, false, '', 'BUTTON'), REP_PAN] })
  eq('rep 줄만 있으면 기록 없음이라 적고 마지막 rep 줄을 싣는다', only, [
    '키보드 세션 기록 없음 (신고창을 연 순간 한 줄 · t=그 순간 기준 ms)', LEGEND,
    't ev  verdict inner vvh top    H   T0      sy kbd inset focus',
    '0 rep ·       622   416 189.66 812 -189.66 0  n   -     INPUT:text',
  ].join('\n'))
  eq('자리가 모자라면 기록 없음 한 줄만', kbdTraceTable({ at: AT, rows: [REP_PAN] }, 30), '키보드 세션 기록 없음')
  eq('그것도 못 들어가면 빈 문자열(기록 없음)', kbdTraceTable({ at: AT, rows: [REP_PAN] }, 5), '')
}
eq('기록이 없으면 그렇다고 적는다(기능이 없던 신고와 가른다)', kbdTraceTable({ at: AT, rows: [] }), '키보드 세션 기록 없음')
eq('얼린 적이 없으면 빈 문자열', kbdTraceTable(null), '')

// 기록 — 브라우저 밖에서는 아무것도 안 하고, 브라우저에서는 값만 담고 최근 CAP 건만 남긴다.
{
  kbdTrace('vr', 'open')
  eq('브라우저 밖에서는 기록하지 않는다', kbdTraceFreeze().rows.length, 0)

  const g = globalThis as unknown as Record<string, unknown>
  const vv = { height: 416, offsetTop: 189.66, scale: 1 }
  const attrs = new Set<string>(['data-kbd-open'])
  // 열린 모달 오버레이 — fixed inset-0 라 폭이 innerWidth 와 같다. 팬 중 자리는 이 계측이 가르려는 값이다.
  let overlay: { width: number; height: number; top: number } | null = { width: 402, height: 812, top: -189.66 }
  const reads: string[] = []
  g.window = { innerHeight: 622, innerWidth: 402, visualViewport: vv }
  g.document = {
    documentElement: { hasAttribute: (n: string) => attrs.has(n), style: { getPropertyValue: () => ' 16px ' } },
    activeElement: { tagName: 'TEXTAREA', type: 'textarea', value: '입주자 이름 010-0000-0000' },
    scrollingElement: { scrollTop: 37 },
    querySelector: (sel: string) => { reads.push(sel); return overlay ? { getBoundingClientRect: () => overlay } : null },
  }
  kbdTrace('vs', 'open')
  const one = kbdTraceFreeze()
  const r = one.rows[0]
  eq('지금 값을 읽어 적는다', [r.ev, r.verdict, r.inner, r.vvh, r.top, r.open, r.inset, r.focus].join(' '),
    'vs open 622 416 189.66 true 16px TEXTAREA')
  eq('팬하는 동안 열린 모달 오버레이의 H·T0 와 문서 sy 를 적는다', [r.H, r.T0, r.sy].join(' '), '812 -189.66 37')
  eq('오버레이는 계측 손잡이로만 찾는다', reads[0], '[data-modal-overlay]')
  eq('얼리는 순간을 rep 한 줄로 남긴다', one.rows[one.rows.length - 1].ev, 'rep')
  // 입력값 글자로 본다. 숫자 '010' 만 찾으면 t·at(performance.now() 소수)에 우연히 섞여 부하 때 흔들렸다.
  eq('기록에 입력값이 안 실린다', ['입주자 이름', '010-0000-0000'].some(v => JSON.stringify(one).includes(v)), false)

  // transform 조상 아래 선 오버레이는 그 조상 기준으로 틀어진다. 폭이 innerWidth 와 다르면 안 믿는다.
  overlay = { width: 360, height: 500, top: 40 }
  kbdTrace('vs', 'open')
  const skew = kbdTraceFreeze().rows.at(-2)
  eq('폭이 innerWidth 와 다른 오버레이는 H·T0 를 비운다', `${skew?.H} ${skew?.T0} ${skew?.sy}`, 'null null 37')

  // 모달이 없으면(셸 폼) 비고, 그 몫은 누른 순간 잰 센티널이 rep 줄에서 진다.
  overlay = null
  kbdTrace('vs', 'open')
  const shell = kbdTraceFreeze({ height: 812, top: -120 })
  eq('모달이 없으면 H·T0 가 빈다', `${shell.rows.at(-2)?.H} ${shell.rows.at(-2)?.T0}`, 'null null')
  eq('누른 순간 잰 센티널을 rep 줄에 싣는다', `${shell.rows.at(-1)?.ev} ${shell.rows.at(-1)?.H} ${shell.rows.at(-1)?.T0}`, 'rep 812 -120')

  // 화면 방식 한 줄(2026-10-20, 신고 be5316e8). 홈화면 앱과 사파리 탭을 가른다. 제목 바로 아래 선다.
  {
    const w = g.window as Record<string, unknown>
    w.matchMedia = (q: string) => ({ matches: q === '(display-mode: standalone)' })
    const fz = kbdTraceFreeze()
    eq('얼릴 때 화면 방식을 함께 담는다', fz.mode?.startsWith('display-mode=standalone navigator.standalone='), true)
    eq('표 제목 바로 아래 화면 방식 줄이 선다', kbdTraceTable(fz).split('\n')[1], fz.mode)
    w.matchMedia = () => ({ matches: false })
    eq('브라우저 탭이면 browser', kbdTraceFreeze().mode?.startsWith('display-mode=browser '), true)
    w.matchMedia = () => { throw new Error('no mq') }
    eq('못 읽으면 - 로 적고 얼리기는 계속된다', kbdTraceFreeze().mode, 'display-mode=- navigator.standalone=-')
    delete w.matchMedia
    // 덜기에도 안 덜린다. 한도가 빠듯해도 판정이 바뀐 줄과 같이 남는다.
    const tightMode = kbdTraceTable({ ...FROZEN, mode: 'display-mode=standalone navigator.standalone=y' }, 400)
    eq('한도가 빠듯해도 화면 방식 줄은 남는다', tightMode.split('\n')[1], 'display-mode=standalone navigator.standalone=y')
    eq('손으로 만든 표(mode 없음)는 종전 모양 그대로', kbdTraceTable(FROZEN).split('\n')[1], LEGEND.split('\n')[0])
  }

  kbdTrace('vr', 'open', { innerHeight: 812, vvHeight: 300, offsetTop: 0, scale: 1.5 })
  const zoomed = kbdTraceFreeze().rows.find(x => x.vvh === 300)
  eq('가드가 넘긴 스냅샷을 그대로 적고, 줌이면 판정에 +zoom 을 붙인다', `${zoomed?.inner} ${zoomed?.verdict}`, '812 open+zoom')

  for (let i = 0; i < KBD_TRACE_CAP + 15; i++) kbdTrace('vs', 'open')
  const full = kbdTraceFreeze()
  eq('최근 CAP 건만 남긴다', full.rows.length, KBD_TRACE_CAP)
  eq('CAP 은 큰 팬 세션 하나와 그 앞부분이 들어갈 만큼이다(60 이던 때 앞부분이 밀렸다)', KBD_TRACE_CAP >= 300, true)
  kbdTrace('fo', '·')
  eq('얼린 사본은 그 뒤 기록에 안 흔들린다', full.rows.length, KBD_TRACE_CAP)

  // 큰 팬 세 번(칸 셋, 프레임 스무 장씩) — 세션 앞부분과 판정이 뒤집힌 줄이 표에 남는다(검수 모의 flood).
  overlay = { width: 402, height: 812, top: 0 }
  const st = { inner: 812 }
  g.window = { get innerHeight() { return st.inner }, innerWidth: 402, visualViewport: vv }
  vv.height = 812; vv.offsetTop = 0
  // 열린 모달 오버레이는 패널 모형대로 팬을 따라간다(H 그대로, T0 = -offsetTop). 그래야 묶음이 접힌다.
  overlay = { width: 402, height: 812, top: 0 }
  kbdTrace('fi', 'shut'); vv.height = 416; kbdTrace('vr', 'open')
  for (let hop = 0; hop < 3; hop++) {
    if (hop) { kbdTrace('fo', '·'); kbdTrace('fi', 'open') }
    for (let i = 1; i <= 20; i++) {
      vv.offsetTop = 17 * i; st.inner = 812 - vv.offsetTop
      overlay = { width: 402, height: 812, top: -vv.offsetTop }
      kbdTrace('vs', st.inner - 416 > 60 ? 'open' : 'shut')
    }
  }
  // 이 세션은 67건(fi·vr open, 팬 3×20, 칸 이동 fo·fi 두 번, rep)이다. 60 이던 상한이면 앞 일곱 건이 밀렸다.
  const frozenFlood = kbdTraceFreeze()
  eq('큰 팬 세션 첫 줄이 링버퍼에 남는다', frozenFlood.rows.at(-67)?.ev, 'fi')
  const flood = kbdTraceTable({ at: frozenFlood.at, rows: frozenFlood.rows.slice(-67) }, 2400)
  const fl = flood.split('\n').filter(l => /^-?\d/.test(l))
  eq('큰 팬 뒤에도 세션 첫 fi·vr open 이 남는다', fl.slice(0, 2).map(l => l.split(/\s+/).slice(1, 4).join(':')).join(' '), 'fi:shut:812 vr:open:812')
  eq('판정이 뒤집힌 vs shut 이 남는다', fl.some(l => /^-?\d+\s+vs\s+shut\b/.test(l)), true)
  eq('팬 묶음을 접어 한도 안에 든다', flood.length <= 2400 && /팬 \d+건 접음/.test(flood), true)

  // 읽다가 터져도 가드로 새지 않는다.
  g.document = { get documentElement(): never { throw new Error('boom') }, activeElement: null }
  let threw = false
  try { kbdTrace('vr', 'open') } catch { threw = true }
  eq('기록 실패는 호출한 쪽으로 새지 않는다', threw, false)
  delete g.window
  delete g.document
}

console.log(`\n[계측 두 스냅샷] 통과 ${pass}건 / 실패 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
