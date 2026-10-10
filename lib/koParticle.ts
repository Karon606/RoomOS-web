// 한국어 조사 정본 — 보간한 값의 받침을 보고 '이/가'·'을/를'·'은/는'·'과/와'·'으로/로' 를 고른다.
//
// 왜 정본이 필요한가. 화면 문장이 값을 끼워 넣고 그 뒤에 조사를 손으로 박으면, 값이 바뀌는
// 순간 틀린 말이 나간다 — '보증금 영수증를'·'350,000원로'가 이미 화면에 서 있었고, 호실명이
// 숫자가 아니면 '사무실는'이 나갈 자리도 여럿이었다(2026-10-10 전수 조사).
// 호실명·단위·서류 이름은 영업장마다 자유 입력이라 "다 숫자다",
// "다 받침이 없다"는 근거가 못 된다(멀티테넌트 전제).
//
// 판정은 마지막 글자 하나다.
//   한글 음절 — 종성 유무. '으로/로' 만 ㄹ 받침(종성 8)을 받침 없음 쪽으로 본다.
//   숫자      — 읽는 소리. 영·일·삼·육·칠·팔(0·1·3·6·7·8)은 받침이 있고 이·사·오·구는 없다.
//               '으로/로' 는 일·칠·팔이 ㄹ 이라 '로', 영·삼·육만 '으로'(lib/roomNo roomNoWithRo 와 같다).
//   그 밖     — 영문·기호·빈 문자열은 받침 없음으로 본다(종전 FieldOverrideListModal 폴백과 같다).
//   끝 괄호   — 떼고 괄호 앞 말로 판정한다(judgedWord 주석).
//
// 감지망 scripts/check-korean-particle.mjs 가 `${값}조사` 고정 붙임을 막는다.

export type ParticlePair = '이/가' | '을/를' | '은/는' | '과/와' | '으로/로'

const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
const JONG_RIEUL = 8

/**
 * 판정할 낱말 — 끝 공백과 **끝에 붙은 괄호 한 덩이**를 뗀다.
 *
 * 괄호 뒤 조사는 괄호 앞 말에 맞춘다(한글 맞춤법 관행: '서울(Seoul)은'). 날짜 정본
 * fmtDateKor 가 '2026년 7월 10일 (금)'처럼 요일을 괄호로 달아서, 괄호를 기호로 보면
 * '7월 10일 (금)와'가 된다. 맞는 말은 '일'에 맞춘 '7월 10일 (금)과'다.
 */
function judgedWord(word: string): string {
  return word.trimEnd().replace(/\s*\([^()]*\)$/, '')
}

/**
 * 날짜꼴('10/13'·'2026.10.16'·'2026.10') — 읽으면 '…일'·'…월'로 끝난다(둘 다 ㄹ 받침). 끝 숫자 소리로
 * 판정하면 '10/13으로'·'10/12와' 가 나와 종전 고정 조사('로'·'과')보다 오히려 틀린다(웹디자이너 실측 2026-10-10).
 */
const DATE_LIKE = /^\d{1,4}([./]\d{1,2}){1,2}$/

/** 마지막 글자의 종성 번호 — 한글 음절이 아니면 null. 날짜꼴은 '일'의 종성(ㄹ)으로 본다. */
function lastJong(word: string): number | null {
  const t = judgedWord(word)
  if (!t) return null
  if (DATE_LIKE.test(t)) return JONG_RIEUL
  const c = t.charCodeAt(t.length - 1)
  if (c < HANGUL_FIRST || c > HANGUL_LAST) return null
  return (c - HANGUL_FIRST) % 28
}

/** 마지막 글자가 숫자면 그 숫자 — 아니면 null. */
function lastDigit(word: string): string | null {
  const last = judgedWord(word).slice(-1)
  return /^\d$/.test(last) ? last : null
}

/** 마지막 글자에 받침이 있는가 — 숫자는 읽는 소리로, 영문·기호·빈 문자열은 없는 것으로 본다. */
export function hasFinalConsonant(word: string): boolean {
  const jong = lastJong(word)
  if (jong !== null) return jong !== 0
  const d = lastDigit(word)
  return d !== null && '013678'.includes(d)
}

/** 값 + 조사 한 덩이 — '보증금 영수증을' · '계약서를' · '350,000원으로' · '9월로' · '508호가'. */
export function withParticle(word: string, pair: ParticlePair): string {
  const [withFinal, withoutFinal] = pair.split('/') as [string, string]
  if (pair === '으로/로') {
    const jong = lastJong(word)
    if (jong !== null) return `${word}${jong !== 0 && jong !== JONG_RIEUL ? withFinal : withoutFinal}`
    const d = lastDigit(word)
    return `${word}${d !== null && '036'.includes(d) ? withFinal : withoutFinal}`
  }
  return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`
}
