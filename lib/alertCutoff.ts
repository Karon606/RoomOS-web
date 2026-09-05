// 알림 컷오프 키 문법의 유일한 집 — 저장은 Property.alertMutes 의 {k:'cutoff:카테고리', at:'YYYY-MM-DD'} 행.
//
// 왜 있는가(운영자 오더 2026-09-06). "이미 인지했고 더이상 보여줄 필요가 없어. 특히 현금영수증
// 미발행 건들... 그 시점 기준으로 과거 알림을 삭제하고 더 안뜨게 하는 옵션이 있으면 좋겠어.
// **알림을 끄는 것과는 또다른거야.**"
//
// 끄기와 무엇이 다른가.
//   끄기   지목한 건 하나를 접는다. 끈 알림 목록에 쌓이고 거기서 다시 켠다.
//   컷오프 그 시점까지의 건을 통째로 안 보이게 한다. **목록에 쌓이면 안 된다** — 쌓이면
//          그것은 삭제가 아니라 끄기다.
//
// 저장 칸을 나누지 않고 키 문법으로 가르는 이유. dashboard/page 의 muteKeyOf 가 만드는 키는
// '{카테고리}:{식별자}' 꼴이라 'cutoff:' 접두어를 **만들 수가 없다.** 그래서 컷오프 행은 끈 알림
// 분류 루프에 구조적으로 못 들어간다 — 필터로 거르는 것이 아니라 애초에 매칭이 안 된다.
// 현금영수증 끈 건 집합도 'receipt:' 접두어로 거르므로 이 행은 거기에도 안 걸린다.
// readAlertMuteRows 가 {k,at} 모양이면 살리므로 끄기·켜기가 이 행을 건드리지 않고 실어 나른다.
//
// **삭제되는 것은 알림 표시뿐이다.** 미발행 건 자체와 발급 의무는 남고 현금영수증 탭 목록에도
// 그대로 있다. 문구가 그 구분을 말해야 한다 — 데이터에 '삭제'라는 말을 쓰지 않는다.

/** 컷오프를 쓸 수 있는 카테고리. 건마다 고유 시점이 있는 **축적형 이벤트** 알림만 해당한다. */
export type AlertCutoffCategory = 'receipt'

export const cutoffKeyOf = (c: AlertCutoffCategory) => `cutoff:${c}`

/**
 * 저장된 컷오프 일자. 없거나 모양이 깨졌으면 null 이고 그때는 아무것도 안 가린다(fail-open).
 * 알림이 조용히 죽는 것보다 하루 더 보이는 편이 낫다 — 기존 readAlertMuteRows 와 같은 축이다.
 */
export function readAlertCutoffYmd(raw: unknown, c: AlertCutoffCategory): string | null {
  if (!Array.isArray(raw)) return null
  const row = raw.find(m => !!m && (m as { k?: unknown }).k === cutoffKeyOf(c))
  const at = row ? (row as { at?: unknown }).at : null
  return typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : null
}
