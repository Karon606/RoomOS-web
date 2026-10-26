// 영수증에 보이는 카드 표기를 등록된 카드 계정에 맞추는 정본(지출 등록 폼·홈 찍어올리기 승인이 함께 쓴다)
//
// 왜 정본이 따로 서는가(신고 eee44d8d, 2026-10-26 운영자 승인 a안). 영수증에 '롯데플래티늄'이 찍혀 있었는데
// 등록 카드는 '롯데카드'와 '롯데카드 (아멕스)' 둘이었다. 종전 매칭(양방향 부분 일치)은 어느 쪽도 못 맞혔고,
// 폼은 직전 지출의 카드(lastPayDefaults)를 그대로 둔 채 저장됐다. 카드가 골라져 있어 안내 줄도 숨었다.
//
// 순서는 하나다. 앞 단계가 한 장으로 정하면 거기서 끝나고, 둘 이상이면 그 후보를 이름으로 보인다.
//   ① 끝 4자리. 계정 번호 끝 4자리가 같은 카드가 한 장이면 그 카드다.
//      영수증 끝 4자리와 **다른** 번호가 적힌 계정은 이름이 같아도 후보에서 뺀다(번호가 반대 증거다).
//   ② 카드사(줄기) + 별칭 낱말. 줄기가 같고 낱말(플래티늄·아멕스 등)이 겹치는 카드가 한 장이면 그 카드다.
//   ③ 카드사만. 줄기가 같은 카드가 한 장이면 그 카드다. 둘 이상이면 그 전부가 후보다.
//   ④ 카드사를 못 알아본 표기만 종전처럼 글자를 양방향으로 대 본다(두 글자부터). '카드'·'체크' 같은 뜻 없는 낱말은 빼고 댄다.
// 카드사도 별칭도 없는 일반 표기('신용카드'·'체크카드'·'IC카드'·'현금'·'삼성페이'·'카카오페이')는 카드 정보가 없는 것으로 본다('none').
// 그런 영수증에서 직전 카드를 비우면 맞는 카드를 지우게 된다(독립 검수 2026-10-26).
// 못 맞히면 '조용히 버리지 않는다'(신고 73c18e13) 원칙 그대로 화면이 표기와 후보를 말한다.

export type CardAccountLike = {
  id: string
  type: string            // 'CREDIT_CARD' | 'DEBIT_CARD'
  brand: string
  alias: string | null
  identifier?: string | null   // 카드 번호(마스킹 가능). 끝 4자리만 쓴다.
}

export type ReceiptCard = { cardName?: string | null; cardLast4?: string | null }

export type CardMatch<A extends CardAccountLike> =
  | { kind: 'none' }                                  // 영수증에 카드 정보가 없다
  | { kind: 'matched'; account: A }
  | { kind: 'ambiguous'; candidates: A[] }            // 후보 둘 이상
  | { kind: 'unmatched' }                             // 카드 정보는 있는데 맞는 계정이 없다

/** 계정 표시명. 별칭이 있으면 '브랜드 (별칭)'. 지출 폼의 accName 과 같은 식이다. */
export function cardDisplayName(a: { brand: string; alias: string | null }): string {
  return a.alias ? `${a.brand} (${a.alias})` : a.brand
}

/** 카드 계정의 결제수단. */
export function cardPayMethod(a: { type: string }): '신용카드' | '체크카드' {
  return a.type === 'CREDIT_CARD' ? '신용카드' : '체크카드'
}

// 카드사 줄기. 왼쪽이 정본, 오른쪽이 같은 회사로 읽는 표기다. 한글은 낱말 앞머리로도 떼어 낸다('롯데플래티늄').
const ISSUERS: [string, string[]][] = [
  ['롯데', ['롯데', 'lotte']],
  ['현대', ['현대', 'hyundai']],
  ['삼성', ['삼성', 'samsung']],
  ['신한', ['신한', 'shinhan']],
  ['국민', ['국민', 'kb']],
  ['우리', ['우리', 'woori']],
  ['하나', ['하나', '외환', 'hana']],
  ['농협', ['농협', 'nh']],
  ['비씨', ['비씨', 'bc']],
  ['씨티', ['씨티', 'citi']],
  ['카카오', ['카카오뱅크', '카카오', 'kakao', 'kakaobank']],
  ['토스', ['토스', 'toss']],
  ['기업', ['기업', 'ibk']],
  ['케이뱅크', ['케이뱅크', 'kbank']],
  ['수협', ['수협']],
  ['광주', ['광주']],
  ['전북', ['전북']],
  ['경남', ['경남']],
  ['부산', ['부산', 'bnk']],
  ['대구', ['대구', 'dgb', '아이엠']],
  ['제주', ['제주']],
  ['우체국', ['우체국']],
  ['새마을', ['새마을', 'mg']],
  ['신협', ['신협']],
]
const ISSUER_OF = new Map<string, string>(ISSUERS.flatMap(([canon, vs]) => vs.map(v => [v, canon] as [string, string])))
// 한글 앞머리 떼기는 긴 표기부터(카카오뱅크가 카카오보다 먼저).
const KO_PREFIXES = [...ISSUER_OF.keys()].filter(v => /^[가-힣]/.test(v)).sort((a, b) => b.length - a.length)

// 같은 뜻의 별칭 낱말. 영수증과 계정이 서로 다른 표기를 써도 같은 낱말로 센다.
const TOKEN_ALIASES: Record<string, string> = {
  amex: 'amex', 아멕스: 'amex', americanexpress: 'amex', 아메리칸익스프레스: 'amex', 아메리칸: 'amex',
  platinum: 'platinum', 플래티늄: 'platinum', 플래티넘: 'platinum', 플레티늄: 'platinum',
  visa: 'visa', 비자: 'visa',
  master: 'master', mastercard: 'master', 마스터: 'master', 마스터카드: 'master',
}
// 뜻이 없는 낱말. 카드 종류·명의를 말할 뿐 어느 카드인지는 안 가른다.
const GENERIC = new Set(['카드', 'card', '체크', 'check', '신용', 'credit', '법인', '개인', '본인', '가족', '일시불', '할부', '승인', '결제',
  'ic', '현금', '현금영수증', '간편결제', '모바일', '국내', '해외', '거래', '매출'])
// 간편결제 앱 이름('삼성페이'·'카카오페이'·'네이버페이'·'payco')은 카드사가 아니다. 카드사 앞머리 떼기 전에 통째로 버린다.
const PAY_APP = /(페이|pay|페이코|payco)$/

type Parsed = { stem: string | null; tokens: Set<string>; flat: string }

function parse(text: string): Parsed {
  const lowered = text.toLowerCase()
    .replace(/[()[\]{}.,·/\\|_*#:-]+/g, ' ')
    .replace(/([가-힣])([a-z0-9])/g, '$1 $2')
    .replace(/([a-z0-9])([가-힣])/g, '$1 $2')
  const words: string[] = []
  for (let w of lowered.split(/\s+/).filter(Boolean)) {
    if (PAY_APP.test(w)) continue
    // '롯데플래티늄카드' 처럼 붙은 한글은 카드사 앞머리와 '카드' 꼬리를 떼어 낸다.
    if (/^[가-힣]/.test(w)) {
      const p = KO_PREFIXES.find(v => w.startsWith(v) && w.length > v.length)
      if (p) { words.push(p); w = w.slice(p.length) }
      if (w.length > 2 && w.endsWith('카드') && !(w in TOKEN_ALIASES)) w = w.slice(0, -2)
    }
    words.push(w)
  }
  let stem: string | null = null
  const tokens = new Set<string>()
  const kept: string[] = []   // 뜻 있는 낱말만(④ 글자 대조용). '카드' 같은 일반 낱말이 아무 계정에나 걸리지 않게.
  for (const w of words) {
    const issuer = ISSUER_OF.get(w)
    if (issuer) { if (!stem) stem = issuer; kept.push(w); continue }
    if (GENERIC.has(w) || /^\d+$/.test(w) || w.length < 2 && !TOKEN_ALIASES[w]) continue
    tokens.add(TOKEN_ALIASES[w] ?? w)
    kept.push(w)
  }
  return { stem, tokens, flat: kept.join('') }
}

const last4Of = (identifier: string | null | undefined): string | null => {
  const d = (identifier ?? '').replace(/\D/g, '')
  return d.length >= 4 ? d.slice(-4) : null
}

/** 이름 단계(②③④). 후보 한 장이면 matched, 둘 이상이면 ambiguous, 없으면 unmatched. */
function matchByName<A extends CardAccountLike>(receipt: Parsed, pool: A[]): CardMatch<A> {
  if (pool.length === 0) return { kind: 'unmatched' }
  const parsed = pool.map(a => ({ a, p: parse(`${a.brand} ${a.alias ?? ''}`) }))
  const pick = (list: A[]): CardMatch<A> =>
    list.length === 1 ? { kind: 'matched', account: list[0] }
      : list.length > 1 ? { kind: 'ambiguous', candidates: list }
      : { kind: 'unmatched' }
  if (receipt.stem) {
    const sameStem = parsed.filter(x => x.p.stem === receipt.stem)
    if (sameStem.length === 0) return { kind: 'unmatched' }
    // ② 줄기 + 낱말. 겹치는 낱말이 가장 많은 카드들.
    if (receipt.tokens.size > 0) {
      const scored = sameStem.map(x => ({ ...x, n: [...receipt.tokens].filter(t => x.p.tokens.has(t)).length }))
      const best = Math.max(...scored.map(s => s.n))
      if (best > 0) return pick(scored.filter(s => s.n === best).map(s => s.a))
    }
    // ③ 줄기만.
    return pick(sameStem.map(x => x.a))
  }
  // ④ 카드사를 못 알아본 표기. 낱말이 겹치거나 뜻 있는 글자가 서로를 품으면(두 글자부터) 후보다.
  const f = receipt.flat
  if (!f) return { kind: 'unmatched' }
  return pick(parsed.filter(({ p }) =>
    [...receipt.tokens].some(t => p.tokens.has(t))
    || (!!p.flat && (p.flat === f || (p.flat.length >= 2 && f.includes(p.flat)) || (f.length >= 2 && p.flat.includes(f)))),
  ).map(x => x.a))
}

/** 영수증 카드 표기를 등록 카드 계정에 맞춘다. 계정은 카드형(신용·체크)만 넘긴다. */
export function matchReceiptCard<A extends CardAccountLike>(receipt: ReceiptCard, accounts: A[]): CardMatch<A> {
  const parsedName = parse((receipt.cardName ?? '').trim())
  // 카드사도 뜻 있는 낱말도 없는 표기는 이름이 없는 것과 같다(일반 표기, 간편결제 앱 이름).
  const name = parsedName.flat ? (receipt.cardName ?? '').trim() : ''
  const l4 = /^\d{4}$/.test((receipt.cardLast4 ?? '').trim()) ? (receipt.cardLast4 ?? '').trim() : null
  if (!name && !l4) return { kind: 'none' }
  if (l4) {
    const byL4 = accounts.filter(a => last4Of(a.identifier) === l4)
    if (byL4.length === 1) return { kind: 'matched', account: byL4[0] }
    if (byL4.length > 1) {
      const narrowed = name ? matchByName(parsedName, byL4) : { kind: 'unmatched' as const }
      return narrowed.kind === 'matched' || narrowed.kind === 'ambiguous' ? narrowed : { kind: 'ambiguous', candidates: byL4 }
    }
    // 번호가 같은 계정이 없으면 이름으로 간다. 다른 번호가 적힌 계정은 뺀다.
    if (!name) return { kind: 'unmatched' }
    return matchByName(parsedName, accounts.filter(a => last4Of(a.identifier) == null))
  }
  return matchByName(parsedName, accounts)
}
