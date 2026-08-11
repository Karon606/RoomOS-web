// 홈 KPI 카드와 수납 관리 캡션이 함께 쓰는 등식 문장 조립 정본 — 항 이름·순서·생략 규칙이 한 곳에 있다
//
// 왜 정본이 필요한가. 두 화면이 각자 문장을 조립하면 값이 같아도 **항 구성**이 갈린다.
// 한쪽만 '퇴실 귀속'을 빼먹거나 한쪽만 '이 달 청구'라 부르면, 운영자는 같은 숫자를 놓고
// 다른 설명을 읽는다. 그것이 신뢰 사고 세 번(7/31·8/07·8/11)의 형태였다.
//
// 값은 여기서 만들지 않는다. 서버가 쓴 값을 받아 이름만 붙인다.
// 항 이름은 전부 **운영자가 확인하러 갈 화면의 라벨과 글자까지 같다**.
//   이 달 청구액 = 수납 관리 스트립 · 기타수익 = 홈 재무 요약 타일
//   기록된 지출 = 결산 보고서 운영이익 정의 · 고정 지출 (예정) = 지출 관리 요약 위젯
import { Fragment } from 'react'
import { fmtWon } from '@/lib/fmtMoney'

/** 등식의 항 하나. op 는 이 항 **앞에** 붙는 연산자다(첫 항은 '=' 뒤라 op 를 안 쓴다). */
export type EquationTerm = { label: string; amount: number; op: '+' | '−' }

/**
 * 예상 수입 = 이 달 청구액 + 예약 확정 + 퇴실 귀속 + 기타수익.
 * 첫 항은 값과 무관하게 항상 선다(그 달 청구가 0원이어도 사실이다).
 * 나머지는 0이면 생략한다 — 0원짜리 항은 등식을 길게만 만든다.
 */
export function expectedRevenueTerms(v: {
  billed: number; reserved: number; checkedOut: number; extra: number
}): EquationTerm[] {
  const terms: EquationTerm[] = [{ label: '이 달 청구액', amount: v.billed, op: '+' }]
  if (v.reserved   !== 0) terms.push({ label: '예약 확정', amount: v.reserved,   op: '+' })
  if (v.checkedOut !== 0) terms.push({ label: '퇴실 귀속', amount: v.checkedOut, op: '+' })
  if (v.extra      !== 0) terms.push({ label: '기타수익',  amount: v.extra,      op: '+' })
  return terms
}

/**
 * 실수납 = 수납 + 퇴실 귀속 + 기타수익.
 * 예약 확정은 아직 받은 돈이 아니라 이 축에 들어오지 않는다(예상 축에만 있다).
 */
export function paidRevenueTerms(v: {
  collected: number; checkedOut: number; extra: number
}): EquationTerm[] {
  const terms: EquationTerm[] = [{ label: '수납', amount: v.collected, op: '+' }]
  if (v.checkedOut !== 0) terms.push({ label: '퇴실 귀속', amount: v.checkedOut, op: '+' })
  if (v.extra      !== 0) terms.push({ label: '기타수익',  amount: v.extra,      op: '+' })
  return terms
}

/**
 * 예상 운영이익 = 예상 수입 − 기록된 지출 − 고정 지출 (예정).
 *
 * `pendingRecurring` 은 부르는 쪽이 **실제로 빠진 금액**(예상 지출 − 기록된 지출)을 넘긴다.
 * 미기록 고정지출 추정치를 그대로 넘기면 안 된다 — 과거월에는 그 추정을 안 빼는데
 * (dashboard/page.tsx 의 isPastMonth 분기) 캡션만 뺀 것처럼 적으면 등식이 거짓이 된다.
 * 뺀 값을 그대로 받으면 과거월엔 저절로 0이 되어 항이 사라진다.
 */
export function operatingProfitTerms(v: {
  projectedRevenue: number; recordedExpense: number; pendingRecurring: number
}): EquationTerm[] {
  const terms: EquationTerm[] = [{ label: '예상 수입', amount: v.projectedRevenue, op: '+' }]
  if (v.recordedExpense  !== 0) terms.push({ label: '기록된 지출',      amount: v.recordedExpense,  op: '−' })
  if (v.pendingRecurring !== 0) terms.push({ label: '고정 지출 (예정)', amount: v.pendingRecurring, op: '−' })
  return terms
}

/**
 * 등식을 적을 만한 달인가 — 차이를 만드는 항이 하나라도 있어야 한다.
 * 전부 0이면 등식이 `= 이 달 청구액 X` 한 줄이 되어 바로 위 큰 숫자를 되풀이할 뿐이다.
 * 두 화면이 같은 술어를 써야 같은 달에 함께 뜨고 함께 사라진다.
 */
export function hasRevenueBridge(v: { reserved: number; checkedOut: number; extra: number }): boolean {
  return v.reserved !== 0 || v.checkedOut !== 0 || v.extra !== 0
}

/**
 * 항 목록을 `= A + B − C` 문장으로 적는다. 좌변(이름과 합계)은 부르는 쪽이 앞에 붙인다.
 * 금액은 fmtWon 전자릿수다 — 축약하면 운영자가 눈으로 검산할 수 없다(§06 축약 금지 구역).
 * 빼기는 U+2212(−), 항 사이는 반각 공백 한 칸이다.
 *
 * 항 하나는 nowrap 원자다. 좁은 카드에서 기본 줄바꿈에 맡기면 '퇴실 / 귀속 1,200,000원' 처럼
 * 라벨이 두 줄로 갈린다(1024px 실측). 연산자와 그 양옆 공백만 span 밖에 두어 거기서 줄이 바뀐다.
 * 최장 항 '고정 지출 (예정) 2,150,000원' 이 126.9px, 가장 좁은 카드 내부폭이 138.5px 라 안 넘친다.
 */
export function MoneyEquation({ terms }: { terms: EquationTerm[] }) {
  return (
    <>
      {terms.map((t, i) => (
        <Fragment key={t.label}>
          {i === 0 ? '= ' : ` ${t.op} `}
          <span className="num" style={{ whiteSpace: 'nowrap' }}>{t.label} {fmtWon(t.amount)}</span>
        </Fragment>
      ))}
    </>
  )
}
