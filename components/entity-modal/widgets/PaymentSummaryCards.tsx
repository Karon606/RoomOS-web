// 총수납·잔액·이월액 3카드 — 셸의 수납 면 summary/full 모드 양쪽에서 재사용.
// 데이터는 caller 가 getLeaseSettlementInfo 결과로 직접 넘긴다 (자체 fetch X — 부모에서 일괄 관리).

import { MoneyDisplay } from '@/components/ui/MoneyDisplay'

type Settlement = { totalPaid: number; balance: number; carryOver: number }

import { fmtWon } from '@/lib/fmtMoney'   // §15 단일 경로

export function PaymentSummaryCards({ settlement, month }: { settlement: Settlement; month?: string }) {
  return (
    <div className="space-y-2">
      {month && (
        <p className="text-[0.625rem] text-[var(--warm-muted)]">
          총 수납·잔액·이월액은 입금일 기준입니다. ({month.slice(0, 4)}년 {Number(month.slice(5))}월)
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)]">총 수납</p>
          <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]"><MoneyDisplay amount={settlement.totalPaid} /></p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)]">잔액</p>
          <p className={`text-sm font-bold mt-0.5 ${settlement.balance >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
            {settlement.balance > 0 ? `+${fmtWon(settlement.balance)}` : settlement.balance < 0 ? `−${fmtWon(Math.abs(settlement.balance))}` : '0원'}
          </p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)]">이월액</p>
          <p className="text-sm font-bold mt-0.5 text-[var(--coral)]">
            {settlement.carryOver !== 0 ? `${settlement.carryOver > 0 ? '+' : '−'}${fmtWon(Math.abs(settlement.carryOver))}` : '0원'}
          </p>
        </div>
      </div>
    </div>
  )
}
