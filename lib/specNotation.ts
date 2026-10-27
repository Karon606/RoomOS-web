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
import { withParticle, type ParticlePair } from './koParticle'

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

// ── 영수증 인식 규격을 지난 기록에 맞추기(2026-10-27 운영자 승인) ─────────────────────────────
// 영수증 자동 읽기는 AI 가 읽은 글자를 그대로 넣었다. 같은 품명을 예전에 산 적이 있으면 그때 적은 표기를 따른다.
//   · 영수증 서술 규격이 지난 기록 표기와 **동치**면 지난 기록 표기(그 묶음에서 가장 많이 쓴 표기)로 맞춘다(aligned).
//     묻지 않고 맞추되 화면이 그렇다고 말하고 되살리기를 둔다('영수증 표기로 되돌리기').
//   · 숫자가 하나라도 다르면 맞추지 않는다. 지난 기록 서술 표기가 있으면 '이전 표기와 규격이 다릅니다' 만 말한다(differs).
//   · 영수증에 규격이 아예 없고 지난 기록 규격이 **하나뿐**이면 서술 규격은 그것으로 빈 칸을 채운다(filled, 되살리기 '비우기').
//     숫자 규격(40개·750mm)은 단가 기준수량에 들어가는 돈의 축이라 조용히 채우지 않고, 캡션 '지난번 {규격} · 채우기' 로
//     한 번 눌러 채우게 둔다(offer, 독립 검수 권고 2).
//     둘 이상이면 채우지 않고 몇 가지인지만 넘긴다(choose). 규격 없이 산 기록은 변형으로 세지 않는다(없는 정보일 뿐이다).
//   · 숫자 규격만 읽힌 품목은 건드리지 않는다(단가 계산에 들어가는 칸이라 여기서 바꾸지 않는다).
export type SpecFields = { specValue?: string; specUnit?: string; specText?: string }
export type SpecNote =
  | { kind: 'aligned'; receipt: SpecFields; history: string }
  | { kind: 'filled'; receipt: SpecFields; history: string }
  | { kind: 'offer'; spec: SpecFields; history: string }
  | { kind: 'differs'; history: string[] }
  | { kind: 'choose'; count: number }
/** 지난 기록 한 조합(품명 하나 안의 규격 세 칸 + 건수). Expense groupBy 그대로다. */
export type SpecHistoryRow = { specValue: number | null; specUnit: string | null; specText: string | null; count: number }

/** 지난 기록 규격을 사람이 읽는 한 줄로(서술 규격이 있으면 그것, 숫자 규격이면 값+단위, 둘 다면 둘 다). */
export function specDisplay(s: { specValue?: number | string | null; specUnit?: string | null; specText?: string | null }): string {
  const v = s.specValue == null || s.specValue === '' ? null : Number(s.specValue)
  const num = v != null && Number.isFinite(v) && v > 0 ? `${numText(v)}${(s.specUnit ?? '').trim()}` : ''
  return [num, (s.specText ?? '').trim()].filter(Boolean).join(' ')
}

export function reconcileSpecWithHistory(item: SpecFields, history: SpecHistoryRow[]): { spec: SpecFields; note: SpecNote | null } {
  const spec: SpecFields = { specValue: item.specValue, specUnit: item.specUnit, specText: item.specText }
  const text = (item.specText ?? '').trim()
  // 서술 표기 묶음 — 동치 키마다 가장 많이 쓴 표기(같으면 먼저 온 것)
  const byText = new Map<string, { text: string; count: number; total: number }>()
  for (const h of history) {
    const t = (h.specText ?? '').trim()
    if (!t) continue
    const k = specNotationKey(t)
    const cur = byText.get(k)
    if (!cur) byText.set(k, { text: t, count: h.count, total: h.count })
    else { cur.total += h.count; if (h.count > cur.count) { cur.text = t; cur.count = h.count } }
  }
  if (text) {
    const hit = byText.get(specNotationKey(text))
    if (hit) {
      if (hit.text === text) return { spec, note: null }
      return { spec: { ...spec, specText: hit.text }, note: { kind: 'aligned', receipt: { ...spec }, history: hit.text } }
    }
    if (byText.size === 0) return { spec, note: null }
    return { spec, note: { kind: 'differs', history: [...byText.values()].sort((a, b) => b.total - a.total).map(x => x.text) } }
  }
  const hasNum = !!(item.specValue ?? '').trim() && Number(item.specValue) > 0
  if (hasNum) return { spec, note: null }
  // 규격이 아예 없다 — 규격을 가진 지난 기록 변형(동치 키 묶음)을 센다
  const variants = new Map<string, SpecHistoryRow>()
  for (const h of history) {
    const k = specKeyOf(h)
    if (!k) continue
    const cur = variants.get(k)
    if (!cur || h.count > cur.count) variants.set(k, h)
  }
  if (variants.size === 0) return { spec, note: null }
  if (variants.size > 1) return { spec, note: { kind: 'choose', count: variants.size } }
  const v = [...variants.values()][0]
  const numeric = v.specValue != null && v.specValue > 0
  const filled: SpecFields = {
    specValue: v.specValue != null && v.specValue > 0 ? numText(v.specValue) : '',
    specUnit: v.specValue != null && v.specValue > 0 ? (v.specUnit ?? '') : '',
    specText: (v.specText ?? '').trim() || undefined,
  }
  if (numeric) return { spec, note: { kind: 'offer', spec: filled, history: specDisplay(v) } }
  return { spec: filled, note: { kind: 'filled', receipt: { ...spec }, history: specDisplay(v) } }
}

// 따옴표로 감싼 값 뒤 조사만(값의 받침으로 고른다, lib/koParticle).
const josa = (w: string, pair: ParticlePair) => withParticle(w, pair).slice(w.length)

/** 화면에 띄울 캡션 문장(정본 한 벌 — 지출 등록 폼과 홈 영수증 카드가 같은 말을 쓴다). */
export function specNoteText(note: SpecNote): { text: string; revert: string | null } {
  switch (note.kind) {
    case 'aligned': {
      const r = note.receipt.specText ?? ''
      return { text: `영수증 표기 '${r}' ${josa(r, '을/를')} 지난 기록 표기 '${note.history}' ${josa(note.history, '으로/로')} 맞췄습니다`, revert: '영수증 표기로 되돌리기' }
    }
    case 'filled':
      return { text: `영수증에 규격이 없어 지난 기록 규격 '${note.history}' ${josa(note.history, '으로/로')} 채웠습니다`, revert: '비우기' }
    case 'offer':
      return { text: `영수증에 규격이 없습니다. 지난번 ${note.history}`, revert: '채우기' }
    case 'differs':
      return { text: note.history.length === 1 ? `이전 표기와 규격이 다릅니다. 지난 기록은 '${note.history[0]}' 입니다.` : '이전 표기와 규격이 다릅니다.', revert: null }
    case 'choose':
      return { text: `지난 기록 규격이 ${note.count}가지라 채우지 않았습니다.`, revert: null }
  }
}

// ── 저장 때 규격 정체성 판정(2026-10-27 운영자 승인, 4단계) ───────────────────────────────
// 지금 적은 규격이 그 품명의 지난 기록과 어떤 관계인가. 세 갈래 하나로 저장 게이트 둘이 같은 답을 쓴다.
//   'same'          지난 기록 어느 조합과 글자까지 같다.
//   'notation-only' 표기만 다르고 같은 규격이다(2.1L 대 2100ml, '183cm, 1.8T' 대 '폭 183cm · 두께 1.8T').
//   'new'           어느 지난 기록과도 동치가 아니다(색상·치수가 다른 물건일 수 있다).
// 소모품 수량 카드의 크기 게이트(규격을 품명으로 승격)와 비품·자재 서술 규격 게이트(나누기 / 같은 품목)가 이것을 부른다.
type SpecLike = { specValue?: number | string | null; specUnit?: string | null; specText?: string | null }
const rawOf = (s: SpecLike) => {
  const v = s.specValue == null || s.specValue === '' ? null : Number(s.specValue)
  return `${v != null && Number.isFinite(v) && v > 0 ? numText(v) : ''}␟${v != null && v > 0 ? (s.specUnit ?? '').trim() : ''}␟${(s.specText ?? '').trim()}`
}
export function classifySpecChoice(now: SpecLike, history: SpecLike[]): 'same' | 'notation-only' | 'new' {
  const nk = specKeyOf(now)
  const raw = rawOf(now)
  let notation = false
  for (const h of history) {
    if (specKeyOf(h) !== nk) continue
    if (rawOf(h) === raw) return 'same'
    notation = true
  }
  return notation ? 'notation-only' : 'new'
}
