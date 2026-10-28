// 서명 패드 계측 순수층 진리표(신고 c6eb427d) — 한 줄 표기·최근 순·TTL·최대 개수. 실패 시 exit 1.
// 실행: npx tsx scripts/test-sign-pad-trace.ts
import { padTraceLine, padTraceText, pushPadSession, PAD_TRACE_MAX, PAD_TRACE_TTL_MS, type PadSession } from '../lib/signPadTrace'
import { SIGN_LANGS, SIGN_KEYS, t } from '../lib/signGuideText'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++
  else fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const NOW = 1_800_000_000_000
const S = (o: Partial<PadSession> = {}): PadSession => ({
  at: NOW - 3 * 60000, path: 'pointer', vw: 402, vh: 812, padW: 334, padH: 188, zoom: 1,
  strokes: 4, cancels: 2, multiMax: 2, touchDowns: 6, penDowns: 0, mouseDowns: 0, outsideDowns: 1,
  inkPx: 42, rejectsEmpty: 0, rejectsShort: 1, outcome: 'closed', ...o,
})

// ① 한 줄 표기 — 수만 담는다. 순서는 경로·결과 먼저.
eq('① 한 줄', padTraceLine(S(), NOW), '3분 전 pointer 닫음 획4 끊김2 동시2 밖1 t6/p0/m0 잉크42px 거절 빈0 짧1 화면402x812 패드334x188 배율1')
eq('① 확인 통과·touch 경로', padTraceLine(S({ outcome: 'saved', path: 'touch', at: NOW }), NOW).split(' ').slice(0, 4).join(' '), '0분 전 touch 확인')
eq('① 배율 반올림', padTraceLine(S({ zoom: 1.2345 }), NOW).split(' ').pop(), '배율1.23')

// ② 덧붙일 글 — 새 것부터, TTL 밖은 뺀다, 없으면 빈 문자열(신고에 머리를 안 단다).
eq('② 비면 빈 문자열', padTraceText([], NOW), '')
eq('② TTL 밖만 있으면 빈 문자열', padTraceText([S({ at: NOW - PAD_TRACE_TTL_MS - 1 })], NOW), '')
{
  const txt = padTraceText([S({ at: NOW - 10 * 60000, strokes: 1 }), S({ at: NOW - 60000, strokes: 9 })], NOW).split('\n')
  eq('② 새 것이 먼저', txt.map(l => l.split(' ')[0]), ['1분', '10분'])
}

// ③ 최대 개수
{
  let list: PadSession[] = []
  for (let i = 0; i < PAD_TRACE_MAX + 3; i++) list = pushPadSession(list, S({ at: NOW - (100 - i) * 1000, strokes: i }))
  eq('③ 최대 개수만 남는다', list.length, PAD_TRACE_MAX)
  eq('③ 가장 최근이 맨 앞', list[0].strokes, PAD_TRACE_MAX + 2)
}

// ④ 상태 줄 문장 — 8개 언어 전부 있고 금지 부호(em dash·화살표·느낌표)가 없다(가이드 §29).
for (const k of ['pad.stIdle', 'pad.stDrawing', 'pad.stOk', 'pad.stShort'] as const) {
  eq(`④ ${k} 열쇠가 사전에 있다`, SIGN_KEYS.includes(k), true)
  for (const lang of SIGN_LANGS) {
    const v = t(lang, k)
    if (!v || /[—→!！]/.test(v)) fails.push(`④ ${lang} ${k} 가 비었거나 금지 부호가 있다: ${v}`); else pass++
  }
}
eq('④ 한국어 정본 문장', ['pad.stIdle', 'pad.stDrawing', 'pad.stOk', 'pad.stShort'].map(k => t('ko', k as never)),
  ['이 칸에 성함을 써 주세요', '서명 받는 중…', '서명 받음 · 확인을 누르세요', '조금 더 길게 써 주세요'])

console.log(`[서명 패드 계측·상태 줄] 통과 ${pass} / 실패 ${fails.length}`)
for (const f of fails) console.log('  - ' + f)
process.exit(fails.length ? 1 : 0)
