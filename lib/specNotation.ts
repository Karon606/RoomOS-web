// 규격 표기 동치 판정 정본 — '폭 183cm · 두께 1.8T' 와 '183cm, 1.8T' 처럼 표기만 다른 같은 규격을 한 키로 접는다.
//
// 왜 있나(2026-10-27 운영자 승인, 영수증 규격 표기 기억). 비품 미배정 창고에 같은 '원목무늬 장판' 이 카드 둘로 섰다.
// 비품 카드 묶음 키(inventory/assets/aggregate)에 서술 규격(specText) 글자가 그대로 들어가는데, 5~8월에 적은 표기는
// '폭 183cm · 두께 1.8T' 이고 10-20 영수증 자동 읽기가 넣은 표기는 '183cm, 1.8T' 였다. 사람 눈에는 같은 장판이다.
// 영수증 경로가 AI 글자를 그대로 저장했고, 지난 기록 표기를 기억하는 장치가 품명(별칭)에만 있었다.
//
// 규칙(운영 DB 전수 22품명 재생에서 오합병 0, 설계 책임자 실측).
//   · 숫자+단위 토큰은 같은 양이면 같다. 아는 단위는 기준 단위로 접는다(lib/units convertUnit, 2.1L = 2100ml, 183cm = 1830mm).
//     모르는 단위(T·A·Hz·홀 등)는 글자 그대로 비교한다. 't' 는 lib/units 에서 톤이지만 규격 칸의 T 는 두께 표기라 접지 않는다.
//   · 글자 토큰(색상·향·재질 등)은 집합이 같아야 같다. '싱글/그레이' 와 '싱글/퍼플' 은 다르고, '2.1L 애플민트향' 과 '2.1L' 도 다르다.
//   · 공백·구분자(· , / x × : 괄호)와 접두어(폭·두께·길이)는 무시한다. 같은 토큰이 몇 번 나오는지는 센다(90x90 ≠ 90). '폭183cm' 는 {183cm} 이라 '183cm, 1.8T' 와 다르다(부분집합은 같지 않다).
//   · 빈 값(null·'')끼리는 같다.
// 시스템은 구분의 종류(용량·색·향)를 해석하지 않는다(knowledge/domain-inventory). 여기서 하는 일은 '같은 글을 다르게 적었나' 뿐이다.
// 수량 단위(qtyUnit)는 건드리지 않는다.
import { canonicalUnit, convertUnit } from './units'

// 차원별 기준 단위 — lib/units UNIT_DIMS 의 배율 1 단위와 같다.
const BASE_UNITS = ['ml', 'g', 'mm'] as const
// 규격 칸에서 접두어로만 쓰이는 말. 뒤에 숫자가 붙어 있어도('폭183cm') 뗀다.
const PREFIXES = ['두께', '길이', '폭']

function numText(v: number): string {
  return String(Number(v.toFixed(6)))
}

// 토큰 하나 → 비교 키. 숫자+단위면 양으로, 아니면 글자 그대로(소문자).
function tokenKey(raw: string): string | null {
  let t = raw.trim().toLowerCase()
  if (!t) return null
  for (const p of PREFIXES) {
    if (t === p) return null
    if (t.startsWith(p) && /^\d/.test(t.slice(p.length))) { t = t.slice(p.length); break }
  }
  const m = t.match(/^(\d+(?:\.\d+)?)(.*)$/)
  if (!m) return `w:${t}`
  const value = parseFloat(m[1])
  const unit = m[2].trim()
  if (!unit) return `u:${numText(value)}:`
  // 't' 는 톤이 아니라 두께 표기(1.8T)다. 접지 않는다.
  if (unit !== 't') {
    const canon = canonicalUnit(unit)
    for (const base of BASE_UNITS) {
      const v = convertUnit(value, canon, base)
      if (v != null) return `n:${base}:${numText(v)}`
    }
  }
  return `u:${numText(value)}:${unit}`
}

/** 규격 표기의 비교 키. 같은 키 = 표기만 다른 같은 규격. 빈 값은 ''. */
export function specNotationKey(text: string | null | undefined): string {
  if (text == null) return ''
  let s = text.normalize('NFKC')
  // 천 단위 쉼표(2,100ml)는 구분자가 아니다.
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  // 곱셈 x 는 숫자 사이이거나 띄어 쓴 경우만 구분자다(XL 같은 글자 속 x 는 그대로).
  s = s.replace(/(\d)\s*[xX*]\s*(?=\d)/g, '$1 ')
  s = s.replace(/(^|\s)[xX*](?=\s|$)/g, '$1 ')
  s = s.replace(/×/g, ' ')
  // 숫자와 단위 사이 공백('183 cm', '1.8 T')은 붙인다. 단위로 아는 말(접히는 단위, 두께 T)일 때만이다.
  // 아무 말에나 붙이면 '90x200 라이트블루' 가 '200라이트블루' 가 된다.
  s = s.replace(/(\d)\s+([a-zA-Z가-힣"″]+)(?=$|[\s·•,/|:;()[\]{}])/g, (m, d: string, w: string) =>
    /^t$/i.test(w) || BASE_UNITS.some(b => convertUnit(1, canonicalUnit(w), b) != null) ? d + w : m)
  const tokens = s.split(/[\s·•,/|:;()[\]{}]+/).map(tokenKey).filter((k): k is string => !!k)
  // 중복을 접지 않는다(독립 검수 B3). 접으면 '90x90' 이 '90', '100cm x 100cm' 이 '100cm' 과 같아진다.
  return tokens.sort().join('|')
}

/** 두 규격 표기가 같은 규격인가(표기만 다른가 포함). */
export function sameSpecNotation(a: string | null | undefined, b: string | null | undefined): boolean {
  return specNotationKey(a) === specNotationKey(b)
}

/** 지출 한 행의 규격 세 칸(숫자 규격 + 서술 규격)을 한 키로. 지난 기록 변형 목록의 묶음 키다. */
export function specKeyOf(s: { specValue?: number | string | null; specUnit?: string | null; specText?: string | null }): string {
  const v = s.specValue == null || s.specValue === '' ? null : Number(s.specValue)
  const num = v != null && Number.isFinite(v) && v > 0 ? `${numText(v)}${(s.specUnit ?? '').trim()}` : ''
  return specNotationKey([num, s.specText ?? ''].filter(Boolean).join(' '))
}
