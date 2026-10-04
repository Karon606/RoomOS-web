// 총수납·잔액·이월(다음 달로/지난달 미수) 3카드 — 셸의 수납 면 summary/full 모드 양쪽에서 재사용.
// 데이터는 caller 가 getLeaseSettlementInfo 결과로 직접 넘긴다 (자체 fetch X — 부모에서 일괄 관리).

import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { InfoHint } from '@/components/ui/InfoHint'

type Settlement = {
  totalPaid: number; balance: number; carryOver: number
  // 선납 이월(lib/prepaidCarry) — 미정의는 0 으로 읽는다(예약·퇴실 폴백 등 종전 표시 유지).
  prepaidIn?: number
  prepaidOut?: number
  // 예약(RESERVED) 표시 정본(신고 50a2a69b) — 실수납은 조회월 무관 reservationPaid, 잔액 대신 '입주 시 납부 예정'.
  status?: string | null
  expected?: number
  reservationPaid?: { deposit: number; prepaid: number; cleaning: number } | null
  moveInDate?: string | null
  // 이 달 청구가 없는 사정 — 뱃지만 고치고 여기를 두면 눌러 들어와서 다시 0원 세 개를 만난다(2026-08-02).
  noBillReason?: 'shortTermPrepaid' | 'checkoutNoBilling' | null
  noBillCoveredAmount?: number | null
  noBillCoveredDate?: string | null
  noBillCoveredMonth?: string | null
  expectedMoveOut?: string | null
}

import { fmtWon, fmtNoBillCovered } from '@/lib/fmtMoney'   // v2.0 §06 단일 경로

export function PaymentSummaryCards({ settlement, month }: { settlement: Settlement; month?: string }) {
  // 예약 단계는 청구·잔액이 0으로 잠겨 있어(미납 집계 제외 정본) 실수납·입주 시 낼 금액을 따로 보여준다.
  const resv = settlement.status === 'RESERVED' ? (settlement.reservationPaid ?? null) : null
  // 분해 수납의 청소비 몫도 '받은 돈'이다 — 빼면 5만을 받은 예약이 3만으로 보인다.
  const resvPaid = resv ? resv.deposit + resv.prepaid + resv.cleaning : 0
  const resvDue = resv ? Math.max(0, (settlement.expected ?? 0) - resv.prepaid) : 0
  // 입주월 전 조회 — '이번 달 청구 없음' 맥락(예정액이 이번 달 청구로 오독되지 않게, 운영자 지적 2026-07-30)
  const moveInMonth = settlement.moveInDate ? settlement.moveInDate.slice(0, 7) : null
  const beforeMoveIn = !!(resv && month && moveInMonth && month < moveInMonth)
  // 청구 없는 달 — 단기 선납분이 덮고 있거나(입주월 일괄 수납), 납부일 전 퇴실이라 받을 게 없는 달.
  const noBill = !resv ? (settlement.noBillReason ?? null) : null
  const coveredCaption = noBill
    ? fmtNoBillCovered({ month: settlement.noBillCoveredMonth, date: settlement.noBillCoveredDate, amount: settlement.noBillCoveredAmount })
    : null
  // 뱃지와 같은 해상도로 — '퇴실일까지'가 아니라 '8/2 퇴실까지'. 날짜가 사라지면 같은 사실을 다르게 말한다.
  const noBillWhy = !noBill ? null
    : noBill === 'shortTermPrepaid' ? '입주월에 전액 납부'
    : settlement.expectedMoveOut
      ? `${Number(settlement.expectedMoveOut.slice(5, 7))}/${Number(settlement.expectedMoveOut.slice(8))} 퇴실까지 납부됨`
      : '퇴실일까지 납부됨'

  // 셋째 칸 — 종전 '이월액'(carryOver)은 FIFO 저장이 앞 달을 정확히 채우고 남은 돈을 다음 달 record 로
  // 밀어 두는 한 거의 늘 0 이었다(2026-10-05 502호: 매달 1,500원을 더 내 이월시키는데 0원).
  // 미수가 있으면 그 사실이 먼저다. 아니면 다음 달 이후분으로 넘어가는 돈을 보이고, 지난달에서
  // 넘어와 이 달분을 채운 돈은 보조줄로 적는다. 수치(carryOver)는 그대로이고 읽는 방식만 바뀐다.
  const prepaidIn = settlement.prepaidIn ?? 0
  const prepaidOut = settlement.prepaidOut ?? 0
  const pastUnpaid = settlement.carryOver < 0
  const pastOverpaid = settlement.carryOver > 0 ? settlement.carryOver : 0

  return (
    <div className="space-y-2">
      {/* 카드 라벨은 간결하게, 용어 설명은 (i)로 이관(운영자 지시 2026-07-13) */}
      <div className="flex items-center">
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">
          {month ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월 · 귀속월 기준` : '귀속월 기준'}
        </p>
        <InfoHint title="수납 요약 용어" z={380}>
          <div className="space-y-2">
            <p><span className="font-medium">총 수납</span> 이 달분(귀속월)으로 기록된 금액 합계입니다. 지난달에 냈어도 이 달분이면 포함됩니다.</p>
            <p><span className="font-medium">잔액</span> 이번 달 청구 대비 남은 금액입니다. +는 선납(더 받음), −는 미수(덜 받음)입니다.</p>
            <p><span className="font-medium">다음 달로</span> 이 달까지 받은 돈 중 다음 달 이후분으로 적어 둔 금액입니다. 지난달에 미리 받아 이 달분을 채운 금액은 &apos;지난달 이월&apos;로 적습니다.</p>
            <p><span className="font-medium">지난달 미수</span> 지난달까지 다 받지 못한 금액입니다.</p>
            <p><span className="font-medium">이 달 청구</span> 이번 달에 청구할 금액입니다. 청구가 없는 달에는 청구 없음으로 표시되고, 그 달을 덮은 수납을 아래에 적습니다.</p>
          </div>
        </InfoHint>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)]">총 수납</p>
          <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]"><MoneyDisplay amount={resv ? resvPaid : settlement.totalPaid} /></p>
          {resv && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">예약금 {fmtWon(resvPaid)} 포함</p>}
          {coveredCaption && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{coveredCaption}</p>}
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          {/* 값 자리에 '청구 없음'이 들어가면 '잔액' 라벨과 답이 어긋난다 — 라벨을 값에 맞춘다. */}
          <p className="text-xs text-[var(--warm-muted)] leading-tight">{resv ? '입주 시 납부 예정' : noBill ? '이 달 청구' : '잔액'}</p>
          {noBill ? (
            <>
              <p className="text-sm font-bold mt-0.5 text-[var(--warm-muted)]">청구 없음</p>
              <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{noBillWhy}</p>
            </>
          ) : resv ? (
            // 선납·미수(+/−)가 아니라 '앞으로 낼 금액' — 부호 없이 표기해 구분한다.
            // 아직 안 받은 돈이라 예정 톤(info) — 중립 짙은 색이면 수납 완료 금액과 같은 문법이 된다(신고 d9e6ecd2).
            <>
              <p className="text-sm font-bold mt-0.5 text-[var(--info-fg)]">{fmtWon(resvDue)}</p>
              {beforeMoveIn && moveInMonth && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">이번 달 청구 없음 · {Number(moveInMonth.slice(5))}월 입주 예정</p>
              )}
            </>
          ) : (
            <p className={`text-sm font-bold mt-0.5 ${settlement.balance >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
              {settlement.balance > 0 ? `+${fmtWon(settlement.balance)}` : settlement.balance < 0 ? `−${fmtWon(Math.abs(settlement.balance))}` : '0원'}
            </p>
          )}
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)] leading-tight">{pastUnpaid ? '지난달 미수' : '다음 달로'}</p>
          {/* 큰 숫자는 한 줄 — 320px 3열에서 '원'만 아랫줄로 떨어지지 않게. 색은 §06 +/− 정본. */}
          {pastUnpaid ? (
            <p className="text-sm font-bold mt-0.5 whitespace-nowrap text-[var(--danger-fg)]">−{fmtWon(Math.abs(settlement.carryOver))}</p>
          ) : (
            <p className="text-sm font-bold mt-0.5 whitespace-nowrap text-[var(--success-fg)]">{prepaidOut > 0 ? `+${fmtWon(prepaidOut)}` : '0원'}</p>
          )}
          {!pastUnpaid && prepaidOut > 0 && settlement.status === 'CHECKED_OUT' && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 break-keep">퇴실 정산 대상</p>
          )}
          {pastOverpaid > 0 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 break-keep">지난달 과납 {fmtWon(pastOverpaid)}</p>
          )}
          {prepaidIn > 0 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 break-keep">지난달 이월 {fmtWon(prepaidIn)}</p>
          )}
        </div>
      </div>
    </div>
  )
}
