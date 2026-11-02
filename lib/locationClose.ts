// 보관 위치 숨김(품목 하나의 위치 닫기)의 순수 판정 정본: 허브 승격 값, 수량 조사, 숨김 이관 메모 읽기.
import { withParticle, type ParticlePair } from '@/lib/koParticle'
//
// 허브 승격 규칙(운영자 승인 2026-10-28 결정 7). 품목의 실효 창고를 숨기면 남은 재고가 간 곳(또는 다음 열린 위치)이
// 새 창고가 된다. 그 곳이 **영업장 기본 창고와 같으면 hubLocationId 를 null 로 둔다**. 명시값으로 박으면 나중에 영업장
// 기본 창고를 바꿨을 때 이 품목만 옛 곳에 남는다(쌀처럼 기본 창고를 따르던 품목이 숨김 한 번으로 따라가기를 멈춘다).
// 다르면 그 곳을 명시한다(null 이면 폴백이 기본 창고로 돌아가 버려 옮긴 곳과 창고가 갈린다).
// 서버(closeItemLocation)가 쓰고 진리표는 scripts/test-location-close.ts.

/** 숨긴 뒤 품목의 hubLocationId 로 쓸 값. 새 창고가 영업장 기본 창고면 null(따라가기 유지), 아니면 그 id. */
export function hubAfterClose(newHubId: string, propertyDefaultHubId: string | null): string | null {
  return propertyDefaultHubId != null && newHubId === propertyDefaultHubId ? null : newHubId
}

// 수량 뒤 조사. 수량 표기는 '20kg'·'3L'·'12개' 처럼 단위로 끝나는데, 영문 단위는 정본(withParticle)이 받침 없음으로 보아
// '20kg가' 가 된다. 읽는 소리('킬로그램')로 판정해야 '20kg이' 다. 단위가 영업장마다 자유 입력이라 읽기를 아는 단위만
// 바꿔 판정하고, 모르는 영문은 정본 규칙(받침 없음)에 맡긴다. 판정만 바꾸고 화면 글자는 그대로다.
const UNIT_READING: Record<string, string> = {
  kg: '킬로그램', g: '그램', mg: '밀리그램',
  l: '리터', ml: '밀리리터',
  m: '미터', cm: '센티미터', mm: '밀리미터', km: '킬로미터',
}

/** '20kg' + '이/가' 는 '20kg이', '3L' + '을/를' 은 '3L를', '12개' + '은/는' 은 '12개는'. */
export function withQtyParticle(qtyText: string, pair: ParticlePair): string {
  const m = /([A-Za-z]+)$/.exec(qtyText)
  const reading = m ? UNIT_READING[m[1].toLowerCase()] : undefined
  if (!reading) return withParticle(qtyText, pair)
  // 읽는 말로 조사를 고르고 붙은 꼬리만 원래 글자 뒤에 붙인다.
  const judged = withParticle(reading, pair)
  return qtyText + judged.slice(reading.length)
}

// 재고가 남은 보관 위치를 숨기거나 떼려 할 때의 거부 문장. 품목 설정 캡션과 서버(setItemLocations) 거부가 이 한 벌을 쓴다
// (독립 검수 2026-10-28 차단 1). 옮길 다른 열린 위치가 없을 때 '다른 위치를 켜고 저장' 만 말하면, 그대로 따라 하면 재고 든
// 칸이 꺼진 채 저장돼 서버가 거부한다. 그래서 두 단계를 사실대로 말한다. 이 칸은 켠 채로 저장하고, 그다음 여기서 옮긴다.
// 옮길 위치가 있으면(서버만 이 갈래를 쓴다. 화면은 같은 자리에 '옮기고 숨기기' 링크를 띄운다) 그 링크를 가리킨다.
export function stockedHideDenied(pathName: string, leftWithParticle: string, hasTarget: boolean): string {
  return hasTarget
    ? `${pathName}에 ${leftWithParticle} 남아 있어 뗄 수 없습니다 · 보관 위치 칩 아래 '옮기고 숨기기'로 옮기면 됩니다`
    : `${pathName}에 ${leftWithParticle} 남아 있어 숨길 수 없습니다 · 이 칸은 켠 채로 옮길 위치를 하나 더 켜고 저장하면 여기서 옮길 수 있습니다`
}

// 숨김 이관 메모 읽기. closeItemLocation 이 남기는 장부 문자열은
//   `위치 숨김: {출발 경로}에서 {도착 경로}(으)로 {수량} 이관`
// 이고 품목 설정 '숨긴 위치' 목록의 캡션('20kg은 603호 창고로 옮겨짐')이 이 기록을 읽는다. 별도 칸을 두지 않은 까닭은
// 이력 불변이다. 기록이 곧 사실이라 위치 이름을 나중에 바꿔도 그때 옮긴 곳 이름 그대로 말한다.
export const HIDE_MEMO_PREFIX = '위치 숨김: '

/** 숨김 이관 메모에서 도착 경로·수량을 읽는다. 꼴이 아니면 null. */
export function parseHideTransferMemo(memo: string | null | undefined): { toPathName: string; qty: number } | null {
  if (!memo || !memo.startsWith(HIDE_MEMO_PREFIX)) return null
  const m = /에서 (.+?)(?:으로|로) ([0-9]+(?:\.[0-9]+)?) 이관$/.exec(memo.slice(HIDE_MEMO_PREFIX.length))
  if (!m) return null
  const qty = Number(m[2])
  return Number.isFinite(qty) ? { toPathName: m[1], qty } : null
}
