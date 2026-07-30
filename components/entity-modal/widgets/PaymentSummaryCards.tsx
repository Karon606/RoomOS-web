// 총수납·잔액·이월액 3카드 — 셸의 수납 면 summary/full 모드 양쪽에서 재사용.
// 데이터는 caller 가 getLeaseSettlementInfo 결과로 직접 넘긴다 (자체 fetch X — 부모에서 일괄 관리).

import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { InfoHint } from '@/components/ui/InfoHint'

type Settlement = {
  totalPaid: number; balance: number; carryOver: number
  // 예약(RESERVED) 표시 정본(신고 50a2a69b) — 실수납은 조회월 무관 reservationPaid, 잔액 대신 '입주 시 납부 예정'.
  status?: string | null
  expected?: number
  reservationPaid?: { deposit: number; prepaid: number } | null
  moveInDate?: string | null
}

import { fmtWon } from '@/lib/fmtMoney'   // v2.0 §06 단일 경로

export function PaymentSummaryCards({ settlement, month }: { settlement: Settlement; month?: string }) {
  // 예약 단계는 청구·잔액이 0으로 잠겨 있어(미납 집계 제외 정본) 실수납·입주 시 낼 금액을 따로 보여준다.
  const resv = settlement.status === 'RESERVED' ? (settlement.reservationPaid ?? null) : null
  const resvPaid = resv ? resv.deposit + resv.prepaid : 0
  const resvDue = resv ? Math.max(0, (settlement.expected ?? 0) - resv.prepaid) : 0
  // 입주월 전 조회 — '이번 달 청구 없음' 맥락(예정액이 이번 달 청구로 오독되지 않게, 운영자 지적 2026-07-30)
  const moveInMonth = settlement.moveInDate ? settlement.moveInDate.slice(0, 7) : null
  const beforeMoveIn = !!(resv && month && moveInMonth && month < moveInMonth)
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
          <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]"><MoneyDisplay amount={resv ? resvPaid : settlement.totalPaid} /></p>
          {resv && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">예약금 {fmtWon(resvPaid)} 포함</p>}
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
          <p className="text-xs text-[var(--warm-muted)] leading-tight">{resv ? '입주 시 납부 예정' : '잔액'}</p>
          {resv ? (
            // 선납·미수(+/−)가 아니라 '앞으로 낼 금액' — 부호 없이 표기해 구분한다.
            <>
              <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]">{fmtWon(resvDue)}</p>
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
          <p className="text-xs text-[var(--warm-muted)]">이월액</p>
          <p className="text-sm font-bold mt-0.5 text-[var(--coral)]">
            {settlement.carryOver !== 0 ? `${settlement.carryOver > 0 ? '+' : '−'}${fmtWon(Math.abs(settlement.carryOver))}` : '0원'}
          </p>
        </div>
      </div>
    </div>
  )
}
