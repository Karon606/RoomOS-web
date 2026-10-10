// 자재 상세 구매 내역 밑 '같은 구매' 계보 한 줄을 조립하는 순수층. 진리표는 scripts/test-asset-disposal ⑮.
//
// 왜 뺐나. AssetsClient 는 'use client' 라 그 안의 조립에 진리표가 못 붙는데, 짝을 카드 단위로 접는 규칙
// (2026-10-10 디자이너 패스 후속, 운영자 승인)은 셈이 여럿 겹쳐 글자만 보는 그물로는 못 지킨다.
// 자리 이름(curPlace)·수령 대기 판정·금액·수량 표기는 화면 정본을 그대로 받는다. 여기서 다시 만들면
// 같은 자리가 두 화면에서 다른 이름이 된다.
//
// 계보 줄은 '지금 어디에 몇 개', 배정 변경 이력은 '언제 어디서 어디로'다. 셋째 축(이벤트 표)을 만들지 않는다.
// 묶음 id 는 분할(buildSplitOps) 때만 생긴다. 통째로 옮긴 것은 묶음이 없고 그 행방은 이력이 말한다.
import type { AssetItem } from './aggregate'

export type SameBuyMember = { item: AssetItem; row: AssetItem['breakdown'][number] }

/** 같은 구매 묶음(allocationGroupId) 색인. 짝이 다른 버킷(수령 대기·방·공용부·공용 자재·미배정)에 가 있으므로
 *  **모든 카드**를 넣어야 한다. 한 버킷만 넣으면 짝이 빠져 합계가 산 수보다 적게 나온다. */
export function sameBuyIndex(items: AssetItem[]): Map<string, SameBuyMember[]> {
  const m = new Map<string, SameBuyMember[]>()
  for (const item of items) for (const row of item.breakdown) {
    if (row.groupId) (m.get(row.groupId) ?? m.set(row.groupId, []).get(row.groupId)!).push({ item, row })
  }
  return m
}

export type LineageCtx = {
  placeOf: (it: AssetItem) => string       // 화면 정본 curPlace
  isPending: (it: AssetItem) => boolean    // 수령 대기 버킷의 카드인가
  won: (n: number) => string               // fmtWon(§06 단일 경로)
  fmtQty: (n: number) => string
}

// 날짜는 같은 모달의 폐기·분실 이력, 배정 변경 이력과 같은 YY-MM-DD 다. MM-DD 는 해를 넘긴 배정
// (12월 구매·1월 배정)에서 모호하다.
const yy = (ymd: string) => ymd.slice(2)
// 여럿이 모두 같은 날일 때만 그 날을 쓴다. 다르면 안 쓴다(대표 하나를 골라 지어내지 않는다).
const oneDay = (ds: (string | null)[]) => (ds.length > 0 && ds.every(d => d != null && d === ds[0]) ? ds[0] : null)

/**
 * 계보 한 줄. 짝은 행이 아니라 **카드**로 접는다. 행 단위로 늘어놓으면 같은 자리가 한 줄에 두 번 섰다
 * (`504호 1개 (09-16 폐기) · 504호 1개 (06-30 배정)`). 지금 카드의 행은 전부 `여기` 하나로 합친다.
 * 한 카드의 몫은 `{자리} {살아 있는 수} ({배정일} 배정), 폐기 {수} ({폐기일})` 이고 폐기만 남았으면
 * `{자리} 폐기 {수} ({폐기일})` 이다. 폐기를 `폐기 N개` 로 적는 것은 배치 현황 칩 부기와 같은 말이다.
 *
 * 줄이 안 서는 경우(null). 묶음이 없다 · 이 카드 말고 다른 카드가 없다(추적할 행방이 없다. 이 카드 안의
 * 폐기는 바로 위 폐기·분실 이력이 말한다) · 단위가 섞였다(합계가 거짓말이 된다. 장판몰딩 m·개).
 * 수량 미기록 행은 1로 센다(liveUnits·게이트·분할과 같은 셈법). 합계는 폐기까지 전부다(돈의 축).
 */
export function lineageLine(all: SameBuyMember[] | undefined, hereId: string, ctx: LineageCtx): string | null {
  if (!all || all.length < 2) return null
  const cards = new Map<string, SameBuyMember[]>()
  for (const p of all) (cards.get(p.item.id) ?? cards.set(p.item.id, []).get(p.item.id)!).push(p)
  if (!cards.has(hereId) || cards.size < 2) return null
  const units = new Set(all.map(p => p.item.qtyUnit ?? '개'))
  if (units.size > 1) return null
  const unit = [...units][0]
  const n = (r: { qty: number | null }) => r.qty ?? 1
  const q = (ms: SameBuyMember[]) => `${ctx.fmtQty(ms.reduce((s, p) => s + n(p.row), 0))}${unit}`
  const total = `같은 구매 ${q(all)} ${ctx.won(all.reduce((s, p) => s + p.row.amount, 0))}`
  const share = (ms: SameBuyMember[], name: string, withAssigned: boolean) => {
    const live = ms.filter(p => !p.row.disposed)
    const dead = ms.filter(p => p.row.disposed)
    const bits: string[] = []
    if (live.length > 0) {
      const day = withAssigned ? oneDay(live.map(p => p.row.assignedAt)) : null
      const tag = ctx.isPending(live[0].item) ? ' (수령 대기)' : day ? ` (${yy(day)} 배정)` : ''
      bits.push(`${name} ${q(live)}${tag}`)
    }
    if (dead.length > 0) {
      const day = oneDay(dead.map(p => p.item.disposals.find(d => d.id === p.row.id)?.disposedAt ?? null))
      bits.push(`${live.length > 0 ? '' : `${name} `}폐기 ${q(dead)}${day ? ` (${yy(day)})` : ''}`)
    }
    return bits.join(', ')
  }
  // `여기`에는 배정일을 안 붙인다. 지금 카드의 배정일은 바로 위 카드 머리가 말한다.
  const here = share(cards.get(hereId)!, '여기', false)
  // 다른 자리가 둘 이상이고 전부 살아 있는 몫만 있고(폐기 부기·수령 대기 없음) 배정일이 하나로 모이면 그 날을
  // `여기` 바로 뒤에 `나머지 {날} 배정` 한 번만 쓴다. SUS 앵글밸브 15A 묶음은 17곳이 전부 같은 날이라 같은
  // 괄호가 17번 서서 줄의 절반 넘게 사실 하나를 되풀이했다(439자, 폰에서 8줄, 독립 검수 2026-10-10).
  // 끝에 두면 마지막 토막에 붙어 읽히고, `모두`라 쓰면 `여기`까지 포함해 읽혀 거짓이 된다.
  // 미배정·공용 자재(방도 공용부도 없는 카드)는 배정일이 없는 게 정상이라 날짜 판정에서 빼고 `나머지` **앞**에
  // 세운다. 빼지 않으면 앵글밸브 묶음을 방 카드 16곳에서 볼 때 `미배정(여분) 8개` 하나 때문에 안 접힌다.
  // 방·공용부인데 배정일이 빈 카드(418호)는 판정에 남아 접기를 막는다(그 날 배정이라고 지어내지 않는다).
  const otherCards = [...cards.entries()].filter(([id]) => id !== hereId).map(([, ms]) => ms)
  const allLive = otherCards.every(ms => ms.every(p => !p.row.disposed) && !ctx.isPending(ms[0].item))
  const placed = otherCards.filter(ms => ms[0].item.roomId || ms[0].item.locationId)
  const unplaced = otherCards.filter(ms => !(ms[0].item.roomId || ms[0].item.locationId))
  const sharedDay = placed.length >= 2 && allLive ? oneDay(placed.flatMap(ms => ms.map(p => p.row.assignedAt))) : null
  const seg = (ms: SameBuyMember[]) => share(ms, ctx.placeOf(ms[0].item), sharedDay == null)
  const others = sharedDay ? [...unplaced.map(seg), `나머지 ${yy(sharedDay)} 배정`, ...placed.map(seg)] : otherCards.map(seg)
  return [total, here, ...others].join(' · ')
}
