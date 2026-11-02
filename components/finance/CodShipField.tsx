'use client'

// 수령 자리에서 착불 배송비를 한 번 묻는 칸(금액 + 결제수단). 소모품 수령 대기 묶음·품목 상세 구매 카드·비품 수령 창이 같은 칸·같은 문장이다.
//
// 그 주문의 첫 수령이고 착불 배송비가 아직 없을 때만 선다(판정 정본 lib/codShipping asksCodAtReceipt, 서버도 같은 판정으로 거부한다).
// 금액은 선택이다. 비우면 아무것도 만들지 않고, 나중에 지출 상세 [수정] 에서 적거나 '없었음' 으로 닫는다.
// 결제수단 기본값은 계좌이체다(착불은 받을 때 따로 낸다). 선택지는 지출 화면과 같은 한 벌(getShipPayOptions)이다.
// 칸 높이는 금액 칸과 같은 40px 이다(PayMethodField 기본형, 한 폼 안 높이 혼용 금지 §12).
import { useEffect, useId, useState } from 'react'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { PayMethodField } from '@/components/finance/PayMethodField'
import { getShipPayOptions, type ShipPayOptions } from '@/app/(app)/finance/shipPayActions'
import { COD_RECEIPT_LABEL, COD_RECEIPT_CAPTION, SHIP_PAY_LABEL } from '@/lib/codShipping'

export type CodShipValue = { amount?: number; payMethod: string; accountId: string }
export const codShipInitial = (): CodShipValue => ({ amount: undefined, payMethod: '계좌이체', accountId: '' })

// 선택지 캐시는 영업장 키로 나눈다(독립 검수 2026-11-02). 영업장을 바꾼 뒤 남의 영업장 계정이 보이지 않게, 칸이 설 때마다 지금 영업장
// 값을 서버에서 받고(같은 순간 여러 칸은 요청 하나로 합친다), 받은 영업장 키에 담아 같은 영업장 칸이 다시 설 때 먼저 그린다.
const optsByProperty = new Map<string, ShipPayOptions>()
let inflight: Promise<ShipPayOptions & { propertyId: string }> | null = null
let lastPropertyId: string | null = null
function loadOpts() {
  if (!inflight) inflight = getShipPayOptions().finally(() => { inflight = null })
  return inflight.then(o => { optsByProperty.set(o.propertyId, o); lastPropertyId = o.propertyId; return o })
}

export function CodShipField({ value, onChange, suffix, disabled = false, labelClassName }: {
  value: CodShipValue
  onChange: (v: CodShipValue) => void
  /** 한 묶음에 물을 주문이 둘 이상이면 어느 주문인지(날짜 · 구매처). */
  suffix?: string
  disabled?: boolean
  /** 라벨 글자 클래스. 부르는 자리의 다른 칸 라벨과 같은 문법을 쓴다. */
  labelClassName?: string
}) {
  const uid = useId()
  const [opts, setOpts] = useState<ShipPayOptions | null>(() => (lastPropertyId ? optsByProperty.get(lastPropertyId) ?? null : null))
  useEffect(() => { let on = true; loadOpts().then(o => { if (on) setOpts(o) }).catch(() => {}); return () => { on = false } }, [])
  return (
    <div className="space-y-1.5">
      <p id={`${uid}-l`} className={labelClassName ?? 'text-xs font-medium text-[var(--warm-mid)]'}>
        {COD_RECEIPT_LABEL}{suffix && <span className="font-normal text-[var(--warm-muted)]"> {suffix}</span>}
      </p>
      <MoneyInput value={value.amount} onChange={v => onChange({ ...value, amount: v || undefined })} placeholder="배송비"
        labelledBy={`${uid}-l`} describedBy={`${uid}-c`} disabled={disabled} />
      {/* 비워 두면 어떻게 되는지는 금액 칸 바로 아래 한 줄(그 칸에 붙은 말이다, 독립 검수 2026-11-02). */}
      <p id={`${uid}-c`} className="text-[0.65625rem] text-[var(--warm-muted)] break-keep">{COD_RECEIPT_CAPTION}</p>
      {opts && (
        <PayMethodField label={SHIP_PAY_LABEL} methods={opts.methods} accounts={opts.accounts} disabled={disabled}
          payMethod={value.payMethod} accountId={value.accountId}
          onChange={(m, a) => onChange({ ...value, payMethod: m, accountId: a })} />
      )}
    </div>
  )
}
