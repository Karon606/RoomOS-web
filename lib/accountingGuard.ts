// 과거 회계월 보호 정본 — 정산·환불이 이미 신고를 마친 달을 조용히 뒤집는 것을 막는다.
//
// 왜 필요한가: 이 앱에는 월 마감·잠금 개념이 스키마에도 코드에도 없다(2026-08-01 전수 확인).
// 유일한 방어가 락인(record.expectedAmount)이었는데, 퇴실 정산액이 그보다 우선순위가 높다
// (lib/billing.ts). 지금까지 안전했던 이유는 정산월이 항상 퇴실월(현재 또는 미래)이었기 때문이고,
// 그 전제가 깨지는 작업을 하는 중이라 여기서 선을 긋는다.
//
// 경계선은 임의의 'N개월 전'이 아니라 **신고 시점**이다(회계 패널 2026-08-01).
//   · 전년도 귀속월 — 종합소득세 확정신고(다음해 5/31)가 끝난 구간. **차단.**
//     여기를 건드리면 이미 낸 신고서, 다음 해 이월 미수, 장부가 3중으로 어긋난다.
//   · 인수(前 소유주) 이전 — 우리 장부가 아니다. **차단.**
//   · 같은 해 과거 달 — 아직 소득세 신고 전이라 장부가 사실을 따라가는 게 정상. **허용하되 알린다.**
//     다만 부가세 확정신고(1기 7/25, 2기 다음해 1/25)를 이미 낸 기간이면 수정신고·경정청구가
//     따라와야 하므로 그 사실을 문구로 알린다.
//
// 차단만 하고 끝내면 운영자가 막힌 채로 남는다. 이유와 대안(당월 조정)을 반드시 함께 준다.

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
 * @param mon        정산이 기록될 귀속월 'YYYY-MM'
 * @param todayMonth 오늘이 속한 달 'YYYY-MM' (호출부가 KST 기준으로 넘긴다)
 * @param acquisition 영업장 인수일 (Date | 'YYYY-MM-DD' | null)
 */
export function checkSettlementMonth(
  mon: string,
  todayMonth: string,
  acquisition?: Date | string | null,
): SettlementMonthVerdict {
  if (!/^\d{4}-\d{2}$/.test(mon) || !/^\d{4}-\d{2}$/.test(todayMonth)) {
    return { ok: false, reason: '정산 귀속월을 해석할 수 없습니다.' }
  }
  // 미래·당월은 언제나 허용 — 아직 신고 대상이 아니다
  if (mon >= todayMonth) return { ok: true, warning: null }

  const acqMonth = monthOf(acquisition)
  if (acqMonth && mon < acqMonth) {
    return {
      ok: false,
      reason: `${fmt(mon)}은 영업장을 인수하기 전(${fmt(acqMonth)} 인수)이라 이 장부에 기록할 수 없습니다. 인수 이후 달로 정산하거나 수납 기록에서 직접 조정해 주세요.`,
    }
  }

  const year = mon.slice(0, 4)
  const thisYear = todayMonth.slice(0, 4)
  if (year < thisYear) {
    return {
      ok: false,
      reason: `${fmt(mon)}은 지난해라 종합소득세 신고가 끝난 구간입니다. 여기를 고치면 이미 낸 신고서와 장부가 어긋납니다. 이번 달 수납 기록에서 조정으로 처리해 주세요.`,
    }
  }

  // 같은 해 과거 달 — 허용하되 부가세 확정신고를 이미 낸 기간이면 알린다.
  // 1기(1~6월) 확정신고 7/25, 2기(7~12월)는 다음해 1/25이라 같은 해 안에서는 2기가 걸릴 일이 없다.
  const monNum = Number(mon.slice(5, 7))
  const todayNum = Number(todayMonth.slice(5, 7))
  const vatFirstHalfFiled = monNum <= 6 && todayNum >= 8   // 7/25 지난 뒤 = 8월부터로 본다
  return {
    ok: true,
    warning: vatFirstHalfFiled
      ? `${fmt(mon)} 장부가 바뀝니다. 부가가치세 1기 확정신고(7월 25일)가 이미 지난 기간이라, 금액이 달라지면 수정신고나 경정청구가 필요할 수 있습니다. 세무 담당자에게 알려 주세요.`
      : `${fmt(mon)} 장부가 바뀝니다. 그 달 매출과 미수 숫자가 다시 계산됩니다.`,
  }
}

const fmt = (mon: string) => `${Number(mon.slice(5, 7))}월(${mon.slice(0, 4)}년)`
