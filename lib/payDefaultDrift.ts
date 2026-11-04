// 정가 기본값이 남긴 수납 기록 모양을 찾는 순수 판정. 감지망(verify-money-consistency 20-5)과 진리표가 같이 부른다.
//
// 사건(2026-11-04). 입주자 상세 수납 모달이 금액을 계약 이용료(정가)로 채웠고, 할인 달에 그대로 저장하면 FIFO 가
// 그 달을 채우고 남은 할인액만큼을 다음 달 선납으로 적었다(404호 470,000 = 10월 440,000 + 11월 30,000). 출처 표식이
// 없어 화면을 DB 로 가를 수 없으므로 모양으로 센다. 정상 선납도 걸릴 수 있어 위반이 아니라 목록이다(운영자가 확인).

export type DriftRecord = {
  id: string
  leaseTermId: string
  targetMonth: string
  expectedAmount: number
  actualAmount: number
  payDate: string          // YYYY-MM-DD
  payMethod: string | null
  createdAt: number        // ms
}

/** 한 결제 묶음 = 같은 계약·입금일·수단이고 앞 기록과 만든 시각이 5초 안. savePayment 의 FIFO 가 한 번에 만든 행들이다. */
export function bundlePayments(records: readonly DriftRecord[]): DriftRecord[][] {
  const sorted = [...records].sort((a, b) => a.leaseTermId.localeCompare(b.leaseTermId) || a.createdAt - b.createdAt)
  const out: DriftRecord[][] = []
  for (const r of sorted) {
    const cur = out[out.length - 1]
    const last = cur?.[cur.length - 1]
    if (last && last.leaseTermId === r.leaseTermId && last.payDate === r.payDate && last.payMethod === r.payMethod && r.createdAt - last.createdAt < 5000) cur.push(r)
    else out.push([r])
  }
  return out
}

/**
 * 정가 끝전 이월 의심 묶음. 셋이 다 맞을 때.
 *  (가) 여러 달로 쪼개졌고 마지막(가장 늦은 귀속월) 행이 그 달 청구의 30% 미만이다(끝전 선납).
 *  (나) 묶음 총액이 계약 이용료(정가)와 같고, 첫 달 청구는 정가와 다르다(할인·일할·인상 달).
 */
export function isListPriceCarry(bundle: readonly DriftRecord[], rentAmount: number): boolean {
  if (bundle.length < 2) return false
  const byMonth = [...bundle].sort((a, b) => a.targetMonth.localeCompare(b.targetMonth))
  const first = byMonth[0], last = byMonth[byMonth.length - 1]
  if (first.targetMonth === last.targetMonth) return false
  const total = bundle.reduce((s, r) => s + r.actualAmount, 0)
  return last.actualAmount < last.expectedAmount * 0.3 && total === rentAmount && first.expectedAmount !== rentAmount
}

/** (다) 한 달 수납 합이 그 달 락(행 청구의 최댓값)보다 큰 (계약, 달). savePayment 는 이렇게 적지 않으므로 손 수정 흔적이다. */
export function overLockMonths(records: readonly DriftRecord[]): { leaseTermId: string; targetMonth: string; paid: number; lock: number }[] {
  const m = new Map<string, { leaseTermId: string; targetMonth: string; paid: number; lock: number }>()
  for (const r of records) {
    const k = `${r.leaseTermId}|${r.targetMonth}`
    const v = m.get(k) ?? { leaseTermId: r.leaseTermId, targetMonth: r.targetMonth, paid: 0, lock: 0 }
    v.paid += r.actualAmount
    v.lock = Math.max(v.lock, r.expectedAmount)
    m.set(k, v)
  }
  return [...m.values()].filter(v => v.lock > 0 && v.paid > v.lock)
}
