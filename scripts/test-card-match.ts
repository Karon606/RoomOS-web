// 영수증 카드 매칭 정본(lib/cardMatch) 진리표 회귀. 실행: npx tsx scripts/test-card-match.ts
//
// 고정하는 것(신고 eee44d8d, 2026-10-26 승인 a안). 끝 4자리 > 카드사 + 별칭 낱말 > 카드사만 순서로 한 장을 정하고,
// 둘 이상이면 후보를 돌려준다(폼이 이름을 보인다). 영수증에 카드 정보가 없으면 'none'(폼은 직전 카드를 지킨다).
import { matchReceiptCard, cardDisplayName, type CardAccountLike } from '../lib/cardMatch'

let pass = 0, fail = 0
const acc = (id: string, brand: string, alias: string | null = null, identifier: string | null = null, type = 'CREDIT_CARD'): CardAccountLike =>
  ({ id, type, brand, alias, identifier })

const show = (m: ReturnType<typeof matchReceiptCard>) =>
  m.kind === 'matched' ? `matched:${m.account.id}`
    : m.kind === 'ambiguous' ? `ambiguous:${m.candidates.map(c => c.id).sort().join(',')}`
    : m.kind

const eq = (name: string, got: string, want: string) => {
  if (got === want) { pass++; return }
  fail++; console.log(`  실패 ${name}\n    기대 ${want}\n    실제 ${got}`)
}

const lotte = acc('lotte', '롯데카드')
const lotteAmex = acc('lotteAmex', '롯데카드', '아멕스')
const lottePlat = acc('lottePlat', '롯데카드', '플래티늄')
const hyundai = acc('hyundai', '현대카드 M2', null, '5555-****-****-1234')
const shinhanChk = acc('shinhanChk', '신한카드', '체크', null, 'DEBIT_CARD')
const kb = acc('kb', 'KB국민카드')

const T: [string, Parameters<typeof matchReceiptCard>[0], CardAccountLike[], string][] = [
  // 정보 없음
  ['카드 정보가 없으면 none', {}, [lotte], 'none'],
  ['빈 글자와 형식 아닌 끝자리도 none', { cardName: '  ', cardLast4: '12' }, [lotte], 'none'],
  // ① 끝 4자리
  ['끝 4자리가 한 장이면 그 카드', { cardLast4: '1234' }, [lotte, hyundai], 'matched:hyundai'],
  ['끝 4자리가 이름보다 앞선다', { cardName: '롯데카드', cardLast4: '1234' }, [lotte, hyundai], 'matched:hyundai'],
  ['끝 4자리가 둘이면 이름으로 좁힌다', { cardName: '롯데 아멕스', cardLast4: '9999' },
    [acc('a', '롯데카드', null, '9999'), acc('b', '롯데카드', '아멕스', '****9999')], 'matched:b'],
  ['끝 4자리 둘에 이름이 못 좁히면 둘 다 후보', { cardLast4: '9999' },
    [acc('a', '롯데카드', null, '9999'), acc('b', '현대카드', null, '9999')], 'ambiguous:a,b'],
  ['다른 번호가 적힌 계정은 이름이 같아도 뺀다', { cardName: '현대카드', cardLast4: '0000' }, [hyundai], 'unmatched'],
  ['번호 없는 계정은 이름으로 간다', { cardName: '롯데카드', cardLast4: '0000' }, [lotte, hyundai], 'matched:lotte'],
  ['끝 4자리만 있고 아무도 안 맞으면 unmatched', { cardLast4: '0000' }, [lotte], 'unmatched'],
  // ② 카드사 + 별칭 낱말 (신고 원형)
  ['롯데플래티늄은 플래티늄 별칭 카드', { cardName: '롯데플래티늄' }, [lotte, lotteAmex, lottePlat], 'matched:lottePlat'],
  ['AMEX 표기는 아멕스 별칭과 같다', { cardName: 'LOTTE AMEX' }, [lotte, lotteAmex], 'matched:lotteAmex'],
  ['아메리칸익스프레스도 아멕스', { cardName: '롯데 아메리칸익스프레스' }, [lotte, lotteAmex], 'matched:lotteAmex'],
  ['플래티넘 표기 흔들림도 같은 낱말', { cardName: '롯데 플래티넘' }, [lotte, lottePlat], 'matched:lottePlat'],
  // ③ 카드사만
  ['신고 원형: 롯데플래티늄인데 롯데 둘(별칭이 안 겹침)이면 후보 둘', { cardName: '롯데플래티늄' }, [lotte, lotteAmex], 'ambiguous:lotte,lotteAmex'],
  ['롯데 한 장이면 그 카드', { cardName: '롯데플래티늄' }, [lotte, hyundai], 'matched:lotte'],
  ['롯데카드 표기로 롯데 둘이면 후보 둘', { cardName: '롯데카드' }, [lotte, lotteAmex, hyundai], 'ambiguous:lotte,lotteAmex'],
  ['현대카드 표기로 M2 계정', { cardName: '현대카드' }, [lotte, hyundai], 'matched:hyundai'],
  ['KB국민 표기 흔들림', { cardName: '국민카드' }, [kb, lotte], 'matched:kb'],
  ['KB 영문만', { cardName: 'KB Card' }, [kb, lotte], 'matched:kb'],
  ['신한체크(체크는 뜻 없는 낱말)', { cardName: '신한체크' }, [shinhanChk, lotte], 'matched:shinhanChk'],
  ['카드사가 아무와도 안 맞으면 unmatched', { cardName: '삼성카드' }, [lotte, hyundai], 'unmatched'],
  ['등록 카드가 없으면 unmatched', { cardName: '롯데카드' }, [], 'unmatched'],
  // ④ 카드사를 못 알아본 표기
  ['모르는 카드사는 글자 전체로(한 장)', { cardName: '하이브리드' }, [acc('hy', '하이브리드카드'), lotte], 'matched:hy'],
  ['한 글자 표기는 정보가 아니다(아무 데나 안 붙는다)', { cardName: 'x' }, [acc('x1', 'XX카드')], 'none'],
  // 일반 표기는 카드 정보가 없는 것이다(독립 검수 2026-10-26). 'none' 이면 폼은 직전 카드를 지킨다.
  ['신용카드는 정보 없음', { cardName: '신용카드' }, [lotte, hyundai], 'none'],
  ['체크카드는 정보 없음', { cardName: '체크카드' }, [shinhanChk], 'none'],
  ['IC카드는 정보 없음', { cardName: 'IC카드' }, [lotte], 'none'],
  ['현금은 정보 없음', { cardName: '현금' }, [lotte], 'none'],
  ['삼성페이는 삼성카드가 아니다(정보 없음)', { cardName: '삼성페이' }, [acc('ss', '삼성카드'), lotte], 'none'],
  ['카카오페이는 정보 없음', { cardName: '카카오페이' }, [acc('kk', '카카오뱅크 체크', null, null, 'DEBIT_CARD')], 'none'],
  ['신용카드 표기 + 끝 4자리는 번호로 간다', { cardName: '신용카드', cardLast4: '1234' }, [lotte, hyundai], 'matched:hyundai'],
  ["'카드' 낱말만으로 아무 계정에나 붙지 않는다", { cardName: '법인카드' }, [acc('u1', '하이브리드카드')], 'none'],
  ["모르는 카드사 대조에서 '카드' 꼬리는 빼고 댄다", { cardName: '하이브리드 카드' }, [acc('hy', '하이브리드카드'), acc('u2', '다른카드')], 'matched:hy'],
]

for (const [name, receipt, accounts, want] of T) eq(name, show(matchReceiptCard(receipt, accounts)), want)

eq('표시명 별칭', cardDisplayName(lotteAmex), '롯데카드 (아멕스)')
eq('표시명 별칭 없음', cardDisplayName(lotte), '롯데카드')

console.log(`[영수증 카드 매칭] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
