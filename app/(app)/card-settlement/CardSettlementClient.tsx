'use client'

// 카드 정산 — '지출/기타수익'에서 분리한 독립 화면.
// 미정산 신용카드 대금을 카드·청구월별로 묶어 '확정(마감)'과 '예정(진행 중)'으로 구분 표시 + 정산 처리.
import { InfoHint } from '@/components/ui/InfoHint'
import { fmtMD } from '@/lib/fmtDate'
import { useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { useRouter } from 'next/navigation'
import { settleCardExpenses, unsettleExpenses } from '../finance/actions'
import { Btn } from '@/components/ui/Btn'
import { EmptyState } from '@/components/ui/EmptyState'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import MonthSelector from '@/components/layout/MonthSelector'

type UnsettledExpense = {
  id: string; date: Date; amount: number; category: string
  detail: string | null; financeName: string | null
  financialAccountId: string | null
  financialAccount: {
    id: string; brand: string; alias: string | null
    cutOffDay: number | null; payDay: number | null
    linkedAccount: { brand: string; alias: string | null } | null
  } | null
}

type SettleGroup = {
  accountId: string; accountName: string; billMonth: string
  billingPeriodStr: string; linkedAccountName: string | null
  payDayStr: string; items: UnsettledExpense[]; total: number
  isFinalized: boolean
}

function accName(a: { brand: string; alias: string | null } | null) {
  if (!a) return ''
  return a.alias ? `${a.brand} (${a.alias})` : a.brand
}
function displayDay(day: number | null) {
  if (!day || day >= 31) return '말일'
  return `${day}일`
}

// 거래일 → 그 거래가 속한 청구월(YYYY-MM). 마감일(cutOff) 이후 거래는 다음 청구월.
function getBillMonth(date: Date | string, cutOffDay: number | null) {
  const d = new Date(date)
  const cutOff = cutOffDay && cutOffDay < 31 ? cutOffDay : 31
  let year = d.getFullYear(), month = d.getMonth() + 1
  if (d.getDate() > cutOff) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return `${year}-${String(month).padStart(2, '0')}`
}

function buildSettleGroups(unsettledExpenses: UnsettledExpense[]): SettleGroup[] {
  const now = Date.now()
  const map = new Map<string, SettleGroup>()
  unsettledExpenses.forEach(exp => {
    const acc = exp.financialAccount
    const cutOff = acc?.cutOffDay ?? null
    const billMonth = getBillMonth(exp.date, cutOff)
    const accountId = acc?.id ?? (exp.financeName ?? 'unknown')
    const name = acc ? accName(acc) : (exp.financeName ?? '미지정 카드')
    const key = `${accountId}__${billMonth}`

    if (!map.has(key)) {
      const [billYStr, billMStr] = billMonth.split('-')
      const billY = parseInt(billYStr), billM = parseInt(billMStr)
      let prevM = billM - 1, prevY = billY
      if (prevM < 1) { prevM = 12; prevY -= 1 }
      const startDay = (cutOff && cutOff < 31) ? cutOff + 1 : 1
      const endDayStr = (cutOff && cutOff < 31) ? `${cutOff}일` : '말일'
      const periodStr = `${prevY}년 ${prevM}월 ${startDay}일 ~ ${billY}년 ${billM}월 ${endDayStr}`
      const linked = acc?.linkedAccount ? accName(acc.linkedAccount) : null
      const payDayStr = acc?.payDay ? displayDay(acc.payDay) : '미지정'
      // 청구 마감일(그 청구월의 cutOff, 없으면 말일)이 지났으면 '확정', 아니면 '예정(진행 중)'.
      const closeDate = (cutOff && cutOff < 31)
        ? new Date(billY, billM - 1, cutOff, 23, 59, 59, 999)
        : new Date(billY, billM, 0, 23, 59, 59, 999)
      const isFinalized = now > closeDate.getTime()
      map.set(key, { accountId, accountName: name, billMonth, billingPeriodStr: periodStr, linkedAccountName: linked, payDayStr, items: [], total: 0, isFinalized })
    }
    const g = map.get(key)!
    g.items.push(exp)
    g.total += exp.amount
  })
  return Array.from(map.values()).sort((a, b) => a.billMonth.localeCompare(b.billMonth))
}

export default function CardSettlementClient({
  unsettledExpenses, settledCardExpenses, targetMonth,
}: {
  unsettledExpenses: UnsettledExpense[]
  settledCardExpenses: UnsettledExpense[]
  targetMonth: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const settleGroups = buildSettleGroups(unsettledExpenses)
  // 정산 완료 내역은 선택한 달의 '청구월'분만. (미정산은 월 무관 전체 유지)
  const settledGroups = buildSettleGroups(settledCardExpenses).filter(g => g.billMonth === targetMonth)
  const monthLabel = `${Number(targetMonth.slice(5))}월`
  const finalizedG = settleGroups.filter(g => g.isFinalized)
  const pendingG   = settleGroups.filter(g => !g.isFinalized)

  const handleSettle = async (ids: string[], name: string, billMonth: string) => {
    if (!(await confirmDialog({ title: `'${name}' ${billMonth} 청구분 ${ids.length}건을 정산 완료로 처리할까요?`, confirmLabel: '정산 완료' }))) return
    startTransition(async () => { await settleCardExpenses(ids); router.refresh() })
  }

  const settleCard = (g: SettleGroup) => (
    <div key={`${g.accountId}__${g.billMonth}`} className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-[var(--warm-dark)] text-base">{g.accountName}</span>
        {g.payDayStr !== '미지정' && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)] font-medium shrink-0">
            결제일: {g.payDayStr}
          </span>
        )}
      </div>
      <div className="text-xs text-[var(--warm-mid)] space-y-0.5">
        <div>청구기간: {g.billingPeriodStr}</div>
        {g.linkedAccountName && (
          <div>출금계좌: <span className="text-[var(--warm-dark)]">{g.linkedAccountName}</span></div>
        )}
      </div>
      <div className="flex items-baseline justify-between border-b border-[var(--warm-border)] pb-3">
        <span className="text-xs text-[var(--warm-mid)] font-medium">
          {g.billMonth.replace('-', '년 ')}월 청구 {g.isFinalized ? '총액(확정)' : '예정액'}
        </span>
        <span className="text-xl font-bold text-[var(--danger-fg)] num">
          {fmtWon(g.total)}
        </span>
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1.5">
        {g.items.map(item => (
          <div key={item.id} className="flex items-center justify-between text-xs gap-2">
            <span className="text-[var(--warm-mid)] min-w-0 truncate">
              {fmtMD(item.date)}
              &nbsp;
              <span className="text-[var(--warm-muted)]">{item.category}</span>
              {item.detail && <span className="text-[var(--warm-muted)]"> · {item.detail}</span>}
            </span>
            <span className="text-[var(--warm-dark)] font-medium num shrink-0">
              {fmtWon(item.amount)}
            </span>
          </div>
        ))}
      </div>
      {g.accountId && g.accountId !== 'unknown' ? (
        <Btn
          variant={g.isFinalized ? 'primary' : 'secondary'} size="md" fullWidth
          onClick={() => handleSettle(g.items.map(i => i.id), g.accountName, g.billMonth)}
          disabled={isPending}>
          {g.isFinalized ? '출금 확인 (정산 완료 처리)' : '미리 정산 처리'}
        </Btn>
      ) : (
        <p className="text-xs text-[var(--warm-muted)] text-center">자산 등록 후 정산하세요</p>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">카드 정산
            <InfoHint title="카드 정산이란?">신용카드로 결제된 미정산 지출을 카드·청구월별로 묶어 정산합니다. 미정산 목록은 월과 무관하게 전체가 보이고, 정산 완료 내역은 위에서 선택한 달의 청구분만 보입니다.</InfoHint>
          </h1>
        </div>
        <MonthSelector />
      </div>

      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">미정산 신용카드 대금 합산</h2>
        <p className="text-xs text-[var(--warm-muted)] mb-5">청구 마감 여부로 확정·예정을 구분합니다.</p>

        {settleGroups.length === 0 ? (
          <EmptyState title="미정산 건이 없습니다" />
        ) : (
          <div className="space-y-6">
            {/* 확정 청구분 — 마감돼 금액이 고정된 출금 대상 */}
            {finalizedG.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[var(--danger-bg)] text-[var(--danger-fg)] ring-1 ring-[var(--danger-ring)]">확정</span>
                  <span className="text-sm font-semibold text-[var(--warm-dark)]">청구 마감 · 출금 대상</span>
                  <span className="text-xs text-[var(--warm-muted)]">{finalizedG.length}건</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {finalizedG.map(settleCard)}
                </div>
              </div>
            )}
            {/* 예정 청구분 — 아직 마감 전이라 금액이 더 늘 수 있음 */}
            {pendingG.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]">예정</span>
                  <span className="text-sm font-semibold text-[var(--warm-dark)]">진행 중 · 마감 전</span>
                  <span className="text-xs text-[var(--warm-muted)]">{pendingG.length}건</span>
                </div>
                <p className="text-xs text-[var(--warm-muted)]">아직 청구 마감 전이라 결제일까지 금액이 더 늘 수 있어요.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pendingG.map(settleCard)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 정산 완료 내역 — 선택한 달 청구분 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--warm-mid)]">정산 완료 내역 <span className="text-[var(--warm-muted)] font-normal">· {monthLabel} 청구분</span></h3>
        {settledGroups.length === 0 ? (
          <EmptyState title={`${monthLabel} 청구분 정산 완료 내역이 없습니다`} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {settledGroups.map(g => (
              <div key={`${g.accountId}__${g.billMonth}`}
                className="bg-[var(--canvas)]/60 border border-[var(--warm-border)] rounded-xl p-4 space-y-3 opacity-70">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-[var(--warm-dark)]">{g.accountName}</span>
                    <span className="text-xs text-[var(--success-fg)] bg-[var(--success-bg)] px-2 py-0.5 rounded-full">정산완료</span>
                  </div>
                  <p className="text-xs text-[var(--warm-muted)] mt-0.5">{g.billingPeriodStr}</p>
                </div>
                <div className="space-y-1">
                  {g.items.map(item => (
                    <div key={item.id} className="flex justify-between text-xs text-[var(--warm-muted)]">
                      <span>{new Date(item.date).getMonth() + 1}. {new Date(item.date).getDate()}. {item.detail ?? item.category}</span>
                      <span>{fmtWon(item.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-[var(--warm-border)]">
                  <span className="text-sm font-bold text-[var(--warm-dark)]">{fmtWon(g.total)}</span>
                  <button
                    onClick={async () => {
                      if (!(await confirmDialog({ title: `'${g.accountName}' ${g.billMonth} 청구분 정산을 전부 취소할까요?`, confirmLabel: '전체 취소' }))) return
                      startTransition(async () => { await unsettleExpenses(g.items.map(i => i.id)); router.refresh() })
                    }}
                    disabled={isPending}
                    className="text-xs text-[var(--warning-fg)] hover:text-[var(--warning-fg)] px-3 py-1.5 bg-[var(--warning-bg)] hover:bg-[var(--warning-bg)] rounded-lg transition-colors disabled:opacity-40">
                    전체 정산 취소
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
