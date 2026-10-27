// 규격 표기 동치 진리표 — 실행: npx tsx scripts/test-spec-notation.ts
//
// 여기서 고정하는 것(2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계).
//   · 표기만 다른 같은 규격은 같다. '폭 183cm · 두께 1.8T' = '183cm, 1.8T'(원목무늬 장판 카드가 둘로 갈린 사건), 2.1L = 2100ml.
//   · 숫자가 하나라도 다르면 다르다(1.8T 대 2.0T). 부분집합은 같지 않다('폭183cm' 대 '183cm, 1.8T').
//   · 글자 토큰(색상·향)이 다르면 다르다. 매트리스 커버 색상 다섯·주방세제 향은 갈라져야 한다(운영 DB 전수, 오합병 0).
//   · 빈 값끼리는 같다.
import { specNotationKey, sameSpecNotation, specKeyOf, reconcileSpecWithHistory, specNoteText, type SpecHistoryRow } from '../lib/specNotation'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const same = (a: string | null, b: string | null, want: boolean) =>
  eq(`'${a}' ${want ? '=' : '≠'} '${b}'`, sameSpecNotation(a, b), want)

// ── 승인 계획 진리표 ─────────────────────────────────────────────────
same('폭 183cm · 두께 1.8T', '183cm, 1.8T', true)
same('2.1L', '2100ml', true)
same('폭183cm', '183cm, 1.8T', false)
same('2.1L 애플민트향', '2.1L', false)
same('싱글/그레이', '싱글/퍼플', false)
same(null, '', true)
same('1.8T', '2.0T', false)

// ── 표기 흔들림(같아야 한다) ──────────────────────────────────────────
same('183cm,1.8T', '183cm, 1.8T', true)
same('1.8T 183cm', '183cm 1.8T', true)            // 순서
same('폭 183 cm · 두께 1.8 T', '183cm, 1.8T', true) // 숫자와 단위 사이 공백
same('183CM, 1.8t', '183cm, 1.8T', true)           // 대소문자
same('1.83m', '183cm', true)                       // 아는 단위는 접는다
same('2,100ml', '2.1L', true)                      // 천 단위 쉼표
same('1200x600mm', '1200 x 600mm', true)
same('1200×600mm', '1200x600mm', true)
same('싱글 / 그레이', '싱글/그레이', true)
same('(방수) 싱글', '싱글 방수', true)              // 괄호는 구분자
same('  ', null, true)

// ── 다른 물건(갈라져야 한다) ─────────────────────────────────────────
same('40cm', '60cm', false)                        // 고압호스(9/16 운영자 정정)
same('80cm', '42cm', false)                        // 블라인드 (Beige)
same('4.7kg', '9.5kg', false)                      // 세탁세제
same('싱글/그레이', '90x200 / 라이트블루', false)
same('IPS / 100Hz / 화이트 / 60cm', 'IPS / 60Hz / 화이트 / 60cm', false)   // 모르는 단위(Hz)는 글자 그대로
same('2홀 무광 스텐 샤워겸용', '3홀 무광 스텐 샤워겸용', false)
same('XL', 'L', false)                             // 글자 속 x 는 구분자가 아니다
same('1200x600mm', '1200mm x 600mm', false)        // 단위가 붙은 쪽만 양으로 접는다(보수)
same('1.8T', '1.8t 두께', true)                    // 접두어 단독 토큰은 무시
same('50L 화이트 반투명', '50L', false)
same('나비-화이트', '나비-블랙', false)
same('90x90', '90', false)                         // 중복 토큰을 접지 않는다(독립 검수 B3)
same('100cm x 100cm', '100cm', false)
same('1:1', '1', false)
same('90x90', '90 x 90', true)
eq('색상 앞 숫자에 색상 글자를 붙이지 않는다', specNotationKey('90x200 라이트블루'), 'u:200:|u:90:|w:라이트블루')

// ── 키 모양 ─────────────────────────────────────────────────────────
eq('빈 값의 키는 빈 글자', specNotationKey(null), '')
eq('t 는 톤으로 접지 않는다(두께 1.8T)', specNotationKey('1.8T'), 'u:1.8:t')
eq('길이는 mm 로 접는다', specNotationKey('183cm'), 'n:mm:1830')
eq('부피는 ml 로 접는다', specNotationKey('2.1L'), 'n:ml:2100')

// ── 숫자 규격 + 서술 규격(지출 한 행) ─────────────────────────────────
eq('숫자 규격 2.1L 과 2100ml 은 같은 변형', specKeyOf({ specValue: 2.1, specUnit: 'L' }) === specKeyOf({ specValue: 2100, specUnit: 'ml' }), true)
eq('숫자 규격 + 향은 숫자 규격만과 다르다', specKeyOf({ specValue: 2.1, specUnit: 'L', specText: '애플민트향' }) === specKeyOf({ specValue: 2.1, specUnit: 'L' }), false)
eq('규격 없음의 키는 빈 글자', specKeyOf({ specValue: null, specUnit: null, specText: null }), '')
eq('specValue 0 은 규격 없음', specKeyOf({ specValue: 0, specUnit: 'ml' }), '')
eq('문자열 specValue 도 받는다(폼 값)', specKeyOf({ specValue: '183', specUnit: 'cm' }), 'n:mm:1830')

// ── 영수증 인식 규격 맞추기(reconcileSpecWithHistory) ─────────────────
const H = (specText: string | null, count: number, specValue: number | null = null, specUnit: string | null = null): SpecHistoryRow => ({ specValue, specUnit, specText, count })
const floor = [H('폭 183cm · 두께 1.8T', 33), H('183cm, 1.8T', 2)]
{
  const r = reconcileSpecWithHistory({ specText: '183cm, 1.8T' }, floor)
  eq('동치 표기는 그 묶음에서 가장 많이 쓴 표기로 맞춘다', [r.spec.specText, r.note?.kind], ['폭 183cm · 두께 1.8T', 'aligned'])
  eq('맞춘 흔적이 영수증 원문을 쥔다', r.note?.kind === 'aligned' ? r.note.receipt.specText : null, '183cm, 1.8T')
  eq('맞춤 캡션 문장(조사는 값의 받침으로)', r.note ? specNoteText(r.note) : null,
    { text: "영수증 표기 '183cm, 1.8T' 를 지난 기록 표기 '폭 183cm · 두께 1.8T' 로 맞췄습니다", revert: '영수증 표기로 되돌리기' })
}
eq('이미 지난 기록 표기면 흔적 없음', reconcileSpecWithHistory({ specText: '폭 183cm · 두께 1.8T' }, floor).note, null)
{
  const r = reconcileSpecWithHistory({ specText: '183cm, 2.0T' }, floor)
  eq('숫자가 하나라도 다르면 맞추지 않는다', [r.spec.specText, r.note], ['183cm, 2.0T', { kind: 'differs', history: ['폭 183cm · 두께 1.8T'] }])
  eq('다름 캡션은 지난 기록 표기를 말한다', r.note ? specNoteText(r.note).text : '', "이전 표기와 규격이 다릅니다. 지난 기록은 '폭 183cm · 두께 1.8T' 입니다.")
}
eq('지난 기록에 서술 표기가 없으면 아무 말도 안 한다', reconcileSpecWithHistory({ specText: '싱글/그린' }, [H(null, 3)]).note, null)
{
  const r = reconcileSpecWithHistory({}, [H(null, 12), H('750mm', 1)])
  eq('규격 없는 영수증 + 규격 변형 하나 = 채운다(규격 없이 산 기록은 변형으로 안 센다)', [r.spec.specText, r.note?.kind], ['750mm', 'filled'])
  eq('채움 캡션', r.note ? specNoteText(r.note) : null, { text: "영수증에 규격이 없어 지난 기록 규격 '750mm' 로 채웠습니다", revert: '비우기' })
}
{
  // 숫자 규격은 돈의 축(기준수량)이라 조용히 채우지 않고 '채우기' 한 번으로 둔다(독립 검수 권고 2)
  const r = reconcileSpecWithHistory({}, [H(null, 3, 40, '개')])
  eq('숫자 규격 하나는 채우지 않고 제안만(offer)', [r.spec.specValue, r.note?.kind], [undefined, 'offer'])
  eq('제안이 채울 값(값·단위)을 쥔다', r.note?.kind === 'offer' ? [r.note.spec.specValue, r.note.spec.specUnit] : null, ['40', '개'])
  eq('제안 캡션', r.note ? specNoteText(r.note) : null, { text: '영수증에 규격이 없습니다. 지난번 40개', revert: '채우기' })
}
eq('변형이 둘 이상이면 채우지 않고 수만 넘긴다', reconcileSpecWithHistory({}, [H('싱글/그레이', 4), H('싱글/퍼플', 2), H(null, 1)]), { spec: { specValue: undefined, specUnit: undefined, specText: undefined }, note: { kind: 'choose', count: 2 } })
eq('동치 표기 둘은 변형 하나다(채운다)', reconcileSpecWithHistory({}, floor).note?.kind, 'filled')
eq('숫자 규격만 읽힌 품목은 건드리지 않는다', reconcileSpecWithHistory({ specValue: '2.1', specUnit: 'L' }, [H(null, 2, 2100, 'ml')]).note, null)
eq('지난 기록이 없으면 흔적 없음', reconcileSpecWithHistory({ specText: '183cm, 1.8T' }, []).note, null)
eq('받침 있는 표기 뒤 조사', specNoteText({ kind: 'aligned', receipt: { specText: '애플민트향' }, history: '2.1L 애플민트향' }).text,
  "영수증 표기 '애플민트향' 을 지난 기록 표기 '2.1L 애플민트향' 으로 맞췄습니다")

if (fails.length) {
  console.error(`[규격 표기 동치] 통과 ${pass} / 실패 ${fails.length}`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`[규격 표기 동치] 통과 ${pass} / 실패 0`)
