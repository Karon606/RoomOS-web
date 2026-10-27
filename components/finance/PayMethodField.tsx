'use client'

// 결제수단 + 결제 계정(이체 계좌·카드·선불 계정) 고르는 칸 한 벌. 작업·청소 완료 폼과 한 건 수정 폼이 쓴다(2026-10-27).
//
// 칸 문법은 지출 수정 폼(FinanceClient 결제수단 블록)과 고정지출 기록 모달(RecurringExpenseRecordModal)의 그것이다.
// 결제수단 select 하나, 고른 수단이 계정을 묻는 것이면(계좌이체 = 통장, 신용·체크카드 = 카드, 선불 브랜드 = 그 계정) 아래 select 하나,
// 계정 첫 줄은 '선택 안함'. 수단을 바꾸면 계정은 비운다(다른 수단의 계정이 남지 않게). 선택지는 lib/payMethodOptions 정본이다.
// 지금 값이 목록에 없으면(목록에서 뺀 옛 수단) 그 글자를 맨 앞에 세운다. 안 세우면 select 가 첫 항목을 보여 주는데 저장은 옛 값이라
// 화면과 저장이 갈린다.

import { useId } from 'react'
import { accName, accountTypesFor } from '@/lib/payMethodOptions'

export type PayAccount = { id: string; type: string; brand: string; alias: string | null }

const ACCOUNT_LABEL: Record<string, string> = { BANK_ACCOUNT: '이체 계좌', CREDIT_CARD: '카드 선택', PREPAID: '선불 계정' }

export function PayMethodField({ methods, accounts, payMethod, accountId, onChange, dense = false, disabled = false }: {
  methods: string[]
  accounts: PayAccount[]
  payMethod: string
  accountId: string
  onChange: (payMethod: string, accountId: string) => void
  /** 행 안 촘촘한 폼(완료 처리). 라벨이 칸 왼쪽에 서고 글자가 12px 다. */
  dense?: boolean
  disabled?: boolean
}) {
  const uid = useId()
  const options = payMethod && !methods.includes(payMethod) ? [payMethod, ...methods] : methods
  // 이미 있는 지출의 결제수단이 비어 있으면 빈 칸으로 보인다(고르기 전에는 아무것도 저장하지 않는다, 독립 검수 B1).
  const blank = payMethod === ''
  const types = payMethod ? accountTypesFor(payMethod, accounts) : null
  const pickable = types ? accounts.filter(a => types.includes(a.type)) : []
  const accLabel = types ? ACCOUNT_LABEL[types[0]] : ''

  if (dense) {
    const cls = 'flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30'
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
          <label htmlFor={`${uid}-m`} className="w-14 shrink-0">결제수단</label>
          <select id={`${uid}-m`} value={payMethod} disabled={disabled}
            onChange={e => onChange(e.target.value, '')} className={cls}>
            {blank && <option value="">비어 있음</option>}
            {options.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {pickable.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            <label htmlFor={`${uid}-a`} className="w-14 shrink-0">{accLabel}</label>
            <select id={`${uid}-a`} value={accountId} disabled={disabled}
              onChange={e => onChange(payMethod, e.target.value)} className={cls}>
              <option value="">선택 안함</option>
              {pickable.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
            </select>
          </div>
        )}
      </div>
    )
  }

  const cls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-m`} className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
        <select id={`${uid}-m`} value={payMethod} disabled={disabled}
          onChange={e => onChange(e.target.value, '')} className={cls}>
          {blank && <option value="">비어 있음</option>}
          {options.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {pickable.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-a`} className="text-xs font-medium text-[var(--warm-mid)]">{accLabel}</label>
          <select id={`${uid}-a`} value={accountId} disabled={disabled}
            onChange={e => onChange(payMethod, e.target.value)} className={cls}>
            <option value="">선택 안함</option>
            {pickable.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
          </select>
        </div>
      )}
    </>
  )
}
