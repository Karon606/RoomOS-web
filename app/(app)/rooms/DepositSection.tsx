'use client'

// 보증금 — 수납관리 탭 (2026-08-12, /finance '보증금' 탭에서 이동).
// 보증금은 받고 돌려주는 돈이라 지출이 아니라 수납 흐름이다(운영자 확정). 부가수익 이관(2026-07-02)과 같은 방향으로,
// 데이터·액션(finance/actions)은 그대로 두고 화면만 이곳에 둔다 — 홈 '보유 보증금' 딥링크도 여기로 온다.
import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { recordDepositReceived } from './actions'
import type { DepositPerTenant, DepositLedgerEntry } from '@/app/(app)/finance/actions'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { InfoHint } from '@/components/ui/InfoHint'
import { confirmDialog, choiceDialog } from '@/components/ui/ConfirmDialog'
import { trackSave, pushToast } from '@/lib/saveStatus'

const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT: '퇴실', NON_RESIDENT: '비거주',
}

export function DepositSection({ summary, ledger, totalBalance }: {
  summary: DepositPerTenant[]
  ledger: DepositLedgerEntry[]
  totalBalance: number
}) {
  type SubTab = 'tenant' | 'ledger'
  const [sub, setSub] = useState<SubTab>('tenant')
  const router = useRouter()
  const [recPending, startRec] = useTransition()

  // 전 원장 등으로 받았으나 입금기록 없는 보증금 → '받음(실수납)'으로 기록.
  // 청소비를 이미 받은 계약이면 얼마를 기록할지 되묻는다 — 입주자 폼의 '보증금 실제로 받음'과 같은 선택창.
  // 종전에는 버튼 한 번에 계약액 전액이 무확인으로 record 되어 청소비 몫이 두 번 잡혔다(2026-08-10).
  const handleRecordReceived = async (leaseTermId: string, name: string, amount: number, cleaningPaid: number) => {
    const cash = Math.max(0, amount - cleaningPaid)
    let recordAmount: number | null = null
    if (cleaningPaid > 0 && cash < amount) {
      const choice = await choiceDialog({
        title: `${name} 보증금을 얼마로 기록할까요?`,
        message: `이 계약은 입실 때 청소비 ${fmtWon(cleaningPaid)}을 이미 받았습니다.\n`
          + `보증금 ${fmtWon(amount)}에 청소비가 포함되는 방식이라면 현금으로 받은 몫은 ${fmtWon(cash)}입니다.`,
        confirmLabel: `${fmtWon(cash)}으로 기록`,
        altLabel: `${fmtWon(amount)} 전액`,
        level: 'caution',
      })
      if (choice === null) return
      recordAmount = choice === 'alt' ? null : cash
    } else if (!(await confirmDialog({ title: `${name} 보증금을 '받음(실수납)'으로 기록할까요?`, message: `계약상 금액(${fmtWon(amount)})으로 입금 기록이 생성됩니다.`, confirmLabel: '기록' }))) {
      return
    }
    startRec(async () => {
      const release = trackSave()
      try {
        await recordDepositReceived(leaseTermId, recordAmount != null ? { amount: recordAmount } : undefined)
        pushToast('success', '보증금 받음으로 기록됨')
        router.refresh()
      } catch (e) {
        pushToast('error', (e as Error).message ?? '기록 실패')
      } finally { release() }
    })
  }

  const totalIn       = summary.reduce((s, d) => s + d.totalIn, 0)
  const totalReturned = summary.reduce((s, d) => s + d.totalReturned, 0)
  const totalWithheld = summary.reduce((s, d) => s + d.totalWithheld, 0)

  return (
    <div className="space-y-5">
      {/* 잔고 요약 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">현재 보유</p>
            <p className="text-xl font-bold" style={{ color: 'var(--deposit-fg)' }}>
              <MoneyDisplay amount={totalBalance} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 입금</p>
            <p className="text-base font-semibold text-[var(--success-fg)]"><MoneyDisplay amount={totalIn} /></p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 반환</p>
            <p className="text-base font-semibold text-[var(--warning-fg)]"><MoneyDisplay amount={totalReturned} /></p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 미반환</p>
            <p className="text-base font-semibold" style={{ color: 'var(--coral)' }}><MoneyDisplay amount={totalWithheld} /></p>
          </div>
        </div>
      </div>

      {/* 서브 탭 */}
      <div className="flex gap-1.5">
        {(['tenant', 'ledger'] as SubTab[]).map(k => (
          <button key={k} onClick={() => setSub(k)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              sub === k ? 'bg-[var(--coral)] text-[var(--on-solid)]'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:text-[var(--warm-dark)]'
            }`}>
            {k === 'tenant' ? `입주자별 (${summary.length})` : `거래 이력 (${ledger.length})`}
          </button>
        ))}
      </div>

      {sub === 'tenant' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          {summary.length === 0 ? (
            <EmptyState title="보증금 거래 이력이 있는 입주자가 없습니다." className="border-0 bg-transparent" />
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/50">
              {summary.map(d => (
                <li key={d.leaseTermId} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--warm-dark)]">{d.tenantName}</span>
                      {d.roomNo && <span className="text-xs text-[var(--warm-muted)]">· {d.roomNo}호</span>}
                      <span className="text-[0.65625rem] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                        {DEPOSIT_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                      {d.hasNoInRecord && (
                        <Badge tone="pale-amber">입금 거래 기록 없음</Badge>
                      )}
                    </div>
                    <p className="text-xs text-[var(--warm-muted)]">
                      {d.hasNoInRecord
                        ? <>계약상 보증금 {fmtWon(d.contractDeposit)}
                            {/* 용어 설명(신고 249b5652) — ? 문법은 InfoHint 정본 */}
                            <InfoHint title="계약상 보증금">
                              계약서에 약정한 보증금 금액으로, 실제 입금 기록과는 별개입니다. 입금 기록이 없는 계약은 이 약정액을 기준으로 잔고를 계산합니다. 실제로 받았다면 옆의 받음으로 기록 버튼으로 실수납을 남기세요.
                            </InfoHint></>
                        : `입금 ${fmtWon(d.totalIn)}`}
                      {/* 청소비가 채운 몫은 받은 돈이다 — 병기하지 않으면 아래 '(계약 N)'이 어긋남처럼 읽힌다. */}
                      {d.coveredByCleaning > 0 && ` + 청소비 ${fmtWon(d.coveredByCleaning)}`}
                      {d.totalReturned > 0 && ` · 반환 ${fmtWon(d.totalReturned)}`}
                      {d.totalWithheld > 0 && ` · 미반환 ${fmtWon(d.totalWithheld)}`}
                      {!d.hasNoInRecord && d.contractDeposit !== d.totalIn && (
                        // 차이가 청소비 몫으로 설명되면 경고색이 아니다(포함형 영업장 상시 오탐이던 자리).
                        <span className={`ml-1 ${d.contractDeposit === d.totalIn + d.coveredByCleaning ? 'text-[var(--warm-muted)]' : 'text-[var(--warning-fg)]'}`}>(계약 {fmtWon(d.contractDeposit)})</span>
                      )}
                      {d.status === 'CHECKED_OUT' && d.balance === 0 && (d.totalReturned + d.totalWithheld === 0) && (
                        <span className="ml-1 text-[var(--warm-muted)]">· 퇴실 정리됨</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: d.balance > 0 ? 'var(--deposit-fg)' : 'var(--warm-muted)' }}>
                      {fmtWon(d.balance)}
                    </p>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">현재 잔고</p>
                    {/* 행 액션은 RowActionBtn 정본 — 맨 버튼은 히트영역이 글자 높이라 §09 터치 타깃
                        44px 에 못 미친다. 형제(수납 기록·보증금 패널·상태 이력·청소 행)와 같은 문법이다.
                        mt-3.5 는 정본이 히트영역용으로 먹는 -my-2 를 되갚아 종전 6px 간격을 지킨다. */}
                    {d.hasNoInRecord && d.status !== 'CHECKED_OUT' && d.contractDeposit > 0 && (
                      <RowActionBtn tone="success" disabled={recPending} className="mt-3.5 whitespace-nowrap"
                        onClick={() => handleRecordReceived(d.leaseTermId, d.tenantName, d.contractDeposit, d.cleaningPaid)}>
                        받음으로 기록
                      </RowActionBtn>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sub === 'ledger' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          {ledger.length === 0 ? (
            <EmptyState title="보증금 거래 이력이 없습니다." className="border-0 bg-transparent" />
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/50">
              {ledger.map((e, i) => (
                <li key={i} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={`text-xs font-semibold ${e.type === 'IN' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'}`}>
                        {e.type === 'IN' ? '입금' : '환불'}
                      </span>
                      {/* 날짜는 fmtDateDot 정본(감사 B5) — toISOString 은 UTC 라 KST 00~09시에
                          하루 앞선 날짜를 그렸고, 서버·기기가 갈려 하이드레이션도 어긋날 자리였다. */}
                      <span className="text-xs text-[var(--warm-muted)]">{fmtDateDot(e.date)}</span>
                      <span className="text-xs text-[var(--warm-dark)]">· {e.tenantName}</span>
                      {e.roomNo && <span className="text-xs text-[var(--warm-muted)]">· {e.roomNo}호</span>}
                    </div>
                    {e.type === 'REFUND' && (
                      <p className="text-xs text-[var(--warm-muted)]">
                        반환 {fmtWon((e.returnedAmount ?? 0))}
                        {(e.withheldAmount ?? 0) > 0 && ` · 미반환 ${fmtWon((e.withheldAmount ?? 0))}`}
                        {e.reason && ` · 사유: ${e.reason}`}
                      </p>
                    )}
                    {e.memo && <p className="text-xs text-[var(--warm-muted)] truncate">메모: {e.memo}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${e.type === 'IN' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'}`}>
                      {e.type === 'IN' ? '+' : '−'}{fmtWon(e.amount)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
