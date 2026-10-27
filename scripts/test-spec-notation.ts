// 규격 표기 동치 진리표 — 실행: npx tsx scripts/test-spec-notation.ts
//
// 여기서 고정하는 것(2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계).
//   · 표기만 다른 같은 규격은 같다. '폭 183cm · 두께 1.8T' = '183cm, 1.8T'(원목무늬 장판 카드가 둘로 갈린 사건), 2.1L = 2100ml.
//   · 숫자가 하나라도 다르면 다르다(1.8T 대 2.0T). 부분집합은 같지 않다('폭183cm' 대 '183cm, 1.8T').
//   · 글자 토큰(색상·향)이 다르면 다르다. 매트리스 커버 색상 다섯·주방세제 향은 갈라져야 한다(운영 DB 전수, 오합병 0).
//   · 빈 값끼리는 같다.
import { specNotationKey, sameSpecNotation, specKeyOf } from '../lib/specNotation'

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

if (fails.length) {
  console.error(`[규격 표기 동치] 통과 ${pass} / 실패 ${fails.length}`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`[규격 표기 동치] 통과 ${pass} / 실패 0`)
