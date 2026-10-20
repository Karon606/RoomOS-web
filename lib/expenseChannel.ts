// 지출의 구매처(실제 판매자)와 쇼핑몰(주문을 받은 플랫폼) 저장·표시 규칙 정본(순수). 서버 저장 경로·화면·그물이 같은 함수를 쓴다.
//
// 뜻(2026-10-19 운영자 승인, 신고 a0636f36 "구매처랑 실제 구매한 쿠팡이나 옥션, 지마켓과 같은 채널").
//   · 구매처(vendor·vendorBizNo)는 실제 판매자다. 사업자번호의 주인이다.
//   · 쇼핑몰(channel)은 주문을 받은 플랫폼 서비스 이름이다. 오프라인이면 비운다(화면 안내만 '비우면 구매처와 같음').
//   · 비운 쇼핑몰은 '미기록'이다. 코드는 구매처를 쇼핑몰 자리에 끌어 쓰지 않는다. 옛 판매자 행 87건이 거짓 쇼핑몰이 되지 않게다.
//     그래서 '쇼핑몰 ?? 구매처' 같은 대신 쓰기를 두지 않는다(scripts/check-expense-channel-wiring 이 소스를 본다).
//   · 결제대행사(네이버파이낸셜 등)는 어느 쪽에도 안 적는다(폼 안내 문장).
//   · 한 주문(한 결제)의 행은 같은 쇼핑몰이다(배송비 행 포함).
//   · 품목별 구매처는 다품목에서만 따로 적는다. 그 사업자번호는 입력 칸이 없고, 이 영업장 과거 기록에 그 구매처 번호가 있으면
//     그것, 없으면 비운다. **머리 구매처(예: 쿠팡) 번호를 다른 판매자 행에 물려주지 않는다.**
//   · 쇼핑몰 목록(Property.channelOptions)의 이름은 판매자 자리의 자동 기능에서 빠진다. 구매처 자동완성, 사업자번호 소급,
//     번호로 이름 채우기 지도가 그렇다. 플랫폼 이름이 판매자로 퍼지지 않게다.
// 'use server' 파일이 아니다. 서버 액션·클라이언트·스크립트가 함께 읽는다.
import { normalizeOptionName } from '@/lib/optionLists'

/** 쇼핑몰 칸의 저장 값. 목록 이름 정규화(쉼표는 저장 구분자라 공백)와 같다. 빈 값은 null(미기록). */
export function normalizeChannel(raw: string | null | undefined): string | null {
  return normalizeOptionName('channelOptions', raw) || null
}

const key = (v: string | null | undefined) => (v ?? '').trim()

/**
 * 쇼핑몰 목록 이름 견주기 열쇠(정본 한 곳). 앞뒤 공백을 걷고 라틴 문자 대소문자를 무시한다('Coupang' 과 'coupang' 은 같은 이름).
 * 그 밖의 글자는 그대로 견준다('쿠팡' 과 '쿠팡(주)' 는 다른 이름이다). 장부 그물(scripts/order-channel-audit)도 같은 규칙(lower·btrim)이다.
 */
export function channelKey(v: string | null | undefined): string {
  return key(v).toLowerCase()
}

/** 이 이름이 쇼핑몰 목록의 이름인가(channelKey 로 견준다). */
export function isChannelName(name: string | null | undefined, channelNames: readonly string[]): boolean {
  const k = channelKey(name)
  return !!k && channelNames.some(c => channelKey(c) === k)
}

/**
 * 쇼핑몰 저장 값. 정규화한 뒤 목록에 같은 열쇠(대소문자만 다른) 이름이 있으면 목록의 표기를 쓴다. 한 쇼핑몰이 두 표기로 갈리지 않게 한다.
 */
export function channelForSave(raw: string | null | undefined, channelNames: readonly string[]): string | null {
  const v = normalizeChannel(raw)
  if (!v) return null
  return channelNames.find(c => channelKey(c) === channelKey(v)) ?? v
}

/**
 * 한 행에 실제로 적을 쇼핑몰(운영자 결정 2026-10-20 A). 쇼핑몰이 그 행 구매처와 같은 이름(channelKey)이면 비운다.
 * 화면 안내 '비우면 구매처와 같음' 과 같은 뜻이다(다이소에서 산 것을 쇼핑몰 '다이소' 로 두 번 적지 않는다). 그런 이름은 목록에도 안 쌓는다.
 * 같은 주문 안에서 이 규칙으로 비는 행은 갈림이 아니다(장부 그물은 미기록 섞임을 경고로만 센다).
 */
export function rowChannel(channel: string | null | undefined, vendor: string | null | undefined): string | null {
  const c = key(channel)
  if (!c) return null
  return channelKey(c) === channelKey(vendor) ? null : c
}

/** 폼 안내: 쇼핑몰 칸이 구매처 칸과 같은 이름인가(저장하면 비운다). */
export function channelSameAsVendor(channel: string | null | undefined, vendor: string | null | undefined): boolean {
  return !!key(channel) && channelKey(channel) === channelKey(vendor)
}

/**
 * 한 주문 안 쇼핑몰이 둘로 갈리는가(이번 쓰기 뒤 모양). 비어 있는 값은 안 센다. 서버 쓰기 관문이 쓴다(한 주문 = 한 쇼핑몰, 결정 B).
 */
export function wouldSplitOrder(channelsAfter: readonly (string | null | undefined)[]): boolean {
  return new Set(channelsAfter.map(v => key(v)).filter(Boolean)).size > 1
}

/** 폼 안내: 쇼핑몰 칸이 구매처 칸과 같은 이름일 때(결정 A). 재무 등록·수정, 일괄 편집, 소모품 구매 수정이 한 벌로 쓴다. 홈 승인 카드는 칸 이름이 '상호명' 이라 그 낱말로 바꿔 쓴다. */
export const CHANNEL_SAME_AS_VENDOR_HINT = '구매처와 같으면 비워 두세요. 저장할 때 비웁니다.'

/** 주문 갈림 물음의 꼬리(재무 수정 폼·일괄 편집·소모품 구매 수정). 갈래는 [주문 전체에 적용 / 취소] 둘뿐이라 다른 길을 함께 말한다(결정 B). */
export const ORDER_CHANNEL_SPLIT_TAIL = '결제가 정말 다르면 취소하고 먼저 지출 상세에서 그 지출을 주문 묶음에서 빼 주세요.'

/** 주문 갈림 쓰기를 거절할 때의 문장(서버). 결제가 정말 다르면 먼저 주문에서 빼라는 안내까지 한 벌이다. */
export const ORDER_CHANNEL_SPLIT_DENIED = '한 주문은 한 쇼핑몰입니다. 주문 전체에 같은 쇼핑몰을 적거나, 결제가 정말 다르면 먼저 지출 상세에서 그 지출을 주문 묶음에서 빼 주세요.'

/**
 * 구매처 ↔ 사업자번호 지도. 번호가 있는 지출을 **최근순으로** 넘겨받아 구매처별 최근 번호, 번호별 최근 구매처를 하나씩 뽑는다.
 * 쇼핑몰 목록 이름은 양쪽에서 뺀다. '쿠팡' 을 쇼핑몰로 정한 영업장에서 쿠팡 번호를 쳤을 때 구매처 칸이 '쿠팡' 으로 채워지면
 * 플랫폼이 판매자 자리에 선다.
 */
export function buildVendorBizMap(
  recentRows: readonly { vendor: string | null; vendorBizNo: string | null }[],
  channelNames: readonly string[],
): { vendorToBiz: Record<string, string>; bizToVendor: Record<string, string> } {
  const vendorToBiz: Record<string, string> = {}
  const bizToVendor: Record<string, string> = {}
  for (const r of recentRows) {
    const v = key(r.vendor)
    const b = key(r.vendorBizNo)
    if (!v || !b || isChannelName(v, channelNames)) continue
    if (!Object.hasOwn(vendorToBiz, v)) vendorToBiz[v] = b
    if (!Object.hasOwn(bizToVendor, b)) bizToVendor[b] = v
  }
  return { vendorToBiz, bizToVendor }
}

/**
 * 품목 한 줄의 구매처와 사업자번호.
 *   itemVendor undefined 이면 머리를 따른다(머리 구매처·머리 번호).
 *   itemVendor '' 이면 비운다(구매처·번호 둘 다 없음).
 *   머리와 같은 글자면 머리를 따른다.
 *   다른 판매자면 그 판매자의 과거 번호(vendorToBiz), 없으면 null. 머리 번호는 절대 안 쓴다.
 */
export function itemVendorFor(
  head: { vendor: string | null; vendorBizNo: string | null },
  itemVendor: string | null | undefined,
  vendorToBiz: Readonly<Record<string, string>>,
): { vendor: string | null; vendorBizNo: string | null } {
  if (itemVendor === undefined || itemVendor === null) return { vendor: key(head.vendor) || null, vendorBizNo: head.vendorBizNo ?? null }
  const v = key(itemVendor)
  if (!v) return { vendor: null, vendorBizNo: null }
  if (v === key(head.vendor)) return { vendor: v, vendorBizNo: head.vendorBizNo ?? null }
  return { vendor: v, vendorBizNo: Object.hasOwn(vendorToBiz, v) ? vendorToBiz[v] : null }
}

/**
 * 같은 구매처의 번호 빈 과거 지출을 이 번호로 채워도 되는가(사업자번호 소급).
 * 쇼핑몰 목록 이름은 안 채운다(그 이름의 행은 판매자가 제각각이다). 품목별 구매처로 들어온 이름도 부르는 쪽이 넘기지 않는다.
 */
export function bizBackfillAllowed(vendor: string | null | undefined, bizNo: string | null | undefined, channelNames: readonly string[]): boolean {
  return !!key(vendor) && !!key(bizNo) && !isChannelName(vendor, channelNames)
}

/** 구매처 자동완성 후보에서 쇼핑몰 목록 이름을 뺀다. 순서는 그대로다. */
export function vendorSuggestionsWithoutChannels(vendors: readonly string[], channelNames: readonly string[]): string[] {
  return vendors.filter(v => !isChannelName(v, channelNames))
}

/**
 * 한 줄 요약('쿠팡 · 철물24'). 쇼핑몰 먼저, 같거나 하나뿐이면 한 번. 둘 다 없으면 null.
 * 쇼핑몰이 비었으면 구매처만 말한다(쇼핑몰 자리에 구매처를 대신 세우지 않는다, 그냥 한 이름이다).
 */
export function channelVendorLabel(channel: string | null | undefined, vendor: string | null | undefined): string | null {
  const c = key(channel), v = key(vendor)
  if (c && v) return c === v ? c : `${c} · ${v}`
  return c || v || null
}

/** 여러 행(한 주문)의 쇼핑몰. 값이 하나로 모이면 그 이름, 비었거나 갈리면 null. 미기록 행은 세지 않는다. */
export function commonChannel(rows: readonly { channel?: string | null }[]): string | null {
  const vals = new Set(rows.map(r => key(r.channel)).filter(Boolean))
  return vals.size === 1 ? [...vals][0] : null
}

/**
 * 주문 캡션의 쇼핑몰 주문번호 줄('주문 261013-001 · 쿠팡 31000…'). 낱말 '쇼핑몰' 자리에 실제 이름이 선다.
 * 그 주문의 쇼핑몰이 하나로 모이지 않으면(미기록·갈림) 종전대로 '쇼핑몰' 이다. 주문번호가 없으면 null.
 */
export function externalOrderCaption(externalOrderNo: string | null | undefined, rows: readonly { channel?: string | null }[]): string | null {
  const no = key(externalOrderNo)
  if (!no) return null
  return `${commonChannel(rows) ?? '쇼핑몰'} ${no}`
}

/** 주문별 보기 한 줄의 판매처 요약. 쇼핑몰 먼저, 구매처는 첫 이름 + '외 N'('쿠팡 · 철물24 외 1'). */
export function orderSellerLabel(rows: readonly { channel?: string | null; vendor?: string | null }[]): string | null {
  const vendors = [...new Set(rows.map(r => key(r.vendor)).filter(Boolean))]
  const ch = commonChannel(rows)
  const rest = ch ? vendors.filter(v => v !== ch) : vendors
  const vendorPart = rest.length > 1 ? `${rest[0]} 외 ${rest.length - 1}` : (rest[0] ?? null)
  return channelVendorLabel(ch, vendorPart)
}

/**
 * 한 주문 안 쇼핑몰 갈림. distinct 는 미기록이 아닌 서로 다른 이름, unset 은 미기록 행 수.
 * distinct 가 둘 이상이면 오류(한 결제는 한 플랫폼), 하나에 미기록이 섞이면 경고(옛 행을 아직 안 정했다)다.
 */
export function orderChannelSplit(rows: readonly { channel?: string | null }[]): { distinct: string[]; unset: number } {
  const distinct = [...new Set(rows.map(r => key(r.channel)).filter(Boolean))].sort()
  return { distinct, unset: rows.filter(r => !key(r.channel)).length }
}

/**
 * 주문 속 한 행의 쇼핑몰을 바꿀 때 다른 행과 갈리는가. 갈리면 그 행 수와 이름들('쿠팡', 미기록은 '미기록').
 * 같으면 null. 수정 폼 경고와 저장 직전 물음이 같은 함수를 쓴다.
 */
export function channelSplitAgainst(siblings: readonly { channel?: string | null }[], next: string | null | undefined): { count: number; names: string[]; unset: number } | null {
  const n = key(next)
  const differing = siblings.filter(s => key(s.channel) !== n)
  if (differing.length === 0) return null
  const names = [...new Set(differing.map(s => key(s.channel)).filter(Boolean))]
  return { count: differing.length, names, unset: differing.filter(s => !key(s.channel)).length }
}

/**
 * 갈린 형제를 사람 말로('쿠팡입니다' · '쇼핑몰이 비어 있습니다' · '쿠팡이거나 쇼핑몰이 비어 있습니다'). 수정 폼 경고 상자와 저장 직전 물음이 쓴다.
 * 화면 문장에는 '미기록' 이라는 낱말을 쓰지 않는다(운영자 말이 아니다, 독립 검수 2026-10-20).
 */
export function splitSiblingsText(split: { names: string[]; unset: number }): string {
  if (split.names.length && split.unset) return `${split.names.join(', ')}이거나 쇼핑몰이 비어 있습니다`
  if (split.names.length) return `${split.names.join(', ')}입니다`
  return '쇼핑몰이 비어 있습니다'
}

/**
 * 쇼핑몰 목록 이름이 구매처 자리에 있을 때 이름 변경·합치기를 막는 까닭(서버 renameVendor 거부 문장과 구매처 관리 화면 캡션이 한 벌).
 * 행동 낱말은 '쇼핑몰로'(구매처 관리의 행 동작·알약·창 제목 '쇼핑몰로 옮기기'와 같다).
 */
export const VENDOR_CHANNEL_LOCKED = "쇼핑몰 목록의 이름은 구매처로 바꾸거나 합칠 수 없습니다. '쇼핑몰로'를 눌러 쇼핑몰 칸에 옮기세요."

/** 묶을 행들의 쇼핑몰이 서로 다른가(미기록은 빼고 센다). 다르면 그 이름들. 주문 묶기·같은 주문 합류가 막는 조건이다. */
export function mergeChannelConflict(rows: readonly { channel?: string | null }[]): string[] | null {
  const { distinct } = orderChannelSplit(rows)
  return distinct.length > 1 ? distinct : null
}
