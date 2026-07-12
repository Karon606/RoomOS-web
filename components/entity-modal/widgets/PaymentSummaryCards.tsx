// 총수납·잔액·이월액 3카드 — 셸의 수납 면 summary/full 모드 양쪽에서 재사용.
// 데이터는 caller 가 getLeaseSettlementInfo 결과로 직접 넘긴다 (자체 fetch X — 부모에서 일괄 관리).

import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { InfoHint } from '@/components/ui/InfoHint'

type Settlement = { totalPaid: number; balance: number; carryOver: number }

import { fmtWon } from '@/lib/fmtMoney'   // v2.0 §06 단일 경로

export function PaymentSummaryCards({ settlement, month }: { settlement: Settlement; month?: string }) {
  return (
    <div className="space-y-2">
      {/* 카드 라벨은 간결하게, 용어 설명은 (i)로 이관(운영자 지시 2026-07-13) */}
      <div className="flex items-center">
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">
          {month ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월 · 입금일 기준` : '입금일 기준'}
        </p>
        <InfoHint title="수납 요약 용어" z={380}>
          <div className="space-y-2">
            <p><span className="font-medium">총 수납</span> 이번 달 입금일 기준으로 받은 금액 합계입니다.</p>
            <p><span className="font-medium">잔액</span> 이번 달 청구 대비 남은 금액입니다. +는 선납(더 받음), −는 미수(덜 받음)입니다.</p>
            <p><span className="font-medium">이월액</span> 지난달에서 넘어온 선납·미수입니다.</p>
          </div>
        </InfoHint>
      </div>
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
