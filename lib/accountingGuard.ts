// 과거 회계월 보호 정본 — 정산·환불이 이미 신고를 마친 달을 조용히 뒤집는 것을 막는다.
//
// 왜 필요한가: 이 앱에는 월 마감·잠금 개념이 스키마에도 코드에도 없다(2026-08-01 전수 확인).
// 유일한 방어가 락인(record.expectedAmount)이었는데, 퇴실 정산액이 그보다 우선순위가 높다
// (lib/billing.ts). 지금까지 안전했던 이유는 정산월이 항상 퇴실월(현재 또는 미래)이었기 때문이고,
// 그 전제가 깨지는 작업을 하는 중이라 여기서 선을 긋는다.
//
// ── 경계선 (2026-08-02 회계 패널 재검토로 교체) ───────────────────────────────
// 초판은 '연도가 작년이면 무조건 차단'이었다. **틀렸다.**
// 2026-01-05 에 2025-12 를 고치는 것은 신고를 어긋나게 하는 게 아니라 **신고 전에 맞추는 행위**다
// (2025년 귀속 종합소득세 확정신고 기한은 2026-05-31). 오히려 여기서 안 고치면 틀린 매출이
// 1월 부가세 확정신고와 5월 소득세 신고까지 그대로 실려 간다. 가드가 정확히 반대로 작동했고,
// 매년 1월부터 5월까지 다섯 달을 불필요하게 막았다. 매년 1월 퇴실자에게 상시 재현되는 장애였다.
//
// 기준은 하나다. **앱 안에서 끝나면 고지, 앱 밖 절차가 반드시 따라붙으면 차단.**
//   · 소득세 확정신고 기한(다음해 5/31)이 지난 귀속연도 — **차단.** 신고서·이월 잔액·장부가
//     동시에 어긋나고 앱이 그 셋을 맞춰줄 방법이 없다.
//   · 부가세·사업장현황신고 기한만 지난 경우 — **허용 + 강한 고지.** 수정신고·경정청구가 일상적이고,
//     이걸 차단하면 매년 8월부터 연말까지 상반기 퇴실 정산이 전부 막힌다. 가드가 앱을 못 쓰게
//     만들면 운영자는 우회하는 습관을 만들고 방어선 자체가 무너진다.
//   · 인수(前 소유주) 이전 — 차단. 우리 장부가 아니다.
//
// 결과적으로 실제 차단은 '6월 1일 이후에 전년도 이전 귀속을 고치려는 경우'뿐이다.
// 퇴실 정산은 보통 퇴실 직후에 하므로 정상 운영에서는 거의 안 걸린다.
//
// 신고 기한(확실). 종합소득세 확정신고 다음해 5/31(성실신고확인대상은 6/30).
// 부가세 개인 일반과세자 1기 7/25 · 2기 다음해 1/25, 간이과세자 다음해 1/25.
// 면세사업자 사업장현황신고 다음해 2/10. 경정청구는 법정신고기한 후 5년.
//
// 고시원이 부가세 과세인지 면세인지는 사업장마다 갈리고 이 앱은 멀티테넌트라 어느 쪽도 박지 않는다.
// 고지 문구는 '부가가치세 또는 사업장현황신고' 수준으로 두고, 기한은 둘 중 이른 날을 쓴다.
// 성실신고확인대상(6/30)도 자동 판별하지 않는다 — 5/31 고정에 문구로 단서를 단다.
//
// 차단만 하고 끝내면 운영자가 막힌 채로 남는다. 무엇을 어떻게 할지와 정식 출구(경정청구)를 함께 준다.

export type SettlementMonthVerdict =
  | { ok: true; warning: string | null }
  | { ok: false; reason: string }

/** 'YYYY-MM-DD' 또는 Date 에서 'YYYY-MM' 뽑기 (UTC 기준 — DB 저장 규약) */
function monthOf(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.slice(0, 7) || null
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * 정산 귀속월이 손대도 되는 달인가.
 * @param mon       정산이 기록될 귀속월 'YYYY-MM'
 * @param todayYmd  오늘 날짜 'YYYY-MM-DD' (호출부가 KST 기준으로 넘긴다).
 *                  월이 아니라 날짜여야 5/31 같은 기한 경계를 그을 수 있다.
 * @param acquisition 영업장 인수일 (Date | 'YYYY-MM-DD' | null)
 */
export function checkSettlementMonth(
  mon: string,
  todayYmd: string,
  acquisition?: Date | string | null,
): SettlementMonthVerdict {
  if (!/^\d{4}-\d{2}$/.test(mon) || !/^\d{4}-\d{2}-\d{2}$/.test(todayYmd)) {
    return { ok: false, reason: '정산 귀속월 또는 오늘 날짜를 해석할 수 없습니다.' }
  }
  const todayMonth = todayYmd.slice(0, 7)
  // 미래·당월은 언제나 허용 — 아직 어떤 신고 대상도 아니다
  if (mon >= todayMonth) return { ok: true, warning: null }

  const acqMonth = monthOf(acquisition)
  if (acqMonth && mon < acqMonth) {
    return {
      ok: false,
      reason: `${fmt(mon)}은 영업장을 인수하기 전(${fmt(acqMonth)} 인수)이라 이 장부에 기록할 수 없습니다. 인수 이후 달로 정산하거나 수납 기록에서 직접 조정해 주세요.`,
    }
  }

  const year = Number(mon.slice(0, 4))
  const monthNum = Number(mon.slice(5, 7))

  // 유일한 연도 단위 차단선 — 그 귀속연도의 종합소득세 확정신고 기한이 지났는가
  const incomeTaxDue = `${year + 1}-05-31`
  if (todayYmd > incomeTaxDue) {
    return {
      ok: false,
      reason: `${fmt(mon)}은 종합소득세 확정신고(${year + 1}년 5월 31일)가 끝난 기간이라 이 앱에서 되돌릴 수 없습니다. 실제 환불금이 나가는 날짜로 이번 달 수납 기록에 조정을 기록하고, 메모에 "${fmt(mon)}분 퇴실 정산"이라고 남겨 주세요. 이미 신고했고 금액이 크다면 세무 담당자에게 경정청구를 문의하세요(법정신고기한 후 5년 이내).`,
    }
  }

  // 여기부터는 전부 허용. 중간 신고 기한만 고지 강도로 가른다.
  // 부가세 1기(1~6월분) 7/25 · 2기(7~12월분) 다음해 1/25. 면세는 사업장현황신고 다음해 2/10 이라
  // 과세·면세를 모르는 상태에서는 이른 날(부가세 기준)을 써서 고지가 빠지지 않게 한다.
  const filingDue = monthNum <= 6 ? `${year}-07-25` : `${year + 1}-01-25`
  if (todayYmd >= filingDue) {
    return {
      ok: true,
      warning: `${fmt(mon)} 장부가 바뀝니다. 그 기간 매출은 이미 신고했을 수 있어, 금액이 달라지면 수정신고나 경정청구가 필요할 수 있습니다. 세무 담당자에게 알려 주세요.`,
    }
  }
  return { ok: true, warning: `${fmt(mon)} 장부가 바뀝니다. 그 달 매출과 미수 숫자가 다시 계산됩니다.` }
}

const fmt = (mon: string) => `${Number(mon.slice(5, 7))}월(${mon.slice(0, 4)}년)`
